// 画面の処理のうち、ブラウザや通信に触れない部分(発言のまとめ方、再接続の間隔、表示の言葉)。
// 仕様: docs/04-app/README.md「画面(SPA)」「WebSocket API」
import { API_MAX_TURNS, type AccountType, type ListModelsResponse, type ModelRole } from '@agorawl/api/types';
import type { Debate, DebaterRole, Message, Positions, Source } from '@agorawl/contract';

/** 発言を turn で重複を除き、turn の順に並べる。同じ turn は後から来たほうで置き換える */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byTurn = new Map<number, Message>();
  for (const m of [...current, ...incoming]) byTurn.set(m.turn, m);
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

/** 再接続までの待ち時間。1秒から倍に延ばし、最大30秒(attempt は0始まり) */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/** 議論の作成で選べるターン数(4〜10の偶数。HTTP APIで作れるのは10ターンまで) */
export const TURN_OPTIONS = Array.from({ length: (API_MAX_TURNS - 4) / 2 + 1 }, (_, i) => 4 + i * 2);
export const DEFAULT_TURNS = 10;

/** 先攻・後攻の呼び名 */
export const ROLE_LABELS: Record<DebaterRole, string> = { pro: '先攻', con: '後攻' };

/** AIを選ぶ役割の呼び名(先攻、後攻、審判) */
export const MODEL_ROLE_LABELS: Record<ModelRole, string> = { ...ROLE_LABELS, judge: '審判' };

/**
 * 見た目をAIに聞いた答えのうち、AIを選ぶ画面に出すもの(tools/generate-illustration/answers/<ID>.json から写す)。
 * 理由は、答えの文を画面用に短くしたもの(docs/04-app/README.md「AIを選ぶ」の「理由の文」)
 */
export interface CharacterProfile {
  motif: string;
  personality: readonly string[];
  reason: string;
}

/** 立ち絵のあるキャラクターと、モデルIDの見分け方(docs/04-app/README.md「議論の画面」の「発言のアイコン」) */
const CHARACTERS: {
  id: string;
  name: string;
  match: (modelId: string) => boolean;
  tiers: readonly (readonly [string, number])[];
  profile: CharacterProfile;
}[] = [
  {
    id: 'claude',
    name: 'Claude',
    match: (m) => m.includes('anthropic.'),
    profile: {
      motif: 'フクロウ',
      personality: ['好奇心旺盛', '公平な思考', '熱心'],
      reason: '知識や議論に関連した賢さの象徴であり、大きな目は異なる視点をじっくり観察するため',
    },
    // 星の数(docs/05-persona-illustration/README.md「星の付け方」)。版の違いでは変えない
    tiers: [
      ['haiku', 1],
      ['sonnet', 2],
      ['opus', 3],
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    match: (m) => m.includes('openai.'),
    profile: {
      motif: 'タコ',
      personality: ['好奇心旺盛', '穏やか', 'ユーモア好き'],
      reason: '腕がたくさんあるので議論のポイントを指し示したり、情報を同時に扱える点が討論者にぴったり',
    },
    // 120b は 20b を含むため、先に確かめる
    tiers: [
      ['120b', 2],
      ['20b', 1],
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    match: (m) => m.includes('mistral.'),
    profile: {
      motif: '電球とペンギンの融合生物',
      personality: ['論理的', '茶目っ気', '好奇心旺盛'],
      reason: '電球はAIのひらめきを表し、ペンギンの体型で親しみやすく、知性とユーモアを兼ね備えた議論好き',
    },
    // 選べるのは Large 3 だけのため1つ。ほかのモデルを足したときに見直す
    tiers: [['large', 1]],
  },
];

/**
 * 審判のキャラクター。モデルによらず1つ(docs/05-persona-illustration/README.md「立ち絵」)。
 * 答えは tools/generate-illustration/answers/judge.json から写し、理由は画面用に短くした(docs/04-app/README.md「AIを選ぶ」)
 */
export const JUDGE_CHARACTER: { id: string; name: string; profile: CharacterProfile } = {
  id: 'judge',
  name: '審判',
  profile: {
    motif: 'ハリネズミ',
    personality: ['公正', '辛口', '愛嬌がある'],
    reason: '針で鋭く論点を突く審判で、丸くてコミカルな体型',
  },
};

/** モデルの性能を表す星の数。決まりにないモデルは0(星を出さない) */
export function modelStars(modelId: string): number {
  const c = CHARACTERS.find((x) => x.match(modelId));
  const id = modelId.toLowerCase();
  return c?.tiers.find(([name]) => id.includes(name))?.[1] ?? 0;
}

/** 発言のアイコンの画像。立ち絵のないモデルは null */
export function characterIcon(modelId: string): { src: string; name: string } | null {
  const c = CHARACTERS.find((x) => x.match(modelId));
  return c ? { src: `/characters/${c.id}-icon.png`, name: c.name } : null;
}

/** ポーズの絵(画面用に縮めた版)。立ち絵のないモデルは null(docs/05-persona-illustration/README.md「ポーズ」) */
export function characterPose(modelId: string, pose: 'front' | 'debate' | 'win' | 'lose' | 'think'): { src: string; name: string } | null {
  const c = CHARACTERS.find((x) => x.match(modelId));
  return c ? { src: `/characters/${c.id}-${pose}-sm.png`, name: c.name } : null;
}

/**
 * AIを選ぶ画面で、モデルをグループ(キャラクター)ごとにまとめる。グループは最初に出てくる順に並べ、
 * 立ち絵のないモデルは character が null のグループにまとめて最後に置く(docs/04-app/README.md「AIを選ぶ」)
 */
export function groupByCharacter<T extends { modelId: string }>(
  models: T[],
): { character: { id: string; name: string; profile: CharacterProfile } | null; models: T[] }[] {
  const groups = new Map<string, { character: { id: string; name: string; profile: CharacterProfile } | null; models: T[] }>();
  const others: T[] = [];
  for (const m of models) {
    const c = CHARACTERS.find((x) => x.match(m.modelId));
    if (!c) {
      others.push(m);
      continue;
    }
    const g = groups.get(c.id) ?? { character: { id: c.id, name: c.name, profile: c.profile }, models: [] };
    g.models.push(m);
    groups.set(c.id, g);
  }
  return [...groups.values(), ...(others.length ? [{ character: null, models: others }] : [])];
}

/** 議論の先攻または後攻のモデルID。古い議論などで分からなければ空文字 */
export function participantModel(debate: Pick<Debate, 'participants'>, role: DebaterRole): string {
  return debate.participants?.find((p) => p.role === role)?.modelId ?? '';
}

/** 端末の設定で動きを減らしているか */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const STATUS_LABELS: Record<Debate['status'], string> = { running: '議論中', done: '終了', failed: '失敗' };
/**
 * IDトークンの中身(oidc-client-ts の profile)から、管理者か(Cognito のグループ admin に入っているか)。
 * 画面で操作を出す目安にだけ使い、断るのは API(docs/04-app/README.md「認証」の「管理者」)
 */
export function isAdminProfile(profile: Record<string, unknown> | undefined): boolean {
  const groups = profile?.['cognito:groups'];
  return Array.isArray(groups) && groups.includes('admin');
}

export const statusLabel = (s: Debate['status']) => STATUS_LABELS[s];

const END_REASON_LABELS: Record<NonNullable<Debate['endReason']>, string> = {
  maxTurns: '最大ターン数に到達',
  conceded: '投了',
  exhausted: '両者の攻め手が尽きて引き分け',
};
export const endReasonLabel = (r: Debate['endReason']) => (r ? END_REASON_LABELS[r] : '');

/** 勝者の表示。判定がなければ空(投了は投了した側の負け) */
export function winnerLabel(d: Pick<Debate, 'positions' | 'endReason' | 'concededBy'> & { winner?: DebaterRole | 'draw' }): string {
  if (d.endReason === 'conceded' && d.concededBy) return `${d.positions[d.concededBy === 'pro' ? 'con' : 'pro']}の勝ち(投了)`;
  if (d.endReason === 'exhausted') return '引き分け';
  if (!d.winner) return '';
  return d.winner === 'draw' ? '引き分け' : `${d.positions[d.winner]}の勝ち`;
}

/** 結果の節の、片側の結果。waiting は判定待ち */
export type SideOutcome = 'win' | 'lose' | 'draw' | 'waiting';

/**
 * 結果の節の、先攻と後攻の結果(docs/04-app/README.md「結果の節」)。
 * 絵と札を出さない議論(失敗、結果の分からない議論)は null
 */
export function sideOutcomes(d: Pick<Debate, 'status' | 'endReason' | 'concededBy' | 'verdict'>): Record<DebaterRole, SideOutcome> | null {
  if (d.status !== 'done') return null;
  const winBy = (w: DebaterRole): Record<DebaterRole, SideOutcome> => (w === 'pro' ? { pro: 'win', con: 'lose' } : { pro: 'lose', con: 'win' });
  if (d.endReason === 'conceded' && d.concededBy) return winBy(d.concededBy === 'pro' ? 'con' : 'pro');
  if (d.endReason === 'exhausted') return { pro: 'draw', con: 'draw' };
  // 多数決の勝者がない(項目を加える前の)判定は、1人目の審判の勝者
  const winner = d.verdict?.winner ?? d.verdict?.judgments[0]?.winner;
  if (winner === 'draw') return { pro: 'draw', con: 'draw' };
  if (winner) return winBy(winner);
  if (d.endReason === 'maxTurns') return { pro: 'waiting', con: 'waiting' };
  return null;
}

/** 結果ごとのポーズ(引き分けと判定待ちは考え込む) */
export const OUTCOME_POSE = { win: 'win', lose: 'lose', draw: 'think', waiting: 'think' } as const satisfies Record<SideOutcome, string>;

/** 発言者の立場の名前(司会を廃止する前の議論の司会の発言は「司会」) */
export function speakerLabel(role: string, positions: Positions): string {
  return role === 'pro' || role === 'con' ? positions[role] : '司会';
}

/** 日時の表示(日本時間) */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });
}

/** 年月日(日本時間)。アカウントの一覧の「作った日」 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** アカウントの種類の呼び名(docs/04-app/README.md「アカウントの種類」) */
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { admin: '管理者', general: '一般', demo: 'デモ' };
export const accountTypeLabel = (t: AccountType) => ACCOUNT_TYPE_LABELS[t];

/** 資料一覧: 各発言の sources を、資料の番号の順に並べたもの(docs/04-app/README.md「資料一覧の節」) */
export function collectSources(messages: Message[]): Source[] {
  const byId = new Map<number, Source>();
  for (const m of messages) for (const s of m.sources ?? []) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** 文を、資料の番号([3] など)とそれ以外の文字に分ける。番号は数で、ほかは文字のまま返す */
export function splitCitations(text: string): (string | number)[] {
  const parts: (string | number)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(Number(m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 発言の段階(立論はターン1・2。投了の発言は「投了」)。司会を廃止する前の議論の司会の発言は「総括」 */
export function stageLabel(m: Pick<Message, 'turn' | 'role' | 'conceded'>): string {
  if (m.role !== 'pro' && m.role !== 'con') return '総括';
  if (m.conceded) return '投了';
  return m.turn <= 2 ? '立論' : '攻防';
}

/** 立場の名前。持たない古い議論(賛成・反対の形だったころのもの)は「賛成」「反対」とする */
export function positionsOf(d: { positions?: Positions }): Positions {
  return d.positions ?? { pro: '賛成', con: '反対' };
}

/** スクロールの動き。端末の設定で動きを減らしている人には動かさない */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/** 設定を写して作るときに、作成の画面に入れる値(docs/04-app/README.md「設定を写して作る」) */
export interface CopiedSettings {
  theme: string;
  pro: string;
  con: string;
  maxTurns: number;
  /** 写せたAI。写せなかった役割は含めない(既定のAIのまま) */
  models: Partial<Record<ModelRole, string>>;
  /** 写せなかったことの案内 */
  notes: string[];
}

/**
 * 元の議論から、作成の画面に入れる値を決める。今は選べないAIと、選べないターン数は既定のままにし、案内を残す。
 * AIの一覧(catalog)を読み込めなかったときは、AIは写さない(作成の画面は既定のAIで作る)
 */
export function copySettings(
  debate: Pick<Debate, 'theme' | 'participants' | 'judges' | 'maxTurns'> & { positions?: Positions },
  catalog: Pick<ListModelsResponse, 'models' | 'judgeModels'> | null,
): CopiedSettings {
  const positions = positionsOf(debate);
  const notes: string[] = [];
  const models: Partial<Record<ModelRole, string>> = {};
  const original: Record<ModelRole, string | undefined> = {
    pro: debate.participants?.find((p) => p.role === 'pro')?.modelId,
    con: debate.participants?.find((p) => p.role === 'con')?.modelId,
    judge: debate.judges?.[0]?.modelId,
  };
  if (catalog) {
    for (const role of ['pro', 'con', 'judge'] as const) {
      const id = original[role];
      if (!id) continue;
      const options = role === 'judge' ? catalog.judgeModels : catalog.models;
      if (options.some((m) => m.modelId === id)) models[role] = id;
      else notes.push(`元の${MODEL_ROLE_NAMES[role]}のAI(${id})は今は選べないため、既定のAIにしました`);
    }
  } else {
    notes.push('AIの一覧を読み込めなかったため、討論者と審判のAIは既定のAIにしました');
  }
  let maxTurns = debate.maxTurns;
  if (!TURN_OPTIONS.includes(maxTurns)) {
    notes.push(`元のターン数(${debate.maxTurns}ターン)は選べないため、${DEFAULT_TURNS}ターンにしました`);
    maxTurns = DEFAULT_TURNS;
  }
  return { theme: debate.theme, pro: positions.pro, con: positions.con, maxTurns, models, notes };
}

const MODEL_ROLE_NAMES: Record<ModelRole, string> = { pro: '先攻', con: '後攻', judge: '審判' };
