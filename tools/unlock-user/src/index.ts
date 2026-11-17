// 開発用CLI: ログインのロックを解除する。ユーザーを有効に戻し、続けて間違えた回数を0にする。
// 使い方: npm run unlock-user -- <メールアドレス>
// 仕様: docs/04-app/README.md「ログインのロック」。本番スタックには含めない
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error('使い方: npm run unlock-user -- <メールアドレス>');
    process.exit(1);
  }

  const outputs = await loadStackOutputs('AgorawlAuth');
  const userPoolId = outputs.UserPoolId;
  const table = outputs.LoginAttemptsTable;
  if (!userPoolId || !table) throw new Error('AgorawlAuth の出力(UserPoolId、LoginAttemptsTable)が見つかりません');

  const cognito = new CognitoIdentityProviderClient({});
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // メールアドレスからCognitoのユーザー名を探す
  const users = await cognito.send(
    new ListUsersCommand({ UserPoolId: userPoolId, Filter: `email = "${email.replace(/"/g, '')}"`, Limit: 2 }),
  );
  const user = users.Users?.[0];
  if (!user?.Username) {
    console.error(`ユーザーが見つかりません: ${email}`);
    process.exit(1);
  }

  const before = await ddb.send(new GetCommand({ TableName: table, Key: { userName: user.Username } }));
  await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: user.Username }));
  await ddb.send(new DeleteCommand({ TableName: table, Key: { userName: user.Username } }));

  console.log(`解除しました: ${email}`);
  console.log(`  解除する前: ${user.Enabled ? '有効' : '無効(ロック中)'}、続けて試みた回数 ${before.Item?.attempts ?? 0}`);
  if (before.Item?.lockedAt) console.log(`  止めた時刻: ${before.Item.lockedAt}`);
}

async function loadStackOutputs(StackName: string): Promise<Record<string, string>> {
  const res = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName }));
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
