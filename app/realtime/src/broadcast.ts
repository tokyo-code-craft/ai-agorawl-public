// 配信Lambda。MessagesとDebatesの Streams から起動し、議論を購読中の接続へ送る。
// 仕様: docs/04-app/README.md「WebSocket API」、docs/01-architecture/README.md「DynamoDB Streams」
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { INDEX_NAMES } from '@agorawl/contract';
import { toBroadcast } from './logic';

interface StreamEvent {
  Records: { eventName?: string; dynamodb?: { NewImage?: Record<string, AttributeValue> } }[];
}

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
};
const CONNECTIONS_TABLE = env('CONNECTIONS_TABLE');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const api = new ApiGatewayManagementApiClient({ endpoint: env('WEBSOCKET_ENDPOINT') });

export async function handler(event: StreamEvent): Promise<void> {
  // フィルタで Messages は INSERT、Debates は MODIFY だけが届く。順番を保つため、1件ずつ送る
  for (const record of event.Records) {
    const image = record.dynamodb?.NewImage;
    if (!image) continue;
    const { debateId, payload } = toBroadcast(unmarshall(image));
    const data = JSON.stringify(payload);
    const connectionIds = await subscribers(debateId);
    // 送信先が切断済みなら、その接続情報を消す。それ以外の失敗は投げて、バッチごと再試行させる
    await Promise.all(
      connectionIds.map(async (connectionId) => {
        try {
          await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
        } catch (err) {
          if (!(err instanceof GoneException)) throw err;
          await ddb.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
        }
      }),
    );
    console.log(JSON.stringify({ debateId, type: payload.type, sent: connectionIds.length }));
  }
}

/** 議論を購読中の接続ID */
async function subscribers(debateId: string): Promise<string[]> {
  const ids: string[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: INDEX_NAMES.connectionsByDebateId,
        KeyConditionExpression: 'debateId = :d',
        ExpressionAttributeValues: { ':d': debateId },
        ExclusiveStartKey: startKey,
      }),
    );
    ids.push(...(res.Items ?? []).map((i) => i.connectionId as string));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return ids;
}
