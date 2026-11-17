// 分析CLI: 保存済みの議論から、討論者の挙動の指標を出す。議論には何も書き込まない。
// 使い方: npm run analyze-debate -- <議論ID> [<議論ID> …]
// 仕様: docs/03-engine/analysis.md。本番スタックには含めない。
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { Debate, Message } from '@agorawl/contract';
import { formatReport } from './format';
import { debateMetrics } from './metrics';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('使い方: npm run analyze-debate -- <議論ID> [<議論ID> …]');
    process.exit(1);
  }

  const outputs = await loadStackOutputs('AgorawlData');
  if (!outputs.DebatesTableName || !outputs.MessagesTableName) {
    console.error('AgorawlData スタックの出力にテーブル名がありません。デプロイ済みか確かめてください。');
    process.exit(1);
  }
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const metrics = [];
  for (const debateId of ids) {
    const res = await ddb.send(new GetCommand({ TableName: outputs.DebatesTableName, Key: { debateId } }));
    const debate = res.Item as Debate | undefined;
    if (!debate) {
      console.error(`議論が見つかりません: ${debateId}`);
      process.exit(1);
    }
    metrics.push(debateMetrics(debate, await loadMessages(ddb, outputs.MessagesTableName, debateId)));
  }
  console.log(formatReport(metrics));
}

async function loadMessages(ddb: DynamoDBDocumentClient, table: string, debateId: string): Promise<Message[]> {
  const messages: Message[] = [];
  let start: QueryCommandOutput['LastEvaluatedKey'];
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'debateId = :id',
        ExpressionAttributeValues: { ':id': debateId },
        ExclusiveStartKey: start,
      }),
    );
    messages.push(...((res.Items ?? []) as Message[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return messages;
}

async function loadStackOutputs(stackName: string): Promise<Record<string, string>> {
  const res = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs: Record<string, string> = {};
  for (const o of res.Stacks?.[0]?.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
  }
  return outputs;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
