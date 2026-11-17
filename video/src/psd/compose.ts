// PSD のレイヤーを選んで重ね、1枚の PNG にする。docs/06-explainer-video/README.md「立ち絵」
// レイヤーの名前の決まりは PSDTool に合わせる: 「!」で始まるグループは常に表示、「*」で始まるものは同じ親の「*」の中から1つだけ表示
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeCanvas, readPsd, type Layer, type Psd } from 'ag-psd';
import { PNG } from 'pngjs';

// Node には canvas がないため、画素の入れ物(ImageData と同じ形)だけを渡す。canvas は使わない(useImageData)
initializeCanvas(
  () => {
    throw new Error('canvas は使わない');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as ImageData,
);

export function loadPsd(file: string): Psd {
  return readPsd(readFileSync(file), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
}

/** レイヤーの道のり(例: 「!目/*にっこり」)から、親から順のレイヤーの並びを探す */
function find(psd: Psd, path: string): Layer[] {
  const names = path.split('/');
  const chain: Layer[] = [];
  let level = psd.children ?? [];
  for (const name of names) {
    const hit = level.find((l) => l.name === name);
    if (!hit) throw new Error(`レイヤーが見つからない: ${path}(「${name}」がない)`);
    chain.push(hit);
    level = hit.children ?? [];
  }
  return chain;
}

/**
 * 表示するレイヤーを決める。PSD に保存された表示を元にし、show の各レイヤーと、その親を表示にする。
 * 「*」のレイヤーを表示にしたときは、同じ親の他の「*」を非表示にする。hide の各レイヤーは非表示にする
 */
export function selectVisible(psd: Psd, show: string[], hide: string[] = []): Set<Layer> {
  const visible = new Set<Layer>();
  const walk = (ls: Layer[]) =>
    ls.forEach((l) => {
      if (!l.hidden || l.name?.startsWith('!')) visible.add(l);
      if (l.children) walk(l.children);
    });
  walk(psd.children ?? []);

  for (const path of show) {
    const chain = find(psd, path);
    chain.forEach((l, i) => {
      visible.add(l);
      if (l.name?.startsWith('*')) {
        const siblings = i === 0 ? (psd.children ?? []) : (chain[i - 1].children ?? []);
        siblings.filter((s) => s !== l && s.name?.startsWith('*')).forEach((s) => visible.delete(s));
      }
    });
  }
  for (const path of hide) {
    const chain = find(psd, path);
    visible.delete(chain[chain.length - 1]);
  }
  return visible;
}

/** 表示するレイヤーを、下から順に重ねる(通常の重ね方だけ。PSD の他の重ね方は使っていない) */
export function composite(psd: Psd, visible: Set<Layer>): PNG {
  const { width, height } = psd;
  const out = new PNG({ width, height });
  const dst = out.data;
  const draw = (ls: Layer[]) => {
    for (const l of ls) {
      if (!visible.has(l)) continue;
      if (l.children) {
        draw(l.children);
        continue;
      }
      const img = l.imageData;
      if (!img) continue;
      const opacity = l.opacity ?? 1;
      const left = l.left ?? 0;
      const top = l.top ?? 0;
      for (let y = 0; y < img.height; y++) {
        const dy = top + y;
        if (dy < 0 || dy >= height) continue;
        for (let x = 0; x < img.width; x++) {
          const dx = left + x;
          if (dx < 0 || dx >= width) continue;
          const s = (y * img.width + x) * 4;
          const sa = (img.data[s + 3] / 255) * opacity;
          if (sa === 0) continue;
          const d = (dy * width + dx) * 4;
          const da = dst[d + 3] / 255;
          const oa = sa + da * (1 - sa);
          for (let c = 0; c < 3; c++) {
            dst[d + c] = Math.round((img.data[s + c] * sa + dst[d + c] * da * (1 - sa)) / oa);
          }
          dst[d + 3] = Math.round(oa * 255);
        }
      }
    }
  };
  draw(psd.children ?? []);
  return out;
}

export function writePng(png: PNG, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PNG.sync.write(png));
}
