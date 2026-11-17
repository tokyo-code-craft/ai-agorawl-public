// 審判の出力の読み取りと、合計・勝者の計算。
// 仕様: docs/03-engine/README.md「優劣判定」、docs/03-engine/prompts.md「審判」
import {
  CRITERIA,
  criterionWeights,
  type ClaimJudgment,
  type Criterion,
  type DebaterRole,
  type JudgeViewpoint,
  type Judgment,
  type Message,
  type SideJudgment,
} from '@agorawl/contract';
import { SIDE_PREFIX, type JudgeClaim, type JudgeRebuttal } from './prompts';
import { OutputFormatError } from './errors';

/** 審判に渡した項目のID。そのすべてに点数があることを確かめる */
export interface JudgedItemIds {
  claims: Record<DebaterRole, string[]>;
  rebuttals: Record<DebaterRole, string[]>;
}

/**
 * 審判の出力(JSON)から採点を取り出し、合計と勝者を付ける。形式が誤っていれば OutputFormatError。
 * 観点があれば、観点の基準の点を重くして合計し、観点と重みも残す
 */
export function parseJudgeOutput(
  text: string,
  modelId: string,
  createdAt: string,
  ids: JudgedItemIds,
  viewpoint?: JudgeViewpoint,
): Judgment {
  const body = text.replace(/```(?:json)?/gi, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new OutputFormatError('審判の出力にJSONがありません');
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new OutputFormatError(`審判の出力がJSONとして読めません: ${(err as Error).message}`);
  }
  if (!isObject(raw)) throw new OutputFormatError('審判の出力がオブジェクトではありません');

  const claims = isObject(raw.claims) ? raw.claims : {};
  const rebuttals = isObject(raw.rebuttals) ? raw.rebuttals : {};
  const weights = viewpoint ? criterionWeights(viewpoint) : undefined;
  const sideOf = (role: DebaterRole): SideJudgment => ({
    ...side(raw[role], role, weights),
    claims: itemScores(claims[role], ids.claims[role], `claims.${role}`),
    rebuttals: itemScores(rebuttals[role], ids.rebuttals[role], `rebuttals.${role}`),
  });
  const pro = sideOf('pro');
  const con = sideOf('con');
  const winner = pro.total > con.total ? 'pro' : con.total > pro.total ? 'con' : 'draw';
  return { modelId, ...(viewpoint && { viewpoint, weights }), pro, con, winner, createdAt };
}

function side(v: unknown, name: string, weights?: Record<Criterion, number>): SideJudgment {
  if (!isObject(v) || !isObject(v.scores)) throw new OutputFormatError(`${name}.scores がありません`);
  const rawScores = v.scores;
  const scores = Object.fromEntries(
    CRITERIA.map((c) => {
      const s = rawScores[c];
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 10) {
        throw new OutputFormatError(`${name}.scores.${c} は0〜10の数値にしてください`);
      }
      return [c, Math.round(s)];
    }),
  ) as Record<Criterion, number>;
  if (typeof v.reason !== 'string' || v.reason.trim() === '') {
    throw new OutputFormatError(`${name}.reason が空です`);
  }
  const total = CRITERIA.reduce((sum, c) => sum + scores[c] * (weights?.[c] ?? 1), 0);
  return { scores, total, reason: v.reason.trim() };
}

/** 渡した項目のすべてに0〜10の点数があること。渡していないIDは無視し、同じIDは最初のものを使う */
function itemScores(v: unknown, ids: string[], name: string): ClaimJudgment[] {
  if (ids.length === 0) return [];
  if (!Array.isArray(v)) throw new OutputFormatError(`${name} は配列にしてください`);
  const found = new Map<string, number>();
  for (const item of v) {
    if (!isObject(item) || typeof item.id !== 'string') continue;
    // 審判には「先攻C1」の形で渡すので、頭の側の名前を取り除いて作戦メモのIDと照らし合わせる
    const id = stripSide(item.id.trim());
    if (found.has(id)) continue;
    const s = item.score;
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 10) {
      throw new OutputFormatError(`${name} の ${id} の score は0〜10の数値にしてください`);
    }
    found.set(id, Math.round(s));
  }
  return ids.map((id) => {
    const score = found.get(id);
    if (score === undefined) throw new OutputFormatError(`${name} に ${id} の点数がありません`);
    return { id, score };
  });
}

function stripSide(id: string): string {
  for (const prefix of Object.values(SIDE_PREFIX)) {
    if (id.startsWith(prefix)) return id.slice(prefix.length).trim();
  }
  return id;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** その側の作戦メモを持つ発言を、新しい順に返す */
function notesOf(messages: Message[], role: DebaterRole): Message[] {
  return [...messages].sort((a, b) => b.turn - a.turn).filter((m) => m.role === role && m.notes);
}

/**
 * その側の最終の主張一覧(最後の発言の作戦メモにある主張)を、IDと内容だけにして返す。
 * 討論者が付けた点数と状態は審判に渡さない(仕様: docs/03-engine/README.md「項目ごとの採点」)
 */
export function finalClaims(messages: Message[], role: DebaterRole): JudgeClaim[] {
  return (notesOf(messages, role)[0]?.notes?.claims ?? []).map(({ id, text }) => ({ id, text }));
}

/**
 * その側の最終の反論一覧を、IDと対象と内容だけにして返す。
 * 議論の最後の発言で初めて足した反論(答える機会のない反論)は除く。
 * それは、その側の最後から2番目の作戦メモにないIDの反論とする(仕様: docs/03-engine/README.md「項目ごとの採点」)
 */
export function finalRebuttals(messages: Message[], role: DebaterRole): JudgeRebuttal[] {
  const [last, previous] = notesOf(messages, role);
  if (!last?.notes) return [];
  const lastTurn = Math.max(...messages.map((m) => m.turn));
  const known = new Set((previous?.notes?.rebuttals ?? []).map((r) => r.id));
  return last.notes.rebuttals
    .filter((r) => last.turn !== lastTurn || known.has(r.id))
    .map(({ id, target, text }) => ({ id, target, text }));
}

/** 審判ごとの勝者の多数決。過半数の審判が同じ勝者を選ばなければ引き分け(仕様: docs/03-engine/README.md「優劣判定」) */
export function majorityWinner(judgments: Pick<Judgment, 'winner'>[]): Judgment['winner'] {
  for (const w of ['pro', 'con', 'draw'] as const) {
    if (judgments.filter((j) => j.winner === w).length * 2 > judgments.length) return w;
  }
  return 'draw';
}
