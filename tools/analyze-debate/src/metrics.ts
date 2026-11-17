// 議論の指標の計算(AWSに触れない)。仕様: docs/03-engine/analysis.md「指標」
import type { Claim, ClaimJudgment, Debate, DebaterRole, Judgment, Message } from '@agorawl/contract';

export interface ClaimScoreChanges {
  up: number;
  down: number;
  same: number;
}

/** 討論者の最終の見込み(作戦メモの主張の点数)と、審判の主張ごとの点数の比較 */
export interface ClaimCalibration {
  /** 同じIDで比べられた主張の数 */
  compared: number;
  /** 差(見込み − 審判)の絶対値の平均 */
  meanAbsDiff: number;
  /** 見込みが審判より高かった・低かった・同じだった件数 */
  over: number;
  under: number;
  same: number;
  /** 審判が3点以下と見た主張のうち、討論者が守っていた(defending)件数 */
  judgedWeakButDefended: number;
}

/** 審判がこの点数以下なら、崩された主張とみなす(docs/03-engine/README.md「主張ごとの採点」) */
export const JUDGED_WEAK_AT_MOST = 3;

export interface SideMetrics {
  role: DebaterRole;
  /** 自分の発言の数(作戦メモを持つ発言) */
  turns: number;
  /** 最初の発言(立論)の主張の数 */
  openingClaims: number;
  /** 途中で足した主張のID(最終の一覧のうち、最初の発言にないもの) */
  addedClaimIds: string[];
  /** 途中で足した主張のうち、内容に「相手」を含むもののID */
  addedClaimsMentioningOpponent: string[];
  finalClaims: number;
  scoreChanges: ClaimScoreChanges;
  /** 最終の主張の点数ごとの件数(点数 → 件数) */
  finalScoreDistribution: Record<number, number>;
  abandonedClaims: number;
  /** 主張を新しく捨てた発言(投了の発言を除く)のターンと、撤回の言葉を含むか */
  withdrawals: { turn: number; claimIds: string[]; declared: boolean }[];
  /** 自分の発言ごとの、守っている主張の数 */
  defendingByTurn: { turn: number; defending: number }[];
  /** 攻防の発言(立論と投了を除く)の形。攻防の発言がなければ undefined */
  speech?: {
    count: number;
    avgLength: number;
    avgOpponentQuotes: number;
    enumeratedShare: number;
    /** 1回の発言で動かした反論(追加、または内容・点数・状態が変わった反論)の数の平均 */
    avgMovedRebuttals: number;
  };
  /** 判定があり、審判が主張ごとの点数を付けている場合のみ(1人目の審判と比べる) */
  calibration?: ClaimCalibration;
}

export interface DebateMetrics {
  debateId: string;
  theme: string;
  positions: Debate['positions'];
  turns: number;
  endReason: Debate['endReason'];
  concededBy: Debate['concededBy'];
  judgments: Judgment[];
  sides: Record<DebaterRole, SideMetrics | undefined>;
}

export const OPPONENT_WORD = '相手';

/** 相手の発言の引用の形(docs/03-engine/analysis.md「発言の形」) */
export const OPPONENT_QUOTE = /相手(?:は|が)[「『]/g;
/** 論点を並べる形(docs/03-engine/analysis.md「発言の形」) */
export const ENUMERATION = /(第一に|第二に|まず[、,]|次に[、,]|最後に[、,]|三つ|3つ|三点|3点|二つ|2つ|2点)/;

/** 撤回の宣言とみなす言葉(docs/03-engine/analysis.md「撤回の宣言」) */
export const WITHDRAWAL_WORDS = ['撤回', '取り下げ', '取下げ'];

export function debateMetrics(debate: Debate, messages: Message[]): DebateMetrics {
  const sorted = [...messages].sort((a, b) => a.turn - b.turn);
  return {
    debateId: debate.debateId,
    theme: debate.theme,
    positions: debate.positions,
    turns: sorted.length,
    endReason: debate.endReason,
    concededBy: debate.concededBy,
    judgments: debate.verdict?.judgments ?? [],
    sides: {
      pro: sideMetrics('pro', sorted, debate.verdict?.judgments[0]?.pro.claims),
      con: sideMetrics('con', sorted, debate.verdict?.judgments[0]?.con.claims),
    },
  };
}

/** 作戦メモを持つ発言がなければ undefined */
export function sideMetrics(
  role: DebaterRole,
  sortedMessages: Message[],
  judgedClaims?: ClaimJudgment[],
): SideMetrics | undefined {
  const own = sortedMessages.filter((m) => m.role === role && m.notes);
  if (own.length === 0) return undefined;
  const first = own[0]!.notes!;
  const last = own[own.length - 1]!.notes!;

  const openingIds = new Set(first.claims.map((c) => c.id));
  const added = last.claims.filter((c) => !openingIds.has(c.id));

  const scoreChanges: ClaimScoreChanges = { up: 0, down: 0, same: 0 };
  for (let i = 1; i < own.length; i++) {
    const before = new Map(own[i - 1]!.notes!.claims.map((c) => [c.id, c.score]));
    for (const c of own[i]!.notes!.claims) {
      const prev = before.get(c.id);
      if (prev === undefined) continue;
      if (c.score > prev) scoreChanges.up++;
      else if (c.score < prev) scoreChanges.down++;
      else scoreChanges.same++;
    }
  }

  const finalScoreDistribution: Record<number, number> = {};
  for (const c of last.claims) finalScoreDistribution[c.score] = (finalScoreDistribution[c.score] ?? 0) + 1;

  return {
    role,
    turns: own.length,
    openingClaims: first.claims.length,
    addedClaimIds: added.map((c) => c.id),
    addedClaimsMentioningOpponent: added.filter((c) => c.text.includes(OPPONENT_WORD)).map((c) => c.id),
    finalClaims: last.claims.length,
    scoreChanges,
    finalScoreDistribution,
    abandonedClaims: last.claims.filter((c) => c.status === 'abandoned').length,
    withdrawals: withdrawals(own),
    ...speechShape(own),
    defendingByTurn: own.map((m) => ({
      turn: m.turn,
      defending: m.notes!.claims.filter((c) => c.status === 'defending').length,
    })),
    ...(judgedClaims ? { calibration: calibration(last.claims, judgedClaims) } : {}),
  };
}

/** 攻防の発言(自分の最初の発言=立論と、投了の発言を除く)の形 */
function speechShape(own: Message[]): Pick<SideMetrics, 'speech'> {
  const targets = own.map((m, i) => ({ m, prev: own[i - 1] })).slice(1).filter(({ m }) => !m.conceded);
  const speeches = targets.map(({ m }) => m.content);
  if (speeches.length === 0) return {};
  const moved = targets.map(({ m, prev }) => {
    const before = new Map(prev!.notes!.rebuttals.map((r) => [r.id, JSON.stringify(r)]));
    return m.notes!.rebuttals.filter((r) => before.get(r.id) !== JSON.stringify(r)).length;
  });
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    speech: {
      count: speeches.length,
      avgLength: avg(speeches.map((s) => s.length)),
      avgOpponentQuotes: avg(speeches.map((s) => (s.match(OPPONENT_QUOTE) ?? []).length)),
      enumeratedShare: speeches.filter((s) => ENUMERATION.test(s)).length / speeches.length,
      avgMovedRebuttals: avg(moved),
    },
  };
}

/** 前回の自分の作戦メモでは守っていた主張を、今回捨てた発言。投了の発言は数えない */
function withdrawals(own: Message[]): SideMetrics['withdrawals'] {
  const result: SideMetrics['withdrawals'] = [];
  for (let i = 1; i < own.length; i++) {
    const m = own[i]!;
    if (m.conceded) continue;
    const before = new Map(own[i - 1]!.notes!.claims.map((c) => [c.id, c.status]));
    const claimIds = m.notes!.claims
      .filter((c) => c.status === 'abandoned' && before.get(c.id) === 'defending')
      .map((c) => c.id);
    if (claimIds.length === 0) continue;
    result.push({ turn: m.turn, claimIds, declared: WITHDRAWAL_WORDS.some((w) => m.content.includes(w)) });
  }
  return result;
}

export function calibration(claims: Claim[], judged: ClaimJudgment[]): ClaimCalibration {
  const judgeScores = new Map(judged.map((j) => [j.id, j.score]));
  const pairs = claims.flatMap((c) => {
    const judge = judgeScores.get(c.id);
    return judge === undefined ? [] : [{ claim: c, judge }];
  });
  const diffs = pairs.map((p) => p.claim.score - p.judge);
  return {
    compared: pairs.length,
    meanAbsDiff: diffs.length ? diffs.reduce((sum, d) => sum + Math.abs(d), 0) / diffs.length : 0,
    over: diffs.filter((d) => d > 0).length,
    under: diffs.filter((d) => d < 0).length,
    same: diffs.filter((d) => d === 0).length,
    judgedWeakButDefended: pairs.filter((p) => p.judge <= JUDGED_WEAK_AT_MOST && p.claim.status === 'defending').length,
  };
}
