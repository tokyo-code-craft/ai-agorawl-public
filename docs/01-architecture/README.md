# 01-architecture: AWS構成

## 配下ファイル

| ファイル | 内容 |
|---|---|
| [cost.md](cost.md) | 費用の目安(議論1回あたり、単価、月の見込み。仕様ではない) |
| [decisions.md](decisions.md) | 決定の記録 |

## 全体像

| 層 | 構成 |
|---|---|
| フロントエンド | S3 + CloudFront の静的SPA |
| 認証 | Cognito(サインアップ無効、ユーザーは手動作成) |
| API | API Gateway(HTTP)+ Lambda(議論作成、一覧、履歴取得) |
| 議論エンジン | Step Functions + Lambda(発言生成)+ Bedrock |
| 保存 | DynamoDB(Debates、Messages、Connections) |
| リアルタイム配信 | API Gateway WebSocket + Lambda(接続・購読、配信) |

## 処理の流れ

1. ブラウザがWebSocketに接続し、議論IDを購読する。
2. ブラウザがHTTP APIでテーマを投入する。議論IDが即座に返る。
3. Step Functionsが1ターンずつ発言を生成し、Messagesに保存する。
4. DynamoDB Streamsが保存を検知し、配信Lambdaが購読中の接続へ送信する。
5. 規定ターン後に完了を保存し、完了通知を送る。

- 議論エンジンは「保存するだけ」。配信はStreams経由で切り離されている。

## CDKスタック分割

| スタック | 内容 | 依存 |
|---|---|---|
| HostingStack | SPAを配信する入れ物。S3(非公開)+ CloudFront。中身は置かない | なし |
| AuthStack | Cognito(セルフサインアップ無効、ユーザーは手動作成)。管理者のグループ `admin` とデモのグループ `demo`(→ `04-app`「アカウントの種類」)。コールバックのURLにCloudFrontのドメインを使う。ログインのロック(事前認証・事後認証のLambdaと、テーブル LoginAttempts → `04-app`「ログインのロック」) | Hosting、Notify |
| DataStack | Debates、Messages、Connections | なし |
| EngineStack | Step Functions、発言生成Lambda、判定Lambda、Bedrock呼び出し権限(Web検索用に `us-east-1` のモデルも含む) | Data |
| ApiStack | HTTP API、Cognito JWT認可。CORSでCloudFrontのドメインを許可する。デモのアカウントが1日に作った議論の数を数えるテーブル DailyCreates(→ `04-app`「デモのアカウントが1日に作れる議論」)。アカウントの一覧のため、ユーザープールのユーザーとグループを読む。議論を作る前の入力の内容の確認のため、Bedrock を呼ぶ(→ `04-app`「入力の内容の確認」) | Hosting、Auth、Data、Engine |
| RealtimeStack | WebSocket API、接続・購読Lambda、配信Lambda(Streamsトリガー) | Auth、Data |
| WebStack | 中身。ビルドしたSPA(静的なイラストを含む)と、設定ファイル `config.json`(APIのURLなど)をHostingStackのS3に置き、CloudFrontのキャッシュを消す | Hosting、Auth、Api、Realtime |
| BudgetStack | 費用の通知(AWS Budgets。下の「費用の通知」) | なし |
| NotifyStack | 管理者への通知用のSNSトピック(メールで送る)。議論の開始の通知と、ログインのロックの通知(→ `04-app`)に使う | なし |

- 配信の入れ物(HostingStack)と中身(WebStack)を分けるのは、依存を一方向にするため。CognitoとHTTP APIはCloudFrontのドメインを、SPAはAPIのURLを必要とする。入れ物を先に作れば、そのドメインを後のスタックに渡せる。
- 公開時の変更点は、Cognitoのセルフサインアップ有効化と利用上限の追加のみ。
- CloudFormationのスタック名は `Agorawl` + 種類(`AgorawlData`、`AgorawlEngine` など)。
- テーブル名など個々のリソース名はCDKの自動生成に任せ、固定しない。他のスタックやツールからは、スタックの出力(Outputs)で参照する。
- 開発初期(動作確認の期間)は、テーブルの削除ポリシーをDESTROYにする(`cdk destroy` でデータごと削除される)。本番運用の前に、削除時に残す設定(RETAIN)へ戻す。
- 開発は Data・Engine → Auth・Api → Realtime → Hosting・Web の順に進める(HostingStackを作ってからは、AuthとApiがそのドメインを使う)。画面のない段階(Engine、Api)は、動作確認用CLI(`tools/`)で確かめる。

## 各サービスの位置づけ

| サービス | 役割 |
|---|---|
| Step Functions | 進行制御のみ。ターンの順序、繰り返し、終了判定を管理する。Lambdaの15分上限の影響を受けず、失敗したターンだけ再試行できる。種別はStandard。発言生成はLambda経由で行う(→ `03-engine`) |
| Bedrock | Converse APIで呼ぶ。モデルが違っても同じ呼び出し形式で扱える |
| DynamoDB Streams | MessagesとDebatesの変更を検知して配信Lambdaを起動する(下表) |

### DynamoDB Streams

| 項目 | Messages | Debates |
|---|---|---|
| StreamViewType | NEW_IMAGE(発言をそのまま配信できる) | NEW_IMAGE(議論の状態をそのまま配信できる) |
| イベント | INSERTのみに絞る(フィルタ) | MODIFYのみに絞る(フィルタ。終了、判定の保存など) |
| 配信するもの | 発言(`message`。作戦メモを除く → `04-app`) | 議論(`debate` → `04-app`) |

| 項目 | 内容 |
|---|---|
| 保持期間 | 24時間。それ以前の欠落分は、テーブルの直接参照(HTTP APIの履歴取得)で補う |
| 重複 | Lambdaの再試行で重複し得る。発言は `turn` で、議論は最新の状態で上書きして排除する |
| 失敗時 | バッチ単位で再試行され後続が止まるため、再試行は2回までとし、失敗したバッチは半分に分けて再試行する。それでも失敗した分はSQS(失敗時の送信先)に送り、後続を止めない |
| 送信先が切断済み | 配信Lambdaは、GoneExceptionの接続をConnectionsから消す(→ `02-data-model`「Connectionsの `ttl`」) |

## 費用の通知

AWS Budgets で、月の費用が決めた額を超えたらメールで知らせる。知らせるだけで、議論は止めない。

| 項目 | 内容 | 状態 |
|---|---|---|
| 作り方 | CDK の BudgetStack(`AgorawlBudget`)に、予算(`AWS::Budgets::Budget`)を1つ作る | 確定 |
| 予算 | 月ごと、費用(`COST`)、250ドル | 確定 |
| 通知 | 月の実績の費用が 50・100・150・200・250 ドルを超えたとき(額で指定。1つの予算に付けられる通知は5つまで) | 確定 |
| 通知の送り先 | 管理者のメールアドレス。手元の設定ファイル `infra/local.json` の `adminEmail` に書く(手元で作る。コミットしない)。デプロイ時に CDK の context(`-c adminEmail=…`)を渡したときは、そちらを使う。どちらもないときは BudgetStack を作らず、NotifyStack のトピックにメールの送り先を付けない | 確定 |
| 数える範囲 | アカウント全体の費用(サービス・リージョン・タグで絞らない)。費用の種類は AWS の初期値(税、サポート、クレジット、返金などを含む) | 確定 |

## 実装時の制約

| 項目 | 内容 | 対応 |
|---|---|---|
| WebSocketの認証 | ブラウザはハンドシェイクにヘッダーを付けられない | トークンをクエリ文字列で渡し、`$connect` のLambdaオーソライザーで検証 |
| 接続の寿命 | アイドル10分、最大2時間で切断される | 定期pingと自動再接続 |
| 再接続時の欠落 | 切断中の発言を取り逃す | 「購読 → 履歴取得」の順に行い、`turn` で重複を排除 |
| Bedrockのモデル | リージョンごとにモデルアクセスの有効化が必要。モデルによっては推論プロファイル指定が必要 | モデルIDはコードに固定せず `participants` で持つ |

## 検討事項(未決)

- 利用可能な画像生成モデルの、対象リージョンでの提供状況の確認(テキスト生成の動作確認用モデルは確認済み → `03-engine`)。