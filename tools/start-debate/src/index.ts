// 動作確認用CLI: Debatesに議論を1件登録し、エンジン(Step Functions)を起動して、発言を順に表示する。
// 使い方: npm run start-debate -- "テーマ" "先攻の立場" "後攻の立場" [maxTurns(省略時10)]
// 本番スタックには含めない。HTTP APIができるまでの代わり。
import { randomUUID } from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  LIST_KEY,
  validateDebateSettings,
  type Debate,
  type DebaterNotes,
  type EngineStartInput,
  type Judge,
  type Verdict,
  type Message,
  type Participant,
  type Positions,
  type Role,
} from '@agorawl/contract';

// 動作確認用のモデルの組み合わせ(docs/03-engine/README.md)
const PARTICIPANTS: Participant[] = [
  { role: 'pro', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
  { role: 'con', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
];

// 審判は Claude Opus 4.6 の3人。観点(論理、根拠、反論・応答)を分ける(docs/03-engine/README.md「動作確認用のモデルの組み合わせ」)
const JUDGES: Judge[] = [
  { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'logic' },
  { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'evidence' },
  { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'exchange' },
];

const POLL_INTERVAL_MS = 3000;
// 見て楽しめる長さにする(docs/03-engine/README.md「動作確認用のモデルの組み合わせ」)。仕組みの検証では30などを指定する
const DEFAULT_MAX_TURNS = 10;

/** 話者の表示名(立場の名前) */
let positions: Positions;
const label = (role: Role) => `${positions[role]}側`;

async function main() {
  const [theme, proPosition, conPosition, maxTurnsArg] = process.argv.slice(2);
  if (!theme || !proPosition || !conPosition) {
    console.error(
      `使い方: npm run start-debate -- "テーマ" "先攻の立場" "後攻の立場" [maxTurns(4〜50の偶数、省略時${DEFAULT_MAX_TURNS})]`,
    );
    console.error('例: npm run start-debate -- "週休は何日がよいか" "週休3日制" "週休2日制(現状維持)" 10');
    process.exit(1);
  }
  positions = { pro: proPosition.trim(), con: conPosition.trim() };
  const maxTurns = maxTurnsArg ? Number(maxTurnsArg) : DEFAULT_MAX_TURNS;

  const errors = validateDebateSettings({ theme, positions, maxTurns, participants: PARTICIPANTS, judges: JUDGES });
  if (errors.length > 0) {
    errors.forEach((e) => console.error(`エラー: ${e}`));
    process.exit(1);
  }

  const outputs = await loadStackOutputs(['AgorawlData', 'AgorawlEngine']);
  const debatesTable = outputs.DebatesTableName;
  const messagesTable = outputs.MessagesTableName;
  const stateMachineArn = outputs.StateMachineArn;

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const debate: Debate = {
    debateId: randomUUID(),
    ownerId: 'local-cli', // HTTP APIができるまでの仮の作成者
    theme: theme.trim(),
    positions,
    status: 'running',
    participants: PARTICIPANTS,
    judges: JUDGES,
    maxTurns,
    createdAt: new Date().toISOString(),
    listKey: LIST_KEY,
  };
  await ddb.send(new PutCommand({ TableName: debatesTable, Item: debate }));

  const input: EngineStartInput = { debateId: debate.debateId };
  const exec = await new SFNClient({}).send(
    new StartExecutionCommand({ stateMachineArn, name: debate.debateId, input: JSON.stringify(input) }),
  );
  console.log(`議論ID: ${debate.debateId}`);
  console.log(`テーマ: ${debate.theme}(${maxTurns}ターン)`);
  console.log(`立場: 先攻「${positions.pro}」、後攻「${positions.con}」`);
  console.log(`実行: ${exec.executionArn}\n`);

  // 発言を順に表示する(turn で重複を除く)
  let shown = 0;
  const seen: Message[] = [];
  for (;;) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: messagesTable,
        KeyConditionExpression: 'debateId = :id AND #turn > :shown',
        ExpressionAttributeNames: { '#turn': 'turn' },
        ExpressionAttributeValues: { ':id': debate.debateId, ':shown': shown },
      }),
    );
    for (const m of (res.Items ?? []) as Message[]) {
      if (m.turn !== shown + 1) break;
      seen.push(m);
      console.log(`── ターン${m.turn} ${label(m.role)}${m.conceded ? '【投了】' : ''}${m.exhausted ? '【引き分け】' : ''}(${m.modelId})`);
      console.log(`${m.content}\n`);
      for (const s of m.sources ?? []) {
        console.log(`〔検索〕[${s.id}]「${s.query}」: ${s.text}\n  出典: ${s.urls.join(' ') || 'なし'}`);
      }
      if (m.citations?.length) console.log(`〔引用〕${m.citations.map((n) => `[${n}]`).join(' ')}`);
      if (m.invalidCitations?.length) {
        console.log(`〔警告〕資料一覧にない番号を引用: ${m.invalidCitations.map((n) => `[${n}]`).join(' ')}`);
      }
      if (m.sources?.length || m.citations?.length) console.log('');
      if (m.notes) console.log(`${formatNotes(m.notes)}\n`);
      shown = m.turn;
    }

    const current = await ddb.send(
      new GetCommand({ TableName: debatesTable, Key: { debateId: debate.debateId } }),
    );
    const status = (current.Item as Debate | undefined)?.status;
    if (status === 'failed') {
      console.error('議論が失敗しました。Step Functionsの実行履歴を確認してください。');
      process.exit(1);
    }
    // 投了で早く終わることがあるため、最後の発言まで表示してから終える
    if (status === 'done') {
      const last = await ddb.send(
        new QueryCommand({
          TableName: messagesTable,
          KeyConditionExpression: 'debateId = :id',
          ExpressionAttributeValues: { ':id': debate.debateId },
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      const lastTurn = (last.Items?.[0] as Message | undefined)?.turn ?? 0;
      if (shown >= lastTurn) {
        const d = current.Item as Debate;
        const reason =
          d.endReason === 'conceded'
            ? `${label(d.concededBy ?? 'pro')}の投了`
            : d.endReason === 'exhausted'
              ? '両者の攻め手が尽きて引き分け'
              : '最大ターン数に到達';
        console.log(`議論が完了しました(終了理由: ${reason})。`);
        if (d.verdict) console.log(`\n${formatVerdict(d.verdict)}\n\n${formatItems(d.verdict, seen)}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

const CRITERION_LABELS = { logic: '論理', evidence: '根拠', rebuttal: '反論', response: '応答' } as const;

function formatVerdict(verdict: Verdict): string {
  const overall = verdict.winner
    ? `〔判定〕審判${verdict.judgments.length}人の多数決: ${verdict.winner === 'draw' ? '引き分け' : `${label(verdict.winner)}の勝ち`}\n`
    : '';
  return overall + verdict.judgments
    .map((j) => {
      const side = (label: string, s: Verdict['judgments'][number]['pro']) =>
        `  ${label} 合計${s.total}点(${Object.entries(s.scores)
          .map(([k, v]) => `${CRITERION_LABELS[k as keyof typeof CRITERION_LABELS]}${v}`)
          .join(' ')})\n    ${s.reason}`;
      const winner = j.winner === 'draw' ? '引き分け' : `${label(j.winner)}の勝ち`;
      return [`〔判定〕${j.modelId}: ${winner}`, side(label('pro'), j.pro), side(label('con'), j.con)].join('\n');
    })
    .join('\n');
}

/** 作戦メモの項目ごとに、討論者の点数と審判ごとの点数を並べる(動作確認用) */
function formatItems(verdict: Verdict, messages: Message[]): string {
  const lines = ['〔項目ごとの点数〕討論者 / 審判(judges の順)'];
  for (const role of ['pro', 'con'] as const) {
    const notes = [...messages].reverse().find((m) => m.role === role && m.notes)?.notes;
    if (!notes) continue;
    const judged = (kind: 'claims' | 'rebuttals', id: string) =>
      verdict.judgments.map((j) => j[role][kind]?.find((x) => x.id === id)?.score ?? '-').join(' ');
    lines.push(`  ${label(role)}`);
    for (const c of notes.claims) lines.push(`    ${c.id} ${c.score} / ${judged('claims', c.id)}  ${c.text.slice(0, 40)}`);
    // 審判に渡していない反論(議論の最後の発言で初めて足した反論)は「-」になる
    for (const r of notes.rebuttals) lines.push(`    ${r.id} ${r.score} / ${judged('rebuttals', r.id)}  ${r.text.slice(0, 40)}`);
  }
  return lines.join('\n');
}

const REBUTTAL_STATUS_LABELS = { won: '獲得', pursuing: '追及中', dropped: '断念' } as const;

/** 作戦メモの要約(動作確認用。エンジンは発言者本人にしか渡さない) */
function formatNotes(notes: DebaterNotes): string {
  const claims = notes.claims.map(
    (c) => `  ${c.id} ${c.score}点 [${c.status === 'abandoned' ? '捨てる' : '守る'}] ${c.text}`,
  );
  const rebuttals = notes.rebuttals.map(
    (r) => `  ${r.id} ${r.score}点 [${REBUTTAL_STATUS_LABELS[r.status]}] ${r.text}(対象: ${r.target})`,
  );
  return ['〔作戦メモ〕主張', ...claims, '〔作戦メモ〕反論', ...(rebuttals.length ? rebuttals : ['  (なし)'])].join('\n');
}

async function loadStackOutputs(stackNames: string[]): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({});
  const outputs: Record<string, string> = {};
  for (const StackName of stackNames) {
    const res = await cfn.send(new DescribeStacksCommand({ StackName }));
    for (const o of res.Stacks?.[0]?.Outputs ?? []) {
      if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
    }
  }
  return outputs;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
