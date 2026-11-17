import { describe, expect, it } from 'vitest';
import type { DebaterNotes } from '@agorawl/contract';
import { isExhausted, parseDebaterOutput, rebuttalStatus, mergeNotes, shouldConcede } from '../src/notes';

const notesJson = JSON.stringify({
  claims: [{ id: 'C1', text: '主張', score: 7.4, status: 'defending' }],
  rebuttals: [{ id: 'R1', target: '相手の主張', text: '反論', score: 8 }],
});

describe('parseDebaterOutput', () => {
  it('作戦メモと発言を取り出し、点数を丸め、反論の状態を付ける', () => {
    const r = parseDebaterOutput(`<notes>\n${notesJson}\n</notes>\n<speech>\n本文です\n</speech>`);
    expect(r.speech).toBe('本文です');
    expect(r.notes.claims[0]).toEqual({ id: 'C1', text: '主張', score: 7, status: 'defending' });
    expect(r.notes.rebuttals[0]?.status).toBe('won');
  });

  it('コードブロックの記号を取り除き、閉じタグのない本文も読む', () => {
    const r = parseDebaterOutput(`<notes>\n\`\`\`json\n${notesJson}\n\`\`\`\n</notes>\n<speech>本文`);
    expect(r.speech).toBe('本文');
  });

  it('形式の誤りは OutputFormatError', () => {
    const cases = [
      '本文だけ',
      `<notes>${notesJson}</notes>`,
      '<notes>{壊れたJSON</notes><speech>本文</speech>',
      '<notes>{"claims":[{"id":"C1","text":"x","score":11,"status":"defending"}],"rebuttals":[]}</notes><speech>本文</speech>',
      '<notes>{"claims":[{"id":"C1","text":"x","score":5,"status":"maybe"}],"rebuttals":[]}</notes><speech>本文</speech>',
    ];
    for (const c of cases) {
      expect(() => parseDebaterOutput(c)).toThrow(expect.objectContaining({ name: 'OutputFormatError' }));
    }
  });

  const previous: DebaterNotes = {
    claims: [{ id: 'C1', text: '前の主張', score: 7, status: 'defending' }],
    rebuttals: [{ id: 'R1', target: '前の対象', text: '前の反論', score: 5, status: 'pursuing' }],
  };

  it('前回にあるIDの項目は、省略した欄を前回の値で補い、反論の状態は点数から付け直す', () => {
    const out = '<notes>{"claims":[{"id":"C1","status":"abandoned"}],"rebuttals":[{"id":"R1","score":9}]}</notes><speech>本文</speech>';
    const r = parseDebaterOutput(out, previous);
    expect(r.notes.claims[0]).toEqual({ id: 'C1', text: '前の主張', score: 7, status: 'abandoned' });
    expect(r.notes.rebuttals[0]).toEqual({ id: 'R1', target: '前の対象', text: '前の反論', score: 9, status: 'won' });
  });

  it('新しいIDの項目は、欄を省略すると OutputFormatError', () => {
    const out = '<notes>{"claims":[{"id":"C2","score":5}],"rebuttals":[]}</notes><speech>本文</speech>';
    expect(() => parseDebaterOutput(out, previous)).toThrow(expect.objectContaining({ name: 'OutputFormatError' }));
  });

  it('前回にあるIDでも、書いた欄が不正なら OutputFormatError', () => {
    const out = '<notes>{"claims":[{"id":"C1","text":""}],"rebuttals":[]}</notes><speech>本文</speech>';
    expect(() => parseDebaterOutput(out, previous)).toThrow(expect.objectContaining({ name: 'OutputFormatError' }));
  });
});

describe('mergeNotes', () => {
  const claim = (id: string, status: 'defending' | 'abandoned') => ({ id, text: id, score: 5, status });
  const rebuttal = (id: string, score: number) => ({
    id,
    target: 't',
    text: id,
    score,
    status: rebuttalStatus(score),
  });

  it('同じIDは前回の位置で置き換え、新しい項目は末尾に足し、出力にない項目は引き継ぐ', () => {
    const previous: DebaterNotes = {
      claims: [claim('C1', 'defending'), claim('C2', 'defending')],
      rebuttals: [rebuttal('R1', 2), rebuttal('R2', 6), rebuttal('R3', 5)],
    };
    const output: DebaterNotes = {
      claims: [claim('C2', 'abandoned')],
      rebuttals: [rebuttal('R4', 6), rebuttal('R2', 8)],
    };
    const r = mergeNotes(output, previous);
    expect(r.claims.map((c) => [c.id, c.status])).toEqual([
      ['C1', 'defending'],
      ['C2', 'abandoned'],
    ]);
    expect(r.rebuttals.map((x) => [x.id, x.score, x.status])).toEqual([
      ['R1', 2, 'dropped'],
      ['R2', 8, 'won'],
      ['R3', 5, 'pursuing'],
      ['R4', 6, 'pursuing'],
    ]);
  });

  it('変えた項目がなければ前回の作戦メモのまま', () => {
    const previous: DebaterNotes = { claims: [claim('C1', 'defending')], rebuttals: [rebuttal('R1', 5)] };
    expect(mergeNotes({ claims: [], rebuttals: [] }, previous)).toEqual(previous);
  });

  it('前回の作戦メモがなければ出力のまま。主張が1件もなければ形式の誤り', () => {
    const output: DebaterNotes = { claims: [claim('C1', 'defending')], rebuttals: [] };
    expect(mergeNotes(output, undefined)).toEqual(output);
    expect(() => mergeNotes({ claims: [], rebuttals: [] }, undefined)).toThrow(expect.objectContaining({ name: 'OutputFormatError' }));
  });
});

describe('rebuttalStatus', () => {
  it('8以上は獲得、3以下は断念、その間は追及中', () => {
    expect([0, 3, 4, 7, 8, 10].map(rebuttalStatus)).toEqual([
      'dropped',
      'dropped',
      'pursuing',
      'pursuing',
      'won',
      'won',
    ]);
  });
});

describe('投了・引き分けの判定', () => {
  const notes = (claims: boolean[], rebuttals: number[]): DebaterNotes => ({
    claims: claims.map((defending, i) => ({
      id: `C${i + 1}`,
      text: 'x',
      score: 5,
      status: defending ? 'defending' : 'abandoned',
    })),
    rebuttals: rebuttals.map((score, i) => ({
      id: `R${i + 1}`,
      target: 'y',
      text: 'z',
      score,
      status: rebuttalStatus(score),
    })),
  });

  it('守っている主張が1件もなければ投了。反論の状態は関係ない', () => {
    expect(shouldConcede(notes([false, false], [6]))).toBe(true);
    expect(shouldConcede(notes([false, true], [1, 2]))).toBe(false);
    expect(shouldConcede(notes([true], []))).toBe(false);
  });

  it('両者とも追及中の反論がなければ引き分け', () => {
    const noAttack = notes([true], [2, 9]); // 断念と獲得のみ
    const attacking = notes([true], [5]);
    expect(isExhausted(noAttack, noAttack)).toBe(true);
    expect(isExhausted(noAttack, attacking)).toBe(false);
    expect(isExhausted(attacking, noAttack)).toBe(false);
    expect(isExhausted(noAttack, undefined)).toBe(false);
  });
});
