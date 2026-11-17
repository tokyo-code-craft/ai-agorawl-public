// AI言い合いバトルの本番の画面を、場面ごとに録る。docs/06-explainer-video/README.md「画面の映像」
// 使い方(video/ で):
//   npm run record -- list               場面の一覧
//   npm run record -- <場面の ID> …       録る(動画は public/screens/<ID>.mp4、写真は public/screens/<ID>.png)
//   npm run record -- all                費用のかからない場面を全部録る
//   npm run record -- create --cost      費用のかかる場面(議論を本当に作る)を録る
// 環境変数: AGORAWL_WEB_URL(本番の画面の URL)、AGORAWL_USER、AGORAWL_PASSWORD(ログイン。コミットしない)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContextOptions } from 'playwright';
import { SCENES, waitForList, type Scene, type SceneContext } from './scenes.ts';
import { Screencast } from './screencast.ts';

const OUT = 'public/screens';
const RECORD_JSON = 'record.json';
/** 画面の大きさ(1280×720 の表示を、1.5倍の細かさで録る) */
const VIEWPORT = { width: 1280, height: 720 };
const SCALE = 1.5;

interface RecordJson {
  /** 見せる議論の ID(create の場面で作ったもの) */
  debateId?: string;
}

const args = process.argv.slice(2);
const cost = args.includes('--cost');
const ids = args.filter((a) => !a.startsWith('--'));

if (ids.length === 0 || ids[0] === 'list') {
  for (const s of SCENES) console.log(`${s.id.padEnd(12)} ${s.kind === 'video' ? '動画' : '写真'}  ${s.title}${s.costs ? '(費用がかかる)' : ''}`);
  process.exit(0);
}

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} がない(video/README.md「画面を録る」)`);
  return v;
};
/** ログインした状態(トークンを含む。out/ に置き、コミットしない)。場面ごとにアカウントを変えるので、アカウントごとに分ける */
const AUTH_STATE = `out/auth-state-${env('AGORAWL_USER').replace(/[^A-Za-z0-9.-]/g, '_')}.json`;
const record: RecordJson = existsSync(RECORD_JSON) ? JSON.parse(readFileSync(RECORD_JSON, 'utf-8')) : {};
const ctx: SceneContext = {
  webUrl: env('AGORAWL_WEB_URL').replace(/\/$/, ''),
  user: env('AGORAWL_USER'),
  password: env('AGORAWL_PASSWORD'),
  debateId: record.debateId,
  saveDebateId(id) {
    record.debateId = id;
    ctx.debateId = id;
    writeFileSync(RECORD_JSON, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`  作った議論の ID を ${RECORD_JSON} に書いた: ${id}`);
  },
};

const scenes = ids[0] === 'all' ? SCENES.filter((s) => !s.costs && (!s.needsDebate || ctx.debateId)) : ids.map((id) => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`場面 ${id} がない(npm run record -- list)`);
  return s;
});
for (const s of scenes) {
  if (s.costs && !cost) throw new Error(`場面 ${s.id} は Bedrock の費用がかかる。録るときは --cost を付ける`);
  if (s.needsDebate && !ctx.debateId && !scenes.some((x) => x.id === 'create')) {
    throw new Error(`場面 ${s.id} には見せる議論が要る。先に create を録るか、${RECORD_JSON} に debateId を書く`);
  }
}

mkdirSync(OUT, { recursive: true });
// 画面配信(→ screencast.ts)を表示の細かさのまま受け取るには、ブラウザ全体の細かさも指定する必要がある
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`] });
try {
  for (const s of scenes) {
    console.log(`${s.id}: ${s.title}`);
    await recordScene(browser, s);
  }
} finally {
  await browser.close();
}

/** ログインした状態を作る(画面からログインし、localStorage のトークンを残す) */
async function ensureLoggedIn(browser: Browser) {
  // トークンは1時間で切れるため、50分より古い状態は作り直す
  if (existsSync(AUTH_STATE) && Date.now() - statSync(AUTH_STATE).mtimeMs < 50 * 60 * 1000) return;
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${ctx.webUrl}/`);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL((u) => !u.href.startsWith(ctx.webUrl), { timeout: 15000 });
  await page.locator('input[name="username"]:visible').fill(ctx.user);
  await page.locator('input[name="password"]:visible').fill(ctx.password);
  await page.locator('input[name="signInSubmitButton"]:visible').click();
  await page.waitForURL((u) => u.href.startsWith(ctx.webUrl), { timeout: 15000 });
  await waitForList(page);
  mkdirSync('out', { recursive: true });
  await context.storageState({ path: AUTH_STATE });
  await context.close();
}

async function recordScene(browser: Browser, s: Scene) {
  if (s.loggedIn) await ensureLoggedIn(browser);
  const options: BrowserContextOptions = {
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    ...(s.loggedIn ? { storageState: AUTH_STATE } : {}),
  };
  const context = await browser.newContext(options);
  // tsx は関数に名前を付ける処理(__name)を足す。page.evaluate に渡した関数の中でも呼ばれるので、ページにも置く
  await context.addInitScript({ content: 'window.__name = (f) => f;' });
  const page = await context.newPage();
  const cast = s.kind === 'video' ? new Screencast(page, `out/record-tmp-${s.id}`) : null;
  try {
    await s.setup?.(page, ctx);
    await cast?.start();
    await s.run(page, ctx);
    if (cast) {
      await cast.stop(`${OUT}/${s.id}.mp4`);
      console.log(`  ${OUT}/${s.id}.mp4`);
    } else {
      await page.screenshot({ path: `${OUT}/${s.id}.png` });
      console.log(`  ${OUT}/${s.id}.png`);
    }
  } finally {
    await context.close();
  }
}
