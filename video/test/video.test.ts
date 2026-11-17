import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinScripts, parseScript } from '../src/script.ts';
import { layout, isMouthOpen, START_SEC, END_SEC, FPS, GAP_SEC } from '../src/timeline.ts';
import { mouthSpans, queryDuration, type AudioQuery } from '../src/voice/voicevox.ts';

const mora = (vowel: string, vowel_length: number, consonant_length: number | null = null) => ({ text: '', vowel, vowel_length, consonant_length });

const query: AudioQuery = {
  speedScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  accent_phrases: [
    // 「カン」+ 間
    { moras: [mora('a', 0.2, 0.05), mora('N', 0.1)], pause_mora: mora('pau', 0.3) },
    // 「ス」(無声化した母音)
    { moras: [mora('U', 0.1, 0.08)], pause_mora: null },
  ],
};

test('母音の間だけ口を開け、撥音・間・無声化した母音では閉じる', () => {
  const spans = mouthSpans(query);
  assert.equal(spans.length, 1);
  assert.ok(Math.abs(spans[0][0] - 0.15) < 1e-9);
  assert.ok(Math.abs(spans[0][1] - 0.35) < 1e-9);
});

test('音声の長さは、前後の無音と間を含む', () => {
  assert.ok(Math.abs(queryDuration(query) - 1.03) < 1e-9);
  assert.ok(Math.abs(queryDuration({ ...query, speedScale: 2 }) - 0.515) < 1e-9);
});

test('セリフを、前の間とセリフの間を空けて並べる', () => {
  const voice = (duration: number) => ({ file: 'x.wav', duration, mouth: [[0, 0.5]] as [number, number][] });
  const lines = [
    { speaker: 'zundamon' as const, text: 'a' },
    { speaker: 'metan' as const, text: 'b' },
  ];
  const r = layout(lines, [voice(1), voice(2)]);
  assert.equal(r.lines[0].from, START_SEC * FPS);
  assert.equal(r.lines[0].frames, FPS);
  assert.equal(r.lines[1].from, START_SEC * FPS + FPS + GAP_SEC * FPS);
  assert.equal(r.totalFrames, r.lines[1].from + 2 * FPS + END_SEC * FPS);
  assert.equal(isMouthOpen(r.lines[0].voice, 0.2), true);
  assert.equal(isMouthOpen(r.lines[0].voice, 0.6), false);
});

test('台本の話し手と表情を確かめる', () => {
  assert.throws(() => parseScript('{"title":"t","lines":[]}'), /1行以上/);
  assert.throws(() => parseScript('{"title":"t","lines":[{"speaker":"x","text":"a"}]}'), /話し手 x/);
  assert.throws(() => parseScript('{"title":"t","lines":[{"speaker":"zundamon","text":"a","expression":"angry"}]}'), /表情 angry/);
  assert.equal(parseScript('{"title":"t","lines":[{"speaker":"metan","text":"a"}]}').lines.length, 1);
  assert.throws(() => parseScript('{"title":"t","bgm":{},"lines":[{"speaker":"metan","text":"a"}]}'), /file/);
  assert.throws(() => parseScript('{"title":"t","bgm":{"file":"a.mp3","volume":2},"lines":[{"speaker":"metan","text":"a"}]}'), /volume/);
});

test('画面の映像の区間: 省くと続け、null で消し、同じ場面はまとめる', async () => {
  const { screenSegments } = await import('../src/timeline.ts');
  const v = { file: 'x.wav', duration: 1, mouth: [] };
  const line = (from: number, screen?: { id: string; start?: number } | null) => ({ speaker: 'zundamon' as const, text: 't', voice: v, from, frames: 30, ...(screen !== undefined ? { screen } : {}) });
  const segs = screenSegments(
    [line(15), line(55, { id: 'a' }), line(95), line(135, { id: 'a' }), line(175, { id: 'a', start: 2 }), line(215, { id: 'b' }), line(255, null), line(295)],
    340,
  );
  assert.deepEqual(
    segs.map((s) => [s.id, s.from, s.frames, s.start]),
    [
      ['a', 55, 120, 0],
      ['a', 175, 40, 2],
      ['b', 215, 40, 0],
    ],
  );
});

test('段階の台本をつなぐ: 行は順に、題・背景・BGM は最初の台本', () => {
  const a = parseScript(JSON.stringify({ title: '1', background: 'a.png', bgm: { file: 'a.mp3' }, lines: [{ speaker: 'zundamon', text: 'あ' }] }));
  const b = parseScript(JSON.stringify({ title: '2', background: 'b.png', lines: [{ speaker: 'metan', text: 'い' }, { speaker: 'zundamon', text: 'う' }] }));
  const j = joinScripts([a, b]);
  assert.equal(j.title, '1');
  assert.equal(j.background, 'a.png');
  assert.deepEqual(j.bgm, { file: 'a.mp3' });
  assert.deepEqual(j.lines.map((l) => l.text), ['あ', 'い', 'う']);
});

test('話し始める前の間: 台詞は間の後に始まり、画面の映像は間の頭から出す', async () => {
  const { screenSegments } = await import('../src/timeline.ts');
  const v = { file: '', duration: 1, mouth: [] };
  const lines = [{ speaker: 'zundamon' as const, text: 'a' }, { speaker: 'metan' as const, text: 'b', wait: 2, screen: { id: 's' } }];
  const { lines: timed, totalFrames } = layout(lines, [v, v] as never);
  assert.equal(timed[1].from - timed[1].screenFrom!, 2 * FPS);
  const segs = screenSegments(timed, totalFrames);
  assert.equal(segs[0].from, timed[1].screenFrom);
});
