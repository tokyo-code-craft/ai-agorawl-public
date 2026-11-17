// 録る場面と、その操作。docs/06-explainer-video/README.md「画面の映像」
// 場面ごとに、動画で録るか(video)、画面の写真を撮るか(still)を選ぶ
import type { Page } from 'playwright';

export interface SceneContext {
  /** 本番の画面の URL(末尾の / なし) */
  webUrl: string;
  /** ログインのメールアドレスとパスワード */
  user: string;
  password: string;
  /** 見せる議論の ID(video/record.json) */
  debateId?: string;
  /** 作った議論の ID を残す(create の場面) */
  saveDebateId(id: string): void;
}

export interface Scene {
  id: string;
  kind: 'video' | 'still';
  /** 説明(npm run record -- list で出す) */
  title: string;
  /** ログインした状態で始めるか(login の場面は、ログインしていない状態で始める) */
  loggedIn: boolean;
  /** 見せる議論が要るか */
  needsDebate?: boolean;
  /** Bedrock の費用がかかるか(--cost を付けたときだけ録る) */
  costs?: boolean;
  /** 録り始める前の準備(前の場面で終えた状態にする。録らない) */
  setup?(page: Page, ctx: SceneContext): Promise<void>;
  run(page: Page, ctx: SceneContext): Promise<void>;
}

/** 人が打つくらいの速さで打つ */
const typeSlowly = (page: Page, selector: string, text: string) => page.locator(selector).pressSequentially(text, { delay: 90 });

/** なめらかにスクロールする(window.scrollBy を少しずつ) */
async function scrollSmoothly(page: Page, dy: number, ms: number) {
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await page.waitForTimeout(16);
  }
}

/** 要素が画面の上の方に来るまでスクロールする(写真用。動きは要らない) */
async function scrollTo(page: Page, selector: string, offset = 80) {
  await page.locator(selector).first().evaluate((el, off) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'instant' }), offset);
  await page.waitForTimeout(500);
}

/** 一覧を読み終えるまで待つ(議論のカードか、「まだ議論がありません。」が出るまで) */
export async function waitForList(page: Page) {
  await page.locator('.debate-card, p.muted:has-text("まだ議論がありません")').first().waitFor({ timeout: 15000 });
}

const THEME = 'きのこの山とたけのこの里はどっちが美味い?';
const PRO = 'きのこの山';
const CON = 'たけのこの里';

/** 前の場面で入れ終えた状態から始める(打たずに、すぐに入れる) */
async function fillNewDebateAtOnce(page: Page, { positions }: { positions: boolean }) {
  await page.waitForSelector('input[placeholder^="例: 虎と熊"]');
  await page.locator('input[placeholder^="例: 虎と熊"]').fill(THEME);
  if (positions) {
    await page.locator('input[placeholder="例: 虎派"]').fill(PRO);
    await page.locator('input[placeholder="例: 熊派"]').fill(CON);
  }
  await page.locator('input[placeholder^="例: 虎と熊"]').blur();
}

/** 先攻の AI を選ぶ窓を開く */
async function openProPicker(page: Page) {
  await openPicker(page, '先攻');
}

/** 先攻か後攻の AI を選ぶ窓を開く */
async function openPicker(page: Page, side: '先攻' | '後攻') {
  await page.getByRole('button', { name: `${side}のAIを選ぶ` }).click();
  await page.waitForSelector('.picker-card');
}

const PRO_MODEL = 'Mistral Large 3';
const CON_MODEL = 'Claude Opus 4.6';

/** 選ぶ窓の中の、名前で探したカード(名前の後ろに星が付くので、先頭で合わせる) */
const pickerCard = (page: Page, name: string) =>
  page.locator('.picker-card', { has: page.locator('.picker-name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}`) }) });

/** 選ぶ窓を開き、すぐに選んで閉じる(準備用。動きは要らない) */
async function selectAtOnce(page: Page, side: '先攻' | '後攻', name: string) {
  await openPicker(page, side);
  await pickerCard(page, name).getByRole('button', { name: 'このAIにする' }).click();
  await page.locator('.picker').waitFor({ state: 'detached' });
}

/** 作成の画面を開き、テーマ・立場・先攻と後攻の AI を入れ終えた状態にする(準備用) */
async function prepareForm(page: Page, webUrl: string, { con }: { con: boolean }) {
  await page.goto(`${webUrl}/new`);
  await fillNewDebateAtOnce(page, { positions: true });
  await page.waitForSelector('.model-slot.pro button:not([disabled])');
  await selectAtOnce(page, '先攻', PRO_MODEL);
  if (con) await selectAtOnce(page, '後攻', CON_MODEL);
  await waitForImages(page);
}

/** 画面の画像(立ち絵など)を読み終えるまで待つ(準備用。読み込み途中の絵を録らない) */
async function waitForImages(page: Page) {
  // 画面の外の、遅れて読む(loading="lazy")画像は待たない
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img')].every((i) => {
      const r = i.getBoundingClientRect();
      return i.complete || r.bottom < 0 || r.top > window.innerHeight;
    }),
  );
}

/** 要素が画面の真ん中に来るまで、なめらかにスクロールする */
async function scrollIntoCenter(page: Page, selector: string, ms = 2000) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await page.waitForTimeout(ms);
}

/** 見せる議論の画面を開く(カットインは出たまま) */
async function openDebate(page: Page, { webUrl, debateId }: SceneContext) {
  await page.goto(`${webUrl}/debates/${encodeURIComponent(debateId!)}`);
  await page.waitForSelector('ol.speeches > li');
}

/** 見せる議論の画面を開き、カットインを消す(準備用) */
async function openDebateWithoutCutIn(page: Page, ctx: SceneContext) {
  await openDebate(page, ctx);
  await page.locator('.cutin-start').click({ timeout: 30000 });
  await page.locator('.cutin').waitFor({ state: 'detached', timeout: 10000 });
  await waitForImages(page);
}

/** ターンの頭が、画面の上(見出しの帯の下)に来るまでスクロールする */
async function scrollToTurn(page: Page, turn: number, behavior: 'smooth' | 'instant') {
  await scrollToTop(page, `#turn-${turn}`, behavior);
}

/** 要素の頭が、画面の上(見出しの帯の下)に来るまでスクロールする */
async function scrollToTop(page: Page, selector: string, behavior: 'smooth' | 'instant') {
  await page.locator(selector).evaluate((el, b) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: b }), behavior);
  await page.waitForTimeout(behavior === 'smooth' ? 1500 : 300);
}

/**
 * 文に蛍光ペンのような色を付ける(録るブラウザの中だけ。docs/06-explainer-video/README.md「文の強調」)。
 * scope の中の、start で始まり end で終わる範囲の文字に付け、その範囲を画面の真ん中に寄せる。前に付けた色は残す(消すのは clearMarks)。
 * 画面の要素は変えずに、ブラウザのハイライトの機能(CSS.highlights)で色を付ける(要素を変えると、画面の描き直しで崩れる)
 */
async function markText(page: Page, scope: string, start: string, end: string, { animate = true, scroll = true } = {}) {
  await page.locator(scope).evaluate(
    (root, [s, e, anim, scr]) => {
      if (!document.getElementById('rec-mark-style')) {
        const style = document.createElement('style');
        style.id = 'rec-mark-style';
        style.textContent = '::highlight(rec-mark) { background-color: rgba(255, 221, 0, 0.6); }';
        document.head.append(style);
      }
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const all = nodes.map((n) => n.data).join('');
      const from = all.indexOf(s);
      const to = from < 0 ? -1 : all.indexOf(e, from) + e.length;
      if (from < 0 || to < e.length) throw new Error(`強調する文が見つからない: ${s}〜${e}`);
      // 文字の位置(全体の何文字目か)を、テキストの要素とその中の位置にする
      const at = (k: number): [Text, number] => {
        let pos = 0;
        for (const n of nodes) {
          if (k <= pos + n.data.length) return [n, k - pos];
          pos += n.data.length;
        }
        const last = nodes[nodes.length - 1];
        return [last, last.data.length];
      };
      const rangeTo = (k: number) => {
        const r = document.createRange();
        r.setStart(...at(from));
        r.setEnd(...at(k));
        return r;
      };
      // ハイライトを変えただけでは、画面配信が画像を送らないことがある。見えない点も一緒に変えて送らせる
      const dot = document.createElement('div');
      dot.style.cssText = 'position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0.01; pointer-events: none;';
      document.body.append(dot);
      const before = [...(CSS.highlights.get('rec-mark') ?? [])] as AbstractRange[];
      const set = (k: number) => {
        CSS.highlights.set('rec-mark', new Highlight(...before, rangeTo(k)));
        dot.style.background = dot.style.background === 'black' ? 'white' : 'black';
      };
      const box = rangeTo(to).getBoundingClientRect();
      const y0 = window.scrollY;
      // 窓(モーダル)の中の文は、後ろのページを動かさない
      const dy = scr ? box.top + box.height / 2 - window.innerHeight / 2 : 0;
      if (!anim) {
        window.scrollTo({ top: y0 + dy, behavior: 'instant' });
        set(to);
        return;
      }
      // 0.4秒でスクロールし、続けて0.5秒で左から塗るように色を付ける(台詞の間に塗り終える)
      const t0 = performance.now();
      const tick = () => {
        const t = performance.now() - t0;
        const sp = Math.min(1, t / 400);
        window.scrollTo({ top: y0 + dy * (1 - (1 - sp) ** 2), behavior: 'instant' });
        const pp = Math.max(0, Math.min(1, (t - 400) / 500));
        if (pp > 0) set(from + Math.ceil((to - from) * pp));
        if (pp < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [start, end, animate, scroll] as const,
  );
  await page.waitForTimeout(animate ? 1000 : 300);
  await repaint(page);
}

/**
 * 画面を描き直させる。画面配信は、画面が止まると最後の変化の画像を送らないことがある(色を塗り終えた画像が録れない)。
 * 見えない点を少しの間だけ動かして、止まった後の画像を送らせる
 */
async function repaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const dot = document.createElement('div');
        dot.style.cssText = 'position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0.01; pointer-events: none;';
        document.body.append(dot);
        const until = performance.now() + 500;
        const tick = () => {
          dot.style.background = dot.style.background === 'black' ? 'white' : 'black';
          if (performance.now() < until) requestAnimationFrame(tick);
          else {
            dot.remove();
            done();
          }
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** markText で付けた色を、一度に消す */
async function clearMarks(page: Page) {
  await page.evaluate(() => CSS.highlights.delete('rec-mark'));
  await page.waitForTimeout(100);
}

/** ターン1の、最初に色を付ける段落 */
const TURN1_MARK1 = ['まず、きのこの山の最大の魅力は', '魅力を持っています。'] as const;
/** ターン1の、2つ目に色を付ける段落 */
const TURN1_MARK2 = ['以上の理由から', '認してみてください。'] as const;

/** ターン2の、主張の3点とまとめ(順に色を足す) */
const TURN2_POINTS = [
  ['第一に、国民の圧倒的な支持です。', '第一に、国民の圧倒的な支持です。'],
  ['第二に、食感の完成度です。', '第二に、食感の完成度です。'],
  ['第三に、売上という客観的指標です。', '第三に、売上という客観的指標です。'],
  ['人気・食感・売上のすべてにおいて', '優れていることは明らかです。'],
] as const;
/** ターン2の、「さらに決定的なのは」の文 */
const TURN2_DECISIVE = ['さらに決定的なのは、[3]によれば', '優勢という結果が出ていることです。'] as const;
/** ターン2の、引用の番号 [3] がある文 */
const TURN2_CITE = ['[3]によれば2020年の明治国民大調査で', '優勢という結果が出ていることです。'] as const;
/** ターン3の、2019年の総選挙の文 */
const TURN3_2019 = ['[1]によれば、2019年の総選挙では', 'きのこの山が勝利しており'] as const;
/** ターン5の、「甘すぎる」の文 */
const TURN5_SWEET = ['また、[11]では、', '「甘すぎる」と指摘されており'] as const;
/** [11]の資料の窓の中の、色を付ける2か所(順に足す) */
const SOURCE11_MARKS = [
  ['たけのこの里は甘味と塩味の', 'バランスが良く'],
  ['一方、きのこの山は', '甘味が強く'],
] as const;

/** ターン6の、[11]の引用が正反対だと指摘する文 */
const TURN6_REBUT = ['まず、相手は[11]を引用して', 'これは資料の内容と正反対です。'] as const;
/** ターン9の、最後のまとめの段落 */
const TURN9_LAST = ['最後に、', '魅了しているのです。'] as const;
/** ターン10の、相手の引用の信頼性を指摘する文 */
const TURN10_TRUST = ['相手は自ら検索した資料の内容を', '信頼性が損なわれています。'] as const;

/** 根拠の審判(2人目)の、先攻(きのこの山)の理由の文 */
const JUDGE2_PRO = ['後攻から繰り返し指摘されても', '大きく損なう。'] as const;
const JUDGE2_CARD = '.judges > .judge-card:nth-child(2)';

/** ターン5の[11]を押し、資料の窓を開く */
async function openSource11(page: Page) {
  await page.locator('#turn-5 .speech-body').getByRole('button', { name: '[11]', exact: true }).first().click();
  await page.locator('dialog.source-modal').waitFor();
}

/** 要素が画面の真ん中に来るまで、すぐにスクロールする(準備用) */
async function jumpIntoCenter(page: Page, selector: string) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await page.waitForTimeout(300);
}

export const SCENES: Scene[] = [
  {
    id: 'cover',
    kind: 'video',
    title: '表紙(題が出るまで)',
    loggedIn: false,
    async run(page, { webUrl }) {
      await page.goto(`${webUrl}/`);
      await page.waitForTimeout(4000);
    },
  },
  {
    id: 'login',
    kind: 'video',
    title: '表紙の「ログイン」→ メールアドレスとパスワードを入れる → 一覧',
    loggedIn: false,
    // 表紙の題が出る動きは cover で見せたので、出し終えてから録る
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/`);
      await page.waitForTimeout(4000);
    },
    async run(page, { webUrl, user, password }) {
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await page.waitForURL((u) => !u.href.startsWith(webUrl), { timeout: 15000 });
      await page.waitForTimeout(800);
      await typeSlowly(page, 'input[name="username"]:visible', user);
      await typeSlowly(page, 'input[name="password"]:visible', password);
      await page.waitForTimeout(500);
      await page.locator('input[name="signInSubmitButton"]:visible').click();
      await page.waitForURL((u) => u.href.startsWith(webUrl), { timeout: 15000 });
      await waitForList(page);
      await page.waitForTimeout(2500);
    },
  },
  {
    id: 'list',
    kind: 'video',
    title: '議論の一覧(議論があれば少しスクロール)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/`);
      await waitForList(page);
    },
    async run(page) {
      await page.waitForTimeout(1500);
      if ((await page.locator('.debate-card').count()) > 0) await scrollSmoothly(page, 500, 2500);
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'new-form',
    kind: 'video',
    title: '一覧の「議論を始める」を押し、何も入れていない作成の画面を出す',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/`);
      await waitForList(page);
    },
    async run(page) {
      await page.waitForTimeout(1200);
      await page.getByRole('link', { name: '議論を始める' }).click();
      await page.waitForSelector('input[placeholder^="例: 虎と熊"]');
      await page.waitForTimeout(3000);
    },
  },
  {
    id: 'enter-theme',
    kind: 'video',
    title: '作成の画面で、テーマだけを入れる(作らない)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/new`);
      await page.waitForSelector('input[placeholder^="例: 虎と熊"]');
    },
    async run(page) {
      await page.waitForTimeout(1000);
      await typeSlowly(page, 'input[placeholder^="例: 虎と熊"]', THEME);
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'enter-positions',
    kind: 'video',
    title: '作成の画面: テーマを入れた状態から、先攻と後攻の立場を入れる(作らない)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/new`);
      await fillNewDebateAtOnce(page, { positions: false });
    },
    async run(page) {
      await page.waitForTimeout(1000);
      await typeSlowly(page, 'input[placeholder="例: 虎派"]', PRO);
      await page.waitForTimeout(300);
      await typeSlowly(page, 'input[placeholder="例: 熊派"]', CON);
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'pick-ai',
    kind: 'video',
    title: '作成の画面: 先攻の AI を選ぶ窓を開き、選べる AI をゆっくり見せる(閉じない。作らない)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/new`);
      await fillNewDebateAtOnce(page, { positions: true });
      await waitForImages(page);
    },
    async run(page) {
      await page.waitForTimeout(1200);
      await openProPicker(page);
      await page.waitForTimeout(2500);
      await scrollSmoothly(page, 700, 4000);
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'pick-mistral',
    kind: 'video',
    title: '作成の画面: 先攻の AI を選ぶ窓で Mistral Large 3 を選び、先攻の欄に立ち絵が出る(作らない)',
    loggedIn: true,
    // 窓を開いてスクロールする動きは pick-ai で見せたので、その終わりの状態から録る
    async setup(page, { webUrl }) {
      await page.goto(`${webUrl}/new`);
      await fillNewDebateAtOnce(page, { positions: true });
      await openProPicker(page);
      await page.waitForTimeout(2500);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(1000);
      await waitForImages(page);
    },
    async run(page) {
      await page.waitForTimeout(800);
      const card = page.locator('.picker-card', { has: page.locator('.picker-name', { hasText: 'Mistral Large 3' }) });
      await card.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(2500);
      await card.getByRole('button', { name: 'このAIにする' }).click();
      await page.waitForTimeout(4000);
    },
  },
  {
    id: 'pick-opus',
    kind: 'video',
    title: '作成の画面: 後攻の AI を選ぶ窓で Claude Opus 4.6 を選び、先攻と後攻の欄を見せる(作らない)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await prepareForm(page, webUrl, { con: false });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    },
    async run(page) {
      await page.waitForTimeout(800);
      await openPicker(page, '後攻');
      await page.waitForTimeout(800);
      const card = pickerCard(page, CON_MODEL);
      await card.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(3000);
      await card.getByRole('button', { name: 'このAIにする' }).click();
      await page.waitForTimeout(1500);
      await scrollIntoCenter(page, '.model-slot.pro', 2500);
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'judge',
    kind: 'video',
    title: '作成の画面: 審判の欄までスクロールする(作らない)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await prepareForm(page, webUrl, { con: true });
      await jumpIntoCenter(page, '.model-slot.pro');
    },
    async run(page) {
      await page.waitForTimeout(800);
      await scrollIntoCenter(page, '.model-slot.judge', 2500);
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'turns',
    kind: 'video',
    title: '作成の画面: ターン数の欄までスクロールする(作らない)',
    loggedIn: true,
    async setup(page, { webUrl }) {
      await prepareForm(page, webUrl, { con: true });
      await jumpIntoCenter(page, '.model-slot.judge');
    },
    async run(page) {
      await page.waitForTimeout(800);
      await scrollIntoCenter(page, 'form select', 2000);
      await page.locator('form select').focus();
      await page.waitForTimeout(2500);
    },
  },
  {
    id: 'create',
    kind: 'video',
    title: '議論を本当に作る: 「議論を始める」を押す → カットインの「CLICK TO START」が出るまで(Bedrock の費用がかかる)',
    loggedIn: true,
    costs: true,
    async setup(page, { webUrl }) {
      await prepareForm(page, webUrl, { con: true });
      await jumpIntoCenter(page, 'form select');
    },
    async run(page, ctx) {
      await page.waitForTimeout(800);
      await scrollIntoCenter(page, 'form button[type="submit"]', 1500);
      await page.waitForTimeout(800);
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL(/\/debates\//, { timeout: 30000 });
      ctx.saveDebateId(decodeURIComponent(page.url().split('/debates/')[1].split(/[?#]/)[0]));
      // カットインの「CLICK TO START」が出たら、押さずに少し映して終える(カットインの後は別に録る)
      await page.locator('.cutin-start').waitFor({ timeout: 30000 });
      await page.waitForTimeout(6000);
    },
  },
  {
    id: 'open-debate',
    kind: 'video',
    title: '議論の画面: カットインの「CLICK TO START」を押し、ターン1までスクロールする',
    loggedIn: true,
    needsDebate: true,
    // create の終わり(カットインが出ている)と同じ状態から録る
    async setup(page, ctx) {
      await openDebate(page, ctx);
      await page.locator('.cutin-start').waitFor({ timeout: 30000 });
      await waitForImages(page);
      await page.waitForTimeout(1500);
    },
    async run(page) {
      await page.waitForTimeout(1000);
      await page.locator('.cutin-start').click();
      await page.locator('.cutin').waitFor({ state: 'detached', timeout: 10000 });
      await page.waitForTimeout(1500);
      await scrollToTurn(page, 1, 'smooth');
      await page.waitForTimeout(2500);
    },
  },
  {
    id: 'turn1-mark',
    kind: 'video',
    title: '議論の画面: ターン1の「まず、きのこの山の最大の魅力は〜」の段落に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await scrollToTurn(page, 1, 'instant');
    },
    async run(page) {
      await page.waitForTimeout(200);
      await markText(page, '#turn-1 .speech-body', ...TURN1_MARK1);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn1-mark2',
    kind: 'video',
    title: '議論の画面: ターン1の1つ目の色を消し、「以上の理由から〜」の段落に色を付ける',
    loggedIn: true,
    needsDebate: true,
    // turn1-mark の終わり(1つ目の段落に色が付いている)と同じ状態から録る
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-1 .speech-body', ...TURN1_MARK1, { animate: false });
      // 前の色は、台詞が変わったところで消えている(録り始めの画面に色を残さない)
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await markText(page, '#turn-1 .speech-body', ...TURN1_MARK2);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn2',
    kind: 'video',
    title: '議論の画面: ターン1の色を消し、ターン2までスクロールする',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-1 .speech-body', ...TURN1_MARK2, { animate: false });
      // 前の色は、台詞が変わったところで消えている(録り始めの画面に色を残さない)
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await scrollToTurn(page, 2, 'smooth');
      await page.waitForTimeout(3000);
    },
  },
  {
    id: 'turn2-points',
    kind: 'video',
    title: '議論の画面: ターン2の主張の3点(第一に〜、第二に〜、第三に〜)とまとめの文に、順に色を足す',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await scrollToTurn(page, 2, 'instant');
    },
    async run(page) {
      await page.waitForTimeout(200);
      for (const [i, [a, b]] of TURN2_POINTS.entries()) {
        if (i > 0) await page.waitForTimeout(500);
        await markText(page, '#turn-2 .speech-body', a, b);
      }
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn2-decisive',
    kind: 'video',
    title: '議論の画面: ターン2の色を消し、「さらに決定的なのは、[3]によれば〜ことです。」の文に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      for (const [a, b] of TURN2_POINTS) await markText(page, '#turn-2 .speech-body', a, b, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await markText(page, '#turn-2 .speech-body', ...TURN2_DECISIVE);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn2-cite',
    kind: 'video',
    title: '議論の画面: ターン2の色を消し、「[3]によれば〜ことです。」の文に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-2 .speech-body', ...TURN2_DECISIVE, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await markText(page, '#turn-2 .speech-body', ...TURN2_CITE);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn3',
    kind: 'video',
    title: '議論の画面: ターン2の色を消し、ターン3までスクロールして「[1]によれば、2019年の総選挙では〜勝利しており」に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-2 .speech-body', ...TURN2_CITE, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await scrollToTurn(page, 3, 'smooth');
      await page.waitForTimeout(500);
      await markText(page, '#turn-3 .speech-body', ...TURN3_2019);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn5',
    kind: 'video',
    title: '議論の画面: ターン3の色を消し、ターン5までスクロールして「また、[11]では、〜指摘されており」に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-3 .speech-body', ...TURN3_2019, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await scrollToTurn(page, 5, 'smooth');
      await page.waitForTimeout(500);
      await markText(page, '#turn-5 .speech-body', ...TURN5_SWEET);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn5-source',
    kind: 'video',
    title: '議論の画面: ターン5の色を消し、[11]を押して資料の窓を出し、窓の中の2か所に順に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-5 .speech-body', ...TURN5_SWEET, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(800);
      await openSource11(page);
      await page.waitForTimeout(1500);
      for (const [i, [a, b]] of SOURCE11_MARKS.entries()) {
        if (i > 0) await page.waitForTimeout(500);
        await markText(page, 'dialog.source-modal', a, b, { scroll: false });
      }
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn6',
    kind: 'video',
    title: '議論の画面: 資料の窓の色を消して窓を閉じ、ターン6までスクロールして「まず、相手は[11]を引用して〜正反対です。」に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-5 .speech-body', ...TURN5_SWEET, { animate: false });
      await clearMarks(page);
      await openSource11(page);
      for (const [a, b] of SOURCE11_MARKS) await markText(page, 'dialog.source-modal', a, b, { animate: false, scroll: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(800);
      await page.locator('dialog.source-modal').getByRole('button', { name: '閉じる' }).click();
      await page.waitForTimeout(1000);
      await scrollToTurn(page, 6, 'smooth');
      await page.waitForTimeout(500);
      await markText(page, '#turn-6 .speech-body', ...TURN6_REBUT);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn9',
    kind: 'video',
    title: '議論の画面: ターン6の色を消し、ターン9までスクロールして「最後に、〜魅了しているのです。」に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-6 .speech-body', ...TURN6_REBUT, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await scrollToTurn(page, 9, 'smooth');
      await page.waitForTimeout(500);
      await markText(page, '#turn-9 .speech-body', ...TURN9_LAST);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'turn10',
    kind: 'video',
    title: '議論の画面: ターン9の色を消し、ターン10までスクロールして「相手は自ら検索した資料の内容を〜損なわれています。」に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-9 .speech-body', ...TURN9_LAST, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await scrollToTurn(page, 10, 'smooth');
      await page.waitForTimeout(500);
      await markText(page, '#turn-10 .speech-body', ...TURN10_TRUST);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'result-section',
    kind: 'video',
    title: '議論の画面: ターン10の色を消し、「議論が終わりました」の欄までスクロールする(勝ち負けが出る動きまで)',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await markText(page, '#turn-10 .speech-body', ...TURN10_TRUST, { animate: false });
      await clearMarks(page);
    },
    async run(page) {
      await page.waitForTimeout(200);
      await scrollToTop(page, '#result', 'smooth');
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'verdict-section',
    kind: 'video',
    title: '議論の画面: 「議論が終わりました」の欄から、「判定の内訳」の欄までスクロールする',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await scrollToTop(page, '#result', 'instant');
      // 勝ち負けが出る動きを終えてから録る
      await page.waitForTimeout(5000);
      await waitForImages(page);
    },
    async run(page) {
      await page.waitForTimeout(500);
      await scrollToTop(page, '#verdict', 'smooth');
      await page.waitForTimeout(3000);
    },
  },
  {
    id: 'judge-evidence',
    kind: 'video',
    title: '議論の画面: 根拠の審判の「詳しく見る」を押し、先攻(きのこの山)の理由までスクロールして「後攻から繰り返し指摘されても〜大きく損なう。」に色を付ける',
    loggedIn: true,
    needsDebate: true,
    async setup(page, ctx) {
      await openDebateWithoutCutIn(page, ctx);
      await scrollToTop(page, '#verdict', 'instant');
      await waitForImages(page);
    },
    async run(page) {
      await page.waitForTimeout(800);
      await page.locator(`${JUDGE2_CARD} .judge-toggle`).click();
      await page.waitForTimeout(1200);
      await scrollToTop(page, `${JUDGE2_CARD} .judge-detail.pro`, 'smooth');
      await page.waitForTimeout(500);
      await markText(page, `${JUDGE2_CARD} .judge-detail.pro .reason`, ...JUDGE2_PRO);
      await page.waitForTimeout(5000);
    },
  },
  {
    id: 'debate-view',
    kind: 'video',
    title: '終わった議論の画面を、上から順にスクロール',
    loggedIn: true,
    needsDebate: true,
    async run(page, { webUrl, debateId }) {
      await page.goto(`${webUrl}/debates/${encodeURIComponent(debateId!)}`);
      await page.waitForSelector('ol.speeches > li');
      // 開いたときのカットインを閉じる
      await page.getByRole('button', { name: '議論を見る' }).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await scrollSmoothly(page, 1600, 9000);
      await page.waitForTimeout(1000);
    },
  },
  {
    id: 'source',
    kind: 'video',
    title: '発言の中の資料の番号を押し、資料の窓を開く',
    loggedIn: true,
    needsDebate: true,
    async run(page, { webUrl, debateId }) {
      await page.goto(`${webUrl}/debates/${encodeURIComponent(debateId!)}`);
      await page.waitForSelector('ol.speeches > li');
      await page.getByRole('button', { name: '議論を見る' }).click({ timeout: 5000 }).catch(() => {});
      const cite = page.locator('.speech-body .cite, .speech-body sup button, .speech-body button').first();
      await cite.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      await cite.click();
      await page.waitForTimeout(4000);
    },
  },
  {
    id: 'result',
    kind: 'still',
    title: '結果の節(勝ち負けと票)',
    loggedIn: true,
    needsDebate: true,
    async run(page, { webUrl, debateId }) {
      await page.goto(`${webUrl}/debates/${encodeURIComponent(debateId!)}`);
      await page.waitForSelector('ol.speeches > li');
      await page.getByRole('button', { name: '議論を見る' }).click({ timeout: 5000 }).catch(() => {});
      await scrollTo(page, '#result, .result');
    },
  },
  {
    id: 'verdict',
    kind: 'still',
    title: '判定の内訳(審判3人のカード)',
    loggedIn: true,
    needsDebate: true,
    async run(page, { webUrl, debateId }) {
      await page.goto(`${webUrl}/debates/${encodeURIComponent(debateId!)}`);
      await page.waitForSelector('ol.speeches > li');
      await page.getByRole('button', { name: '議論を見る' }).click({ timeout: 5000 }).catch(() => {});
      await scrollTo(page, '.judge-card, .verdict');
    },
  },
];
