import { describe, expect, it } from 'vitest';
import { buildImagePrompt, parseAnswer, parseJudgeAnswer } from '../src/answer';
import { STYLE } from '../src/characters';

const ANSWER = {
  motif: 'フクロウ',
  reason: '夜通し考え続けるから',
  colors: ['テラコッタ', 'クリーム'],
  outfit: '小さなマント',
  prop: '開いた本',
  pose: '片手を挙げて主張する',
  expression: 'にこやか',
  personality: ['穏やか', '慎重', '粘り強い'],
  imagePrompt: 'a round owl holding an open book.',
};

describe('parseAnswer', () => {
  it('コードブロックや前後の文があっても JSON を取り出す', () => {
    const text = `はい、こちらです。\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\`\nよろしく。`;
    expect(parseAnswer(text)).toEqual(ANSWER);
  });

  it('余計な項目は落とす', () => {
    expect(parseAnswer(JSON.stringify({ ...ANSWER, extra: 1 }))).toEqual(ANSWER);
  });

  it('項目が欠けていたり型が違えば断る', () => {
    expect(() => parseAnswer(JSON.stringify({ ...ANSWER, prop: '' }))).toThrow('prop');
    expect(() => parseAnswer(JSON.stringify({ ...ANSWER, colors: 'オレンジ' }))).toThrow('colors');
    expect(() => parseAnswer('JSONなし')).toThrow('JSON がありません');
  });
});

describe('buildImagePrompt', () => {
  it('共通の画風の後に外見をつなぐ(末尾の句点は落とす)', () => {
    expect(buildImagePrompt(ANSWER)).toBe(`${STYLE}, a round owl holding an open book`);
  });
});

describe('parseJudgeAnswer', () => {
  const { prop: _prop, ...common } = ANSWER;
  const JUDGE = {
    ...common,
    props: { logic: '天秤', evidence: '虫めがね', exchange: '木づち' },
    propPrompts: { logic: 'a balance scale', evidence: 'a magnifying glass', exchange: 'a gavel' },
  };

  it('観点ごとの持ち物を読み、prop は求めない', () => {
    expect(parseJudgeAnswer(`答えです\n${JSON.stringify(JUDGE)}`)).toEqual(JUDGE);
  });

  it('観点の持ち物が欠けていればエラー', () => {
    expect(() => parseJudgeAnswer(JSON.stringify({ ...JUDGE, props: { logic: '天秤', evidence: '虫めがね' } }))).toThrow('props.exchange');
    expect(() => parseJudgeAnswer(JSON.stringify({ ...JUDGE, propPrompts: undefined }))).toThrow('propPrompts.logic');
  });
});
