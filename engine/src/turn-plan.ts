// ターン番号から話者と段階を決める。仕様: docs/03-engine/README.md「ターンと段階・話者の対応」
import type { DebaterRole, EndReason, Message } from '@agorawl/contract';

/** 生成前に決まる段階。投了(concession)は生成後の判定で決まる */
export type Stage = 'opening' | 'exchange';

export const STAGE_LABELS: Record<Stage | 'concession', string> = {
  opening: '立論',
  exchange: '攻防',
  concession: '投了',
};

/** 立論のターン数(ターン1が先攻、ターン2が後攻)。立論では相手の発言と資料を見せない */
export const OPENING_TURNS = 2;

/** 立論のターンか */
export function isOpeningTurn(turn: number): boolean {
  return turn <= OPENING_TURNS;
}

/** 自分の最初の攻防のターンか(ターン3が先攻、ターン4が後攻) */
export function isFirstExchangeTurn(turn: number): boolean {
  return turn > OPENING_TURNS && turn <= OPENING_TURNS + 2;
}

export interface TurnPlan {
  role: DebaterRole;
  stage: Stage;
}

export function planTurn(turn: number, maxTurns: number): TurnPlan {
  if (!Number.isInteger(turn) || turn < 1 || turn > maxTurns) {
    throw new Error(`turn が範囲外です: turn=${turn}, maxTurns=${maxTurns}`);
  }
  // 先攻と後攻が交互に発言し、常に先攻が先(奇数ターンが先攻)
  const role: DebaterRole = turn % 2 === 1 ? 'pro' : 'con';
  return { role, stage: isOpeningTurn(turn) ? 'opening' : 'exchange' };
}

export interface TurnEnd {
  /** このターンの発言で議論を終えたら true */
  finished: boolean;
  endReason: EndReason | null;
  concededBy: DebaterRole | null;
}

/** 保存したターンの発言から、議論を終えるかを決める。投了・引き分けの発言、またはターンNで終える */
export function turnEnd(turn: number, maxTurns: number, message: Pick<Message, 'role' | 'conceded' | 'exhausted'>): TurnEnd {
  const endReason: EndReason | null = message.conceded
    ? 'conceded'
    : message.exhausted
      ? 'exhausted'
      : turn >= maxTurns
        ? 'maxTurns'
        : null;
  return { finished: endReason !== null, endReason, concededBy: message.conceded ? message.role : null };
}

/** このターンを含めた、その発言者の残りの発言回数(ターン N まで) */
export function remainingTurns(turn: number, maxTurns: number): number {
  if (turn > maxTurns) return 0;
  return Math.floor((maxTurns - turn) / 2) + 1;
}
