// 作戦メモの読み取り・状態の決定・投了の判定。
// 仕様: docs/03-engine/README.md「作戦メモ」「投了」、docs/03-engine/prompts.md「出力の検証」
import type { Claim, DebaterNotes, Rebuttal } from '@agorawl/contract';
import { OutputFormatError } from './errors';

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
/** 反論がこの点数以上なら獲得 */
export const WON_AT_LEAST = 8;
/** 反論がこの点数以下なら断念 */
export const DROPPED_AT_MOST = 3;

export function rebuttalStatus(score: number): Rebuttal['status'] {
  if (score >= WON_AT_LEAST) return 'won';
  if (score <= DROPPED_AT_MOST) return 'dropped';
  return 'pursuing';
}

/**
 * モデルの出力(新しい項目と変えた項目だけ)を、前回の作戦メモと合わせて全項目の一覧にする(IDで比べる)。
 * 同じIDの項目は前回の位置で置き換え、新しいIDの項目は末尾に足し、出力にない項目は前回のまま引き継ぐ。
 * 合わせた一覧に主張が1件もなければ OutputFormatError
 */
export function mergeNotes(output: DebaterNotes, previous: DebaterNotes | undefined): DebaterNotes {
  const merge = <T extends { id: string }>(before: T[], now: T[]): T[] => {
    const updates = new Map(now.map((x) => [x.id, x]));
    const kept = before.map((x) => updates.get(x.id) ?? x);
    const known = new Set(before.map((x) => x.id));
    const added = [...updates.values()].filter((x) => !known.has(x.id));
    return [...kept, ...added];
  };
  const notes = {
    claims: merge(previous?.claims ?? [], output.claims),
    rebuttals: merge(previous?.rebuttals ?? [], output.rebuttals),
  };
  if (notes.claims.length === 0) throw new OutputFormatError('claims は1件以上にしてください');
  return notes;
}

/** 投了: 守っている主張が1件もない */
export function shouldConcede(notes: DebaterNotes): boolean {
  return !notes.claims.some((c) => c.status === 'defending');
}

/** 攻め手が残っているか: 追及中の反論が1件以上ある */
export function hasActiveRebuttal(notes: DebaterNotes): boolean {
  return notes.rebuttals.some((r) => r.status === 'pursuing');
}

/** 引き分け: 今回の発言者と相手の最新の作戦メモのどちらにも、追及中の反論がない */
export function isExhausted(notes: DebaterNotes, opponentNotes: DebaterNotes | undefined): boolean {
  return opponentNotes !== undefined && !hasActiveRebuttal(notes) && !hasActiveRebuttal(opponentNotes);
}

/**
 * 先攻・後攻の出力から作戦メモと発言を取り出す。形式が誤っていれば OutputFormatError。
 * 前回の作戦メモにあるIDの項目は、省略した欄を前回の値で補う
 */
export function parseDebaterOutput(
  text: string,
  previous?: DebaterNotes,
): { notes: DebaterNotes; speech: string } {
  const notesMatch = /<notes>([\s\S]*?)<\/notes>/.exec(text);
  if (!notesMatch) throw new OutputFormatError('<notes> がありません');

  const speechMatch = /<speech>([\s\S]*?)(?:<\/speech>|$)/.exec(text);
  const speech = speechMatch?.[1]?.trim() ?? '';
  if (!speech) throw new OutputFormatError('<speech> がないか、空です');

  const json = notesMatch[1]!
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new OutputFormatError(`<notes> がJSONとして読めません: ${(err as Error).message}`);
  }
  return { notes: validateNotes(raw, previous), speech };
}

function validateNotes(raw: unknown, previous: DebaterNotes | undefined): DebaterNotes {
  if (!isObject(raw)) throw new OutputFormatError('作戦メモがオブジェクトではありません');
  const { claims, rebuttals } = raw;
  // 変えない項目は省略できるため、0件でもよい(主張が1件以上あるかは mergeNotes で確かめる)
  if (!Array.isArray(claims)) throw new OutputFormatError('claims は配列にしてください');
  if (!Array.isArray(rebuttals)) throw new OutputFormatError('rebuttals は配列にしてください');

  const prevClaims = new Map((previous?.claims ?? []).map((c) => [c.id, c]));
  const prevRebuttals = new Map((previous?.rebuttals ?? []).map((r) => [r.id, r]));

  return {
    claims: claims.map((c, i): Claim => {
      if (!isObject(c)) throw new OutputFormatError(`claims[${i}] がオブジェクトではありません`);
      const id = requireText(c.id, `claims[${i}].id`);
      const before = prevClaims.get(id);
      const status = c.status ?? before?.status;
      if (status !== 'defending' && status !== 'abandoned') {
        throw new OutputFormatError(`claims[${i}].status が不正です`);
      }
      return {
        id,
        text: requireText(c.text ?? before?.text, `claims[${i}].text`),
        score: requireScore(c.score ?? before?.score, `claims[${i}].score`),
        status,
      };
    }),
    rebuttals: rebuttals.map((r, i): Rebuttal => {
      if (!isObject(r)) throw new OutputFormatError(`rebuttals[${i}] がオブジェクトではありません`);
      const id = requireText(r.id, `rebuttals[${i}].id`);
      const before = prevRebuttals.get(id);
      const score = requireScore(r.score ?? before?.score, `rebuttals[${i}].score`);
      return {
        id,
        target: requireText(r.target ?? before?.target, `rebuttals[${i}].target`),
        text: requireText(r.text ?? before?.text, `rebuttals[${i}].text`),
        score,
        status: rebuttalStatus(score),
      };
    }),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireText(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new OutputFormatError(`${name} が空です`);
  return v.trim();
}

function requireScore(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < SCORE_MIN || v > SCORE_MAX) {
    throw new OutputFormatError(`${name} は${SCORE_MIN}〜${SCORE_MAX}の数値にしてください`);
  }
  return Math.round(v);
}
