// 費用の通知(AWS Budgets)。知らせるだけで、議論は止めない。
// 仕様: docs/01-architecture/README.md「費用の通知」
import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import type { Construct } from 'constructs';

/** 月の予算(ドル) */
const LIMIT_USD = 250;
/** 月の実績の費用がこの額(ドル)を超えたら知らせる。1つの予算に付けられる通知は5つまで */
const THRESHOLDS_USD = [50, 100, 150, 200, 250];

export interface BudgetStackProps extends StackProps {
  /** 通知を送る管理者のメールアドレス。リポジトリには書かず、infra/local.json の adminEmail に書く */
  email: string;
}

export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);

    new CfnBudget(this, 'Monthly', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: LIMIT_USD, unit: 'USD' },
      },
      notificationsWithSubscribers: THRESHOLDS_USD.map((threshold) => ({
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'ABSOLUTE_VALUE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: props.email }],
      })),
    });
  }
}
