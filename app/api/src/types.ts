// HTTP APIのリクエストと応答の形。SPA(app/web)もこの型を使う。仕様: docs/04-app/README.md「HTTP API」
import type { Debate, DebaterRole, Message, Positions } from '@agorawl/contract';

/** POST /debates の本文 */
export interface CreateDebateRequest {
  theme: string;
  positions: Positions;
  /** 省略時は DEFAULT_MAX_TURNS */
  maxTurns?: number;
  /**
   * 先攻と後攻の討論者のモデルIDと、審判(judge)のモデルID。省略したものは既定のモデル。
   * 選べるモデル(GET /models)にないものは400。審判は、既定の審判の全員のモデルを替える(人数と観点はそのまま)
   */
  models?: Partial<Record<ModelRole, string>>;
}

/** モデルを選ぶ役割(先攻、後攻、審判) */
export type ModelRole = DebaterRole | 'judge';

/** 議論の作成で選べるモデル(討論者と審判で同じ形) */
export interface ModelOption {
  modelId: string;
  /** 表示用の名前 */
  name: string;
  /** 特徴(画面に出す1行) */
  feature: string;
}

/** GET /models の応答 */
export interface ListModelsResponse {
  /** 討論者で選べるモデル */
  models: ModelOption[];
  /** 審判で選べるモデル */
  judgeModels: ModelOption[];
  /** 先攻、後攻、審判の既定のモデルID */
  defaults: Record<ModelRole, string>;
}

/** POST /debates の応答(201) */
export interface CreateDebateResponse {
  debateId: string;
}

/** GET /debates の一覧の1件 */
export interface DebateSummary {
  debateId: string;
  theme: string;
  positions: Positions;
  /** 先攻と後攻のモデル(一覧に討論者のアイコンを出すため) */
  participants: Debate['participants'];
  status: Debate['status'];
  maxTurns: number;
  createdAt: string;
  endReason?: Debate['endReason'];
  concededBy?: DebaterRole;
  /** 判定の多数決の勝者(判定があるときのみ) */
  winner?: DebaterRole | 'draw';
  /** 隠した議論だけ true(管理者の一覧にだけ出る) */
  hidden?: boolean;
}

/** アカウントの種類(docs/04-app/README.md「アカウントの種類」) */
export type AccountType = 'admin' | 'general' | 'demo';

/** GET /accounts の一覧の1件 */
export interface AccountSummary {
  email: string;
  type: AccountType;
  /** 使えるか(ログインのロックで止めたユーザーは false) */
  enabled: boolean;
  /** ユーザーを作った時刻 */
  createdAt: string;
}

/** GET /accounts の応答 */
export interface ListAccountsResponse {
  items: AccountSummary[];
}

/** デモのアカウントが1日に作れる議論の数(docs/04-app/README.md「デモのアカウントが1日に作れる議論」) */
export const DEMO_DAILY_LIMIT = 5;

/** PATCH /debates/{debateId} の本文 */
export interface UpdateDebateRequest {
  hidden: boolean;
}

/** GET /debates の応答 */
export interface ListDebatesResponse {
  items: DebateSummary[];
  /** 続きがあるときのみ。次の呼び出しの cursor にそのまま渡す */
  nextCursor?: string;
}

/** GET /debates/{debateId} の応答。議論が running の間、発言は notes を持たない */
export interface GetDebateResponse {
  debate: Omit<Debate, 'listKey'>;
  messages: Message[];
}

/** エラーの応答(400・404・500) */
export interface ErrorResponse {
  message: string;
  /** 検証の違反の一覧(400のときのみ) */
  errors?: string[];
}

/** POST /debates で maxTurns を省略したときのターン数 */
export const DEFAULT_MAX_TURNS = 10;

/** HTTP APIで作れる議論のターン数の上限。11ターン以上は開発用CLIでだけ作れる */
export const API_MAX_TURNS = 10;

/** GET /debates の limit の既定値と上限 */
export const LIST_LIMIT = { default: 20, max: 50 } as const;
