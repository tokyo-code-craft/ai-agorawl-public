// アイコン(立ち絵の頭から胸のあたり)の切り出す範囲。仕様: docs/05-persona-illustration/README.md「アイコン」

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** アイコンの一辺(px)。画面の56pxの3倍 */
export const ICON_SIZE = 168;
/** 正方形の一辺を、輪郭の幅の何倍にするか */
const WIDTH_RATIO = 1.08;
/** 輪郭の上端の上に空ける余白(正方形の一辺に対する割合) */
const TOP_MARGIN = 0.03;

/** 透明でない画素の輪郭。alpha は1画素1バイトの透明度 */
export function opaqueBounds(alpha: Uint8Array, width: number, height: number, threshold = 16): Box {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('透明でない部分がありません');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 輪郭の幅より少し広い正方形を、輪郭の上端から取る。画像の外にはみ出さないよう寄せる */
export function iconCrop(bounds: Box, imageWidth: number, imageHeight: number): Box {
  const size = Math.min(Math.round(bounds.width * WIDTH_RATIO), imageWidth, imageHeight);
  const centerX = bounds.left + bounds.width / 2;
  const left = clamp(Math.round(centerX - size / 2), 0, imageWidth - size);
  const top = clamp(Math.round(bounds.top - size * TOP_MARGIN), 0, imageHeight - size);
  return { left, top, width: size, height: size };
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** 輪郭のまわりの余白(輪郭の長い辺に対する割合) */
const TRIM_MARGIN = 0.03;

/** 輪郭に少し余白を足した四角(画像の端で切る)。ポーズの絵の余白を切りそろえるのに使う */
export function trimBox(bounds: Box, imageWidth: number, imageHeight: number): Box {
  const m = Math.round(Math.max(bounds.width, bounds.height) * TRIM_MARGIN);
  const left = Math.max(bounds.left - m, 0);
  const top = Math.max(bounds.top - m, 0);
  const right = Math.min(bounds.left + bounds.width + m, imageWidth);
  const bottom = Math.min(bounds.top + bounds.height + m, imageHeight);
  return { left, top, width: right - left, height: bottom - top };
}
