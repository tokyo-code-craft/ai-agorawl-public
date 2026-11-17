// エンジンとアプリの共通の取り決め。仕様: docs/02-data-model/README.md

/** 議論の役割(先攻・後攻) */
export type Role = 'pro' | 'con';

/** 議論の状態 */
export type DebateStatus = 'running' | 'done' | 'failed';

/** 先攻(pro)・後攻(con)。作戦メモを持ち、投了しうる側 */
export type DebaterRole = Role;

/** 先攻と後攻が受け持つ立場の名前(例: pro「週休3日制」、con「週休2日制(現状維持)」) */
export type Positions = Record<DebaterRole, string>;

/** 議論の終了理由 */
export type EndReason = 'maxTurns' | 'conceded' | 'exhausted';

/** 参加者(役割ごとのモデルと人格) */
export interface Participant {
  role: Role;
  /** BedrockのモデルID(推論プロファイルのIDを含む) */
  modelId: string;
  /** 人格の参照。開発初期は使わない */
  personaId?: string;
}

/** 審判の観点(議論を読むときに特に注意するところ)。仕様: docs/03-engine/README.md「優劣判定」 */
export const JUDGE_VIEWPOINTS = ['logic', 'evidence', 'exchange'] as const;
export type JudgeViewpoint = (typeof JUDGE_VIEWPOINTS)[number];

/** 審判。省略すると判定しない */
export interface Judge {
  modelId: string;
  /** 観点。省略すると観点を持たない */
  viewpoint?: JudgeViewpoint;
}

/** Debatesテーブルの項目 */
export interface Debate {
  debateId: string;
  /** 作成者のCognitoユーザーID(sub) */
  ownerId: string;
  /** 2つの立場を比べる問いの形(例:「週休は何日がよいか」) */
  theme: string;
  positions: Positions;
  status: DebateStatus;
  participants: Participant[];
  judges?: Judge[];
  /** 4〜50の偶数 */
  maxTurns: number;
  /** ISO 8601(UTC、ミリ秒まで) */
  createdAt: string;
  /** 一覧用GSIのパーティションキー。常に LIST_KEY */
  listKey: typeof LIST_KEY;
  /** 判定結果。最大ターン数で終わり、judges があるときのみ */
  verdict?: Verdict;
  /** 終了理由。完了時にエンジンが保存する */
  endReason?: EndReason;
  /** 投了した側。投了で終わったときのみ */
  concededBy?: DebaterRole;
  /** 管理者が一般のユーザーに隠した議論だけ true。持たない議論は見せる(docs/04-app/README.md「議論を隠す」) */
  hidden?: boolean;
}

/** 採点の基準 */
export const CRITERIA = ['logic', 'evidence', 'rebuttal', 'response'] as const;
export type Criterion = (typeof CRITERIA)[number];

/** 観点ごとに、合計で重くする基準(docs/03-engine/README.md「優劣判定」の「観点」) */
export const VIEWPOINT_CRITERIA: Record<JudgeViewpoint, Criterion[]> = {
  logic: ['logic'],
  evidence: ['evidence'],
  exchange: ['rebuttal', 'response'],
};

/** 観点の基準の重み */
export const VIEWPOINT_WEIGHT = 2;

/** 観点から、合計に使う基準ごとの重みを作る */
export function criterionWeights(viewpoint: JudgeViewpoint): Record<Criterion, number> {
  return Object.fromEntries(
    CRITERIA.map((c) => [c, VIEWPOINT_CRITERIA[viewpoint].includes(c) ? VIEWPOINT_WEIGHT : 1]),
  ) as Record<Criterion, number>;
}

/** 審判による、作戦メモの項目(主張または反論)1件の点数 */
export interface ClaimJudgment {
  /** 作戦メモの主張・反論のID */
  id: string;
  /** 0〜10の整数。主張は8以上を持ちこたえた・3以下を崩された、反論は8以上を効いた・3以下を効かなかったとみなす */
  score: number;
}

/** 審判による片側の採点 */
export interface SideJudgment {
  /** 基準ごとの点数(0〜10の整数) */
  scores: Record<Criterion, number>;
  /** 4つの基準の合計。観点がある審判は、観点の基準の点を重くして足す(judgments[].weights)。エンジンが計算する */
  total: number;
  reason: string;
  /** 主張ごとの点数。その側の最終の主張一覧のすべての主張について持つ。この項目を加える前に判定した議論は持たない */
  claims?: ClaimJudgment[];
  /** 反論ごとの点数。その側の最終の反論一覧(議論の最後の発言で初めて足した反論を除く)について持つ。この項目を加える前に判定した議論は持たない */
  rebuttals?: ClaimJudgment[];
}

/** 審判1人の判定結果 */
export interface Judgment {
  modelId: string;
  /** 審判の観点(judges の viewpoint を写す)。観点のない審判と、この項目を加える前に判定した議論は持たない */
  viewpoint?: JudgeViewpoint;
  /** 合計に使った基準ごとの重み。観点がある審判のみ。持たない判定の合計は、重みなしの合計 */
  weights?: Record<Criterion, number>;
  pro: SideJudgment;
  con: SideJudgment;
  /** 合計点から、エンジンが決める */
  winner: DebaterRole | 'draw';
  /** ISO 8601(UTC、ミリ秒まで) */
  createdAt: string;
}

/** 判定結果(Debates.verdict) */
export interface Verdict {
  /** 審判ごとの結果。judges と同じ順 */
  judgments: Judgment[];
  /** 議論の勝者。審判ごとの winner の多数決(過半数がなければ draw)。この項目を加える前に判定した議論は持たない */
  winner?: DebaterRole | 'draw';
}

/** 資料一覧の1件(Web検索の結果) */
export interface Source {
  /** 議論全体の通し番号(1から) */
  id: number;
  /** 検索したターン */
  turn: number;
  /** 検索した側 */
  role: DebaterRole;
  query: string;
  /** 検索用のモデルがまとめた事実の要約 */
  text: string;
  /** 出典のURL(重複なし) */
  urls: string[];
}

/** 主張一覧の項目 */
export interface Claim {
  /** C1 など。ターンをまたいで同じ主張を指す */
  id: string;
  text: string;
  /** 0〜10の整数 */
  score: number;
  status: 'defending' | 'abandoned';
}

/** 反論一覧の項目 */
export interface Rebuttal {
  /** R1 など。ターンをまたいで同じ反論を指す */
  id: string;
  /** 相手のどの主張への反論か */
  target: string;
  text: string;
  /** 0〜10の整数 */
  score: number;
  /** 点数からエンジンが決める */
  status: 'won' | 'pursuing' | 'dropped';
}

/** 作戦メモ(先攻・後攻の発言のみ) */
export interface DebaterNotes {
  claims: Claim[];
  rebuttals: Rebuttal[];
}

/** Messagesテーブルの項目 */
export interface Message {
  debateId: string;
  /** 1始まりの連番 */
  turn: number;
  role: Role;
  modelId: string;
  content: string;
  /** ISO 8601(UTC、ミリ秒まで) */
  createdAt: string;
  /** 発言者の作戦メモ。先攻・後攻の発言のみ */
  notes?: DebaterNotes;
  /** この発言で投了したか。先攻・後攻の発言のみ */
  conceded?: boolean;
  /** この発言で引き分け(両者の攻め手が尽きた)になったか。先攻・後攻の発言のみ */
  exhausted?: boolean;
  /** この発言のために検索して資料一覧に追加した資料 */
  sources?: Source[];
  /** 発言で引用した資料の番号(重複なし、昇順) */
  citations?: number[];
  /** 引用した番号のうち、資料一覧にないもの */
  invalidCitations?: number[];
}

/** Connectionsテーブルの項目 */
export interface Connection {
  connectionId: string;
  /** 購読前は持たない */
  debateId?: string;
  userId: string;
  /** 期限(UNIX秒) */
  ttl: number;
}

/** エンジン(Step Functions)の起動入力 */
export interface EngineStartInput {
  debateId: string;
}

/** Debates.listKey の固定値 */
export const LIST_KEY = 'ALL' as const;

/** GSIの名前 */
export const INDEX_NAMES = {
  debatesByCreatedAt: 'byCreatedAt',
  connectionsByDebateId: 'byDebateId',
} as const;

/** 設定の検証ルール */
export const LIMITS = {
  themeMinLength: 3,
  themeMaxLength: 200,
  positionMaxLength: 50,
  minTurns: 4,
  maxTurns: 50,
  modelIdMaxLength: 200,
  personaIdMaxLength: 64,
  maxJudges: 5,
} as const;

/** 使えない文字(制御文字、目に見えない書式の文字、行区切り・段落区切り)。絵文字をつなぐゼロ幅接合子 U+200D は使える */
const FORBIDDEN_CHAR = /(?!\u200D)[\p{Cc}\p{Cf}\u2028\u2029]/u;

/** 文字数(Unicode の符号位置で数える。サロゲートペアも1文字) */
const charCount = (s: string) => [...s].length;

/** 先攻と後攻の立場が同じかを比べるための形(全角と半角、大文字と小文字、空白の違いを無視する) */
const comparable = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** テーマと立場の文字を検証し、違反の一覧を返す(空なら妥当)。画面でも、送る前に使う */
export function validateDebateText(input: { theme: string; positions: Positions }): string[] {
  const errors: string[] = [];
  const theme = (input.theme ?? '').trim();
  const themeLength = charCount(theme);
  if (themeLength < LIMITS.themeMinLength || themeLength > LIMITS.themeMaxLength) {
    errors.push(`テーマは${LIMITS.themeMinLength}〜${LIMITS.themeMaxLength}文字にしてください`);
  }
  if (FORBIDDEN_CHAR.test(theme)) {
    errors.push('テーマに改行・タブ・目に見えない文字は使えません');
  }

  const pro = (input.positions?.pro ?? '').trim();
  const con = (input.positions?.con ?? '').trim();
  for (const [label, value] of [['先攻の立場', pro], ['後攻の立場', con]] as const) {
    const length = charCount(value);
    if (length < 1 || length > LIMITS.positionMaxLength) {
      errors.push(`${label}は1〜${LIMITS.positionMaxLength}文字にしてください`);
    }
    if (FORBIDDEN_CHAR.test(value)) {
      errors.push(`${label}に改行・タブ・目に見えない文字は使えません`);
    }
  }
  if (pro.length > 0 && comparable(pro) === comparable(con)) {
    errors.push('先攻と後攻の立場は、違う内容にしてください');
  }
  return errors;
}

/** 議論の設定を検証し、違反の一覧を返す(空なら妥当) */
export function validateDebateSettings(input: {
  theme: string;
  positions: Positions;
  maxTurns: number;
  participants: Participant[];
  judges?: Judge[];
}): string[] {
  const errors = validateDebateText(input);

  const t = input.maxTurns;
  if (!Number.isInteger(t) || t < LIMITS.minTurns || t > LIMITS.maxTurns || t % 2 !== 0) {
    errors.push(`ターン数は${LIMITS.minTurns}〜${LIMITS.maxTurns}の偶数にしてください`);
  }

  const roles: Role[] = ['pro', 'con'];
  const ps = input.participants;
  const hasEachOnce = ps.length === 2 && roles.every((r) => ps.filter((p) => p.role === r).length === 1);
  if (!hasEachOnce) {
    errors.push('討論者は、先攻と後攻を1人ずつにしてください');
  }

  for (const p of ps) {
    if (!isValidModelId(p.modelId)) errors.push(`討論者のAIのIDが正しくありません: ${p.modelId}`);
    if (p.personaId !== undefined && !/^[a-z0-9-]{1,64}$/.test(p.personaId)) {
      errors.push(`人格のIDが正しくありません: ${p.personaId}`);
    }
  }

  if (input.judges !== undefined) {
    if (input.judges.length > LIMITS.maxJudges) {
      errors.push(`審判は0〜${LIMITS.maxJudges}人にしてください`);
    }
    // 審判は先攻・後攻と同じモデルでもよい
    for (const j of input.judges) {
      if (!isValidModelId(j.modelId)) errors.push(`審判のAIのIDが正しくありません: ${j.modelId}`);
      if (j.viewpoint !== undefined && !(JUDGE_VIEWPOINTS as readonly string[]).includes(j.viewpoint)) {
        errors.push(`審判の観点は ${JUDGE_VIEWPOINTS.join(' / ')} のいずれかにしてください: ${j.viewpoint}`);
      }
    }
  }

  return errors;
}

function isValidModelId(id: string): boolean {
  return id.length >= 1 && id.length <= LIMITS.modelIdMaxLength && /^[A-Za-z0-9._:/-]+$/.test(id);
}
