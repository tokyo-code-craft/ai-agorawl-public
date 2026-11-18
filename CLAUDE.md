# Agorawl(AI言い合いバトル)

AIにテーマを議論させ(ディベート形式)、その過程をWebでリアルタイムに確認できるシステム。
AWS(CDK / Lambda / Step Functions / Bedrock / DynamoDB / API Gateway)で構築する。
リポジトリ名は `ai-agorawl`。実装はTypeScript(npm workspaces)。議論エンジン(DataStack、EngineStack)は動いており、現在は画面と一連の流れ(認証、HTTP API、リアルタイム配信、SPA。Issue #38)を実装中。

## 仕様の参照(最重要)

- 仕様は `docs/` 配下にある。各ディレクトリが1つの仕様領域で、`README.md` が入口(要点と配下ファイルの目次)。
- 作業を始める前に、次の順で読むこと。
  1. `docs/00-overview/README.md`
  2. 作業対象の領域の `README.md`
  3. `README.md` の目次に載っている、作業に関係するファイル
- `decisions.md` は決定の経緯の記録。仕様の理由を確認したいときだけ読む。
- 領域の一覧:
  - `00-overview` : 全体像、領域をまたぐ決定
  - `01-architecture` : AWS構成、スタック分割
  - `02-data-model` : テーブル設計、起動入力
  - `03-engine` : 議論の進行、役割、判定
  - `04-app` : HTTP API、WebSocket、画面、認証
  - `05-persona-illustration` : 人格定義、イラストの生成手順
  - `06-explainer-video` : 解説動画の自動生成

## 仕様変更のルール

- 仕様の変更・追加は、コードより先に `docs/` へ反映すること。
- 仕様ファイルには「現在の仕様」のみを書き、変更の経緯は書かない。
- 決定を追加・変更した場合は、理由と却下した案を、該当する領域の `decisions.md` に追記すること。
  - 1つの領域に閉じる決定: その領域の `decisions.md`
  - 複数の領域にまたがる決定: `docs/00-overview/decisions.md`
- 仕様ファイルを分割・追加した場合は、その領域の `README.md` の目次を更新すること。
- 仕様にない挙動を実装する必要がある場合は、実装を止めて、変更案を提示しユーザーの確認を得ること。
- 仕様と実装が食い違っている場合は、どちらも直さず、まず報告すること。
- 仕様の変更と、それに伴う実装は、同じコミットに含めること。
- 各仕様の「状態」(確定 / 推奨 / 未決)を守ること。「推奨」「未決」は、ユーザーの確認なしに確定扱いで実装しない。

## ディレクトリ構成

- `contract/` : 共通の取り決め(発言データの型、起動入力、テーブルのキー)
- `engine/` : 議論エンジン(発言生成、進行、判定、Bedrock呼び出し)
- `app/api/` : HTTP API用Lambda
- `app/realtime/` : WebSocket接続・購読、配信Lambda
- `app/web/` : SPA
- `app/auth/` : Cognitoのトリガー用Lambda(ログインのロック)
- `infra/` : CDK(全スタック)
- `tools/` : 開発用CLI(イラスト生成など)。本番スタックには含めない
- `.github/workflows/` : GitHub Actions(PRの自動レビュー)
- `video/` : 解説動画の自動生成
- `docs/` : 仕様の正本
- `CONTRIBUTING.md` : Issue・PR・ブランチ・コミットの汎用のルール(他のリポジトリでも使える形で書く)

## 守るべき設計方針

- `engine/` と `app/` は互いのコードを直接参照しない。つなぐのは `contract/` とDynamoDBのみ。
- `contract/` を変更する場合は、`docs/02-data-model/` も同時に更新する。
- エンジンは発言を保存するだけで、配信には関与しない(配信はDynamoDB Streams経由)。
- Bedrockのモデルは、コードに固定せず `participants` の設定で指定する。
- 表示粒度はターン単位。トークン単位のストリーミングは実装しない。
- クライアントは「購読 → 履歴取得」の順で処理し、重複は `turn` で排除する。
- 認証(Cognito)は最初から組み込む。サインアップは無効にし、ユーザーは手動で作成する。
- 人格(口調・外見)と立場(`positions`)は独立させる。

## 作業上の注意

- AWSへのデプロイ(`cdk deploy` など)は、ユーザーの指示があるまで実行しない。
- 認証情報、`.env`、`cdk.out` はコミットしない。
- 不明点は推測で進めず、ユーザーに確認する。

## Issue と PR

- Issue・PR・ブランチ・コミットは、`CONTRIBUTING.md` のルールに従う。
- `CONTRIBUTING.md` は汎用のルールとし、このリポジトリ固有の単語や番号を書かない。固有の決まりは、この節に書く。
- 親の Issue(開発の大きな目標。段階や作業は子の Issue にする):

  | Issue | 目標 |
  |---|---|
  | #38 | 画面を作り、議論の一連の流れ(ログイン → 作成 → リアルタイム表示 → 判定と作戦メモ)を完成させる |
  | #43 | 議論エンジンを改良する(#38 の後のバージョンアップ)。子の Issue がすべて閉じたら閉じる |
  | #83 | このシステムの解説動画を作る(台本・音声・映像を自動で作り、最初の1本の mp4 を作る) |

- 領域のラベル:

  | ラベル | 領域 |
  |---|---|
  | `engine` | 議論エンジン(`engine/`、`docs/03-engine`) |
  | `app` | HTTP API、配信、画面(`app/`、`docs/04-app`) |
  | `infra` | CDK、AWSの構成(`infra/`、`docs/01-architecture`) |
  | `docs` | 仕様や文書の整理そのもの(どの領域にも当てはまらないとき) |
  | `tools` | 開発用CLI、開発の補助(`tools/`、`.github/` のPRの自動レビューなど) |
  | `video` | 解説動画(`video/`、`docs/06-explainer-video`) |

- 不具合を表すラベルは `bug`(GitHub に最初からあるもの)。領域のラベルと一緒に付ける。機能の追加などには、種類のラベルは付けない。

- Issueを閉じたら(PRのマージで閉じた場合も、PRなしで閉じた場合も)、そのIssueまでの開発の経緯を、Issue #6(開発の経緯。解説動画のネタ帳)にコメントで書き足す。書き方と目次の更新は、#6 の本文に従う。前回までに書き漏らした分があれば、あわせて書く。

## コマンド(リポジトリのルートで実行)

- 依存関係のインストール: `npm install`
- 型チェック: `npm run typecheck`
- テスト: `npm test`
- 画面(SPA)のビルド: `npm run build:web`(CDKのテンプレート生成とデプロイの前に要る)
- 画面を手元で動かす: `npm run dev:web`(`http://localhost:5173`。`app/web/public/config.json` を手元で作る。コミットしない)
- CDKのテンプレート生成(デプロイしない): `npm run build:web && npm run cdk -- synth`
- デプロイ: `npm run build:web && npm run cdk -- deploy --all`(ユーザーの指示があるときのみ。管理者のメールアドレス(費用の通知と議論の開始の通知の送り先)は `infra/local.json` の `adminEmail` から読む。手元で作る。コミットしない。ないときは、費用の通知のスタック `AgorawlBudget` は作られず、議論の開始の通知も届かない)
- ログインのロックの解除(デプロイ後): `npm run unlock-user -- <メールアドレス>`
- 管理者にする(デプロイ後。議論を消せるようになる。入れた後はログインし直す): `aws cognito-idp admin-add-user-to-group --user-pool-id <ID> --username <メールアドレス> --group-name admin`
- デモのアカウントにする(デプロイ後。議論を1日5件まで作れる。入れた後はログインし直す): `aws cognito-idp admin-add-user-to-group --user-pool-id <ID> --username <メールアドレス> --group-name demo`
- 立ち絵の見た目を聞く・候補を出す・採用する: `npm run generate-illustration -- ask <ID>`、`npm run generate-illustration -- generate <ID> [枚数]`、`npm run generate-illustration -- adopt <ID> <候補の番号>`、ポーズの絵(Gemini で作る)を置く: `npm run generate-illustration -- adopt-pose <ID> <ポーズ> <画像のパス>`(Bedrockの画像生成・背景の削除を呼ぶので費用がかかる)
- 動作確認(デプロイ後): `npm run start-debate -- "テーマ" "先攻の立場" "後攻の立場" [maxTurns]`
- 議論の分析(デプロイ後): `npm run analyze-debate -- <議論ID> [<議論ID> …]`
- HTTP APIの動作確認(デプロイ後): `AGORAWL_USER=… AGORAWL_PASSWORD=… npm run call-api -- <list|get|create|watch|raw> …`
- 公開用のリポジトリ(`tokyo-code-craft/ai-agorawl-public`)へ写す: `npm run publish-public`(ユーザーの指示があるときのみ。先に `npm run publish-public -- --dry-run` で差分を見せる。手元の `main` を GitHub の `main` と同じにしておく。仕様: `docs/00-overview/README.md`「リポジトリの公開」)
- リントは未導入。

## レビューの観点(PRの自動レビュー用)

- レビューのコメントは日本語で書く。
- 次の点を重点的に確認する。
  - 仕様(`docs/`)と実装が食い違っていないか。仕様の変更と実装が同じPRに含まれているか。
  - 決定を変更・追加したのに、該当する `decisions.md` に理由と却下した案が追記されているか。
  - 仕様ファイルを分割・追加したのに、`README.md` の目次が更新されているか。
  - 「推奨」「未決」の項目を、確定扱いで実装していないか。
  - `engine/` と `app/` が互いのコードを直接参照していないか。`contract/` の変更に `docs/02-data-model/` の更新が伴っているか。
  - 認証情報、`.env`、`cdk.out` が含まれていないか。
  - Issue・PR・コミットが `CONTRIBUTING.md` のルールに沿っているか。
