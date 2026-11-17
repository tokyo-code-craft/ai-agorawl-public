// HTTP APIの処理のうち、AWSに触れない部分(入力の検証、一覧の要約、カーソル、作戦メモの除去)。
// 仕様: docs/04-app/README.md「HTTP API」
import { LIST_KEY, validateDebateSettings, type Debate, type DebaterRole, type Judge, type Message, type Participant } from '@agorawl/contract';
import {
  API_MAX_TURNS,
  DEFAULT_MAX_TURNS,
  LIST_LIMIT,
  type AccountSummary,
  type AccountType,
  type DebateSummary,
  type ListModelsResponse,
  type ModelOption,
} from './types';

/** SNSの件名の上限(文字数) */
const SUBJECT_MAX = 100;

/** 議論の作成の既定値(既定のモデルと審判)と、選べる討論者と審判のモデル。ApiStackが環境変数 DEBATE_DEFAULTS で渡す */
export interface DebateDefaults {
  participants: Participant[];
  judges: Judge[];
  models: ModelOption[];
  judgeModels: ModelOption[];
}

const ROLES: DebaterRole[] = ['pro', 'con'];

/** 管理者のグループ名(docs/04-app/README.md「認証」の「管理者」) */
export const ADMIN_GROUP = 'admin';
/** デモのアカウントのグループ名(docs/04-app/README.md「アカウントの種類」) */
export const DEMO_GROUP = 'demo';

/**
 * トークンのクレームの cognito:groups を読む。
 * HTTP API の JWT オーソライザーは、配列のクレームを "[admin other]" の形の文字列で渡すため、配列と文字列の両方を読む
 */
function groupsOf(claims: Record<string, unknown> | undefined): string[] {
  const groups = claims?.['cognito:groups'];
  return Array.isArray(groups)
    ? groups.map(String)
    : typeof groups === 'string'
      ? groups.replace(/^\[|\]$/g, '').split(/[\s,]+/)
      : [];
}

/** 入っているグループから、アカウントの種類を決める。両方に入っていれば管理者 */
export function typeOfGroups(groups: string[]): AccountType {
  if (groups.includes(ADMIN_GROUP)) return 'admin';
  if (groups.includes(DEMO_GROUP)) return 'demo';
  return 'general';
}

/** トークンのクレームから、アカウントの種類を決める */
export const accountType = (claims: Record<string, unknown> | undefined): AccountType => typeOfGroups(groupsOf(claims));

/** トークンのクレームの cognito:groups に管理者のグループがあるか */
export const isAdmin = (claims: Record<string, unknown> | undefined): boolean => accountType(claims) === 'admin';

/**
 * デモのアカウントが作った数を数える行のキーと、行を消す時刻(UNIX秒)。
 * 1日は日本時間の0時で区切り、行は2日後に消す(docs/04-app/README.md「デモのアカウントが1日に作れる議論」)
 */
export function dailyCounter(sub: string, now: Date): { counterKey: string; expiresAt: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.toISOString().slice(0, 10);
  return { counterKey: `${sub}#${day}`, expiresAt: Math.floor(now.getTime() / 1000) + 2 * 24 * 60 * 60 };
}

/** Cognito の ListUsers の1件のうち、使う部分 */
export interface CognitoUser {
  Username?: string;
  Attributes?: { Name?: string; Value?: string }[];
  Enabled?: boolean;
  UserCreateDate?: Date;
}

/** GET /accounts の一覧を作る。groups はグループ名ごとの、入っているユーザー名(Username)。作った時刻の古い順 */
export function toAccounts(users: CognitoUser[], groups: Record<string, Set<string>>): AccountSummary[] {
  return users
    .map((u) => {
      const name = u.Username ?? '';
      const inGroups = Object.keys(groups).filter((g) => groups[g]?.has(name));
      return {
        email: u.Attributes?.find((a) => a.Name === 'email')?.Value ?? name,
        type: typeOfGroups(inGroups),
        enabled: u.Enabled !== false,
        createdAt: (u.UserCreateDate ?? new Date(0)).toISOString(),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 本文の誤り(400で返す) */

export class BadRequestError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** 環境変数 DEBATE_DEFAULTS(JSON)を読む */
export function parseDefaults(json: string | undefined): DebateDefaults {
  if (!json) throw new Error('DEBATE_DEFAULTS が設定されていません');
  const v = JSON.parse(json) as Partial<DebateDefaults>;
  if (!Array.isArray(v.participants) || !Array.isArray(v.judges) || !Array.isArray(v.models) || !Array.isArray(v.judgeModels)) {
    throw new Error('DEBATE_DEFAULTS は participants、judges、models、judgeModels の配列を持つJSONにしてください');
  }
  // 既定のモデルは、選べるモデルの中から選ぶ
  for (const role of ROLES) {
    const p = v.participants.find((x) => x.role === role);
    if (!p || !v.models.some((m) => m.modelId === p.modelId)) {
      throw new Error(`DEBATE_DEFAULTS の ${role} の既定のモデルが、models にありません`);
    }
  }
  // 既定の審判は1人以上で、全員が同じモデル。そのモデルは審判で選べるモデルの中から選ぶ
  const judgeModel = v.judges[0]?.modelId;
  if (!judgeModel || v.judges.some((j) => j.modelId !== judgeModel) || !v.judgeModels.some((m) => m.modelId === judgeModel)) {
    throw new Error('DEBATE_DEFAULTS の judges は、judgeModels にある同じモデルの1人以上にしてください');
  }
  return { participants: v.participants, judges: v.judges, models: v.models, judgeModels: v.judgeModels };
}

/** GET /models の応答 */
export function listModels(defaults: DebateDefaults): ListModelsResponse {
  const modelOf = (role: DebaterRole) => defaults.participants.find((p) => p.role === role)?.modelId ?? '';
  return {
    models: defaults.models,
    judgeModels: defaults.judgeModels,
    defaults: { pro: modelOf('pro'), con: modelOf('con'), judge: defaults.judges[0]?.modelId ?? '' },
  };
}

/** 本文の models を読む。オブジェクトでなければ違反に積み、何も選んでいないものとして扱う */
function readChosenModels(raw: unknown, errors: string[]): Record<string, unknown> {
  const chosen = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (raw !== undefined && chosen !== raw) errors.push('AIの指定の形が正しくありません');
  return chosen;
}

/** models から participants を作る。省略した側は既定のモデル。選べるモデルにないものは違反に積む */
function chooseParticipants(chosen: Record<string, unknown>, defaults: DebateDefaults, errors: string[]): Participant[] {
  return defaults.participants.map((p) => {
    const modelId = chosen[p.role];
    if (modelId === undefined) return p;
    if (typeof modelId !== 'string' || !defaults.models.some((m) => m.modelId === modelId)) {
      errors.push(`${p.role === 'pro' ? '先攻' : '後攻'}のAIは、選べるAIから選んでください`);
      return p;
    }
    return { ...p, modelId };
  });
}

/** models.judge から judges を作る。省略すれば既定の審判。指定すれば全員のモデルを替える(人数と観点はそのまま) */
function chooseJudges(chosen: Record<string, unknown>, defaults: DebateDefaults, errors: string[]): Judge[] {
  const modelId = chosen.judge;
  if (modelId === undefined) return defaults.judges;
  if (typeof modelId !== 'string' || !defaults.judgeModels.some((m) => m.modelId === modelId)) {
    errors.push('審判のAIは、選べるAIから選んでください');
    return defaults.judges;
  }
  return defaults.judges.map((j) => ({ ...j, modelId }));
}

/**
 * POST /debates の本文を読み、既定値と合わせて検証し、Debatesに保存する項目を作る。
 * 違反があれば BadRequestError(何も保存しない)
 */
export function buildDebate(
  body: string | undefined,
  defaults: DebateDefaults,
  ctx: { debateId: string; ownerId: string; now: string },
): Debate {
  let raw: unknown;
  try {
    raw = JSON.parse(body ?? '');
  } catch {
    throw new BadRequestError('本文をJSONとして読めません');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadRequestError('本文はオブジェクトにしてください');
  }
  const r = raw as Record<string, unknown>;
  const positions = typeof r.positions === 'object' && r.positions !== null ? (r.positions as Record<string, unknown>) : {};
  const modelErrors: string[] = [];
  const chosen = readChosenModels(r.models, modelErrors);
  const settings = {
    theme: typeof r.theme === 'string' ? r.theme : '',
    positions: {
      pro: typeof positions.pro === 'string' ? positions.pro : '',
      con: typeof positions.con === 'string' ? positions.con : '',
    },
    maxTurns: r.maxTurns === undefined ? DEFAULT_MAX_TURNS : (r.maxTurns as number),
    participants: chooseParticipants(chosen, defaults, modelErrors),
    judges: chooseJudges(chosen, defaults, modelErrors),
  };
  const errors = [...validateDebateSettings(settings), ...modelErrors];
  if (errors.length === 0 && settings.maxTurns > API_MAX_TURNS) {
    errors.push(`ターン数は${API_MAX_TURNS}以下にしてください`);
  }
  if (errors.length > 0) throw new BadRequestError('議論の設定が正しくありません', errors);

  return {
    debateId: ctx.debateId,
    ownerId: ctx.ownerId,
    theme: settings.theme.trim(),
    positions: { pro: settings.positions.pro.trim(), con: settings.positions.con.trim() },
    status: 'running',
    participants: settings.participants,
    judges: settings.judges,
    maxTurns: settings.maxTurns,
    createdAt: ctx.now,
    listKey: LIST_KEY,
  };
}

/** 議論の開始の通知(管理者へのメール)の件名と本文。仕様: docs/04-app/README.md「議論の開始の通知」 */
export function buildStartNotice(d: Debate, webOrigin: string): { subject: string; message: string } {
  const prefix = '[Agorawl] 議論が始まりました: ';
  const room = SUBJECT_MAX - prefix.length;
  // 件名は改行を含められないため、空白にする
  const theme = d.theme.replace(/\s+/g, ' ');
  const subject = prefix + (theme.length > room ? `${theme.slice(0, room - 1)}…` : theme);
  const message = [
    `テーマ: ${d.theme}`,
    `先攻: ${d.positions.pro}`,
    `後攻: ${d.positions.con}`,
    `ターン数: ${d.maxTurns}`,
    `作成者: ${d.ownerId}`,
    `作成の時刻: ${d.createdAt}`,
    `議論の画面: ${webOrigin}/debates/${d.debateId}`,
    '',
    '身に覚えのない議論なら、不正にログインされているおそれがあります。',
  ].join('\n');
  return { subject, message };
}

/** 一覧の1件。判定の詳細は含めず、多数決の勝者だけを持たせる */
export function toSummary(d: Debate): DebateSummary {
  return {
    debateId: d.debateId,
    theme: d.theme,
    positions: d.positions,
    participants: d.participants,
    status: d.status,
    maxTurns: d.maxTurns,
    createdAt: d.createdAt,
    ...(d.endReason ? { endReason: d.endReason } : {}),
    ...(d.concededBy ? { concededBy: d.concededBy } : {}),
    ...(d.verdict?.winner ? { winner: d.verdict.winner } : {}),
    ...(d.hidden ? { hidden: true } : {}),
  };
}

/** その人に議論を見せるか(隠した議論は管理者だけに見せる。docs/04-app/README.md「議論を隠す」) */
export const canSee = (d: Pick<Debate, 'hidden'>, admin: boolean) => admin || !d.hidden;

/** PATCH /debates/{debateId} の本文を読む。hidden が真偽値でなければ BadRequestError */
export function parseUpdate(body: string | undefined): { hidden: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? '');
  } catch {
    throw new BadRequestError('本文がJSONではありません');
  }
  const hidden = (parsed as { hidden?: unknown } | null)?.hidden;
  if (typeof hidden !== 'boolean') throw new BadRequestError('hidden を true か false で指定してください');
  return { hidden };
}

/** GET /debates の limit を読む(1〜50、省略時20) */
export function parseLimit(v: string | undefined): number {
  if (v === undefined) return LIST_LIMIT.default;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT.max) {
    throw new BadRequestError(`limit は1〜${LIST_LIMIT.max}の整数にしてください`);
  }
  return n;
}

/** DynamoDBの続きの位置(LastEvaluatedKey)を、意味を持たない文字列にする */
export function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  return key ? Buffer.from(JSON.stringify(key), 'utf8').toString('base64url') : undefined;
}

/** encodeCursor の逆。正しく読めなければ BadRequestError */
export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (cursor === undefined) return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new BadRequestError('cursor が正しくありません');
  }
}

/** 議論の応答から listKey を除く */
export function withoutListKey(d: Debate): Omit<Debate, 'listKey'> {
  const { listKey: _listKey, ...rest } = d;
  return rest;
}

/** 議論が running の間は、作戦メモ(notes)を除く。作戦メモは議論の終了後に開示する */
export function visibleMessages(messages: Message[], status: Debate['status']): Message[] {
  const sorted = [...messages].sort((a, b) => a.turn - b.turn);
  if (status !== 'running') return sorted;
  return sorted.map(({ notes: _notes, ...rest }) => rest);
}
