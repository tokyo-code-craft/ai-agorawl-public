// 管理者への通知用のSNSトピック。メールで管理者に送る。
// 仕様: docs/01-architecture/README.md「CDKスタック分割」、docs/04-app/README.md「議論の開始の通知」
import { Stack, type StackProps } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface NotifyStackProps extends StackProps {
  /** 管理者のメールアドレス。ないときは、送り先を付けない(トピックだけ作る) */
  email?: string;
}

export class NotifyStack extends Stack {
  readonly topic: Topic;

  constructor(scope: Construct, id: string, props: NotifyStackProps) {
    super(scope, id, props);

    this.topic = new Topic(this, 'Admin');
    // 送り先のメールアドレスには、最初に確認のメールが届く。リンクを押すまでは送られない
    if (props.email) this.topic.addSubscription(new EmailSubscription(props.email));
  }
}
