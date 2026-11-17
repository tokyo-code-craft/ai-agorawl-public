# infra/

CDK。開発初期は DataStack(`AgorawlData`)と EngineStack(`AgorawlEngine`)のみ。
Auth、Api、Realtime、Web の各スタックは今後追加する。

- `bin/app.ts`: CDKアプリ
- `lib/data-stack.ts`: Debates、Messages、Connections
- `lib/engine-stack.ts`: 発言生成Lambda、判定Lambda、Step Functions
- `lib/debate-definition.ts`: Step Functionsの定義
- `lib/budget-stack.ts`: 費用の通知(AWS Budgets)。管理者のメールアドレスがないときは作らない
- `lib/notify-stack.ts`: 管理者への通知用のSNSトピック(議論の開始の通知)
- `local.json`: 管理者のメールアドレス(手元で作る。コミットしない)。例: `{ "adminEmail": "you@example.com" }`
- 仕様: `docs/01-architecture/README.md`
