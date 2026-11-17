// 判定Lambda。最大ターン数で終わった議論を、審判(judges)ごとに採点してDebatesの verdict に保存する。
// 仕様: docs/03-engine/README.md「優劣判定」「判定Lambda」
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Debate, Verdict } from '@agorawl/contract';
import { converse, ddb, loadMessages, requireEnv } from './aws';
import { classifyError } from './errors';
import { finalClaims, finalRebuttals, majorityWinner, parseJudgeOutput } from './judging';
import { buildJudgeSystemPrompt, buildJudgeUserMessage } from './prompts';
import { collectSources } from './sources';

export interface JudgeInput {
  debateId: string;
}

// 採点のぶれを抑えるため temperature を低くする。考える過程を長く出すモデルがあるため、上限に余裕を持たせる
const INFERENCE_CONFIG = { maxTokens: 8000, temperature: 0.2 };

const DEBATES_TABLE = requireEnv('DEBATES_TABLE');
const MESSAGES_TABLE = requireEnv('MESSAGES_TABLE');

export async function handler(event: JudgeInput): Promise<JudgeInput> {
  try {
    await judge(event);
    return event;
  } catch (err) {
    throw classifyError(err);
  }
}

async function judge({ debateId }: JudgeInput): Promise<void> {
  const res = await ddb.send(new GetCommand({ TableName: DEBATES_TABLE, Key: { debateId }, ConsistentRead: true }));
  const debate = res.Item as Debate | undefined;
  if (!debate) throw new Error(`議論が見つかりません: ${debateId}`);
  // judges がない場合と、再試行で既に保存済みの場合は何もしない
  if (!debate.judges?.length || debate.verdict) return;

  const messages = await loadMessages(MESSAGES_TABLE, debateId);
  const claims = { pro: finalClaims(messages, 'pro'), con: finalClaims(messages, 'con') };
  const rebuttals = { pro: finalRebuttals(messages, 'pro'), con: finalRebuttals(messages, 'con') };
  const user = buildJudgeUserMessage(messages, collectSources(messages), debate.positions, claims, rebuttals);
  const ids = {
    claims: { pro: claims.pro.map((c) => c.id), con: claims.con.map((c) => c.id) },
    rebuttals: { pro: rebuttals.pro.map((r) => r.id), con: rebuttals.con.map((r) => r.id) },
  };

  // 審判は同時に呼ぶ(待ち時間を1人分に抑える)。1人でも形式が誤っていれば、再試行ですべて呼び直す
  const judgments = await Promise.all(
    debate.judges.map(async ({ modelId, viewpoint }) => {
      // 観点は審判ごとに違うため、システムプロンプトは審判ごとに作る
      const output = await converse(modelId, buildJudgeSystemPrompt(debate, viewpoint), user, INFERENCE_CONFIG);
      return parseJudgeOutput(output, modelId, new Date().toISOString(), ids, viewpoint);
    }),
  );
  const verdict: Verdict = { judgments, winner: majorityWinner(judgments) };
  console.log(JSON.stringify({ debateId, winners: judgments.map((j) => j.winner), winner: verdict.winner }));

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: DEBATES_TABLE,
        Key: { debateId },
        UpdateExpression: 'SET verdict = :v',
        ConditionExpression: 'attribute_exists(debateId) AND attribute_not_exists(verdict)',
        ExpressionAttributeValues: { ':v': verdict },
      }),
    );
  } catch (err) {
    // 既に保存されている場合は、保存済みとして扱う
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

