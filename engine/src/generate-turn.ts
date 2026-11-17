// 発言生成Lambda。1回の呼び出しで1ターン分の発言を生成して保存する。
// 仕様: docs/03-engine/README.md「発言生成Lambdaの入出力」「実行方式と失敗時の扱い」「作戦メモ」「投了」「Web検索と資料一覧」
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Debate, DebaterRole, EndReason, Message, Source } from '@agorawl/contract';
import {
  converse as converseWith,
  converseWithSearch,
  ddb,
  loadMessages as loadMessagesFrom,
  requireEnv,
} from './aws';
import { webSearch } from './search';
import { collectSources, extractCitations, nextSourceId, searchResultText } from './sources';
import { classifyError } from './errors';
import { sectionLengths } from './converse-output';
import { isExhausted, parseDebaterOutput, mergeNotes, shouldConcede } from './notes';
import {
  buildConcessionSystemPrompt,
  buildConcessionUserMessage,
  buildDebaterSystemPrompt,
  buildDebaterUserMessage,
  visibleToDebater,
} from './prompts';
import { OPENING_TURNS, planTurn, remainingTurns, turnEnd } from './turn-plan';

export interface GenerateTurnInput {
  debateId: string;
  turn: number;
}

export interface GenerateTurnOutput extends GenerateTurnInput {
  /** このターンの発言で議論を終えたら true(ターンN、投了、引き分け) */
  finished: boolean;
  endReason: EndReason | null;
  concededBy: DebaterRole | null;
}

// Bedrockの呼び出し設定(全役割で共通)
const INFERENCE_CONFIG = { maxTokens: 8000, temperature: 0.7 };

// 1ターンの検索回数の上限(docs/03-engine/README.md「Web検索と資料一覧」)
const MAX_SEARCHES_PER_TURN = 3;

/** 引用がない項目は保存しない */
function citationFields({ citations, invalid }: { citations: number[]; invalid: number[] }) {
  return {
    ...(citations.length ? { citations } : {}),
    ...(invalid.length ? { invalidCitations: invalid } : {}),
  };
}

const DEBATES_TABLE = requireEnv('DEBATES_TABLE');
const MESSAGES_TABLE = requireEnv('MESSAGES_TABLE');

export async function handler(event: GenerateTurnInput): Promise<GenerateTurnOutput> {
  try {
    return await generateTurn(event);
  } catch (err) {
    throw classifyError(err);
  }
}

async function generateTurn({ debateId, turn }: GenerateTurnInput): Promise<GenerateTurnOutput> {
  const debateRes = await ddb.send(
    new GetCommand({ TableName: DEBATES_TABLE, Key: { debateId }, ConsistentRead: true }),
  );
  const debate = debateRes.Item as Debate | undefined;
  if (!debate) throw new Error(`議論が見つかりません: ${debateId}`);

  const messages = await loadMessages(debateId);

  // 再試行で既に保存済みなら、Bedrockを呼ばずに次へ進む
  const saved = messages.find((m) => m.turn === turn);
  if (saved) return outcome(debateId, turn, saved, debate.maxTurns);

  const history = messages.filter((m) => m.turn < turn);
  // 投了・引き分けの発言で議論は終わるため、その後のターンは呼ばれない
  if (history.some((m) => m.conceded || m.exhausted)) {
    throw new Error(`議論は既に終わっています: debateId=${debateId}, turn=${turn}`);
  }
  const plan = planTurn(turn, debate.maxTurns);
  const role = plan.role;
  const participant = debate.participants.find((p) => p.role === role);
  if (!participant) throw new Error(`役割 ${role} の参加者が設定されていません`);
  const modelId = participant.modelId;

  const base = { debateId, turn, role, modelId, createdAt: '' };

  const latestNotesOf = (r: DebaterRole) => [...history].reverse().find((m) => m.role === r)?.notes;
  const previousNotes = latestNotesOf(role);
  const knownSources = collectSources(history);
  // 立論では相手の発言と資料を見せない。資料の通し番号は、見せない資料も含めて振る
  const visibleHistory = visibleToDebater(history, turn);
  const visibleSources = visibleToDebater(knownSources, turn);

  // 検索の依頼に応え、結果を資料一覧に通し番号で登録する
  const newSources: Source[] = [];
  const output = await converseWithSearch({
    modelId,
    system: buildDebaterSystemPrompt(role, debate),
    user: buildDebaterUserMessage({
      role,
      positions: debate.positions,
      history: visibleHistory,
      sources: visibleSources,
      previousNotes,
      turn,
      stage: plan.stage,
      remaining: remainingTurns(turn, debate.maxTurns),
    }),
    inferenceConfig: INFERENCE_CONFIG,
    maxSearches: MAX_SEARCHES_PER_TURN,
    onSearch: async (query) => {
      const found = await webSearch(query, debate.theme);
      const source: Source = {
        id: nextSourceId([...knownSources, ...newSources]),
        turn,
        role,
        query,
        ...found,
      };
      newSources.push(source);
      return searchResultText(source);
    },
  });
  const parsed = parseDebaterOutput(output, previousNotes);
  const speech = parsed.speech;
  const { citations, invalid } = extractCitations(speech, [...visibleSources, ...newSources]);
  // 出力は新しい項目と変えた項目だけのため、前回の作戦メモと合わせる
  const notes = mergeNotes(parsed.notes, previousNotes);
  const conceded = shouldConcede(notes);
  // 引き分けは、両者が一度ずつ攻めた後(ターン4以降)、投了しなかった場合のみ判定する
  const exhausted =
    !conceded && turn >= OPENING_TURNS + 2 && isExhausted(notes, latestNotesOf(role === 'pro' ? 'con' : 'pro'));
  console.log(
    JSON.stringify({
      debateId,
      turn,
      role,
      conceded,
      exhausted,
      searches: newSources.length,
      citations,
      invalid,
      // 作戦メモと発言の字数(どの部分が出力を膨らませているかを確かめるため)
      chars: sectionLengths(output),
    }),
  );

  // 投了なら、負けを認める発言に差し替える(作戦メモはそのまま保存する)
  const content = conceded
    ? await converse(
        modelId,
        buildConcessionSystemPrompt(role, debate),
        buildConcessionUserMessage({ role, positions: debate.positions, history: visibleHistory, notes, turn }),
      )
    : speech;
  const message: Message = {
    ...base,
    content,
    notes,
    conceded,
    exhausted,
    ...(newSources.length ? { sources: newSources } : {}),
    // 投了の発言に差し替えた場合は、差し替え後の発言から引用を取り出す
    ...citationFields(conceded ? extractCitations(content, [...visibleSources, ...newSources]) : { citations, invalid }),
  };
  message.createdAt = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: message,
        ConditionExpression: 'attribute_not_exists(#turn)',
        ExpressionAttributeNames: { '#turn': 'turn' },
      }),
    );
  } catch (err) {
    // 同じターンが既に保存されている場合は、保存済みとして扱う
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }

  return outcome(debateId, turn, message, debate.maxTurns);
}

/** 保存したターンの発言から、終了したか・終了理由を返す */
function outcome(debateId: string, turn: number, message: Message, maxTurns: number): GenerateTurnOutput {
  return { debateId, turn, ...turnEnd(turn, maxTurns, message) };
}

function converse(modelId: string, system: string, user: string): Promise<string> {
  return converseWith(modelId, system, user, INFERENCE_CONFIG);
}

function loadMessages(debateId: string): Promise<Message[]> {
  return loadMessagesFrom(MESSAGES_TABLE, debateId);
}
