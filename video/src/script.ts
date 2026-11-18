// 台本データ(工程間の共通の取り決め)。docs/06-explainer-video/README.md「台本データ」
import { readFileSync } from 'node:fs';
import { CHARACTERS, type SpeakerId } from './characters.ts';

export interface ScriptLine {
  speaker: SpeakerId;
  /** 同じセリフを、同時に言うもう1人の話し手(例: 2人で「やっぱり」と言う)。表情は2人とも expression */
  with?: SpeakerId;
  /** 字幕に出す文 */
  text: string;
  /** 読み上げる文。字幕と読み方を変えたいときだけ書く(例: 「Bedrock」を「ベッドロック」と読ませる) */
  reading?: string;
  /** 表情。省くと normal */
  expression?: string;
  /** 話し始める前の間(秒)。間の間、この行の画面の映像を先に出す */
  wait?: number;
  /** 話し始める前に、画面を一瞬黒くする(時間が経ったことを表す)。この行の画面の映像は、黒の間に切り替える */
  blackout?: boolean;
  /** 出す画面の映像。省くと前の行の画面を続ける。null で画面を消す */
  screen?: ScreenRef | null;
}

/** 画面の映像の指定(docs/06-explainer-video/README.md「画面の映像」の「台本での指定」) */
export interface ScreenRef {
  /** 場面の ID(public/screens/<ID>.mp4 か .png) */
  id: string;
  /** 動画の場面: 再生を始める位置(秒)。省くと、前の行から続けて同じ場面を出すときは続きから、そうでなければ最初から */
  start?: number;
  /** 写真の場面: 最後に何倍まで拡大するか。省くと 1.06 */
  zoom?: number;
  /** 写真の場面: 寄せる場所(画面の幅と高さに対する割合)。省くと真ん中 [0.5, 0.5] */
  focus?: [number, number];
}

export interface Bgm {
  /** 曲のファイル(video/ からの道のり。素材なので assets/bgm/ に置き、コミットしない) */
  file: string;
  /** 音量(0〜1)。省くと BGM_VOLUME */
  volume?: number;
}

export interface Script {
  title: string;
  /** 背景の画像(video/ からの道のり。素材なので assets/backgrounds/ に置き、コミットしない)。省くと既定の色 */
  background?: string;
  /** BGM。省くと流さない */
  bgm?: Bgm;
  /** 話す速さ(VOICEVOX の速さの倍率。0.5〜2)。省くと SPEED。全部のセリフに同じ速さを使う */
  speed?: number;
  lines: ScriptLine[];
}

/** 話す速さの標準。VOICEVOX の標準(1.0)では遅く感じるため、少し速くする */
export const SPEED = 1.2;

/** BGM の既定の音量。声の邪魔にならないよう小さめにする */
export const BGM_VOLUME = 0.04;

/** 台本を読み、話し手と表情が設定にあるかを確かめる */
export function parseScript(json: string): Script {
  const s = JSON.parse(json) as Script;
  if (typeof s.title !== 'string' || !Array.isArray(s.lines) || s.lines.length === 0) {
    throw new Error('台本には title と、1行以上の lines が要る');
  }
  if (s.background !== undefined && (typeof s.background !== 'string' || !s.background)) {
    throw new Error('background は画像のファイルの道のり');
  }
  if (s.bgm !== undefined) {
    if (typeof s.bgm.file !== 'string' || !s.bgm.file) throw new Error('bgm には file が要る');
    const v = s.bgm.volume;
    if (v !== undefined && !(typeof v === 'number' && v >= 0 && v <= 1)) throw new Error('bgm の volume は 0〜1');
  }
  if (s.speed !== undefined && !(typeof s.speed === 'number' && s.speed >= 0.5 && s.speed <= 2)) throw new Error('speed は 0.5〜2');
  s.lines.forEach((l, i) => {
    const c = CHARACTERS[l.speaker];
    if (!c) throw new Error(`${i + 1}行目: 話し手 ${l.speaker} がいない`);
    if (l.with !== undefined && (!CHARACTERS[l.with] || l.with === l.speaker)) throw new Error(`${i + 1}行目: with には、speaker と違う話し手を書く`);
    if (!l.text) throw new Error(`${i + 1}行目: text が空`);
    if (l.wait !== undefined && !(typeof l.wait === 'number' && l.wait >= 0)) throw new Error(`${i + 1}行目: wait は0以上の秒`);
    if (l.blackout !== undefined && typeof l.blackout !== 'boolean') throw new Error(`${i + 1}行目: blackout は true か false`);
    if (l.screen) {
      const sc = l.screen;
      if (typeof sc.id !== 'string' || !sc.id) throw new Error(`${i + 1}行目: screen には id が要る`);
      if (sc.start !== undefined && !(typeof sc.start === 'number' && sc.start >= 0)) throw new Error(`${i + 1}行目: screen の start は0以上の秒`);
      if (sc.zoom !== undefined && !(typeof sc.zoom === 'number' && sc.zoom >= 1)) throw new Error(`${i + 1}行目: screen の zoom は1以上`);
      if (sc.focus !== undefined && !(Array.isArray(sc.focus) && sc.focus.length === 2 && sc.focus.every((v) => typeof v === 'number' && v >= 0 && v <= 1))) {
        throw new Error(`${i + 1}行目: screen の focus は [0〜1, 0〜1]`);
      }
    }
    if (l.expression && !c.expressions[l.expression]) {
      throw new Error(`${i + 1}行目: ${c.name}に表情 ${l.expression} がない(${Object.keys(c.expressions).join('、')})`);
    }
  });
  return s;
}

export const readScript = (file: string): Script => parseScript(readFileSync(file, 'utf-8'));

/**
 * 段階ごとの台本を、1本の台本につなぐ(docs/06-explainer-video/README.md「台本データ」)。
 * 行は順につなぎ、題・背景・BGM・速さは最初の台本のものを使う
 */
export function joinScripts(scripts: Script[]): Script {
  if (scripts.length === 0) throw new Error('台本が1つもない');
  const [first] = scripts;
  return { ...first, lines: scripts.flatMap((s) => s.lines) };
}
