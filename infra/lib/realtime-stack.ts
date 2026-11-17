// リアルタイム配信(WebSocket)。仕様: docs/04-app/README.md「WebSocket API」、docs/01-architecture/README.md「DynamoDB Streams」
import * as path from 'node:path';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { FilterCriteria, FilterRule, Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { AuthStack } from './auth-stack';
import type { DataStack } from './data-stack';

const REPO_ROOT = path.join(__dirname, '../..');

export interface RealtimeStackProps extends StackProps {
  auth: AuthStack;
  data: DataStack;
}

export class RealtimeStack extends Stack {
  /** WebSocketのURL(SPAの config.json に書く) */
  readonly webSocketUrl: string;

  constructor(scope: Construct, id: string, props: RealtimeStackProps) {
    super(scope, id, props);
    const { debates, messages, connections } = props.data;

    const realtimeFunction = (id: string, file: string, environment: Record<string, string>) =>
      new NodejsFunction(this, id, {
        entry: path.join(REPO_ROOT, 'app/realtime/src', file),
        handler: 'handler',
        runtime: Runtime.NODEJS_24_X,
        timeout: Duration.seconds(10),
        memorySize: 256,
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
        environment,
      });

    // $connect のオーソライザー。クエリの token(Cognitoのアクセストークン)を検証する
    const authorizerFn = realtimeFunction('Authorizer', 'authorizer.ts', {
      USER_POOL_ID: props.auth.userPool.userPoolId,
      USER_POOL_CLIENT_ID: props.auth.webClient.userPoolClientId,
    });
    const authorizer = new WebSocketLambdaAuthorizer('Cognito', authorizerFn, {
      identitySource: ['route.request.querystring.token'],
    });

    // 接続・購読・切断
    const connectionFn = realtimeFunction('Connection', 'connection.ts', {
      CONNECTIONS_TABLE: connections.tableName,
      DEBATES_TABLE: debates.tableName,
    });
    connections.grantReadWriteData(connectionFn);
    debates.grantReadData(connectionFn);
    const integration = new WebSocketLambdaIntegration('ConnectionIntegration', connectionFn);

    const api = new WebSocketApi(this, 'Api', {
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: { integration, authorizer },
      disconnectRouteOptions: { integration },
      defaultRouteOptions: { integration },
    });
    api.addRoute('subscribe', { integration });
    api.addRoute('ping', { integration });
    const stage = new WebSocketStage(this, 'Stage', { webSocketApi: api, stageName: 'prod', autoDeploy: true });
    api.grantManageConnections(connectionFn);

    // 配信。Messagesの追加(発言)と、Debatesの変更(終了、判定の保存)から起動する
    const broadcastFn = realtimeFunction('Broadcast', 'broadcast.ts', {
      CONNECTIONS_TABLE: connections.tableName,
      WEBSOCKET_ENDPOINT: stage.callbackUrl,
    });
    connections.grantReadWriteData(broadcastFn);
    api.grantManageConnections(broadcastFn);

    // 再試行2回、失敗したバッチは半分に分けて再試行し、それでも失敗した分はSQSに送って後続を止めない
    const failed = new Queue(this, 'BroadcastFailed', { retentionPeriod: Duration.days(4) });
    const streamOptions = (eventName: 'INSERT' | 'MODIFY') => ({
      startingPosition: StartingPosition.LATEST,
      batchSize: 10,
      retryAttempts: 2,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(failed),
      filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual(eventName) })],
    });
    broadcastFn.addEventSource(new DynamoEventSource(messages, streamOptions('INSERT')));
    broadcastFn.addEventSource(new DynamoEventSource(debates, streamOptions('MODIFY')));

    this.webSocketUrl = stage.url;
    new CfnOutput(this, 'WebSocketUrl', { value: this.webSocketUrl });
  }
}
