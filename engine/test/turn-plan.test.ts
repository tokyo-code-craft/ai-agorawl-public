import { describe, expect, it } from 'vitest';
import { isFirstExchangeTurn, isOpeningTurn, planTurn, remainingTurns, turnEnd } from '../src/turn-plan';

describe('planTurn', () => {
  it('N=6: 立論×2、攻防×4。最後は後攻', () => {
    const plans = [1, 2, 3, 4, 5, 6].map((t) => planTurn(t, 6));
    expect(plans).toEqual([
      { role: 'pro', stage: 'opening' },
      { role: 'con', stage: 'opening' },
      { role: 'pro', stage: 'exchange' },
      { role: 'con', stage: 'exchange' },
      { role: 'pro', stage: 'exchange' },
      { role: 'con', stage: 'exchange' },
    ]);
  });

  it('N=4(最小): 立論×2、攻防×2', () => {
    expect([1, 2, 3, 4].map((t) => planTurn(t, 4).stage)).toEqual(['opening', 'opening', 'exchange', 'exchange']);
  });

  it('先攻と後攻の攻める回数(攻防の回数)は同じ', () => {
    for (const n of [4, 6, 10, 30]) {
      const plans = Array.from({ length: n }, (_, i) => planTurn(i + 1, n));
      const exchanges = (r: string) => plans.filter((p) => p.role === r && p.stage === 'exchange').length;
      expect(exchanges('pro')).toBe(n / 2 - 1);
      expect(exchanges('con')).toBe(n / 2 - 1);
    }
  });

  it('先攻と後攻の発言回数は同じ', () => {
    for (const n of [4, 6, 10, 30]) {
      const roles = Array.from({ length: n }, (_, i) => planTurn(i + 1, n).role);
      expect(roles.filter((r) => r === 'pro').length).toBe(n / 2);
      expect(roles.filter((r) => r === 'con').length).toBe(n / 2);
    }
  });

  it('範囲外のターンはエラー', () => {
    expect(() => planTurn(0, 4)).toThrow();
    expect(() => planTurn(5, 4)).toThrow();
    expect(() => planTurn(1.5, 4)).toThrow();
  });
});

describe('turnEnd', () => {
  it('ターンNの発言で、最大ターン数として終える', () => {
    expect(turnEnd(10, 10, { role: 'con' })).toEqual({ finished: true, endReason: 'maxTurns', concededBy: null });
    expect(turnEnd(9, 10, { role: 'pro' })).toEqual({ finished: false, endReason: null, concededBy: null });
  });

  it('投了の発言で終え、投了した側を返す', () => {
    expect(turnEnd(5, 10, { role: 'pro', conceded: true, exhausted: false })).toEqual({
      finished: true,
      endReason: 'conceded',
      concededBy: 'pro',
    });
    // ターンNの投了も投了として扱う
    expect(turnEnd(10, 10, { role: 'con', conceded: true })).toEqual({
      finished: true,
      endReason: 'conceded',
      concededBy: 'con',
    });
  });

  it('引き分けになったターンの発言で終える', () => {
    expect(turnEnd(6, 10, { role: 'con', conceded: false, exhausted: true })).toEqual({
      finished: true,
      endReason: 'exhausted',
      concededBy: null,
    });
  });
});

describe('isOpeningTurn / isFirstExchangeTurn', () => {
  it('立論はターン1・2、自分の最初の攻防はターン3・4', () => {
    expect([1, 2, 3, 4, 5].map(isOpeningTurn)).toEqual([true, true, false, false, false]);
    expect([1, 2, 3, 4, 5].map(isFirstExchangeTurn)).toEqual([false, false, true, true, false]);
  });
});

describe('remainingTurns', () => {
  it('このターンを含めた残りの発言回数(N=10、各側5回)', () => {
    expect(remainingTurns(1, 10)).toBe(5);
    expect(remainingTurns(2, 10)).toBe(5);
    expect(remainingTurns(9, 10)).toBe(1);
    expect(remainingTurns(10, 10)).toBe(1);
    expect(remainingTurns(11, 10)).toBe(0);
  });
});
