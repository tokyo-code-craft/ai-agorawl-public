import { describe, expect, it } from 'vitest';
import type { Message } from '@agorawl/contract';
import { finalClaims, finalRebuttals, majorityWinner, parseJudgeOutput } from '../src/judging';

const side = (logic: number, evidence: number, rebuttal: number, response: number) => ({
  scores: { logic, evidence, rebuttal, response },
  reason: '理由',
});

const NONE = { pro: [], con: [] };
const NO_CLAIMS = { claims: NONE, rebuttals: NONE };

describe('parseJudgeOutput', () => {
  it('合計を計算し、合計の高い側を勝者にする', () => {
    const j = parseJudgeOutput(JSON.stringify({ pro: side(7, 6, 8, 7), con: side(6, 7, 6, 5) }), 'm', 't', NO_CLAIMS);
    expect(j.pro.total).toBe(28);
    expect(j.con.total).toBe(24);
    expect(j.winner).toBe('pro');
    expect(j.modelId).toBe('m');
  });

  it('観点があれば、観点の基準の点を2倍にして合計し、観点と重みを残す。重みで勝者が変わりうる', () => {
    const out = JSON.stringify({ pro: side(8, 4, 8, 8), con: side(6, 9, 6, 6) });
    expect(parseJudgeOutput(out, 'm', 't', NO_CLAIMS).winner).toBe('pro'); // 28 対 27
    const ev = parseJudgeOutput(out, 'm', 't', NO_CLAIMS, 'evidence');
    expect(ev.pro.total).toBe(32);
    expect(ev.con.total).toBe(36);
    expect(ev.winner).toBe('con');
    expect(ev.viewpoint).toBe('evidence');
    expect(ev.weights).toEqual({ logic: 1, evidence: 2, rebuttal: 1, response: 1 });
    const ex = parseJudgeOutput(out, 'm', 't', NO_CLAIMS, 'exchange');
    expect(ex.weights).toEqual({ logic: 1, evidence: 1, rebuttal: 2, response: 2 });
    expect(ex.pro.total).toBe(44);
    // 観点がなければ、観点と重みを持たない
    const none = parseJudgeOutput(out, 'm', 't', NO_CLAIMS);
    expect(none).not.toHaveProperty('viewpoint');
    expect(none).not.toHaveProperty('weights');
  });

  it('同点は引き分け。前置きやコードブロックの記号があっても読み、点数は丸める', () => {
    const json = JSON.stringify({ pro: side(5, 5, 5, 5.4), con: side(5, 5, 5, 5) });
    const j = parseJudgeOutput(`採点結果です。\n\`\`\`json\n${json}\n\`\`\``, 'm', 't', NO_CLAIMS);
    expect(j.pro.scores.response).toBe(5);
    expect(j.winner).toBe('draw');
  });

  it('形式の誤りは OutputFormatError', () => {
    const cases = [
      'JSONなし',
      '{壊れた',
      JSON.stringify({ pro: side(5, 5, 5, 5) }),
      JSON.stringify({ pro: side(5, 5, 5, 11), con: side(5, 5, 5, 5) }),
      JSON.stringify({ pro: { scores: { logic: 5 }, reason: 'x' }, con: side(5, 5, 5, 5) }),
      JSON.stringify({ pro: { ...side(5, 5, 5, 5), reason: '' }, con: side(5, 5, 5, 5) }),
    ];
    for (const c of cases) {
      expect(() => parseJudgeOutput(c, 'm', 't', NO_CLAIMS)).toThrow(expect.objectContaining({ name: 'OutputFormatError' }));
    }
  });

  describe('主張ごとの点数', () => {
    const ids = { claims: { pro: ['C1', 'C2'], con: ['C1'] }, rebuttals: NONE };
    const base = { pro: side(7, 6, 8, 7), con: side(6, 7, 6, 5) };

    it('渡した主張の順に点数を取り出し、丸める。渡していないIDは無視し、同じIDは最初のものを使う', () => {
      const claims = {
        pro: [
          { id: 'C2', score: 2.6 },
          { id: 'C1', score: 8 },
          { id: 'C9', score: 5 },
          { id: 'C1', score: 1 },
        ],
        con: [{ id: 'C1', score: 4 }],
      };
      const j = parseJudgeOutput(JSON.stringify({ claims, ...base }), 'm', 't', ids);
      expect(j.pro.claims).toEqual([
        { id: 'C1', score: 8 },
        { id: 'C2', score: 3 },
      ]);
      expect(j.con.claims).toEqual([{ id: 'C1', score: 4 }]);
      // 主張の点数は合計に入れない
      expect(j.pro.total).toBe(28);
    });

    it('主張がない側は空の配列。claims がなくても、渡した主張がなければ読める', () => {
      const j = parseJudgeOutput(JSON.stringify(base), 'm', 't', NO_CLAIMS);
      expect(j.pro.claims).toEqual([]);
      expect(j.con.claims).toEqual([]);
    });

    it('渡した主張の点数が欠けている、または範囲外なら OutputFormatError', () => {
      const cases = [
        { ...base },
        { claims: { pro: [{ id: 'C1', score: 8 }], con: [{ id: 'C1', score: 4 }] }, ...base },
        { claims: { pro: [{ id: 'C1', score: 8 }, { id: 'C2', score: 11 }], con: [{ id: 'C1', score: 4 }] }, ...base },
        { claims: { pro: [{ id: 'C1', score: 8 }, { id: 'C2', score: 5 }], con: 'C1' }, ...base },
      ];
      for (const c of cases) {
        expect(() => parseJudgeOutput(JSON.stringify(c), 'm', 't', ids)).toThrow(
          expect.objectContaining({ name: 'OutputFormatError' }),
        );
      }
    });
  });

  describe('反論ごとの点数', () => {
    const ids = { claims: NONE, rebuttals: { pro: ['R1', 'R2'], con: ['R1'] } };
    const base = { pro: side(7, 6, 8, 7), con: side(6, 7, 6, 5) };

    it('渡した反論の順に点数を取り出す。合計には入れない', () => {
      const rebuttals = { pro: [{ id: 'R2', score: 2 }, { id: 'R1', score: 8.6 }], con: [{ id: 'R1', score: 5 }] };
      const j = parseJudgeOutput(JSON.stringify({ rebuttals, ...base }), 'm', 't', ids);
      expect(j.pro.rebuttals).toEqual([
        { id: 'R1', score: 9 },
        { id: 'R2', score: 2 },
      ]);
      expect(j.con.rebuttals).toEqual([{ id: 'R1', score: 5 }]);
      expect(j.pro.total).toBe(28);
    });

    it('IDの頭の「先攻」「後攻」は取り除いて照らし合わせる(付いていなくてもよい)', () => {
      const rebuttals = { pro: [{ id: '先攻R1', score: 8 }, { id: 'R2', score: 2 }], con: [{ id: '後攻 R1', score: 5 }] };
      const j = parseJudgeOutput(JSON.stringify({ rebuttals, ...base }), 'm', 't', ids);
      expect(j.pro.rebuttals).toEqual([
        { id: 'R1', score: 8 },
        { id: 'R2', score: 2 },
      ]);
      expect(j.con.rebuttals).toEqual([{ id: 'R1', score: 5 }]);
    });

    it('渡した反論の点数が欠けていれば OutputFormatError', () => {
      const rebuttals = { pro: [{ id: 'R1', score: 8 }], con: [{ id: 'R1', score: 5 }] };
      expect(() => parseJudgeOutput(JSON.stringify({ rebuttals, ...base }), 'm', 't', ids)).toThrow(
        expect.objectContaining({ name: 'OutputFormatError' }),
      );
    });
  });
});

describe('majorityWinner', () => {
  const w = (...winners: ('pro' | 'con' | 'draw')[]) => majorityWinner(winners.map((winner) => ({ winner })));

  it('過半数の審判が選んだ勝者にする', () => {
    expect(w('pro', 'pro', 'con')).toBe('pro');
    expect(w('con', 'draw', 'con')).toBe('con');
    expect(w('draw', 'draw', 'pro')).toBe('draw');
    expect(w('pro')).toBe('pro');
  });

  it('過半数がなければ引き分け', () => {
    expect(w('pro', 'con', 'draw')).toBe('draw');
    expect(w('pro', 'con')).toBe('draw');
  });
});

describe('finalClaims', () => {
  const message = (turn: number, role: Message['role'], ids?: string[]): Message => ({
    debateId: 'd',
    turn,
    role,
    modelId: 'm',
    content: '本文',
    createdAt: 't',
    ...(ids
      ? {
          notes: {
            claims: ids.map((id) => ({ id, text: `内容${id}`, score: 7, status: 'abandoned' as const })),
            rebuttals: [],
          },
        }
      : {}),
  });

  it('その側の最後の発言の作戦メモから、IDと内容だけを返す(点数と状態は渡さない)', () => {
    const messages = [message(3, 'pro', ['C1', 'C2']), message(1, 'pro', ['C1']), message(4, 'con', ['C1'])];
    expect(finalClaims(messages, 'pro')).toEqual([
      { id: 'C1', text: '内容C1' },
      { id: 'C2', text: '内容C2' },
    ]);
    expect(finalClaims(messages, 'con')).toEqual([{ id: 'C1', text: '内容C1' }]);
    expect(finalClaims([message(1, 'pro')], 'con')).toEqual([]);
  });
});

describe('finalRebuttals', () => {
  const r = (id: string) => ({ id, target: `対象${id}`, text: `内容${id}`, score: 6, status: 'pursuing' as const });
  const message = (turn: number, role: Message['role'], ids: string[]): Message => ({
    debateId: 'd',
    turn,
    role,
    modelId: 'm',
    content: '本文',
    createdAt: 't',
    notes: { claims: [], rebuttals: ids.map(r) },
  });
  const messages = [
    message(3, 'pro', ['R1']),
    message(4, 'con', ['R1']),
    message(5, 'pro', ['R1', 'R2']),
    message(6, 'con', ['R1', 'R2', 'R3']),
  ];

  it('その側の最後の作戦メモから、IDと対象と内容だけを返す(点数と状態は渡さない)', () => {
    expect(finalRebuttals(messages, 'pro')).toEqual([
      { id: 'R1', target: '対象R1', text: '内容R1' },
      { id: 'R2', target: '対象R2', text: '内容R2' },
    ]);
  });

  it('議論の最後の発言で初めて足した反論(答える機会のない反論)は除く', () => {
    // 後攻のターン6が議論の最後。R2・R3 はターン4の作戦メモにない
    expect(finalRebuttals(messages, 'con').map((x) => x.id)).toEqual(['R1']);
    // ターン6がなければ、後攻の最後はターン4で、議論の最後の発言ではない(先攻のターン5がある)
    expect(finalRebuttals(messages.slice(0, 3), 'con').map((x) => x.id)).toEqual(['R1']);
    // 作戦メモが1つしかない側が議論の最後に発言した場合は、すべて新しい反論
    expect(finalRebuttals([message(4, 'con', ['R1'])], 'con')).toEqual([]);
    expect(finalRebuttals([], 'pro')).toEqual([]);
  });
});
