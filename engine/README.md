# engine/

議論エンジンの発言生成Lambda(ターン→話者・段階の決定、プロンプトの組み立て、Bedrock呼び出し、作戦メモ・投了・引き分けの判定、条件付き保存)と、判定Lambda(審判による採点)。
進行(Step Functions)の定義は `infra/lib/debate-definition.ts`。

- `src/generate-turn.ts`: 発言生成Lambda(入力は `{ debateId, turn }`)
- `src/judge.ts`: 判定Lambda(入力は `{ debateId }`)
- `src/notes.ts`: 作戦メモの読み取り、投了・引き分けの判定
- `src/judging.ts`: 審判の出力の読み取り、合計と勝者の計算
- `src/aws.ts`: Bedrock・DynamoDBの呼び出し(共通。検索の道具を渡す呼び出しを含む)
- `src/search.ts`: Web検索(Nova 2 Lite の Web Grounding)
- `src/sources.ts`: 資料一覧と引用番号
- `src/turn-plan.ts`: ターンと段階・話者の対応
- `src/prompts.ts`: プロンプト(討論者、投了、審判)
- `test/`: 単体テスト(`npm test`)
- 仕様: `docs/03-engine/README.md`、`docs/03-engine/prompts.md`
