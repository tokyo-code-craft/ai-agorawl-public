import { describe, expect, it } from 'vitest';
import { validateDebateSettings, type Participant, type Positions } from '@agorawl/contract';

const participants: Participant[] = [
  { role: 'pro', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
  { role: 'con', modelId: 'jp.amazon.nova-2-lite-v1:0' },
];
const positions: Positions = { pro: '週休3日制', con: '週休2日制' };
const base = { theme: 'テーマ', positions, maxTurns: 4, participants };

describe('validateDebateSettings', () => {
  it('妥当な設定はエラーなし', () => {
    expect(validateDebateSettings({ ...base, theme: 'テーマ', maxTurns: 10 })).toEqual([]);
  });

  it('maxTurns は4〜50の偶数のみ', () => {
    for (const ok of [4, 6, 10, 30, 50]) {
      expect(validateDebateSettings({ ...base, maxTurns: ok })).toEqual([]);
    }
    for (const ng of [2, 3, 5, 11, 31, 51, 52, 6.5]) {
      expect(validateDebateSettings({ ...base, maxTurns: ng })).toHaveLength(1);
    }
  });

  it('テーマは空白を除いて3〜200文字。絵文字は1文字と数える', () => {
    expect(validateDebateSettings({ ...base, theme: ' あいう ' })).toEqual([]);
    expect(validateDebateSettings({ ...base, theme: 'あい' })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, theme: '🍄'.repeat(200) })).toEqual([]);
    expect(validateDebateSettings({ ...base, theme: '🍄'.repeat(201) })).toHaveLength(1);
  });

  it('テーマと立場に、改行・タブ・目に見えない文字は使えない。絵文字をつなぐゼロ幅接合子は使える', () => {
    expect(validateDebateSettings({ ...base, theme: '虎と熊\nどちらが強いか' })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, theme: '虎と熊\tどちらが強いか' })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, theme: '虎と\u200b熊' })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, positions: { pro: '虎\u2028派', con: '熊派' } })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, positions: { pro: '虎派', con: '熊\ufeff派' } })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, theme: '👨\u200d👩\u200d👧はどうか' })).toEqual([]);
  });

  it('先攻と後攻の立場は、全角と半角・大文字と小文字・空白の違いだけなら同じとみなす', () => {
    expect(validateDebateSettings({ ...base, positions: { pro: 'Ａ派', con: 'A派' } })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, positions: { pro: 'a派', con: 'A派' } })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, positions: { pro: 'A 派', con: 'A派' } })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, positions: { pro: 'A派', con: 'B派' } })).toEqual([]);
  });

  it('テーマは空白を除いて3〜200文字', () => {
    expect(validateDebateSettings({ ...base, theme: '   ' })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, theme: 'あ'.repeat(201) })).toHaveLength(1);
  });

  it('立場の名前は先攻・後攻とも空白を除いて1〜50文字', () => {
    expect(validateDebateSettings({ ...base, positions: { pro: 'あ'.repeat(50), con: 'い' } })).toEqual([]);
    expect(validateDebateSettings({ ...base, positions: { pro: '  ', con: '週休2日制' } })).toHaveLength(1);
    expect(validateDebateSettings({ ...base, positions: { pro: '週休3日制', con: 'あ'.repeat(51) } })).toHaveLength(1);
  });

  it('立場の名前がないとエラー', () => {
    const missing = { ...base, positions: undefined as unknown as Positions };
    expect(validateDebateSettings(missing)).toHaveLength(2);
  });

  it('先攻と後攻の立場は異なる文にする(前後の空白は無視する)', () => {
    expect(validateDebateSettings({ ...base, positions: { pro: '週休3日制', con: ' 週休3日制 ' } })).toHaveLength(1);
  });

  it('先攻と後攻が同じモデルでもよい', () => {
    const same = participants.map((p) => (p.role === 'con' ? { ...p, modelId: participants[0]!.modelId } : p));
    expect(validateDebateSettings({ ...base, participants: same })).toEqual([]);
  });

  it('審判は先攻・後攻と同じモデルでもよい', () => {
    const judges = [{ modelId: 'openai.gpt-oss-120b-1:0' }];
    expect(validateDebateSettings({ ...base, judges })).toEqual([]);
    const same = [{ modelId: participants[0]!.modelId }];
    expect(validateDebateSettings({ ...base, judges: same })).toEqual([]);
  });

  it('審判の観点は logic / evidence / exchange のいずれか。省略してもよい', () => {
    const ok = [
      { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'logic' as const },
      { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'evidence' as const },
      { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'exchange' as const },
      { modelId: 'global.anthropic.claude-opus-4-6-v1' },
    ];
    expect(validateDebateSettings({ ...base, judges: ok })).toEqual([]);
    const bad = [{ modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'style' as never }];
    expect(validateDebateSettings({ ...base, judges: bad })).toHaveLength(1);
  });

  it('役割が欠けている、または重なっているとエラー', () => {
    expect(validateDebateSettings({ ...base, participants: participants.slice(0, 1) })).toHaveLength(1);
    const twoPros = [participants[0]!, { ...participants[1]!, role: 'pro' as const }];
    expect(validateDebateSettings({ ...base, participants: twoPros })).toHaveLength(1);
  });

  it('司会(廃止した役割)を含めるとエラー', () => {
    const withModerator = [...participants, { role: 'moderator', modelId: 'openai.gpt-oss-120b-1:0' }] as unknown as Participant[];
    expect(validateDebateSettings({ ...base, participants: withModerator })).toHaveLength(1);
  });
});
