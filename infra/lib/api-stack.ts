// HTTP API。仕様: docs/04-app/README.md「HTTP API」
import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';
import { DEV_WEB_ORIGIN, type AuthStack } from './auth-stack';
import type { DataStack } from './data-stack';
import { CONTENT_CHECK_MODEL_ID, DEBATE_DEFAULTS } from './debate-defaults';
import type { EngineStack } from './engine-stack';
import type { HostingStack } from './hosting-stack';
import type { NotifyStack } from './notify-stack';

const REPO_ROOT = path.join(__dirname, '../..');

export interface ApiStackProps extends StackProps {
  hosting: HostingStack;
  auth: AuthStack;
  data: DataStack;
  engine: EngineStack;
  notify: NotifyStack;
}

export class ApiStack extends Stack {
  /** HTTP APIのURL(SPAの config.json に書く) */
  readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { debates, messages } = props.data;
    const { stateMachine } = props.engine;

    // デモのアカウントが1日に作った議論の数(docs/04-app/README.md「デモのアカウントが1日に作れる議論」)
    const dailyCreates = new Table(this, 'DailyCreates', {
      partitionKey: { name: 'counterKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      // 開発初期はDESTROY。本番運用の前にRETAINへ戻す(docs/01-architecture/README.md)
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'Http', {
      entry: path.join(REPO_ROOT, 'app/api/src/http.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      // 議論の作成で入力の内容を AI に確かめさせる(最大15秒待つ)。API Gateway の上限30秒の手前にする
      timeout: Duration.seconds(29),
      memorySize: 512,
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
      environment: {
        DEBATES_TABLE: debates.tableName,
        MESSAGES_TABLE: messages.tableName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        // モデルはコードに固定せず、設定として渡す
        DEBATE_DEFAULTS: JSON.stringify(DEBATE_DEFAULTS),
        // 議論の開始の通知(管理者へのメール)。本文に議論の画面のURLを書く
        NOTIFY_TOPIC_ARN: props.notify.topic.topicArn,
        WEB_ORIGIN: props.hosting.webOrigin,
        DAILY_CREATES_TABLE: dailyCreates.tableName,
        // アカウントの一覧(GET /accounts)
        USER_POOL_ID: props.auth.userPool.userPoolId,
        // 入力の内容の確認(docs/04-app/README.md「入力の内容の確認」)
        CONTENT_CHECK_MODEL_ID,
      },
    });
    dailyCreates.grantReadWriteData(fn);
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['cognito-idp:ListUsers', 'cognito-idp:ListUsersInGroup'],
        resources: [props.auth.userPool.userPoolArn],
      }),
    );
    props.notify.topic.grantPublish(fn);
    // 入力の内容の確認。jp. の推論プロファイルは複数のリージョンへ振り分けるため、リージョンを限定しない
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    );
    debates.grantReadWriteData(fn);
    // 発言を読む(GET)、議論を消すときに発言を消す(DELETE)
    messages.grantReadWriteData(fn);
    stateMachine.grantStartExecution(fn);
    // 実行中の議論を数える(同時に実行できる議論は全体で1件)
    stateMachine.grant(fn, 'states:ListExecutions');

    // Cognitoのアクセストークンを検証する(アクセストークンの client_id をアプリクライアントのIDと照らし合わせる)
    const authorizer = new HttpJwtAuthorizer('Cognito', props.auth.userPool.userPoolProviderUrl, {
      jwtAudience: [props.auth.webClient.userPoolClientId],
    });

    const api = new HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: [DEV_WEB_ORIGIN, props.hosting.webOrigin],
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PATCH, CorsHttpMethod.DELETE],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration('HttpIntegration', fn);
    const routes: [HttpMethod, string][] = [
      [HttpMethod.POST, '/debates'],
      [HttpMethod.GET, '/debates'],
      [HttpMethod.GET, '/debates/{debateId}'],
      [HttpMethod.PATCH, '/debates/{debateId}'],
      [HttpMethod.DELETE, '/debates/{debateId}'],
      [HttpMethod.GET, '/models'],
      [HttpMethod.GET, '/accounts'],
    ];
    for (const [method, routePath] of routes) {
      api.addRoutes({ path: routePath, methods: [method], integration, authorizer });
    }

    this.apiUrl = api.apiEndpoint;
    new CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
  }
}
