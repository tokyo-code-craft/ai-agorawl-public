// 認証(Cognito)とログインのロック。仕様: docs/04-app/README.md「認証」「ログインのロック」
import * as path from 'node:path';
import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  CfnUserPoolGroup,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';
import type { NotifyStack } from './notify-stack';

const REPO_ROOT = path.join(__dirname, '../..');

/** 開発用のSPAのURL(Viteの既定) */
export const DEV_WEB_ORIGIN = 'http://localhost:5173';

export interface AuthStackProps extends StackProps {
  /** SPAを配信するCloudFrontのオリジン(HostingStack) */
  webOrigin: string;
  /** 管理者への通知(ログインのロック) */
  notify: NotifyStack;
}

export class AuthStack extends Stack {
  readonly userPool: UserPool;
  readonly webClient: UserPoolClient;
  /** マネージドログイン画面のドメイン(https://….amazoncognito.com) */
  readonly domainBaseUrl: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // セルフサインアップは無効。ユーザーは管理者がAWS CLIで作る
    this.userPool = new UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // 開発初期はDESTROY。本番運用の前にRETAINへ戻す(docs/01-architecture/README.md)
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // 管理者のグループ。人を入れるのは AWS CLI で行う(docs/04-app/README.md「認証」の「管理者」)
    new CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: '管理者(議論を消せる)',
    });
    // デモのアカウントのグループ。動画の視聴者が使う(docs/04-app/README.md「アカウントの種類」)
    new CfnUserPoolGroup(this, 'DemoGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'demo',
      description: 'デモ(議論を1日5件まで作れる)',
    });

    // ログインのロック。続けて間違えた回数を数える(docs/04-app/README.md「ログインのロック」)
    const loginAttempts = new Table(this, 'LoginAttempts', {
      partitionKey: { name: 'userName', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // 開発初期はDESTROY。本番運用の前にRETAINへ戻す(docs/01-architecture/README.md)
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const trigger = (id: string, file: string) =>
      new NodejsFunction(this, id, {
        entry: path.join(REPO_ROOT, 'app/auth/src', file),
        handler: 'handler',
        runtime: Runtime.NODEJS_24_X,
        timeout: Duration.seconds(5),
        memorySize: 256,
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
        environment: {
          LOGIN_ATTEMPTS_TABLE: loginAttempts.tableName,
          NOTIFY_TOPIC_ARN: props.notify.topic.topicArn,
        },
      });
    const preAuth = trigger('PreAuth', 'pre-auth.ts');
    const postAuth = trigger('PostAuth', 'post-auth.ts');
    loginAttempts.grantReadWriteData(preAuth);
    loginAttempts.grantWriteData(postAuth);
    props.notify.topic.grantPublish(preAuth);
    // プールのARNを直接使うと、プール → トリガー → 権限 → プールの輪になるため、このアカウントとリージョンのプールに限る
    preAuth.addToRolePolicy(
      new PolicyStatement({
        // ロックは管理者だけに効かせるため、グループも読む(docs/04-app/README.md「ログインのロック」)
        actions: ['cognito-idp:AdminDisableUser', 'cognito-idp:AdminListGroupsForUser'],
        resources: [
          this.formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: '*', arnFormat: ArnFormat.SLASH_RESOURCE_NAME }),
        ],
      }),
    );
    this.userPool.addTrigger(UserPoolOperation.PRE_AUTHENTICATION, preAuth);
    this.userPool.addTrigger(UserPoolOperation.POST_AUTHENTICATION, postAuth);
    new CfnOutput(this, 'LoginAttemptsTable', { value: loginAttempts.tableName });

    // マネージドログイン画面のドメイン。接頭辞はリージョン内で重複しないよう、アカウントIDを付ける
    const domain = this.userPool.addDomain('Domain', { cognitoDomain: { domainPrefix: `agorawl-${this.account}` } });

    // SPA用。ブラウザはシークレットを安全に持てないため、シークレットなしで認可コードと PKCE を使う
    this.webClient = this.userPool.addClient('Web', {
      generateSecret: false,
      // 画面なしの動作確認用(tools/call-api)。AWSの認証情報が要るため、ブラウザからは使えない
      authFlows: { adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: [`${DEV_WEB_ORIGIN}/`, `${props.webOrigin}/`],
        logoutUrls: [`${DEV_WEB_ORIGIN}/`, `${props.webOrigin}/`],
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.webClient.userPoolClientId });
    this.domainBaseUrl = domain.baseUrl();
    new CfnOutput(this, 'CognitoDomain', { value: this.domainBaseUrl });
  }
}
