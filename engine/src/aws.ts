// 発言生成Lambdaと判定Lambdaで共通の、Bedrock・DynamoDBの呼び出し
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message as BedrockMessage,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Message } from '@agorawl/contract';
import { logConverse, textOf } from './converse-output';
import { OutputFormatError } from './errors';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

/** システムプロンプトと1つのユーザーメッセージでモデルを呼び、本文を返す(→ textOf) */
export async function converse(
  modelId: string,
  system: string,
  user: string,
  inferenceConfig: { maxTokens: number; temperature: number },
): Promise<string> {
  const res = await bedrock.send(
    new ConverseCommand({
      modelId,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig,
    }),
  );
  logConverse(modelId, res);
  return textOf(res, modelId);
}

/** 議論の全発言を turn 順に読む */
export async function loadMessages(table: string, debateId: string): Promise<Message[]> {
  const items: Message[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'debateId = :id',
        ExpressionAttributeValues: { ':id': debateId },
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((res.Items ?? []) as Message[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items.sort((a, b) => a.turn - b.turn);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

const SEARCH_TOOL: Tool = {
  toolSpec: {
    name: 'search',
    description:
      'Webを検索して、議論の根拠になる事実を出典付きで調べる。結果は資料一覧に番号付きで追加され、相手と審判も読む。1ターン3回まで。',
    inputSchema: {
      json: {
        type: 'object',
        properties: { query: { type: 'string', description: '調べたい内容(日本語)' } },
        required: ['query'],
      },
    },
  },
};

const SEARCH_LIMIT_MESSAGE = '検索の上限(1ターン3回)に達しました。これまでの資料で発言してください。';

/**
 * 検索の道具を渡してモデルを呼ぶ。モデルが検索を依頼したら onSearch で調べて結果を返し、
 * 最終的な本文を返す。検索は maxSearches 回まで。
 */
export async function converseWithSearch(params: {
  modelId: string;
  system: string;
  user: string;
  inferenceConfig: { maxTokens: number; temperature: number };
  maxSearches: number;
  onSearch: (query: string) => Promise<string>;
}): Promise<string> {
  const { modelId, system, user, inferenceConfig, maxSearches, onSearch } = params;
  const messages: BedrockMessage[] = [{ role: 'user', content: [{ text: user }] }];
  let searches = 0;
  // 上限を超えて検索を依頼し続ける場合に備え、往復の回数にも上限を設ける
  for (let round = 0; round < maxSearches + 3; round++) {
    const res = await bedrock.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages,
        toolConfig: { tools: [SEARCH_TOOL] },
        inferenceConfig,
      }),
    );
    logConverse(modelId, res);
    const content = res.output?.message?.content ?? [];
    const toolUses = content.flatMap((b) => (b.toolUse ? [b.toolUse] : []));
    if (res.stopReason !== 'tool_use' || toolUses.length === 0) return textOf(res, modelId);

    messages.push({ role: 'assistant', content });
    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      const query = String((use.input as { query?: unknown } | undefined)?.query ?? '').trim();
      let text: string;
      if (searches >= maxSearches) text = SEARCH_LIMIT_MESSAGE;
      else if (!query) text = '検索語が空です。';
      else {
        searches++;
        text = await onSearch(query);
      }
      results.push({ toolResult: { toolUseId: use.toolUseId, content: [{ text }] } });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new OutputFormatError('検索の依頼が続き、発言が出力されませんでした');
}
