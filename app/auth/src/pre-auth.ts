// 事前認証のLambda(Cognitoのトリガー)。管理者のアカウントだけ、ログインしようとするたびに回数を足し、3回続けて間違えた後なら止める。
// 仕様: docs/04-app/README.md「ログインのロック」
import {
  AdminDisableUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { buildLockNotice, decide, LOCKED_MESSAGE, LOCK_GROUP } from './logic';

/** Cognitoから届くイベントのうち、使う部分 */
export interface PreAuthEvent {
  userPoolId: string;
  userName: string;
  request: { userAttributes?: Record<string, string>; userNotFound?: boolean };
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const sns = new SNSClient({});

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
};
const TABLE = env('LOGIN_ATTEMPTS_TABLE');
const TOPIC_ARN = env('NOTIFY_TOPIC_ARN');

export async function handler(event: PreAuthEvent): Promise<PreAuthEvent> {
  // 存在しないユーザー名での試みは数えない
  if (event.request.userNotFound) return event;
  // ロックは管理者のアカウントだけ(docs/04-app/README.md「ログインのロック」の「対象」)
  if (!(await isLockTarget(event))) return event;

  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userName: event.userName },
      UpdateExpression: 'ADD attempts :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const attempts = Number(res.Attributes?.attempts ?? 1);
  const { lock, notify } = decide(attempts);
  if (!lock) return event;

  const email = event.request.userAttributes?.email ?? event.userName;
  const now = new Date().toISOString();
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: event.userPoolId, Username: event.userName }));
  console.log(JSON.stringify({ locked: event.userName, attempts }));

  if (notify) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { userName: event.userName },
          UpdateExpression: 'SET lockedAt = :now',
          ExpressionAttributeValues: { ':now': now },
        }),
      );
      const { subject, message } = buildLockNotice(email, now);
      await sns.send(new PublishCommand({ TopicArn: TOPIC_ARN, Subject: subject, Message: message }));
    } catch (err) {
      // 知らせられなくても、ログインは断る
      console.error(JSON.stringify({ notifyFailed: event.userName, error: String(err) }));
    }
  }
  throw new Error(LOCKED_MESSAGE);
}

/** ロックの対象(管理者)か。グループを確かめられなかったときは、守る側に倒して対象とする */
async function isLockTarget(event: PreAuthEvent): Promise<boolean> {
  try {
    const groups: string[] = [];
    let next: string | undefined;
    do {
      const res = await cognito.send(
        new AdminListGroupsForUserCommand({ UserPoolId: event.userPoolId, Username: event.userName, NextToken: next }),
      );
      groups.push(...(res.Groups ?? []).map((g) => g.GroupName ?? ''));
      next = res.NextToken;
    } while (next);
    return groups.includes(LOCK_GROUP);
  } catch (err) {
    console.error(JSON.stringify({ groupsFailed: event.userName, error: String(err) }));
    return true;
  }
}
