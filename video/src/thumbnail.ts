// サムネイル(1280×720 の PNG)を作る。docs/06-explainer-video/README.md「サムネイル」
// 使い方: npm run thumbnail -- thumbnails/<名前>.json   → out/<名前>-<連番>.png
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import type { SpeakerId } from './characters.ts';
import type { TextPart, ThumbnailProps } from './remotion/Thumbnail.tsx';
import { tachieSizes } from './tachie-size.ts';

const FFMPEG = 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe';
const FONT = 'assets/fonts/DelaGothicOne-Regular.ttf';

interface ThumbnailSpec {
  background?: string;
  /** 題の上に小さく出す行(シリーズの名前など)。省ける */
  kicker?: TextPart[];
  title: TextPart[];
  subtitle: TextPart[];
  badge: string;
  /** 真ん中に出す画面の場面の ID(npm run record で録ったもの) */
  screen?: string;
  expressions?: Partial<Record<SpeakerId, string>>;
}

const file = process.argv[2];
if (!file) {
  console.error('使い方: npm run thumbnail -- thumbnails/<名前>.json');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(file, 'utf-8')) as ThumbnailSpec;

/** 素材を public/<dir>/ に写し、public/ からの道のりを返す。ないときは使わずに作る */
function publish(src: string, dir: string, what: string): string | undefined {
  if (!existsSync(src)) {
    console.log(`${what} ${src} がないため、使わずに作ります(video/README.md の手順で置く)`);
    return undefined;
  }
  mkdirSync(`public/${dir}`, { recursive: true });
  copyFileSync(src, `public/${dir}/${basename(src)}`);
  return `${dir}/${basename(src)}`;
}

/** 録った画面の絵。動画の場面なら最後のコマを切り出す */
function screenStill(id: string): string | undefined {
  if (existsSync(`public/screens/${id}.png`)) return `screens/${id}.png`;
  const video = `public/screens/${id}.mp4`;
  if (!existsSync(video)) {
    console.log(`画面の映像 ${id} を録っていないため、出さずに作ります(npm run record -- ${id})`);
    return undefined;
  }
  mkdirSync('public/thumbnail', { recursive: true });
  const out = `public/thumbnail/${id}-last.png`;
  const r = spawnSync(FFMPEG, ['-loglevel', 'error', '-y', '-sseof', '-0.1', '-i', video, '-frames:v', '1', out], { encoding: 'utf-8' });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`画面の映像 ${video} から絵を切り出せない: ${r.stderr}`);
  return `thumbnail/${id}-last.png`;
}

const inputProps: ThumbnailProps = {
  kicker: spec.kicker,
  title: spec.title,
  subtitle: spec.subtitle,
  badge: spec.badge,
  background: spec.background ? publish(spec.background, 'backgrounds', '背景の画像') : undefined,
  screen: spec.screen ? screenStill(spec.screen) : undefined,
  expressions: spec.expressions ?? {},
  tachie: tachieSizes(),
  font: publish(FONT, 'fonts', '字体のファイル'),
};

const serveUrl = await bundle({ entryPoint: resolve('src/remotion/index.ts'), publicDir: resolve('public') });
const composition = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps });
const out = nextOutput(basename(file, '.json'));
await renderStill({ composition, serveUrl, output: out, inputProps, imageFormat: 'png' });
console.log(out);

/** 作るたびに連番を付ける(out/<名前>-001.png …)。前に作った絵は消さない */
function nextOutput(name: string): string {
  mkdirSync('out', { recursive: true });
  const prefix = `${name}-`;
  const used = readdirSync('out')
    .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
    .map((f) => f.slice(prefix.length, -'.png'.length))
    .filter((n) => /^\d+$/.test(n))
    .map(Number);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `out/${name}-${String(next).padStart(3, '0')}.png`;
}
