// セリフを時間の上に並べる(Remotion と CLI の両方で使う。Node の機能を使わない)
// docs/06-explainer-video/README.md「映像」
import type { ScreenRef, ScriptLine } from './script.ts';
import type { VoiceLine } from './voice/build.ts';

export const FPS = 30;
/** 始めに黒から明るくする・終わりに黒にする長さ(秒)。docs/06-explainer-video/README.md「始めと終わり」 */
export const FADE_SEC = 1;
/** 動画の始まりから最初のセリフまで(秒。明るくする1秒の後に0.5秒) */
export const START_SEC = FADE_SEC + 0.5;
/** 最後のセリフの後から動画の終わりまで(秒。そのまま2秒見せ、1秒で黒にする) */
export const END_SEC = 2 + FADE_SEC;
/** セリフとセリフの間(秒) */
export const GAP_SEC = 0.3;

export interface TimedLine extends ScriptLine {
  voice: VoiceLine;
  /** 始まりのフレーム */
  from: number;
  /** 画面の映像を出し始めるフレーム(話し始める前の間があれば、その頭)。省くと from */
  screenFrom?: number;
  /** 長さのフレーム */
  frames: number;
}

export function layout(lines: ScriptLine[], voices: VoiceLine[]): { lines: TimedLine[]; totalFrames: number } {
  let t = START_SEC;
  const timed = lines.map((line, i) => {
    const voice = voices[i];
    const screenFrom = Math.round(t * FPS);
    t += line.wait ?? 0;
    const from = Math.round(t * FPS);
    const frames = Math.max(1, Math.ceil(voice.duration * FPS));
    t += frames / FPS + GAP_SEC;
    return { ...line, voice, from, frames, screenFrom };
  });
  const last = timed[timed.length - 1];
  return { lines: timed, totalFrames: last.from + last.frames + Math.round(END_SEC * FPS) };
}

/** その時点で口を開けているか(秒は、セリフの始まりからの時間) */
export const isMouthOpen = (voice: VoiceLine, sec: number) => voice.mouth.some(([s, e]) => s <= sec && sec < e);

/** 画面の映像を出す区間 */
export interface ScreenSegment {
  id: string;
  /** 始まりのフレームと長さ */
  from: number;
  frames: number;
  /** 動画の場面: 再生を始める位置(秒) */
  start: number;
  zoom: number;
  focus: [number, number];
}

/**
 * 台本の screen から、画面の映像を出す区間を決める。行の screen を省くと前の画面を続け、null で消す。
 * 同じ場面が続く間は1つの区間にまとめ、動画は続けて再生する。区間は次の行の始まり(最後は動画の終わり)まで
 */
export function screenSegments(lines: TimedLine[], totalFrames: number): ScreenSegment[] {
  const segs: ScreenSegment[] = [];
  let cur: ScreenRef | null = null;
  lines.forEach((l, i) => {
    const end = i + 1 < lines.length ? (lines[i + 1].screenFrom ?? lines[i + 1].from) : totalFrames;
    const from = i === 0 ? 0 : (l.screenFrom ?? l.from);
    if (l.screen !== undefined) cur = l.screen;
    if (!cur) return;
    const last = segs[segs.length - 1];
    const continues = last && last.id === cur.id && last.from + last.frames === from && (l.screen === undefined || l.screen?.start === undefined);
    if (continues) {
      last.frames = end - last.from;
      if (l.screen?.zoom !== undefined) last.zoom = l.screen.zoom;
      if (l.screen?.focus !== undefined) last.focus = l.screen.focus;
      return;
    }
    segs.push({ id: cur.id, from, frames: end - from, start: cur.start ?? 0, zoom: cur.zoom ?? 1.06, focus: cur.focus ?? [0.5, 0.5] });
  });
  return segs;
}
