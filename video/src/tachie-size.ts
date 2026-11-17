// 立ち絵の PNG の大きさと、頭のてっぺんの位置(2人の頭の高さをそろえるため)。docs/06-explainer-video/README.md「映像」「サムネイル」
import { existsSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { CHARACTERS, tachiePath, type SpeakerId } from './characters.ts';
import type { TachieSize } from './remotion/Explainer.tsx';

/** 立ち絵の PNG がそろっている話し手の大きさ(ないときは npm run psd -- build で作る。ない話し手は入れない) */
export function tachieSizes(log: (s: string) => void = console.log): Partial<Record<SpeakerId, TachieSize>> {
  const result: Partial<Record<SpeakerId, TachieSize>> = {};
  for (const id of Object.keys(CHARACTERS) as SpeakerId[]) {
    const files = Object.keys(CHARACTERS[id].expressions).map((e) => `public/${tachiePath(id, e, 'closed')}`);
    if (files.every((f) => existsSync(f))) {
      const png = PNG.sync.read(readFileSync(files[0]));
      result[id] = { width: png.width, height: png.height, headTop: headTop(png) };
    } else {
      log(`${CHARACTERS[id].name}: 立ち絵の PNG がないため、仮の絵にします`);
    }
  }
  return result;
}

/** 透けていない画素のいちばん上の行 */
function headTop(png: PNG): number {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4 + 3] > 20) return y;
  }
  return 0;
}
