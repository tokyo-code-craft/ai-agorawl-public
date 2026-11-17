import { describe, expect, it } from 'vitest';
import { iconCrop, opaqueBounds, trimBox } from '../src/icon';

describe('opaqueBounds', () => {
  it('透明でない画素の範囲を返す', () => {
    const w = 5, h = 4;
    const alpha = new Uint8Array(w * h);
    alpha[1 * w + 2] = 255;
    alpha[3 * w + 3] = 200;
    alpha[0 * w + 0] = 10; // しきい値以下は透明とみなす
    expect(opaqueBounds(alpha, w, h)).toEqual({ left: 2, top: 1, width: 2, height: 3 });
  });

  it('すべて透明なら断る', () => {
    expect(() => opaqueBounds(new Uint8Array(4), 2, 2)).toThrow();
  });
});

describe('iconCrop', () => {
  it('輪郭の幅より少し広い正方形を、輪郭の中央にそろえて上端から取る', () => {
    expect(iconCrop({ left: 200, top: 100, width: 500, height: 900 }, 1000, 1500)).toEqual({ left: 180, top: 84, width: 540, height: 540 });
  });

  it('画像の外にはみ出さないよう寄せる', () => {
    expect(iconCrop({ left: 0, top: 0, width: 1000, height: 1000 }, 1000, 1500)).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
  });
});

describe('trimBox', () => {
  it('輪郭の長い辺の3%の余白を足し、画像の端で切る', () => {
    expect(trimBox({ left: 100, top: 100, width: 200, height: 400 }, 1000, 1000)).toEqual({ left: 88, top: 88, width: 224, height: 424 });
    expect(trimBox({ left: 0, top: 5, width: 100, height: 990 }, 100, 1000)).toEqual({ left: 0, top: 0, width: 100, height: 1000 });
  });
});
