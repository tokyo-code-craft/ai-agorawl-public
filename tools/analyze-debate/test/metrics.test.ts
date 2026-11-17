import { describe, expect, it } from 'vitest';
import type { Claim, Debate, Message } from '@agorawl/contract';
import { debateMetrics, sideMetrics } from '../src/metrics';
import { formatReport } from '../src/format';

const claim = (id: string, score: number, text = `主張${id}`, status: Claim['status'] = 'defending'): Claim => ({
  id,
  text,
  score,
  status,
});

const message = (turn: number, role: Message['role'], claims?: Claim[]): Message => ({
  debateId: 'd1',
  turn,
  role,
  modelId: 'm',
  content: '本文',
  createdAt: '2026-11-11T00:00:00.000Z',
  ...(claims ? { notes: { claims, rebuttals: [] } } : {}),
});

const messages: Message[] = [
  message(1, 'pro', [claim('C1', 7), claim('C2', 6)]),
  message(2, 'con', [claim('C1', 8)]),
  message(3, 'pro', [claim('C1', 8), claim('C2', 5), claim('C3', 7, '相手の『…』という主張は誤りで、…')]),
  message(4, 'con', [claim('C1', 8), claim('C2', 9, '週休2日制は…')]),
  message(5, 'pro', [claim('C1', 8), claim('C2', 2, '主張C2', 'abandoned'), claim('C3', 7), claim('C4', 6, '相手は…')]),
  // 司会を廃止する前に保存した議論には、司会の総括の発言が残っている。分析では数えない
  message(6, 'moderator' as unknown as Message['role']),
];

describe('sideMetrics', () => {
  it('主張の件数、途中で足した主張、「相手」を含む主張を数える', () => {
    const m = sideMetrics('pro', messages)!;
    expect(m.turns).toBe(3);
    expect(m.openingClaims).toBe(2);
    expect(m.addedClaimIds).toEqual(['C3', 'C4']);
    // C3 は最終の内容では「相手」を含まないが、C4 は含む(最終の一覧で判定する)
    expect(m.addedClaimsMentioningOpponent).toEqual(['C4']);
    expect(m.finalClaims).toBe(4);
  });

  it('点数の変化を、前回の自分の作戦メモと同じIDの主張どうしで数える', () => {
    // ターン3: C1 7→8(上げた)、C2 6→5(下げた)。ターン5: C1 8→8(同じ)、C2 5→2(下げた)、C3 7→7(同じ)
    expect(sideMetrics('pro', messages)!.scoreChanges).toEqual({ up: 1, down: 2, same: 2 });
    expect(sideMetrics('con', messages)!.scoreChanges).toEqual({ up: 0, down: 0, same: 1 });
  });

  it('最終の点数の分布、捨てた主張、守っている主張の推移を出す', () => {
    const m = sideMetrics('pro', messages)!;
    expect(m.finalScoreDistribution).toEqual({ 8: 1, 2: 1, 7: 1, 6: 1 });
    expect(m.abandonedClaims).toBe(1);
    expect(m.defendingByTurn).toEqual([
      { turn: 1, defending: 2 },
      { turn: 3, defending: 3 },
      { turn: 5, defending: 3 },
    ]);
  });

  it('主張を新しく捨てた発言と、撤回の言葉を含むかを出す。投了の発言は数えない', () => {
    // ターン5で、ターン3では守っていた C2 を捨てた。発言は「本文」なので撤回を述べていない
    expect(sideMetrics('pro', messages)!.withdrawals).toEqual([{ turn: 5, claimIds: ['C2'], declared: false }]);

    const declared = messages.map((m) => (m.turn === 5 ? { ...m, content: '先ほどの主張は撤回します。' } : m));
    expect(sideMetrics('pro', declared)!.withdrawals).toEqual([{ turn: 5, claimIds: ['C2'], declared: true }]);

    const conceded = messages.map((m) => (m.turn === 5 ? { ...m, conceded: true } : m));
    expect(sideMetrics('pro', conceded)!.withdrawals).toEqual([]);
  });

  it('攻防の発言(立論と投了を除く)の字数、相手の発言の引用、並べる形を数える', () => {
    const contents: Record<number, string> = {
      1: '立論は数えない。第一に、相手は『x』と述べる。',
      3: '相手は『a』と述べるが、相手が「b」とする点も誤りだ。', // 26字、引用2回、並べない
      5: 'まず、論点を絞る。', // 9字、引用0回、並べる
    };
    const shaped = messages.map((m) => (contents[m.turn] ? { ...m, content: contents[m.turn]! } : m));
    expect(sideMetrics('pro', shaped)!.speech).toEqual({
      count: 2,
      avgLength: (contents[3]!.length + contents[5]!.length) / 2,
      avgOpponentQuotes: 1,
      enumeratedShare: 0.5,
      // テストの作戦メモには反論がない
      avgMovedRebuttals: 0,
    });
    // 投了の発言は数えない
    const conceded = shaped.map((m) => (m.turn === 5 ? { ...m, conceded: true } : m));
    expect(sideMetrics('pro', conceded)!.speech?.count).toBe(1);
  });

  it('1回の発言で動かした反論(追加、または変わった反論)の数の平均を出す', () => {
    const r = (id: string, score: number) => ({ id, target: '対象', text: `反論${id}`, score, status: 'pursuing' as const });
    const withRebuttals = messages.map((m) => {
      if (m.role !== 'pro' || !m.notes) return m;
      const rebuttals = m.turn === 1 ? [] : m.turn === 3 ? [r('R1', 5), r('R2', 6)] : [r('R1', 5), r('R2', 4), r('R3', 6)];
      return { ...m, notes: { ...m.notes, rebuttals } };
    });
    // ターン3: R1・R2 を追加(2件)。ターン5: R2 の点数を変え、R3 を追加(2件)。R1 は変わっていない
    expect(sideMetrics('pro', withRebuttals)!.speech?.avgMovedRebuttals).toBe(2);
  });

  it('作戦メモを持つ発言がなければ undefined', () => {
    expect(sideMetrics('con', [message(1, 'pro', [claim('C1', 7)])])).toBeUndefined();
  });
});

describe('debateMetrics と formatReport', () => {
  const debate: Debate = {
    debateId: 'd1',
    ownerId: 'u',
    theme: '週休は何日がよいか',
    positions: { pro: '週休3日制', con: '週休2日制' },
    status: 'done',
    participants: [],
    maxTurns: 5,
    createdAt: '2026-11-11T00:00:00.000Z',
    listKey: 'ALL',
    endReason: 'maxTurns',
    verdict: {
      judgments: [
        {
          modelId: 'j',
          pro: { scores: { logic: 7, evidence: 6, rebuttal: 7, response: 8 }, total: 28, reason: '…' },
          con: { scores: { logic: 6, evidence: 6, rebuttal: 6, response: 7 }, total: 25, reason: '…' },
          winner: 'pro',
          createdAt: '2026-11-11T00:00:00.000Z',
        },
      ],
    },
  };

  it('発言をターン順に並べ直して数え、2件の議論を横に並べて表示する', () => {
    const m = debateMetrics(debate, [...messages].reverse());
    expect(m.turns).toBe(6);
    expect(m.sides.pro?.openingClaims).toBe(2);

    const report = formatReport([m, m]);
    expect(report).toContain('|  | 議論1 | 議論2 |');
    expect(report).toContain('|  | 議論1 先攻 | 議論1 後攻 | 議論2 先攻 | 議論2 後攻 |');
    expect(report).toContain('先攻の勝ち: 先攻28(logic 7、evidence 6、rebuttal 7、response 8)');
    expect(report).toContain('| うち「相手」を含む | 1(C4) | 0 | 1(C4) | 0 |');
    expect(report).toContain('| 守っている主張の推移 | 2 3 3 | 1 2 | 2 3 3 | 1 2 |');
    // 審判が主張ごとの点数を付けていない議論は「-」
    expect(report).toContain('| 見込みと審判の差(平均) | - | - | - | - |');
  });

  it('審判の主張ごとの点数があれば、最終の見込みと同じIDで比べる', () => {
    // 先攻の最終: C1 8(守る)、C2 2(捨てる)、C3 7(守る)、C4 6(守る)
    const judged = structuredClone(debate);
    judged.verdict!.judgments[0]!.pro.claims = [
      { id: 'C1', score: 9 },
      { id: 'C2', score: 2 },
      { id: 'C3', score: 3 },
      { id: 'C4', score: 6 },
    ];
    const m = debateMetrics(judged, messages);
    // 差: C1 −1、C2 0、C3 +4、C4 0
    expect(m.sides.pro?.calibration).toEqual({
      compared: 4,
      meanAbsDiff: 1.25,
      over: 1,
      under: 1,
      same: 2,
      // C3 は審判が3点と見たのに守っていた。C2 は捨てていたので数えない
      judgedWeakButDefended: 1,
    });
    expect(m.sides.con?.calibration).toBeUndefined();

    const report = formatReport([m]);
    expect(report).toContain('| 見込みと審判の差(平均) | 1.3 | - |');
    expect(report).toContain('| 見込みが審判より 高い / 低い / 同じ | 1 / 1 / 2 | - |');
    expect(report).toContain('| 審判が3点以下と見て、守っていた主張 | 1 | - |');
  });
});
