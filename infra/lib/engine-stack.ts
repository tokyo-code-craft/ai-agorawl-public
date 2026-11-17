// 議論エンジン。仕様: docs/03-engine/README.md
import * as path from 'node:path';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DefinitionBody, StateMachine, StateMachineType } from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';
import type { DataStack } from './data-stack';
import { buildDebateDefinition } from './debate-definition';

const REPO_ROOT = path.join(__dirname, '../..');

export interface EngineStackProps extends StackProps {
  data: DataStack;
}

export class EngineStack extends Stack {
  /** HTTP API(ApiStack)が議論を始めるときに起動する */
  readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: EngineStackProps) {
    super(scope, id, props);
    const { debates, messages } = props.data;

    // Web検索用のモデル(東京リージョンでは Web Grounding が使えないため us-east-1)
    const search = { modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1' };

    const engineFunction = (id: string, file: string, timeout: Duration, extraEnv: Record<string, string> = {}) => {
      const fn = new NodejsFunction(this, id, {
        entry: path.join(REPO_ROOT, 'engine/src', file),
        handler: 'handler',
        runtime: Runtime.NODEJS_24_X,
        timeout,
        memorySize: 512,
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
        environment: {
          DEBATES_TABLE: debates.tableName,
          MESSAGES_TABLE: messages.tableName,
          ...extraEnv,
        },
      });
      // モデルは participants / judges で指定するため、モデルを限定しない。
      // jp. などの推論プロファイルは複数のリージョンへ振り分けるため、リージョンも限定しない。
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: [
            'arn:aws:bedrock:*::foundation-model/*',
            `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
          ],
        }),
      );
      return fn;
    };

    // 検索を最大3回行うため、発言生成は5分
    const generateTurn = engineFunction('GenerateTurn', 'generate-turn.ts', Duration.minutes(5), {
      SEARCH_MODEL_ID: search.modelId,
      SEARCH_REGION: search.region,
    });
    debates.grantReadData(generateTurn);
    messages.grantReadWriteData(generateTurn);
    // Web Grounding(Bedrockのシステムツール)の呼び出し権限
    generateTurn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeTool'],
        resources: [`arn:aws:bedrock::${this.account}:system-tool/amazon.nova_grounding`],
      }),
    );

    // 判定Lambdaは verdict を書くため、Debatesの更新権限を持つ
    const judgeDebate = engineFunction('JudgeDebate', 'judge.ts', Duration.minutes(5));
    debates.grantReadData(judgeDebate);
    debates.grant(judgeDebate, 'dynamodb:UpdateItem');
    messages.grantReadData(judgeDebate);

    const stateMachine = (this.stateMachine = new StateMachine(this, 'Debate', {
      stateMachineType: StateMachineType.STANDARD,
      definitionBody: DefinitionBody.fromString(JSON.stringify(buildDebateDefinition())),
      definitionSubstitutions: {
        DebatesTable: debates.tableName,
        GenerateTurnFunction: generateTurn.functionArn,
        JudgeFunction: judgeDebate.functionArn,
      },
    }));
    debates.grant(stateMachine, 'dynamodb:UpdateItem');
    generateTurn.grantInvoke(stateMachine);
    judgeDebate.grantInvoke(stateMachine);

    new CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
  }
}
