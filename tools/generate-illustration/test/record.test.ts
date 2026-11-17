import { describe, expect, it } from 'vitest';
import { buildRecord, type CandidateMeta } from '../src/record';

const cand = (number: number, prompt: string): CandidateMeta & { number: number } => ({
  number,
  file: `${number}.png`,
  seed: 100 + number,
  prompt,
  negativePrompt: 'text',
  modelId: 'stability.stable-image-core-v1:1',
  aspectRatio: '2:3',
  generatedAt: `2026-11-13T00:00:0${number}Z`,
});

const input = {
  character: { id: 'claude', name: 'Claude', askModelId: 'm' },
  adopted: 3,
  imagePath: '../../../app/web/public/characters/claude.png',
  backgroundRemovedBy: 'stability.stable-image-remove-background-v1:0',
  adoptedAt: '2026-11-13T01:00:00Z',
  answer: {
    question: '見た目は?',
    modelId: 'm',
    answeredAt: '2026-11-13T00:00:00Z',
    raw: '{"motif":"フクロウ"}',
    answer: {
      motif: 'フクロウ',
      reason: '賢い | から',
      colors: ['深緑', 'オレンジ'],
      outfit: 'ベスト',
      prop: '本',
      pose: '立つ',
      expression: '笑顔',
      personality: ['熱心'],
      imagePrompt: 'an owl',
    },
  },
  candidates: [cand(1, 'old'), cand(2, 'old'), cand(3, 'new')],
};

describe('buildRecord', () => {
  const md = buildRecord(input);

  it('採用した候補の指示とシードを書く', () => {
    expect(md).toContain('| 採用した候補 | 3 |');
    expect(md).toContain('| シード | 103 |');
    expect(md).toContain('![Claude](../../../app/web/public/characters/claude.png)');
  });

  it('答えを項目ごとに書き、表の区切りの | は逃がす', () => {
    expect(md).toContain('| 色(`colors`) | 深緑、オレンジ |');
    expect(md).toContain('賢い \| から');
    expect(md).toContain('{"motif":"フクロウ"}');
  });

  it('候補は使った指示ごとにまとめる', () => {
    expect(md).toContain('| 1 | 101 | 指示1 |');
    expect(md).toContain('| 3(採用) | 103 | 指示2 |');
    expect(md).toContain('指示2:\n\n```text\nnew\n```');
  });

  it('応答に ``` があれば、より長い囲みにする', () => {
    const raw = '```json\n{}\n```';
    expect(buildRecord({ ...input, answer: { ...input.answer, raw } })).toContain('````text\n```json\n{}\n```\n````');
  });

  it('採用した番号の候補がなければ断る', () => {
    expect(() => buildRecord({ ...input, adopted: 9 })).toThrow('9');
  });
});
