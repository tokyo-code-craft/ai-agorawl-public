import { describe, expect, it } from 'vitest';
import { sectionLengths, textOf, type ConverseResult } from '../src/converse-output';
import { OutputFormatError } from '../src/errors';

const response = (stopReason: ConverseResult['stopReason'], texts: string[]): ConverseResult => ({
  stopReason,
  output: { message: { role: 'assistant', content: texts.map((text) => ({ text })) } },
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
});

describe('textOf', () => {
  it('text のブロックをつないで、前後の空白を除いて返す', () => {
    expect(textOf(response('end_turn', ['  <speech>前半', '後半</speech> ']), 'm')).toBe('<speech>前半後半</speech>');
  });

  it('最大トークン数で切れていたら OutputFormatError(再試行で生成し直す)', () => {
    const cut = response('max_tokens', ['<notes>{}</notes><speech>労働基準法では『健康']);
    expect(() => textOf(cut, 'm')).toThrow(OutputFormatError);
    expect(() => textOf(cut, 'm')).toThrow('応答が最大トークン数で切れました: m');
  });

  it('タグがそろっていても、最大トークン数で切れていれば OutputFormatError', () => {
    const cut = response('max_tokens', ['<notes>{}</notes><speech>本文</speech>']);
    expect(() => textOf(cut, 'm')).toThrow(OutputFormatError);
  });

  it('閉じタグがなくても、上限に達していなければ本文として返す(書き忘れの救済は残す)', () => {
    expect(textOf(response('end_turn', ['<speech>本文']), 'm')).toBe('<speech>本文');
  });

  it('本文がなければエラー(形式の誤りではない)', () => {
    const empty = response('end_turn', []);
    expect(() => textOf(empty, 'm')).toThrow('モデルの応答に本文がありません: m');
    expect(() => textOf(empty, 'm')).not.toThrow(OutputFormatError);
  });
});

describe('sectionLengths', () => {
  it('作戦メモと発言の中身の字数を数える(改行を含む中身、前後の空白は除く)', () => {
    const text = '<notes>\n{\n"b":1}\n</notes>\n<speech>\n本文です\n</speech>';
    expect(sectionLengths(text)).toEqual({ notes: 8, speech: 4, total: text.length });
  });

  it('切れた出力は、閉じタグがなければ次のタグか末尾まで数える', () => {
    expect(sectionLengths('<notes>{"x"}<speech>本文の途中')).toEqual({ notes: 5, speech: 5, total: 25 });
  });

  it('どのタグもなければ undefined', () => {
    expect(sectionLengths('総括の本文')).toBeUndefined();
  });
});
