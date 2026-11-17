# 02-data-model: テーブル設計と起動入力

正本は `contract/` の型定義。ここには意図を書く。

## テーブル

| テーブル | キー | 主な属性 | 備考 |
|---|---|---|---|
| Debates | PK: `debateId` | `ownerId`、`theme`、`positions`、`status`(running / done / failed)、`participants`、`judges`、`maxTurns`、`createdAt`、`listKey`、`endReason`、`concededBy`、`verdict`、`hidden` | 議論1件の設定と状態。エンジンが参照する設定の正本。Streams有効(NEW_IMAGE。状態の変化の配信に使う)。GSIは `byCreatedAt` |
| Messages | PK: `debateId`、SK: `turn`(数値) | `role`、`modelId`、`content`、`createdAt`、`notes`、`conceded`、`exhausted`、`sources`、`citations`、`invalidCitations` | Streams有効(NEW_IMAGE)。`turn` が表示順と重複排除のキー。GSIなし |
| Connections | PK: `connectionId` | `debateId`、`userId`、`ttl` | GSIは `byDebateId`。配信先の検索に使う |

- 議論は、管理者が HTTP API で消せる(終わった議論だけ。→ `04-app`「`DELETE /debates/{debateId}`」)。Messages のその議論の行をすべて消してから、Debates の行を消す。Streams の削除(REMOVE)は配信に使わない。

## GSI

| テーブル | インデックス名 | PK | SK | 射影 | 用途 | 状態 |
|---|---|---|---|---|---|---|
| Debates | `byCreatedAt` | `listKey`(常に `"ALL"`) | `createdAt` | ALL | 議論の一覧(全件、新しい順) | 確定 |
| Connections | `byDebateId` | `debateId` | なし | KEYS_ONLY | 配信Lambdaが、議論を購読中の接続IDを検索する | 確定 |

- Messagesは「議論IDごとに `turn` 順」の取得だけなので、主キーで足りる。
- 議論の一覧は、作成者に関係なく全件を対象にする(→ `04-app`)。
- `byCreatedAt` は全件が1つのパーティションに集まる。本システムの書き込み量では問題にならない。
- GSIへの反映は結果整合性で、購読直後のごく短い間は配信Lambdaから接続が見えない場合がある。取り逃した発言は、「購読 → 履歴取得」の順序と `turn` の重複排除で補う。

## 識別子

| 項目 | 接続ID | 議論ID |
|---|---|---|
| 識別する対象 | WebSocket接続1本(ブラウザ1タブ分) | 議論1件 |
| 発行 | 接続時にAPI Gatewayが発行(AWS固有の概念) | テーマ投入時にシステムが発行(本システム独自) |
| 寿命 | 切断すると無効 | 保存されている限り残る |
| 用途 | 配信の宛先 | 発言・履歴のキー |

- 接続IDと議論IDは、購読時にConnectionsで紐付く。1つの議論IDに複数の接続IDが紐付き、複数の画面で同時に視聴できる。
- WebSocketのプロトコル自体に、接続ID・議論ID・購読の概念はない。

## 起動入力(エンジンへ)

| 項目 | 内容 | 状態 |
|---|---|---|
| 内容 | 議論ID(`debateId`)のみ | 確定 |
| 設定の取得 | エンジンは議論IDでDebatesを読み、議論の設定を取得する | 確定 |

```json
{ "debateId": "…" }
```

- HTTP APIは、議論の設定をDebatesに保存してから、議論IDだけを渡してエンジンを起動する。
- 設定の正本はDebatesの1か所のみ。起動入力と保存内容の食い違いは起こらない。

## 議論の設定(Debatesに保存)

| 項目 | 内容 | 状態 |
|---|---|---|
| `theme` | 議論のテーマ。2つの立場を比べる問いの形にする(例:「週休は何日がよいか」) | 確定 |
| `positions` | 先攻(`pro`)と後攻(`con`)が受け持つ立場の名前(→ `03-engine`「役割と対戦」) | 確定 |
| `maxTurns` | 最大ターン数。議論ごとに自由に設定できる | 確定 |
| `participants` | 役割ごとの参加者の配列。要素は `role`、`modelId`、`personaId` | 確定 |
| `participants[].role` | 役割(`pro`: 先攻 / `con`: 後攻) | 確定 |
| `participants[].modelId` | BedrockのモデルID。コードに固定しない | 確定 |
| `participants[].personaId` | 人格の参照(→ `05-persona-illustration`)。人格定義は別に管理する | 確定 |
| `judges` | 審判の配列。要素は `modelId` と `viewpoint`(観点。省略可)。人数を設定で増減できる(→ `03-engine`) | 確定 |
| `judges[].viewpoint` | 審判の観点。`logic`(論理)/ `evidence`(根拠)/ `exchange`(反論・応答)。省略すると観点を持たない(→ `03-engine`「優劣判定」) | 確定 |

```json
{
  "theme": "週休は何日がよいか",
  "positions": { "pro": "週休3日制", "con": "週休2日制(現状維持)" },
  "maxTurns": 10,
  "participants": [
    { "role": "pro", "modelId": "…", "personaId": "…" },
    { "role": "con", "modelId": "…", "personaId": "…" }
  ],
  "judges": [ { "modelId": "…", "viewpoint": "logic" } ]
}
```

- 開発初期は最低限の設定で動かして検証する。`personaId` は項目として定義するが、初期の実装では使わない(省略可)。`judges` は優劣判定で使う(省略すると判定しない)。

## 判定結果(`verdict`)

| 項目 | 内容 | 状態 |
|---|---|---|
| 採用 | 審判の判定結果を `verdict` として構造化データで保存する | 確定 |
| 保存先 | Debatesの属性 | 確定 |
| 形 | 審判ごとの結果の配列(`judgments`)と、多数決の勝者(`winner`)を持つマップ。審判を増やしても形が変わらない | 確定 |
| 判定中の `status` | 増やさない。判定中も `running` のまま | 確定 |
| 作られる場合 | 最大ターン数で終わり、`judges` が1件以上あるときのみ(→ `03-engine`「優劣判定」) | 確定 |
| 完了通知への掲載 | 完了通知に載せる(→ `04-app`) | 推奨 |

```json
{
  "judgments": [
    {
      "modelId": "…",
      "pro": { "scores": { "logic": 7, "evidence": 6, "rebuttal": 8, "response": 7 }, "total": 28, "reason": "…", "claims": [ { "id": "C1", "score": 8 } ], "rebuttals": [ { "id": "R1", "score": 6 } ] },
      "con": { "scores": { "logic": 6, "evidence": 7, "rebuttal": 6, "response": 5 }, "total": 24, "reason": "…", "claims": [ { "id": "C1", "score": 3 } ], "rebuttals": [ { "id": "R1", "score": 2 } ] },
      "winner": "pro",
      "createdAt": "…"
    }
  ],
  "winner": "pro"
}
```

| 属性 | 型 | 内容 |
|---|---|---|
| `judgments` | リスト(マップの配列) | 審判ごとの結果。`judges` と同じ順 |
| `judgments[].modelId` | 文字列 | 審判のモデルID |
| `judgments[].viewpoint` | 文字列 | 審判の観点。`judges` の `viewpoint` を写す。観点のない審判と、この項目を加える前に判定した議論は持たない |
| `judgments[].weights` | マップ | 合計に使った基準ごとの重み(`logic`、`evidence`、`rebuttal`、`response`。1か2)。観点がある審判のみ持つ。持たない判定の合計は、重みなしの合計 |
| `judgments[].pro` / `con` | マップ | 側ごとの採点 |
| `….scores` | マップ | 基準ごとの点数(`logic`、`evidence`、`rebuttal`、`response`)。0〜10の整数 |
| `….total` | 数値 | 4つの基準の合計。エンジンが計算する。観点がない審判は0〜40。観点がある審判は、観点の基準の点を2倍にして足す(`logic`・`evidence` は0〜50、`exchange` は0〜60。→ `03-engine`「優劣判定」) |
| `….reason` | 文字列 | 採点の理由 |
| `….claims` | リスト(マップの配列) | 主張ごとの点数(→ `03-engine`「主張ごとの採点」)。要素は `id`(作戦メモの主張のID)と `score`(0〜10の整数)。その側の最終の主張一覧のすべての主張について持つ。この項目を加える前に判定した議論は持たない |
| `….rebuttals` | リスト(マップの配列) | 反論ごとの点数(→ `03-engine`「項目ごとの採点」)。要素は `id`(作戦メモの反論のID)と `score`(0〜10の整数)。その側の最終の反論一覧の反論(議論の最後の発言で初めて足した反論を除く)について持つ。この項目を加える前に判定した議論は持たない |
| `judgments[].winner` | 文字列 | `pro` / `con` / `draw`。合計点から、エンジンが決める |
| `judgments[].createdAt` | 文字列 | 判定した日時 |
| `winner` | 文字列 | 議論の勝者。`pro` / `con` / `draw`。審判ごとの `winner` の多数決で、エンジンが決める。過半数の審判が同じ勝者を選ばなければ `draw`(→ `03-engine`「優劣判定」)。この項目を加える前に判定した議論は持たない |

## 属性の型

開発初期の動作確認を優先した初期値。挙動を確認したうえで見直す。

| テーブル | 属性 | 型 | 内容 |
|---|---|---|---|
| Debates | `debateId` | 文字列 | UUID v4。HTTP APIが発行する |
| Debates | `ownerId` | 文字列 | 作成者のCognitoユーザーID(`sub`) |
| Debates | `theme` | 文字列 | |
| Debates | `positions` | マップ | `pro`(文字列)と `con`(文字列)。立場の名前 |
| Debates | `status` | 文字列 | `running` / `done` / `failed`。HTTP APIが `running` で作成する |
| Debates | `participants` | リスト(マップの配列) | 要素は `role`(文字列)、`modelId`(文字列)、`personaId`(文字列、省略可) |
| Debates | `judges` | リスト(マップの配列) | 要素は `modelId`(文字列)と `viewpoint`(文字列、省略可)。省略可 |
| Debates | `maxTurns` | 数値 | |
| Debates | `createdAt` | 文字列 | ISO 8601、UTC、ミリ秒まで(例: `2026-11-08T12:34:56.789Z`)。文字列の並びが時刻順になる |
| Debates | `listKey` | 文字列 | 常に `"ALL"` |
| Debates | `verdict` | マップ | 判定結果(上記)。最大ターン数で終わり、`judges` があるときのみ持つ |
| Debates | `hidden` | 真偽値 | 管理者が一般のユーザーに隠した議論だけ `true` を持つ。持たない議論は見せる(→ `04-app`「議論を隠す」)。HTTP API だけが書き、エンジンは読まない |
| Debates | `endReason` | 文字列 | 議論の終了理由。`maxTurns`(最大ターン数に達した)/ `conceded`(投了)/ `exhausted`(両者の攻め手が尽きて引き分け)。完了時にエンジンが保存する。実行中は持たない |
| Debates | `concededBy` | 文字列 | 投了した側(`pro` / `con`)。投了で終わったときのみ持つ |
| Messages | `debateId` | 文字列 | |
| Messages | `turn` | 数値 | 1始まりの連番 |
| Messages | `role` | 文字列 | `pro` / `con`。司会を廃止する前に保存した議論には、司会の総括の発言(`moderator`)が残っている |
| Messages | `modelId` | 文字列 | 発言したモデルのID |
| Messages | `content` | 文字列 | 発言の本文 |
| Messages | `notes` | マップ | 発言者の作戦メモ(下記)。先攻・後攻の発言のみ持つ |
| Messages | `conceded` | 真偽値 | この発言で投了したか。先攻・後攻の発言のみ持つ |
| Messages | `exhausted` | 真偽値 | この発言で引き分け(両者の攻め手が尽きた)になったか。先攻・後攻の発言のみ持つ |
| Messages | `sources` | リスト(マップの配列) | この発言のために検索して資料一覧に追加した資料(下記)。検索しなかった発言は持たない |
| Messages | `citations` | リスト(数値の配列) | 発言で引用した資料の番号(重複なし、昇順)。引用がなければ持たない |
| Messages | `invalidCitations` | リスト(数値の配列) | 引用した番号のうち、資料一覧にないもの。なければ持たない |
| Messages | `createdAt` | 文字列 | `Debates.createdAt` と同じ形式 |
| Connections | `connectionId` | 文字列 | API Gatewayが発行する |
| Connections | `debateId` | 文字列 | 購読時に設定する。購読前は持たない(GSIに載らない)。別の議論を購読すると置き換える(1つの接続で1件) |
| Connections | `userId` | 文字列 | 接続したユーザーのCognitoユーザーID(`sub`) |
| Connections | `ttl` | 数値 | 期限(UNIX秒)。下記 |

### Messagesの `notes`(作戦メモ)

意味と使い方は `03-engine`「作戦メモ」。保存するのは、エンジンが前回の作戦メモと合わせた全項目の一覧(モデルの出力そのものではない)。

| 属性 | 型 | 内容 |
|---|---|---|
| `claims` | リスト(マップの配列) | 主張一覧。1件以上 |
| `claims[].id` | 文字列 | `C1` など。ターンをまたいで同じ主張を指す |
| `claims[].text` | 文字列 | 主張の内容 |
| `claims[].score` | 数値 | 0〜10の整数 |
| `claims[].status` | 文字列 | `defending`(守る)/ `abandoned`(捨てる) |
| `rebuttals` | リスト(マップの配列) | 反論一覧。0件以上 |
| `rebuttals[].id` | 文字列 | `R1` など。ターンをまたいで同じ反論を指す |
| `rebuttals[].target` | 文字列 | 相手のどの主張への反論か |
| `rebuttals[].text` | 文字列 | 反論の内容 |
| `rebuttals[].score` | 数値 | 0〜10の整数 |
| `rebuttals[].status` | 文字列 | `won`(獲得)/ `pursuing`(追及中)/ `dropped`(断念)。点数からエンジンが決める |

- 作戦メモは発言者本人の作戦用。相手と審判のプロンプトには入れない(→ `03-engine`)。
- 議論の終了後に開示する(→ `03-engine`「作戦メモ」)。配信(DynamoDB Streams)には発言と一緒に流れるため、議論中はクライアントで表示しない。

### Messagesの `sources`(資料)

意味と使い方は `03-engine`「Web検索と資料一覧」。資料一覧は、全発言の `sources` をターン順に並べたもの。

| 属性 | 型 | 内容 |
|---|---|---|
| `id` | 数値 | 資料の通し番号(議論全体で1から) |
| `turn` | 数値 | 検索したターン |
| `role` | 文字列 | 検索した側(`pro` / `con`) |
| `query` | 文字列 | 検索語 |
| `text` | 文字列 | 検索用のモデルがまとめた事実の要約 |
| `urls` | リスト(文字列の配列) | 出典のURL(重複なし)。見つからなければ空 |

### Connectionsの `ttl`

- 値: 接続時刻 + 2時間(7200秒)。WebSocket接続の最大寿命(2時間)に合わせる。
- 用途: `$disconnect` が呼ばれずに残った接続情報の掃除。通常の削除は `$disconnect` で行う。
- TTLによる削除は即時ではないため、配信Lambdaは送信先が切断済み(GoneException)なら、その接続情報を削除する。

## 設定の検証ルール

議論の作成時にHTTP APIで検証し、違反なら作成しない。開発初期の初期値で、挙動を確認したうえで見直す。

| 項目 | ルール |
|---|---|
| `theme` | 前後の空白を除いて3〜200文字。使えない文字を含まない |
| `maxTurns` | 4〜50の偶数。上限50は、十分に長い議論を試せ、費用と待ち時間が際限なく増えないようにする値。先攻と後攻の発言回数をそろえるため偶数にする。下限4は、両者が2回ずつ発言(立論と攻防)する最小の数(→ `03-engine`) |
| `positions` | `pro` と `con` を持つ。それぞれ前後の空白を除いて1〜50文字。使えない文字を含まない。2つは異なる文にする(全角と半角、大文字と小文字、空白の違いだけのものは同じ文とみなす。NFKC で正規化し、小文字にし、空白を除いて比べる) |
| 文字の数え方 | `theme` と `positions` の文字数は、Unicode の符号位置で数える(絵文字などのサロゲートペアも1文字) |
| 使えない文字 | 制御文字(改行・タブを含む。Unicode の一般カテゴリ Cc)、目に見えない書式の文字(ゼロ幅の空白など。一般カテゴリ Cf。ただし絵文字をつなぐゼロ幅接合子 U+200D は使える)、行区切り・段落区切り(U+2028・U+2029) |
| `participants` | 2要素。`pro` と `con` を1つずつ持つ |
| `participants` の `modelId` | `pro` と `con` は同じモデルでもよい(→ `03-engine`「モデルの割当」) |
| `modelId` | 1〜200文字。英数字と `. _ : / -` のみ(推論プロファイルのIDやARNを含む)。モデルが実在するかは検証しない(Bedrock呼び出しの失敗で `failed` になる) |
| `personaId` | 省略可。1〜64文字。英小文字・数字・`-` のみ |
| `judges` | 省略可。0〜5要素。審判の `modelId` は、`pro` や `con` と同じモデルでもよい。`viewpoint` は省略するか、`logic` / `evidence` / `exchange` のいずれか |

## 未決

- なし
