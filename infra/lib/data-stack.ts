// テーブル定義。仕様: docs/02-data-model/README.md
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import { INDEX_NAMES } from '@agorawl/contract';

// 開発初期はDESTROY。本番運用の前にRETAINへ戻す(docs/01-architecture/README.md)
const REMOVAL_POLICY = RemovalPolicy.DESTROY;

export class DataStack extends Stack {
  readonly debates: Table;
  readonly messages: Table;
  readonly connections: Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.debates = new Table(this, 'Debates', {
      partitionKey: { name: 'debateId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // 議論の状態の変化(終了、判定の保存)の配信に使う
      stream: StreamViewType.NEW_IMAGE,
      removalPolicy: REMOVAL_POLICY,
    });
    this.debates.addGlobalSecondaryIndex({
      indexName: INDEX_NAMES.debatesByCreatedAt,
      partitionKey: { name: 'listKey', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.messages = new Table(this, 'Messages', {
      partitionKey: { name: 'debateId', type: AttributeType.STRING },
      sortKey: { name: 'turn', type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_IMAGE,
      removalPolicy: REMOVAL_POLICY,
    });

    this.connections = new Table(this, 'Connections', {
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: REMOVAL_POLICY,
    });
    this.connections.addGlobalSecondaryIndex({
      indexName: INDEX_NAMES.connectionsByDebateId,
      partitionKey: { name: 'debateId', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    new CfnOutput(this, 'DebatesTableName', { value: this.debates.tableName });
    new CfnOutput(this, 'MessagesTableName', { value: this.messages.tableName });
    new CfnOutput(this, 'ConnectionsTableName', { value: this.connections.tableName });
  }
}
