// POST /debates の「同時に実行できる議論は全体で1件」と「議論の開始の通知」。仕様: docs/04-app/README.md「POST /debates」
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ListExecutionsCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

type Handler = (typeof import('../src/http'))['handler'];
let handler: Handler;

beforeAll(async () => {
  process.env.DEBATES_TABLE = 'Debates';
  process.env.MESSAGES_TABLE = 'Messages';
  process.env.STATE_MACHINE_ARN = 'arn:aws:states:ap-northeast-1:000000000000:stateMachine:Debate';
  process.env.NOTIFY_TOPIC_ARN = 'arn:aws:sns:ap-northeast-1:000000000000:Admin';
  process.env.WEB_ORIGIN = 'https://example.cloudfront.net';
  process.env.DAILY_CREATES_TABLE = 'DailyCreates';
  process.env.USER_POOL_ID = 'ap-northeast-1_test';
  process.env.CONTENT_CHECK_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
  process.env.DEBATE_DEFAULTS = JSON.stringify({
    participants: [
      { role: 'pro', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
      { role: 'con', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
    ],
    judges: [{ modelId: 'global.anthropic.claude-opus-4-6-v1' }],
    models: [{ modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Claude Haiku 4.5', feature: '速い' }],
    judgeModels: [{ modelId: 'global.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6', feature: '深く読む' }],
  });
  ({ handler } = await import('../src/http'));
});

const event = {
  routeKey: 'POST /debates',
  body: JSON.stringify({ theme: '虎と熊はどちらが強いか', positions: { pro: '虎派', con: '熊派' }, maxTurns: 10 }),
  requestContext: { authorizer: { jwt: { claims: { sub: 'user-1' } } } },
};

/** クライアントの send。受け取ったコマンドの種類で確かめる */
type Send = Mock<(cmd: unknown) => Promise<unknown>>;
let sfnSend: Send;
let ddbSend: Send;
let snsSend: Send;
let bedrockSend: Send;

/** 入力の内容の確認の答え(ツールの入力の形) */
const checkAnswer = (input: { theme_ok: boolean; pro_ok: boolean; con_ok: boolean; reason: string }) => ({
  output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'report_check', input } }] } },
});

function mockRunning(count: number) {
  sfnSend.mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof ListExecutionsCommand) {
      return { executions: Array.from({ length: count }, (_, i) => ({ name: `debate-${i}` })) };
    }
    return {};
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  sfnSend = vi.spyOn(SFNClient.prototype, 'send') as unknown as Send;
  ddbSend = vi.spyOn(DynamoDBDocumentClient.prototype, 'send') as unknown as Send;
  ddbSend.mockResolvedValue({});
  snsSend = vi.spyOn(SNSClient.prototype, 'send') as unknown as Send;
  snsSend.mockResolvedValue({});
  bedrockSend = vi.spyOn(BedrockRuntimeClient.prototype, 'send') as unknown as Send;
  bedrockSend.mockResolvedValue(checkAnswer({ theme_ok: true, pro_ok: true, con_ok: true, reason: '' }));
});

describe('POST /debates: 同時に実行できる議論', () => {
  it('実行中の議論があれば409を返し、保存も起動もしない', async () => {
    mockRunning(1);
    const res = await handler(event);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toBe('実行中の議論があります。終わってから作ってください');
    expect(ddbSend.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(false);
    expect(sfnSend.mock.calls.some(([c]) => c instanceof StartExecutionCommand)).toBe(false);
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('実行中の議論がなければ、保存して起動し、201を返す', async () => {
    mockRunning(0);
    const res = await handler(event);
    expect(res.statusCode).toBe(201);
    expect(ddbSend.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(true);
    expect(sfnSend.mock.calls.some(([c]) => c instanceof StartExecutionCommand)).toBe(true);
    const list = sfnSend.mock.calls.find(([c]) => c instanceof ListExecutionsCommand)?.[0] as ListExecutionsCommand;
    expect(list.input).toMatchObject({ statusFilter: 'RUNNING', stateMachineArn: process.env.STATE_MACHINE_ARN });
  });

  it('本文に誤りがあれば、実行中の議論を数える前に400を返す', async () => {
    mockRunning(1);
    const res = await handler({ ...event, body: '{}' });
    expect(res.statusCode).toBe(400);
    expect(sfnSend).not.toHaveBeenCalled();
  });
});

describe('POST /debates: 議論の開始の通知', () => {
  it('議論を始めたら、管理者のトピックに発行する', async () => {
    mockRunning(0);
    const res = await handler(event);
    expect(res.statusCode).toBe(201);
    const { debateId } = JSON.parse(res.body) as { debateId: string };
    const pub = snsSend.mock.calls.find(([c]) => c instanceof PublishCommand)?.[0] as PublishCommand;
    expect(pub.input.TopicArn).toBe(process.env.NOTIFY_TOPIC_ARN);
    expect(pub.input.Subject).toBe('[Agorawl] 議論が始まりました: 虎と熊はどちらが強いか');
    expect(pub.input.Message).toContain(`議論の画面: https://example.cloudfront.net/debates/${debateId}`);
  });

  it('送れなくても、議論は始まり201を返す', async () => {
    mockRunning(0);
    snsSend.mockRejectedValue(new Error('SNS is down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(event);
    expect(res.statusCode).toBe(201);
    expect(sfnSend.mock.calls.some(([c]) => c instanceof StartExecutionCommand)).toBe(true);
  });

  it('12ターン以上は400で、通知もしない', async () => {
    mockRunning(0);
    const res = await handler({ ...event, body: JSON.stringify({ theme: 'テーマ', positions: { pro: 'a', con: 'b' }, maxTurns: 12 }) });
    expect(res.statusCode).toBe(400);
    expect(snsSend).not.toHaveBeenCalled();
  });
});

describe('DELETE /debates/{debateId}', () => {
  const del = (groups?: string) => ({
    routeKey: 'DELETE /debates/{debateId}',
    pathParameters: { debateId: 'd-1' },
    requestContext: { authorizer: { jwt: { claims: { sub: 'admin-1', ...(groups ? { 'cognito:groups': groups } : {}) } } } },
  });
  /** 議論の状態と発言の件数を決めて、DynamoDB の応答を作る */
  function mockTable(status: string | null, turns: number) {
    ddbSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof GetCommand) return status ? { Item: { debateId: 'd-1', status } } : {};
      if (cmd instanceof QueryCommand) return { Items: Array.from({ length: turns }, (_, i) => ({ debateId: 'd-1', turn: i + 1 })) };
      return {};
    });
  }
  const sent = (type: unknown) => ddbSend.mock.calls.filter(([c]) => c instanceof (type as new (...a: never[]) => unknown));

  it('管理者でなければ403で、何も読まない', async () => {
    mockTable('done', 3);
    const res = await handler(del());
    expect(res.statusCode).toBe(403);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it('議論がなければ404', async () => {
    mockTable(null, 0);
    expect((await handler(del('[admin]'))).statusCode).toBe(404);
  });

  it('議論中なら409で、何も消さない', async () => {
    mockTable('running', 3);
    const res = await handler(del('[admin]'));
    expect(res.statusCode).toBe(409);
    expect(sent(BatchWriteCommand)).toHaveLength(0);
    expect(sent(DeleteCommand)).toHaveLength(0);
  });

  it('終わった議論は、発言を25件ずつ消してから議論を消し、204を返す', async () => {
    mockTable('done', 30);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await handler(del('[admin]'));
    expect(res.statusCode).toBe(204);
    const batches = sent(BatchWriteCommand).map(([c]) => (c as BatchWriteCommand).input.RequestItems!.Messages!.length);
    expect(batches).toEqual([25, 5]);
    const last = ddbSend.mock.calls.at(-1)![0];
    expect(last).toBeInstanceOf(DeleteCommand);
    expect((last as DeleteCommand).input.Key).toEqual({ debateId: 'd-1' });
  });
});

describe('議論を隠す(docs/04-app/README.md「議論を隠す」)', () => {
  const claims = (groups?: string) => ({ authorizer: { jwt: { claims: { sub: 'u-1', ...(groups ? { 'cognito:groups': groups } : {}) } } } });
  const patch = (body: unknown, groups?: string) => ({
    routeKey: 'PATCH /debates/{debateId}',
    pathParameters: { debateId: 'd-1' },
    body: JSON.stringify(body),
    requestContext: claims(groups),
  });

  it('PATCH: 管理者でなければ403で、何も書かない', async () => {
    const res = await handler(patch({ hidden: true }));
    expect(res.statusCode).toBe(403);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it('PATCH: hidden が真偽値でなければ400', async () => {
    expect((await handler(patch({ hidden: 'yes' }, '[admin]'))).statusCode).toBe(400);
    expect((await handler(patch({}, '[admin]'))).statusCode).toBe(400);
  });

  it('PATCH: 隠すときは hidden を true にし、見せるときは属性を消して、204を返す', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await handler(patch({ hidden: true }, '[admin]'))).statusCode).toBe(204);
    expect((await handler(patch({ hidden: false }, '[admin]'))).statusCode).toBe(204);
    const updates = ddbSend.mock.calls.map(([c]) => (c as UpdateCommand).input);
    expect(updates[0].UpdateExpression).toBe('SET #hidden = :t');
    expect(updates[0].ExpressionAttributeNames).toEqual({ '#hidden': 'hidden' });
    expect(updates[0].ExpressionAttributeValues).toEqual({ ':t': true });
    expect(updates[1].UpdateExpression).toBe('REMOVE #hidden');
    expect(updates.every((u) => u.ConditionExpression === 'attribute_exists(debateId)')).toBe(true);
  });

  it('PATCH: 議論がなければ404', async () => {
    ddbSend.mockRejectedValue(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }));
    expect((await handler(patch({ hidden: true }, '[admin]'))).statusCode).toBe(404);
  });

  const debate = (id: string, hidden?: boolean) => ({
    debateId: id, theme: 'テーマ', positions: { pro: 'a', con: 'b' }, participants: [], status: 'done', maxTurns: 10,
    createdAt: '2026-11-15T00:00:00.000Z', listKey: 'ALL', ...(hidden ? { hidden: true } : {}),
  });

  it('GET /debates/{debateId}: 隠した議論は、一般のユーザーには404、管理者には200', async () => {
    ddbSend.mockImplementation(async (cmd: unknown) => (cmd instanceof GetCommand ? { Item: debate('d-1', true) } : { Items: [] }));
    const get = (groups?: string) => ({ routeKey: 'GET /debates/{debateId}', pathParameters: { debateId: 'd-1' }, requestContext: claims(groups) });
    expect((await handler(get())).statusCode).toBe(404);
    const res = await handler(get('[admin]'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).debate.hidden).toBe(true);
  });

  it('GET /debates: 一般のユーザーには隠した議論を除き、limit 件たまるまで続きを読む', async () => {
    // 1回目: d1(隠す)、d2 / 2回目: d3、続きあり
    const pages = [
      { Items: [debate('d1', true), debate('d2')], LastEvaluatedKey: { debateId: 'd2' } },
      { Items: [debate('d3')], LastEvaluatedKey: { debateId: 'd3' } },
    ];
    ddbSend.mockImplementation(async () => pages.shift() ?? { Items: [] });
    const res = await handler({ routeKey: 'GET /debates', queryStringParameters: { limit: '2' }, requestContext: claims() });
    const body = JSON.parse(res.body);
    expect(body.items.map((i: { debateId: string }) => i.debateId)).toEqual(['d2', 'd3']);
    expect(body.nextCursor).toBeTruthy();
    const limits = ddbSend.mock.calls.map(([c]) => (c as QueryCommand).input.Limit);
    expect(limits).toEqual([2, 1]);
  });

  it('GET /debates: 管理者には隠した議論も返し、hidden: true を付ける', async () => {
    ddbSend.mockResolvedValue({ Items: [debate('d1', true), debate('d2')] });
    const res = await handler({ routeKey: 'GET /debates', queryStringParameters: { limit: '2' }, requestContext: claims('[admin]') });
    const items = JSON.parse(res.body).items as { debateId: string; hidden?: boolean }[];
    expect(items.map((i) => [i.debateId, i.hidden])).toEqual([['d1', true], ['d2', undefined]]);
  });
});

describe('POST /debates: 入力の内容の確認(docs/04-app/README.md「入力の内容の確認」)', () => {
  const demoEvent = {
    ...event,
    requestContext: { authorizer: { jwt: { claims: { sub: 'demo-1', 'cognito:groups': '[demo]' } } } },
  };
  const counterCalls = () =>
    ddbSend.mock.calls.filter(([c]) => c instanceof UpdateCommand && (c as UpdateCommand).input.TableName === 'DailyCreates');

  it('設定のモデルに、テーマと立場を渡して確かめる', async () => {
    mockRunning(0);
    expect((await handler(event)).statusCode).toBe(201);
    const cmd = bedrockSend.mock.calls[0]?.[0] as ConverseCommand;
    expect(cmd).toBeInstanceOf(ConverseCommand);
    expect(cmd.input.modelId).toBe('jp.anthropic.claude-haiku-4-5-20251001-v1:0');
    const text = cmd.input.messages?.[0]?.content?.[0]?.text ?? '';
    expect(text).toContain('虎と熊はどちらが強いか');
    expect(text).toContain('虎派');
    expect(text).toContain('熊派');
  });

  it('適切でなければ、不適切な欄ごとの文を errors に入れて400を返し、保存も起動も数えもしない', async () => {
    mockRunning(0);
    bedrockSend.mockResolvedValue(checkAnswer({ theme_ok: true, pro_ok: false, con_ok: false, reason: '立場がテーマの答えになっていない' }));
    const res = await handler(demoEvent);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      message: 'このテーマと立場では議論を作れません',
      errors: ['先攻の立場が不適切です', '後攻の立場が不適切です'],
    });
    expect(ddbSend.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(false);
    expect(sfnSend.mock.calls.some(([c]) => c instanceof StartExecutionCommand)).toBe(false);
    expect(counterCalls()).toHaveLength(0);
  });

  it('AI を呼べなければ503で、何も保存しない', async () => {
    mockRunning(0);
    bedrockSend.mockRejectedValue(new Error('throttled'));
    const res = await handler(demoEvent);
    expect(res.statusCode).toBe(503);
    expect(ddbSend.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(false);
    expect(counterCalls()).toHaveLength(0);
  });

  it('テーマが不適切なら、立場の判断にかかわらず「テーマが不適切です」だけを出す(理由の説明は出さない)', async () => {
    mockRunning(0);
    bedrockSend.mockResolvedValue(checkAnswer({ theme_ok: false, pro_ok: false, con_ok: true, reason: '政治的な主張を争う' }));
    const res = await handler(event);
    expect(JSON.parse(res.body).errors).toEqual(['テーマが不適切です']);
  });

  it('答えの形が違えば503', async () => {
    mockRunning(0);
    bedrockSend.mockResolvedValue({ output: { message: { role: 'assistant', content: [{ text: 'OK' }] } } });
    expect((await handler(event)).statusCode).toBe(503);
  });

  it('実行中の議論があれば、AI を呼ばずに409', async () => {
    mockRunning(1);
    expect((await handler(event)).statusCode).toBe(409);
    expect(bedrockSend).not.toHaveBeenCalled();
  });

  it('文字の検証に違反していれば、AI を呼ばずに400', async () => {
    const res = await handler({ ...event, body: JSON.stringify({ theme: 'あい', positions: { pro: 'a', con: 'b' } }) });
    expect(res.statusCode).toBe(400);
    expect(bedrockSend).not.toHaveBeenCalled();
  });
});

describe('POST /debates: デモのアカウントが1日に作れる議論', () => {
  const demoEvent = {
    ...event,
    requestContext: { authorizer: { jwt: { claims: { sub: 'demo-1', 'cognito:groups': '[demo]' } } } },
  };
  const counterCalls = () =>
    ddbSend.mock.calls.filter(([c]) => c instanceof UpdateCommand && (c as UpdateCommand).input.TableName === 'DailyCreates');

  it('デモなら数を1つ足してから作る', async () => {
    mockRunning(0);
    const res = await handler(demoEvent);
    expect(res.statusCode).toBe(201);
    const [call] = counterCalls();
    expect((call?.[0] as UpdateCommand).input).toMatchObject({
      ConditionExpression: 'attribute_not_exists(created) OR created < :max',
      ExpressionAttributeValues: { ':one': 1, ':max': 5 },
    });
    expect((call?.[0] as UpdateCommand).input.Key?.counterKey).toMatch(/^demo-1#\d{4}-\d{2}-\d{2}$/);
  });

  it('上限に達していたら429を返し、保存も起動もしない', async () => {
    mockRunning(0);
    ddbSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof UpdateCommand && cmd.input.TableName === 'DailyCreates') {
        throw new ConditionalCheckFailedException({ message: 'failed', $metadata: {} });
      }
      return {};
    });
    const res = await handler(demoEvent);
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).message).toBe('今日作れる議論の数(5件)に達しました。明日また作ってください');
    expect(ddbSend.mock.calls.some(([c]) => c instanceof PutCommand)).toBe(false);
    expect(sfnSend.mock.calls.some(([c]) => c instanceof StartExecutionCommand)).toBe(false);
  });

  it('実行中の議論があって断ったときは数えない', async () => {
    mockRunning(1);
    const res = await handler(demoEvent);
    expect(res.statusCode).toBe(409);
    expect(counterCalls()).toHaveLength(0);
  });

  it('管理者と一般のアカウントは数えない', async () => {
    mockRunning(0);
    expect((await handler(event)).statusCode).toBe(201);
    const admin = { ...event, requestContext: { authorizer: { jwt: { claims: { sub: 'a-1', 'cognito:groups': '[admin]' } } } } };
    expect((await handler(admin)).statusCode).toBe(201);
    expect(counterCalls()).toHaveLength(0);
  });
});

describe('GET /accounts(docs/04-app/README.md「GET /accounts」)', () => {
  const claims = (groups?: string) => ({ authorizer: { jwt: { claims: { sub: 'u-1', ...(groups ? { 'cognito:groups': groups } : {}) } } } });
  let cognitoSend: Send;
  beforeEach(() => {
    cognitoSend = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send') as unknown as Send;
  });

  it('管理者でなければ403で、Cognito を読まない', async () => {
    for (const groups of [undefined, '[demo]']) {
      const res = await handler({ routeKey: 'GET /accounts', requestContext: claims(groups) });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).message).toBe('アカウントの一覧を見られるのは管理者だけです');
    }
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it('管理者には、すべてのページのユーザーを種類付きで返す', async () => {
    const user = (name: string, created: string) => ({
      Username: name,
      Attributes: [{ Name: 'email', Value: `${name}@example.com` }],
      Enabled: true,
      UserCreateDate: new Date(created),
    });
    cognitoSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof ListUsersCommand) {
        return cmd.input.PaginationToken
          ? { Users: [user('demo', '2026-11-15T00:00:00.000Z')] }
          : { Users: [user('dev', '2026-11-01T00:00:00.000Z')], PaginationToken: 'p2' };
      }
      if (cmd instanceof ListUsersInGroupCommand) {
        return { Users: [{ Username: cmd.input.GroupName === 'admin' ? 'dev' : 'demo' }] };
      }
      return {};
    });
    const res = await handler({ routeKey: 'GET /accounts', requestContext: claims('[admin]') });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.body).items as { email: string; type: string }[];
    expect(items.map((i) => [i.email, i.type])).toEqual([
      ['dev@example.com', 'admin'],
      ['demo@example.com', 'demo'],
    ]);
  });
});
