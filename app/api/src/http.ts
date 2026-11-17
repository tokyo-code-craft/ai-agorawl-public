// HTTP API用Lambda。すべてのルートを1つのLambdaで受ける。仕様: docs/04-app/README.md「HTTP API」
import { randomUUID } from 'node:crypto';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ListExecutionsCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { INDEX_NAMES, LIST_KEY, type Debate, type EngineStartInput, type Message } from '@agorawl/contract';
import {
  accountType,
  ADMIN_GROUP,
  BadRequestError,
  buildDebate,
  canSee,
  dailyCounter,
  DEMO_GROUP,
  toAccounts,
  buildStartNotice,
  decodeCursor,
  encodeCursor,
  isAdmin,
  parseDefaults,
  listModels,
  parseLimit,
  parseUpdate,
  toSummary,
  visibleMessages,
  withoutListKey,
} from './logic';
import {
  DEMO_DAILY_LIMIT,
  type CreateDebateResponse,
  type ErrorResponse,
  type GetDebateResponse,
  type ListAccountsResponse,
  type ListDebatesResponse,
} from './types';
import { buildContentCheckRequest, parseContentCheckResponse, type ContentCheckResult } from './content-check';

/** API Gateway(HTTP API、ペイロード2.0、JWTオーソライザー)から届くイベントのうち、使う部分 */
interface HttpEvent {
  routeKey: string;
  body?: string;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };
}

interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const sfn = new SFNClient({});
const sns = new SNSClient({});
const cognito = new CognitoIdentityProviderClient({});
const bedrock = new BedrockRuntimeClient({});

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
};
const DEBATES_TABLE = env('DEBATES_TABLE');
const MESSAGES_TABLE = env('MESSAGES_TABLE');
const STATE_MACHINE_ARN = env('STATE_MACHINE_ARN');
const DEFAULTS = parseDefaults(process.env.DEBATE_DEFAULTS);
const NOTIFY_TOPIC_ARN = env('NOTIFY_TOPIC_ARN');
const WEB_ORIGIN = env('WEB_ORIGIN');
const DAILY_CREATES_TABLE = env('DAILY_CREATES_TABLE');
const USER_POOL_ID = env('USER_POOL_ID');
const CONTENT_CHECK_MODEL_ID = env('CONTENT_CHECK_MODEL_ID');
/** 入力の内容の確認で、AI の答えを待つ時間(ミリ秒) */
const CONTENT_CHECK_TIMEOUT_MS = 15_000;

const json = (statusCode: number, body: unknown): HttpResult => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
const error = (statusCode: number, message: string, errors?: string[]) =>
  json(statusCode, { message, ...(errors?.length ? { errors } : {}) } satisfies ErrorResponse);

export async function handler(event: HttpEvent): Promise<HttpResult> {
  try {
    switch (event.routeKey) {
      case 'POST /debates':
        return await createDebate(event);
      case 'GET /debates':
        return await listDebates(event);
      case 'GET /debates/{debateId}':
        return await getDebate(event);
      case 'DELETE /debates/{debateId}':
        return await deleteDebate(event);
      case 'PATCH /debates/{debateId}':
        return await updateDebate(event);
      case 'GET /models':
        return json(200, listModels(DEFAULTS));
      case 'GET /accounts':
        return await listAccounts(event);
      default:
        return error(404, '見つかりません');
    }
  } catch (err) {
    if (err instanceof BadRequestError) return error(400, err.message, err.errors);
    console.error(err);
    return error(500, 'サーバーでエラーが起きました');
  }
}

async function createDebate(event: HttpEvent): Promise<HttpResult> {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const ownerId = claims?.sub;
  if (typeof ownerId !== 'string' || ownerId === '') throw new Error('トークンに sub がありません');
  const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const debate = buildDebate(body, DEFAULTS, { debateId: randomUUID(), ownerId, now: new Date().toISOString() });

  // 同時に実行できる議論は全体で1件(docs/04-app/README.md「同時に実行できる議論」)
  const running = await sfn.send(
    new ListExecutionsCommand({ stateMachineArn: STATE_MACHINE_ARN, statusFilter: 'RUNNING', maxResults: 1 }),
  );
  if ((running.executions ?? []).length > 0) {
    return error(409, '実行中の議論があります。終わってから作ってください');
  }

  // テーマと立場が議論として適切かを AI に確かめさせる。デモの数を足す前に行う(docs/04-app/README.md「入力の内容の確認」)
  let check: ContentCheckResult;
  try {
    const res = await bedrock.send(new ConverseCommand(buildContentCheckRequest(CONTENT_CHECK_MODEL_ID, debate.theme, debate.positions)), {
      abortSignal: AbortSignal.timeout(CONTENT_CHECK_TIMEOUT_MS),
    });
    check = parseContentCheckResponse(res);
  } catch (err) {
    console.error(JSON.stringify({ contentCheckFailed: true, ownerId, error: String(err) }));
    return error(503, '入力を確かめられませんでした。少し待ってから、もう一度作ってください');
  }
  if (!check.ok) {
    console.log(JSON.stringify({ contentRejected: true, ownerId, theme: debate.theme, positions: debate.positions, reason: check.reason }));
    return error(400, 'このテーマと立場では議論を作れません', check.errors);
  }

  // デモのアカウントは1日に作れる数を限る。足す前の値が上限なら足さずに断る(docs/04-app/README.md「デモのアカウントが1日に作れる議論」)
  if (accountType(claims) === 'demo') {
    const { counterKey, expiresAt } = dailyCounter(ownerId, new Date());
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: DAILY_CREATES_TABLE,
          Key: { counterKey },
          UpdateExpression: 'ADD created :one SET expiresAt = :exp',
          ConditionExpression: 'attribute_not_exists(created) OR created < :max',
          ExpressionAttributeValues: { ':one': 1, ':exp': expiresAt, ':max': DEMO_DAILY_LIMIT },
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return error(429, `今日作れる議論の数(${DEMO_DAILY_LIMIT}件)に達しました。明日また作ってください`);
      }
      throw err;
    }
  }

  await ddb.send(
    new PutCommand({
      TableName: DEBATES_TABLE,
      Item: debate,
      ConditionExpression: 'attribute_not_exists(debateId)',
    }),
  );

  const input: EngineStartInput = { debateId: debate.debateId };
  try {
    await sfn.send(
      new StartExecutionCommand({ stateMachineArn: STATE_MACHINE_ARN, name: debate.debateId, input: JSON.stringify(input) }),
    );
  } catch (err) {
    // 起動できなかった議論は failed にする(進まないまま running で残さない)
    console.error(err);
    await ddb.send(
      new UpdateCommand({
        TableName: DEBATES_TABLE,
        Key: { debateId: debate.debateId },
        UpdateExpression: 'SET #status = :failed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':failed': 'failed' },
      }),
    );
    return error(500, '議論を始められませんでした');
  }
  console.log(JSON.stringify({ created: debate.debateId, ownerId, maxTurns: debate.maxTurns }));

  // 管理者にメールで知らせる。送れなくても議論は続ける(docs/04-app/README.md「議論の開始の通知」)
  try {
    const { subject, message } = buildStartNotice(debate, WEB_ORIGIN);
    await sns.send(new PublishCommand({ TopicArn: NOTIFY_TOPIC_ARN, Subject: subject, Message: message }));
  } catch (err) {
    console.error(JSON.stringify({ notifyFailed: debate.debateId, error: String(err) }));
  }
  return json(201, { debateId: debate.debateId } satisfies CreateDebateResponse);
}

/** 一般のユーザーの一覧で、隠した議論を除いて limit 件を集めるために読む回数の上限 */
const LIST_PAGES_MAX = 10;

async function listDebates(event: HttpEvent): Promise<HttpResult> {
  const q = event.queryStringParameters ?? {};
  const limit = parseLimit(q.limit);
  const admin = isAdmin(event.requestContext.authorizer?.jwt?.claims);
  // 一般のユーザーには隠した議論を返さない。除いた分を埋めるため、limit 件たまるまで続きを読む
  const items: Debate[] = [];
  let startKey = decodeCursor(q.cursor);
  let lastKey: Record<string, unknown> | undefined;
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: DEBATES_TABLE,
        IndexName: INDEX_NAMES.debatesByCreatedAt,
        KeyConditionExpression: 'listKey = :all',
        ExpressionAttributeValues: { ':all': LIST_KEY },
        ScanIndexForward: false,
        Limit: limit - items.length,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((res.Items ?? []) as Debate[]).filter((d) => canSee(d, admin)));
    lastKey = res.LastEvaluatedKey;
    if (!lastKey || items.length >= limit) break;
    startKey = lastKey;
  }
  const nextCursor = encodeCursor(lastKey);
  const body: ListDebatesResponse = {
    items: items.map(toSummary),
    ...(nextCursor ? { nextCursor } : {}),
  };
  return json(200, body);
}

/** 管理者が、議論を一般のユーザーに見せるか隠すかを切り替える(docs/04-app/README.md「PATCH /debates/{debateId}」) */
async function updateDebate(event: HttpEvent): Promise<HttpResult> {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!isAdmin(claims)) return error(403, '議論を隠せるのは管理者だけです');
  const debateId = event.pathParameters?.debateId ?? '';
  const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const { hidden } = parseUpdate(body);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: DEBATES_TABLE,
        Key: { debateId },
        // 見せるときは属性を消す(属性のない議論は見せる。docs/02-data-model/README.md)。hidden は DynamoDB の予約語のため名前で置き換える
        UpdateExpression: hidden ? 'SET #hidden = :t' : 'REMOVE #hidden',
        ConditionExpression: 'attribute_exists(debateId)',
        ExpressionAttributeNames: { '#hidden': 'hidden' },
        ...(hidden ? { ExpressionAttributeValues: { ':t': true } } : {}),
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return error(404, '議論が見つかりません');
    throw err;
  }
  console.log(JSON.stringify({ updated: debateId, hidden, by: claims?.sub }));
  return { statusCode: 204, headers: {}, body: '' };
}

/** 管理者が、アカウントの一覧を見る(docs/04-app/README.md「GET /accounts」) */
async function listAccounts(event: HttpEvent): Promise<HttpResult> {
  if (!isAdmin(event.requestContext.authorizer?.jwt?.claims)) return error(403, 'アカウントの一覧を見られるのは管理者だけです');
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, PaginationToken: token }));
    users.push(...(res.Users ?? []));
    token = res.PaginationToken;
  } while (token);
  const groups: Record<string, Set<string>> = {};
  for (const group of [ADMIN_GROUP, DEMO_GROUP]) {
    const names = new Set<string>();
    let next: string | undefined;
    do {
      const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: group, NextToken: next }));
      for (const u of res.Users ?? []) if (u.Username) names.add(u.Username);
      next = res.NextToken;
    } while (next);
    groups[group] = names;
  }
  return json(200, { items: toAccounts(users, groups) } satisfies ListAccountsResponse);
}

/** 1回の BatchWriteItem で消せる件数の上限(DynamoDB の決まり) */
const BATCH_SIZE = 25;
/** BatchWriteItem で消しきれなかった分を、やり直す回数 */
const BATCH_RETRIES = 5;

/**
 * 管理者が、終わった議論を消す。発言をすべて消してから、議論の行を消す(docs/04-app/README.md「DELETE /debates/{debateId}」)。
 * 途中で失敗しても、もう一度呼べば続きから消せる
 */
async function deleteDebate(event: HttpEvent): Promise<HttpResult> {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!isAdmin(claims)) return error(403, '議論を消せるのは管理者だけです');
  const debateId = event.pathParameters?.debateId ?? '';
  const res = await ddb.send(new GetCommand({ TableName: DEBATES_TABLE, Key: { debateId } }));
  const debate = res.Item as Debate | undefined;
  if (!debate) return error(404, '議論が見つかりません');
  if (debate.status === 'running') return error(409, '議論中の議論は消せません。終わってから消してください');

  let deleted = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'debateId = :id',
        ExpressionAttributeValues: { ':id': debateId },
        ProjectionExpression: 'debateId, #turn',
        ExpressionAttributeNames: { '#turn': 'turn' },
        ExclusiveStartKey: startKey,
      }),
    );
    const keys = (page.Items ?? []).map((i) => ({ debateId, turn: i.turn as number }));
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      let requests = keys.slice(i, i + BATCH_SIZE).map((Key) => ({ DeleteRequest: { Key } }));
      const count = requests.length;
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt >= BATCH_RETRIES) throw new Error(`発言を消しきれませんでした: ${debateId}`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const out = await ddb.send(new BatchWriteCommand({ RequestItems: { [MESSAGES_TABLE]: requests } }));
        requests = (out.UnprocessedItems?.[MESSAGES_TABLE] ?? []) as typeof requests;
      }
      deleted += count;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: DEBATES_TABLE,
        Key: { debateId },
        // 読んでから消すまでの間に、動き出した議論は消さない
        ConditionExpression: '#status <> :running',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':running': 'running' },
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return error(409, '議論中の議論は消せません。終わってから消してください');
    throw err;
  }
  console.log(JSON.stringify({ deleted: debateId, by: claims?.sub, messages: deleted }));
  return { statusCode: 204, headers: {}, body: '' };
}

async function getDebate(event: HttpEvent): Promise<HttpResult> {
  const debateId = event.pathParameters?.debateId ?? '';
  const res = await ddb.send(new GetCommand({ TableName: DEBATES_TABLE, Key: { debateId } }));
  const debate = res.Item as Debate | undefined;
  // 隠した議論は、一般のユーザーには、ない場合と同じに見せる(docs/04-app/README.md「議論を隠す」)
  if (!debate || !canSee(debate, isAdmin(event.requestContext.authorizer?.jwt?.claims))) return error(404, '議論が見つかりません');

  const messages: Message[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'debateId = :id',
        ExpressionAttributeValues: { ':id': debateId },
        ExclusiveStartKey: startKey,
      }),
    );
    messages.push(...((page.Items ?? []) as Message[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const body: GetDebateResponse = {
    debate: withoutListKey(debate),
    messages: visibleMessages(messages, debate.status),
  };
  return json(200, body);
}
