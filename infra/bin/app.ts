// CDKアプリ。スタックの分割と作る順は docs/01-architecture/README.md「CDKスタック分割」
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { BudgetStack } from '../lib/budget-stack';
import { DataStack } from '../lib/data-stack';
import { EngineStack } from '../lib/engine-stack';
import { HostingStack } from '../lib/hosting-stack';
import { NotifyStack } from '../lib/notify-stack';
import { RealtimeStack } from '../lib/realtime-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

// 管理者のメールアドレス(費用の通知、議論の開始の通知の送り先)。
// infra/local.json(手元で作る。コミットしない)の adminEmail から読む。-c adminEmail=… を渡したときは、そちらを使う
const adminEmailValue: unknown = app.node.tryGetContext('adminEmail') ?? readLocalSettings().adminEmail;
const adminEmail = typeof adminEmailValue === 'string' && adminEmailValue !== '' ? adminEmailValue : undefined;

const notify = new NotifyStack(app, 'AgorawlNotify', { env, email: adminEmail });
const data = new DataStack(app, 'AgorawlData', { env });
const engine = new EngineStack(app, 'AgorawlEngine', { env, data });
const hosting = new HostingStack(app, 'AgorawlHosting', { env });
const auth = new AuthStack(app, 'AgorawlAuth', { env, webOrigin: hosting.webOrigin, notify });
const api = new ApiStack(app, 'AgorawlApi', { env, hosting, auth, data, engine, notify });
const realtime = new RealtimeStack(app, 'AgorawlRealtime', { env, auth, data });
new WebStack(app, 'AgorawlWeb', { env, hosting, auth, api, realtime });

// 費用の通知。管理者のメールアドレスがないときは作らない
if (adminEmail) {
  new BudgetStack(app, 'AgorawlBudget', { env, email: adminEmail });
}

/** 手元の設定 infra/local.json。ないときは空 */
function readLocalSettings(): Record<string, unknown> {
  const path = join(__dirname, '..', 'local.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
