// 事前認証のLambda: ロックは管理者のアカウントだけ。仕様: docs/04-app/README.md「ログインのロック」の「対象」
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  AdminDisableUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';

type Handler = (typeof import('../src/pre-auth'))['handler'];
let handler: Handler;

beforeAll(async () => {
  process.env.LOGIN_ATTEMPTS_TABLE = 'LoginAttempts';
  process.env.NOTIFY_TOPIC_ARN = 'arn:aws:sns:ap-northeast-1:000000000000:Admin';
  ({ handler } = await import('../src/pre-auth'));
});

type Send = Mock<(cmd: unknown) => Promise<unknown>>;
let cognitoSend: Send;
let ddbSend: Send;

const event = { userPoolId: 'pool', userName: 'u-1', request: { userAttributes: { email: 'u@example.com' } } };

/** グループの答え。Error ならグループを読めなかったことにする */
function mockGroups(groups: string[] | Error, attempts = 1) {
  cognitoSend.mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof AdminListGroupsForUserCommand) {
      if (groups instanceof Error) throw groups;
      return { Groups: groups.map((GroupName) => ({ GroupName })) };
    }
    return {};
  });
  ddbSend.mockResolvedValue({ Attributes: { attempts } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  cognitoSend = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send') as unknown as Send;
  ddbSend = vi.spyOn(DynamoDBDocumentClient.prototype, 'send') as unknown as Send;
  vi.spyOn(SNSClient.prototype, 'send').mockResolvedValue({} as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('事前認証: ロックの対象', () => {
  it('一般とデモのアカウントは数えず、何回目でも止めない', async () => {
    for (const groups of [[], ['demo']]) {
      mockGroups(groups, 10);
      await expect(handler(event)).resolves.toBe(event);
    }
    expect(ddbSend).not.toHaveBeenCalled();
    expect(cognitoSend.mock.calls.some(([c]) => c instanceof AdminDisableUserCommand)).toBe(false);
  });

  it('管理者は数え、3回続けて間違えた後のログインで止める', async () => {
    mockGroups(['admin'], 1);
    await expect(handler(event)).resolves.toBe(event);
    expect(ddbSend.mock.calls.some(([c]) => c instanceof UpdateCommand)).toBe(true);

    mockGroups(['admin'], 4);
    await expect(handler(event)).rejects.toThrow('ログインできません。管理者に連絡してください');
    expect(cognitoSend.mock.calls.some(([c]) => c instanceof AdminDisableUserCommand)).toBe(true);
  });

  it('グループを読めなかったときは、管理者として数える', async () => {
    mockGroups(new Error('throttled'), 1);
    await expect(handler(event)).resolves.toBe(event);
    expect(ddbSend.mock.calls.some(([c]) => c instanceof UpdateCommand)).toBe(true);
  });

  it('存在しないユーザー名は、グループも読まない', async () => {
    mockGroups(['admin']);
    await handler({ ...event, request: { userNotFound: true } });
    expect(cognitoSend).not.toHaveBeenCalled();
    expect(ddbSend).not.toHaveBeenCalled();
  });
});
