# tools/

開発用CLI。本番スタックには含めない。

| ツール | 内容 |
|---|---|
| `analyze-debate/` | 保存済みの議論から、討論者の挙動の指標を出す(仕様: `docs/03-engine/analysis.md`)。`npm run analyze-debate -- <議論ID> [<議論ID> …]` |
| `call-api/` | 動作確認用。Cognitoのユーザーでトークンを得て、HTTP API(`docs/04-app/README.md`「HTTP API」)を呼び、応答を表示する。`watch <議論ID>` で、WebSocketで購読して届いたメッセージを表示する。`npm run call-api -- <list|get|create|watch|raw> …`。パスワードは環境変数 `AGORAWL_PASSWORD` で渡す(コミットしない) |
| `start-debate/` | 動作確認用。Debatesに議論を1件登録し、エンジンを起動して、発言と作戦メモを順に表示する。`npm run start-debate -- "テーマ" "先攻の立場" "後攻の立場" [maxTurns(省略時10)]` |
| `generate-illustration/` | 立ち絵の見た目をそのAI自身に聞き(答えは `generate-illustration/answers/`)、候補を Bedrock(Stability AI、`us-west-2`)で出し、採用した絵の背景を消して `app/web/public/characters/` に置く(仕様: `docs/05-persona-illustration/README.md`「見た目をAIに聞く」「ポーズ」「生成ツールの流れ」)。`npm run generate-illustration -- ask <ID>`、`npm run generate-illustration -- generate <ID> [枚数] [core|ultra|sd35]`、`npm run generate-illustration -- adopt <ID> <候補の番号>`(正面の立ち姿。アイコンと画面用に縮めた版も作る)、`npm run generate-illustration -- adopt-pose <ID> <ポーズ> <画像のパス>`(Gemini で作ったポーズの絵を置く。画面用に縮めた版も作る。ポーズに `front` を指定すると、正面の立ち姿を置き、アイコンも作る)、`npm run generate-illustration -- shrink <ID>`(縮めた版だけ作り直す)、`npm run generate-illustration -- icon <ID>`(アイコンだけ作り直す)。候補は `generate-illustration/out/`(コミットしない) |
| `publish-public/` | 開発に使うリポジトリの `main` を、公開用のリポジトリ(`tokyo-code-craft/ai-agorawl-public`)へ、履歴なしの「公開版(日付)」のコミット1つとして写す(仕様: `docs/00-overview/README.md`「リポジトリの公開」)。作者は、写す人の GitHub の noreply のアドレス。PR の自動レビューは写さない。`npm run publish-public -- --dry-run` で、写す中身の差分だけを見る。手元の `main` が GitHub の `main` と同じでないと止まる。`gh` でログインしておく |
