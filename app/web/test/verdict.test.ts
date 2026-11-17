import { describe, expect, it } from 'vitest';
import type { Judgment, Message, SideJudgment } from '@agorawl/contract';
import { itemRows, judgeName, majorityText, splitItemRefs, verdictSummary } from '../src/verdict';

const POSITIONS = { pro: '虎派', con: '熊派' };
const side = (total: number, extra: Partial<SideJudgment> = {}): SideJudgment => ({
  scores: { logic: 5, evidence: 5, rebuttal: 5, response: 5 },
  total,
  reason: '理由',
  ...extra,
});
const judgment = (modelId: string, winner: Judgment['winner'], pro = side(20), con = side(20)): Judgment => ({
  modelId,
  pro,
  con,
  winner,
  createdAt: 't',
});

describe('splitItemRefs', () => {
  it('先攻・後攻を頭に付けたIDを取り出し、ほかは文字のまま残す', () => {
    expect(splitItemRefs('先攻C1は強いが、後攻R12[3]に答えていない。C2は触れない')).toEqual([
      { role: 'pro', id: 'C1', text: '先攻C1' },
      'は強いが、',
      { role: 'con', id: 'R12', text: '後攻R12' },
      '[3]に答えていない。C2は触れない',
    ]);
  });

  it('「・」でつないだ2つめ以降は、頭を省いても同じ側のIDとする', () => {
    expect(splitItemRefs('先攻R3・R9で')).toEqual([
      { role: 'pro', id: 'R3', text: '先攻R3' },
      '・',
      { role: 'pro', id: 'R9', text: 'R9' },
      'で',
    ]);
  });

  it('IDがなければ、文をそのまま返す', () => {
    expect(splitItemRefs('理由')).toEqual(['理由']);
  });
});

describe('judgeName', () => {
  it('番号と表示用のモデル名。知らないモデルIDはそのまま', () => {
    expect(judgeName(0, 'openai.gpt-oss-120b-1:0')).toBe('審判1(OpenAI gpt-oss-120b)');
    expect(judgeName(2, 'deepseek.v3.2')).toBe('審判3(DeepSeek V3.2)');
    expect(judgeName(1, 'example.unknown-model')).toBe('審判2(example.unknown-model)');
  });

  it('観点があれば、観点の名前も出す', () => {
    expect(judgeName(0, 'global.anthropic.claude-opus-4-6-v1', 'logic')).toBe('審判1 論理の審判(Claude Opus 4.6)');
    expect(judgeName(2, 'global.anthropic.claude-opus-4-6-v1', 'exchange')).toBe('審判3 反論・応答の審判(Claude Opus 4.6)');
  });
});

describe('majorityText', () => {
  it('多数決の勝者と、何人がその勝者を選んだか', () => {
    const v = { judgments: [judgment('a', 'draw'), judgment('b', 'con'), judgment('c', 'con')], winner: 'con' as const };
    expect(majorityText(v, POSITIONS)).toBe('熊派の勝ち(審判3人のうち2人)');
  });

  it('判定が分かれた引き分けと、過半数が引き分けを選んだ引き分けを分ける', () => {
    const split = { judgments: [judgment('a', 'pro'), judgment('b', 'con'), judgment('c', 'draw')], winner: 'draw' as const };
    expect(majorityText(split, POSITIONS)).toBe('引き分け(審判3人の判定が分かれた)');
    const draws = { judgments: [judgment('a', 'draw'), judgment('b', 'draw'), judgment('c', 'pro')], winner: 'draw' as const };
    expect(majorityText(draws, POSITIONS)).toBe('引き分け(審判3人のうち2人)');
  });

  it('多数決の勝者がない古い判定は、1人目の審判の勝者を出す', () => {
    expect(majorityText({ judgments: [judgment('a', 'pro')] }, POSITIONS)).toBe('虎派の勝ち');
    expect(majorityText({ judgments: [] }, POSITIONS)).toBe('');
  });
});

describe('itemRows', () => {
  const messages: Message[] = [
    {
      debateId: 'd',
      turn: 1,
      role: 'pro',
      modelId: 'm',
      content: '',
      createdAt: 't',
      notes: { claims: [{ id: 'C1', text: '古い主張', score: 9, status: 'defending' }], rebuttals: [] },
    },
    {
      debateId: 'd',
      turn: 3,
      role: 'pro',
      modelId: 'm',
      content: '',
      createdAt: 't',
      notes: {
        claims: [{ id: 'C1', text: '主張1', score: 7, status: 'abandoned' }],
        rebuttals: [
          { id: 'R1', target: '相手のC1', text: '反論1', score: 8, status: 'won' },
          { id: 'R2', target: '相手のC2', text: '最後に足した反論', score: 6, status: 'pursuing' },
        ],
      },
    },
  ];
  const judgments = [
    judgment('a', 'pro', side(20, { claims: [{ id: 'C1', score: 3 }], rebuttals: [{ id: 'R1', score: 9 }] })),
    judgment('b', 'pro', side(20, { claims: [{ id: 'C1', score: 6 }], rebuttals: [{ id: 'R1', score: 5 }] })),
  ];

  it('最後の作戦メモの項目ごとに、討論者の点数と審判ごとの点数を並べる。審判に渡していない項目は「-」', () => {
    expect(itemRows(messages, 'pro', judgments)).toEqual([
      { id: 'C1', kind: 'claim', text: '主張1', status: '捨てる', score: 7, judgeScores: [3, 6] },
      { id: 'R1', kind: 'rebuttal', text: '反論1', target: '相手のC1', status: '獲得', score: 8, judgeScores: [9, 5] },
      { id: 'R2', kind: 'rebuttal', text: '最後に足した反論', target: '相手のC2', status: '追及中', score: 6, judgeScores: ['-', '-'] },
    ]);
  });

  it('審判が項目ごとの点数を付けていない古い判定、作戦メモのない側は空', () => {
    expect(itemRows(messages, 'pro', [judgment('a', 'pro')])).toEqual([]);
    expect(itemRows(messages, 'con', judgments)).toEqual([]);
  });
});

describe('verdictSummary', () => {
  const SCORING = '両者を4項目(論理・根拠・反論・応答。各0〜10点、合計40点)で採点し';

  it('審判ごとの選び方と、多数決の勝者', () => {
    const v = { judgments: [judgment('a', 'con'), judgment('b', 'pro'), judgment('c', 'con')], winner: 'con' as const };
    expect(verdictSummary(v, POSITIONS)).toBe(
      `審判3人が、${SCORING}、それぞれ勝者を選びました。熊派を選んだのは2人(審判1・審判3)、虎派を選んだのは1人(審判2)です。過半数の審判が選んだ熊派の勝ちです。`,
    );
  });

  it('引き分けとした審判を足し、判定が分かれた引き分けと、過半数が引き分けとした引き分けを分ける', () => {
    const split = { judgments: [judgment('a', 'pro'), judgment('b', 'con'), judgment('c', 'draw')], winner: 'draw' as const };
    expect(verdictSummary(split, POSITIONS)).toBe(
      `審判3人が、${SCORING}、それぞれ勝者を選びました。虎派を選んだのは1人(審判1)、熊派を選んだのは1人(審判2)、引き分けとしたのは1人(審判3)です。過半数の審判が同じ側を選ばなかったため、引き分けです。`,
    );
    const draws = { judgments: [judgment('a', 'draw'), judgment('b', 'draw'), judgment('c', 'pro')], winner: 'draw' as const };
    expect(verdictSummary(draws, POSITIONS)).toMatch(/引き分けとしたのは2人\(審判1・審判2\)、虎派を選んだのは1人\(審判3\)です。過半数の審判が引き分けとしたため、引き分けです。$/);
  });

  it('すべての審判に観点があれば、審判ごとの観点を示す', () => {
    const vp = (j: Judgment, viewpoint: Judgment['viewpoint']): Judgment => ({ ...j, viewpoint });
    const v = {
      judgments: [vp(judgment('a', 'pro'), 'logic'), vp(judgment('a', 'pro'), 'evidence'), vp(judgment('a', 'con'), 'exchange')],
      winner: 'pro' as const,
    };
    expect(
      verdictSummary(v, POSITIONS).startsWith(`審判3人が、それぞれ別の観点(審判1は論理、審判2は根拠、審判3は反論・応答)から、${SCORING}、それぞれ勝者を選びました。`),
    ).toBe(true);
    // すべての審判が重みを持てば、観点の項目を2倍にして合計したことを書く
    const w = { logic: 1, evidence: 1, rebuttal: 1, response: 1 };
    const weighted = { ...v, judgments: v.judgments.map((j) => ({ ...j, weights: w })) };
    expect(
      verdictSummary(weighted, POSITIONS).startsWith(
        '審判3人が、それぞれ別の観点(審判1は論理、審判2は根拠、審判3は反論・応答)から、両者を4項目(論理・根拠・反論・応答。各0〜10点)で採点し、観点の項目の点を2倍にして合計し、それぞれ勝者を選びました。',
      ),
    ).toBe(true);
    // 観点のない審判がいれば、観点の文を出さない
    const mixed = { judgments: [vp(judgment('a', 'pro'), 'logic'), judgment('b', 'pro'), judgment('c', 'con')], winner: 'pro' as const };
    expect(verdictSummary(mixed, POSITIONS).startsWith(`審判3人が、${SCORING}、`)).toBe(true);
  });

  it('審判1人', () => {
    expect(verdictSummary({ judgments: [judgment('a', 'pro')], winner: 'pro' }, POSITIONS)).toBe(`審判1人が、${SCORING}、虎派を勝者に選びました。`);
    expect(verdictSummary({ judgments: [judgment('a', 'draw')] }, POSITIONS)).toBe(`審判1人が、${SCORING}、引き分けとしました。`);
  });

  it('多数決の勝者がない古い判定は、結論の文を出さない', () => {
    const v = { judgments: [judgment('a', 'pro'), judgment('b', 'con')] };
    expect(verdictSummary(v, POSITIONS)).toBe(`審判2人が、${SCORING}、それぞれ勝者を選びました。虎派を選んだのは1人(審判1)、熊派を選んだのは1人(審判2)です。`);
    expect(verdictSummary({ judgments: [] }, POSITIONS)).toBe('');
  });
});
