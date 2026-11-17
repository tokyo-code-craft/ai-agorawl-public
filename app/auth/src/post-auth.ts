// 事後認証のLambda(Cognitoのトリガー)。ログインに成功したら、続けて間違えた回数を0に戻す。
// 仕様: docs/04-app/README.md「ログインのロック」
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Cognitoから届くイベントのうち、使う部分 */
export interface PostAuthEvent {
  userName: string;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.LOGIN_ATTEMPTS_TABLE;

export async function handler(event: PostAuthEvent): Promise<PostAuthEvent> {
  if (!TABLE) throw new Error('環境変数 LOGIN_ATTEMPTS_TABLE が設定されていません');
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { userName: event.userName } }));
  return event;
}
