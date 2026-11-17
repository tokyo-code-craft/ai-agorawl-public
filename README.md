# Agorawl(AI言い合いバトル)

AI同士にテーマを議論(ディベート)させ、その過程を Web でリアルタイムに観戦できるシステムです。
名前は agora(古代ギリシャの議論の場)と brawl(乱闘)の造語です。

## 何ができるか

- テーマと、先攻・後攻の立場を入れて、議論を始める(例: 「きのこの山とたけのこの里はどっちが美味い?」、先攻「きのこの山」、後攻「たけのこの里」)。
- 先攻と後攻の AI を選ぶ(Claude、OpenAI、Mistral などのモデル)。
- 発言が1ターンずつ画面に届く様子を、リアルタイムに見る。討論者は Web を検索し、資料を引用して主張する。
- 議論が終わると、3人の審判(論理、根拠、反論・応答の観点)が判定し、勝ち負けと理由を出す。
- 議論を作る前に、テーマと立場が議論として適切かを AI が確かめる。

## 構成

AWS の上で動きます(CDK で作る)。

| 部分 | 使うもの |
|---|---|
| 議論エンジン | Step Functions、Lambda、Amazon Bedrock(討論者・審判のモデル、Web 検索) |
| HTTP API、リアルタイム配信 | API Gateway(HTTP、WebSocket)、Lambda、DynamoDB Streams |
| 画面 | React + Vite(S3 + CloudFront) |
| ログイン | Amazon Cognito(サインアップは無効。ユーザーは管理者が作る) |

仕様は [docs/00-overview/README.md](docs/00-overview/README.md) から読み始めてください。

## 動かし方

必要なもの:

- AWS のアカウントと、手元の認証情報(`aws configure` など)
- Bedrock で使うモデルの利用の有効化。東京リージョン(`ap-northeast-1`)で動かす。選べるモデルは [infra/lib/debate-defaults.ts](infra/lib/debate-defaults.ts) にある(Claude の `jp.`・`global.` の推論プロファイル、OpenAI の gpt-oss、Mistral Large 3)。Web 検索には `us-east-1` の Amazon Nova 2 Lite(`us.` の推論プロファイル)を使う
- Node.js と npm
- CDK の bootstrap(初回だけ。`npm run cdk -- bootstrap`)

```sh
npm install
npm run build:web                    # 画面(SPA)をビルドする
npm run cdk -- deploy --all          # すべてのスタックをデプロイする
```

- 管理者のメールアドレス(費用の通知と、議論の開始の通知の送り先)は、`infra/local.json` に `{ "adminEmail": "…" }` と書く(コミットしない)。ないときは、費用の通知は作られず、議論の開始の通知も届かない。
- デプロイした後、Cognito のユーザープールにユーザーを手で作る。管理者にするときは、グループ `admin` に入れる。
- 画面の URL は、デプロイの出力(CloudFront のドメイン)に出る。

ほかのコマンド(動作確認、議論の分析など)は [CLAUDE.md](CLAUDE.md) の「コマンド」と [tools/README.md](tools/README.md) にあります。

## 費用の注意

議論1回(10ターン、審判3人、Web 検索あり)で、Bedrock の費用が約1〜1.3ドル(税抜き)かかります。ほとんどが Web 検索と討論者のモデルです。審判のモデルや、ターン数によって変わります。詳しくは [docs/01-architecture/cost.md](docs/01-architecture/cost.md) を見てください。

- 同時に動かせる議論は、全体で1件です。
- `infra/local.json` に管理者のメールアドレスを書くと、AWS Budgets で費用の通知が届きます。

## Issue と PR

- 不具合の報告や質問は、Issue で受け付けます。
- PR は受け付けていません。

## 開発

開発は Claude Code で行っています。AI への作業の決まりは [CLAUDE.md](CLAUDE.md)、Issue・PR・コミットの決まりは [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

このリポジトリは、開発に使っているリポジトリから、区切りのよいときに写した公開版です。開発の履歴、Issue、PR は含みません。文書の中の「Issue #103」などの番号は、開発に使っているリポジトリの Issue です。

## ライセンス

[MIT](LICENSE)
