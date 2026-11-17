// 台本から mp4 を作る(立ち絵の PNG → 音声 → 映像)。docs/06-explainer-video/README.md「工程」
// 使い方: npm run make -- scripts/<台本>.json   → out/<台本>-<連番>.mp4
//         npm run make -- scripts/<台本1>.json scripts/<台本2>.json …   → 段階の台本をつないで1本に作る(out/<台本1>+<台本2>-<連番>.mp4)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { tachieSizes } from './tachie-size.ts';
import { BGM_VOLUME, joinScripts, readScript } from './script.ts';
import { FPS, layout } from './timeline.ts';
import { buildVoices } from './voice/build.ts';
import type { ExplainerProps } from './remotion/Explainer.tsx';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('使い方: npm run make -- scripts/<台本>.json [scripts/<台本2>.json …]');
  process.exit(1);
}
const script = joinScripts(files.map(readScript));

// 立ち絵の PNG がそろっている話し手(ないときは npm run psd -- build で作る。PSD がなければ仮の絵)
// PSD ごとに絵の大きさと余白が違うため、大きさと頭のてっぺんの位置も渡す(頭の位置を2人でそろえる)
const tachie: ExplainerProps['tachie'] = tachieSizes();

/**
 * 素材を、Remotion が読めるように public/<dir>/ に写し、public/ からの道のりを返す。
 * 素材はコミットしないため、手元にないこともある。そのときは使わずに作る
 */
function publish(file: string, dir: string, what: string): string | undefined {
  if (!existsSync(file)) {
    console.log(`${what} ${file} がないため、使わずに作ります(video/README.md の手順で置く)`);
    return undefined;
  }
  mkdirSync(`public/${dir}`, { recursive: true });
  copyFileSync(file, `public/${dir}/${basename(file)}`);
  return `${dir}/${basename(file)}`;
}

const bgmFile = script.bgm && publish(script.bgm.file, 'bgm', 'BGM の曲');
const bgm: ExplainerProps['bgm'] = bgmFile ? { file: bgmFile, volume: script.bgm?.volume ?? BGM_VOLUME } : undefined;
const background = script.background ? publish(script.background, 'backgrounds', '背景の画像') : undefined;

console.log('音声を作ります');
const voices = await buildVoices(script);
const { lines, totalFrames } = layout(script.lines, voices);
// 台本で使う画面の映像(npm run record で録ったもの)
const screens: ExplainerProps['screens'] = {};
for (const id of new Set(script.lines.flatMap((l) => (l.screen ? [l.screen.id] : [])))) {
  if (existsSync(`public/screens/${id}.mp4`)) {
    screens[id] = { file: `screens/${id}.mp4`, kind: 'video', frames: Math.floor(videoSeconds(`public/screens/${id}.mp4`) * FPS) };
  } else if (existsSync(`public/screens/${id}.png`)) {
    screens[id] = { file: `screens/${id}.png`, kind: 'still' };
  } else {
    console.log(`画面の映像 ${id} を録っていないため、枠だけ出します(npm run record -- ${id})`);
  }
}
const inputProps: ExplainerProps = { title: script.title, lines, totalFrames, tachie, bgm, background, screens };

console.log('映像を作ります');
const serveUrl = await bundle({ entryPoint: resolve('src/remotion/index.ts'), publicDir: resolve('public') });
const composition = await selectComposition({ serveUrl, id: 'Explainer', inputProps });
const out = nextOutput(files.map((f) => basename(f, '.json')).join('+'));
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: out,
  inputProps,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 10);
    if (p !== last) console.log(`  ${p * 10}%`);
    last = p;
  },
});
console.log(`${out}(${(totalFrames / composition.fps).toFixed(1)}秒)`);

/** 作るたびに連番を付ける(out/<台本>-001.mp4、-002.mp4 …)。前に作った動画は消さない */
function nextOutput(name: string): string {
  mkdirSync('out', { recursive: true });
  const prefix = `${name}-`;
  const used = readdirSync('out')
    .filter((f) => f.startsWith(prefix) && f.endsWith('.mp4'))
    .map((f) => f.slice(prefix.length, -'.mp4'.length))
    .filter((n) => /^\d+$/.test(n))
    .map(Number);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `out/${name}-${String(next).padStart(3, '0')}.mp4`;
}

/** 動画の長さ(秒)。Remotion に同梱の ffmpeg の出力から読む */
function videoSeconds(file: string): number {
  const r = spawnSync('node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe', ['-hide_banner', '-i', file], { encoding: 'utf-8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  if (!m) throw new Error(`動画の長さを読めない: ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
