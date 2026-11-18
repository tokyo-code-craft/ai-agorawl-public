# video/

解説動画の自動生成(台本 → 音声 → 映像 → mp4)。仕様: `docs/06-explainer-video/README.md`

リポジトリの持ち主が動画を作るための道具。npm workspaces には入れていないので、ここで別に `npm install` する。

## 準備

1. 依存関係を入れる(初回の書き出しで、Remotion が書き出し用のブラウザ(約130MB)を落とす)

   ```sh
   cd video
   npm install
   ```

2. VOICEVOX のエンジンを起動する(Docker Desktop を起動しておく)

   ```sh
   docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest
   ```

   止めるときは `docker stop voicevox`。

3. 立ち絵の素材を置く(コミットしない)

   | 話し手 | 置く場所 | 入手先 |
   |---|---|---|
   | ずんだもん | `assets/zundamon/zundamon.psd` | 坂本アヒルさんの「ずんだもん立ち絵素材」(配布の zip の中の PSD の名前を変えて置く) |
   | 四国めたん | `assets/metan/metan.psd` | 坂本アヒルさんの「四国めたん立ち絵素材」(同じく PSD の名前を変えて置く) |

   PSD がない話し手は、仮の絵(名前を書いた形)になる。

4. 背景の画像を使うときは、`assets/backgrounds/` に置き、台本の `background` に書く(例: `"background": "assets/backgrounds/courtroom.png"`)。16:9 の画像なら切れずに広がる

5. BGM を使うときは、曲を `assets/bgm/` に置き、台本の `bgm` に書く(例: `"bgm": { "file": "assets/bgm/xxx.mp3", "volume": 0.04 }`)。曲のサイトと作者の規約を確かめ、クレジットが要る曲は概要欄に書く

6. サムネイルの字体を置く(コミットしない。SIL Open Font License 1.1)

   ```sh
   mkdir -p assets/fonts
   curl -L -o assets/fonts/DelaGothicOne-Regular.ttf https://github.com/google/fonts/raw/main/ofl/delagothicone/DelaGothicOne-Regular.ttf
   curl -L -o assets/fonts/OFL.txt https://github.com/google/fonts/raw/main/ofl/delagothicone/OFL.txt
   ```

   ないときは、日本語の太いゴシックで作る。

7. 立ち絵の PNG を作る(`public/characters/` に、表情ごとに口を閉じた絵と開いた絵)

   ```sh
   npm run psd -- build
   ```

## 動画を作る

```sh
npm run make -- scripts/part1.json   # → out/part1-001.mp4(作るたびに -002、-003 … と連番。前の動画は消さない)
npm run make -- scripts/part1.json scripts/part2.json scripts/part3.json   # 段階の台本をつないで1本に作る → out/part1+part2+part3-001.mp4(題・背景・BGM は最初の台本)
```

- 音声は `public/voice/` に残し、同じ話し手・同じ読みのセリフは作り直さない。
- 映像を見ながら直すときは `npm run studio`(Remotion Studio。台本は渡らないので、見た目の確認用)。

## サムネイルを作る

`thumbnails/<名前>.json` に書いた中身(題、題の下の行、札、背景、真ん中の画面、2人の表情)から、1280×720 の PNG を作る。

```sh
npm run thumbnail -- thumbnails/overview.json   # → out/overview-001.png(作るたびに連番。前の絵は消さない)
```

- 真ん中の画面は、録った場面(`public/screens/<場面>.mp4`)の最後のコマを使う。録っていなければ出さずに作る(先に「画面を録る」)。
- 題の色は、区切りごとに `pro`(先攻の橙)、`con`(後攻の青)、`alert`(赤)を書く。書かなければ濃い灰色。

## 画面を録る

AI言い合いバトルの本番の画面を Playwright で操作し、場面ごとに録る(動画は `public/screens/<場面>.mp4`、写真は `public/screens/<場面>.png`)。

```sh
npx playwright install chromium        # 初回だけ
export AGORAWL_WEB_URL=https://<本番の画面の URL>
export AGORAWL_USER=<メールアドレス> AGORAWL_PASSWORD=<パスワード>   # デモのアカウント(tmp/cognito-demo-user.env)。コミットしない。録る前に、管理者がすべての議論を隠す
npm run record -- list                 # 場面の一覧
npm run record -- cover login          # 場面を指定して録る
npm run record -- all                  # 費用のかからない場面を全部録る
npm run record -- create --cost        # 議論を本当に作って録る(Bedrock の費用がかかる。作った議論の ID は record.json の debates.overview に入る)
```

- 場面と操作は `src/record/scenes.ts` に書く。
- ログインした状態(トークン)は `out/auth-state.json` に残す(コミットしない)。ログインし直すときは消す。
- 台本の行の `screen` に場面を書くと、その画面を大きく出し、2人を左右の下に小さく出す(例: `"screen": { "id": "login" }`。`null` で消す)。

## 表情を足す

1. `npm run psd -- tree zundamon` でレイヤーの木を見る。
2. `src/characters.ts` の `expressions` に、表示にするレイヤーと、口を閉じた・開いたときのレイヤーを書く。
3. `npm run psd -- build` で PNG を作り直す。

## 確認

```sh
npm run typecheck
npm test
```

## クレジット(動画の概要欄に書く)

```
VOICEVOX:ずんだもん、VOICEVOX:四国めたん
立ち絵:坂本アヒル
音楽:魔王魂
```

- 「音楽:魔王魂」は、魔王魂の曲を BGM に使ったときに書く(魔王魂の規約で表記が要る)。ほかのサイトの曲は、そのサイトと作者の規約に従う。
