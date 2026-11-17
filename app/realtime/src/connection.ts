// WebSocketの接続・購読・切断のLambda。ルートごとに分岐する。仕様: docs/04-app/README.md「WebSocket API」
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Connection } from '@agorawl/contract';
import { ClientError, connectionTtl, parseSubscribe, type ServerMessage } from './logic';

interface WebSocketEvent {
  body?: string;
  requestContext: {
    routeKey: string;
    connectionId: string;
    domainName: string;
    stage: string;
    authorizer?: { sub?: string; principalId?: string; admin?: string | boolean };
  };
}

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
};
const CONNECTIONS_TABLE = env('CONNECTIONS_TABLE');
const DEBATES_TABLE = env('DEBATES_TABLE');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const OK = { statusCode: 200, body: '' };

export async function handler(event: WebSocketEvent) {
  const { routeKey, connectionId } = event.requestContext;
  switch (routeKey) {
    case '$connect': {
      const userId = event.requestContext.authorizer?.sub ?? event.requestContext.authorizer?.principalId;
      if (!userId) return { statusCode: 401, body: '' };
      const item: Connection = { connectionId, userId, ttl: connectionTtl(Date.now()) };
      await ddb.send(new PutCommand({ TableName: CONNECTIONS_TABLE, Item: item }));
      return OK;
    }
    case '$disconnect':
      await ddb.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
      return OK;
    case 'ping':
      // 何もしない(無通信の切断を防ぐため)
      return OK;
    case 'subscribe':
      return subscribe(event);
    default:
      await send(event, { type: 'error', message: `知らない action です(subscribe か ping を指定してください)` });
      return OK;
  }
}

async function subscribe(event: WebSocketEvent) {
  const { connectionId } = event.requestContext;
  let debateId: string;
  try {
    debateId = parseSubscribe(event.body);
  } catch (err) {
    if (!(err instanceof ClientError)) throw err;
    await send(event, { type: 'error', message: err.message });
    return OK;
  }
  const debate = await ddb.send(new GetCommand({ TableName: DEBATES_TABLE, Key: { debateId }, ProjectionExpression: 'debateId, #hidden', ExpressionAttributeNames: { '#hidden': 'hidden' } }));
  // 隠した議論は、管理者でなければ、ない場合と同じに扱う(docs/04-app/README.md「議論を隠す」)
  const admin = String(event.requestContext.authorizer?.admin) === 'true';
  if (!debate.Item || (debate.Item.hidden && !admin)) {
    await send(event, { type: 'error', message: '議論が見つかりません' });
    return OK;
  }
  // 1つの接続で購読できるのは1件。別の議論を購読すると置き換える
  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET debateId = :d',
      ConditionExpression: 'attribute_exists(connectionId)',
      ExpressionAttributeValues: { ':d': debateId },
    }),
  );
  await send(event, { type: 'subscribed', debateId });
  return OK;
}

/** この接続へメッセージを送る */
async function send(event: WebSocketEvent, message: ServerMessage): Promise<void> {
  const { domainName, stage, connectionId } = event.requestContext;
  const client = new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` });
  await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: JSON.stringify(message) }));
}
