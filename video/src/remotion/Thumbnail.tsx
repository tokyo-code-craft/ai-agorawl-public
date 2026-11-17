// サムネイル(静止画)。docs/06-explainer-video/README.md「サムネイル」
import { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Img, staticFile } from 'remotion';
import { CHARACTERS, tachiePath, type SpeakerId } from '../characters.ts';
import type { TachieSize } from './Explainer.tsx';

export type TextColor = 'pro' | 'con' | 'alert';

/** 色を変える区切り。color がなければ濃い灰色 */
export interface TextPart {
  text: string;
  color?: TextColor;
}

export interface ThumbnailProps extends Record<string, unknown> {
  title: TextPart[];
  subtitle: TextPart[];
  badge: string;
  /** 背景の画像(Remotion の public/ からの道のり)。ないときは既定の色 */
  background?: string;
  /** 真ん中に出す画面の絵(public/ からの道のり)。ないときは出さない */
  screen?: string;
  /** 2人の表情(立ち絵の PNG があるときだけ出す) */
  expressions: Partial<Record<SpeakerId, string>>;
  tachie: Partial<Record<SpeakerId, TachieSize>>;
  /** 字体のファイル(public/ からの道のり)。ないときは日本語の太いゴシック */
  font?: string;
}

const COLORS: Record<TextColor | 'none', string> = { pro: '#c2410c', con: '#1d4ed8', alert: '#dc2626', none: '#1f2328' };
const FALLBACK_FONT = "'Noto Sans JP', 'Yu Gothic', YuGothic, 'Meiryo', sans-serif";
const FONT_NAME = 'ThumbnailTitle';

/** 立ち絵の縮め方と、頭のてっぺんの高さ(2人でそろえる。動画と同じ考え方) */
const TACHIE_SCALE = 520 / 1650;
const HEAD_TOP = 275;
/** 左に四国めたん、右にずんだもん */
const SIDE: Record<SpeakerId, 'left' | 'right'> = { metan: 'left', zundamon: 'right' };
const SIDE_OFFSET = { metan: -60, zundamon: -50 };

function useFont(font: string | undefined) {
  const [handle] = useState(() => (font ? delayRender('字体を読み込む') : null));
  useEffect(() => {
    if (!font || handle === null) return;
    const face = new FontFace(FONT_NAME, `url(${staticFile(font)})`);
    face
      .load()
      .then((f) => document.fonts.add(f))
      .finally(() => continueRender(handle));
  }, [font, handle]);
  // Dela Gothic One は太さが1つしかない。太字を指定すると、ブラウザが太らせて漢字がつぶれる
  return font ? { fontFamily: `'${FONT_NAME}', ${FALLBACK_FONT}`, fontWeight: 400 } : { fontFamily: FALLBACK_FONT, fontWeight: 900 };
}

type FontStyle = ReturnType<typeof useFont>;

function Line({ parts, size, top, font }: { parts: TextPart[]; size: number; top: number; font: FontStyle }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        ...font,
        fontSize: size,
        lineHeight: 1.05,
        paintOrder: 'stroke fill',
        WebkitTextStroke: `${Math.round(size / 8)}px #fff`,
      }}
    >
      {parts.map((p, i) => (
        <span key={i} style={{ color: COLORS[p.color ?? 'none'] }}>
          {p.text}
        </span>
      ))}
    </div>
  );
}

export function Thumbnail({ title, subtitle, badge, background, screen, expressions, tachie, font }: ThumbnailProps) {
  const fontStyle = useFont(font);
  return (
    <AbsoluteFill style={{ background: '#3b2f2a', overflow: 'hidden' }} lang="ja">
      {background && (
        <Img src={staticFile(background)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.75)' }} />
      )}
      {screen && (
        <Img
          src={staticFile(screen)}
          style={{
            position: 'absolute',
            width: 660,
            left: 310,
            top: 268,
            border: '8px solid #fff',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            transform: 'rotate(-2deg)',
          }}
        />
      )}
      {(Object.keys(SIDE) as SpeakerId[]).map((id) => {
        const size = tachie[id];
        if (!size) return null;
        const c = CHARACTERS[id];
        return (
          <Img
            key={id}
            src={staticFile(tachiePath(id, expressions[id] ?? 'normal', 'closed'))}
            style={{
              position: 'absolute',
              height: size.height * TACHIE_SCALE,
              top: HEAD_TOP - size.headTop * TACHIE_SCALE,
              [SIDE[id]]: SIDE_OFFSET[id],
              transform: c.flip ? 'scaleX(-1)' : undefined,
            }}
          />
        );
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 250, background: 'linear-gradient(rgba(31,35,40,0.93), rgba(31,35,40,0.6))' }} />
      <Line parts={title} size={96} top={22} font={fontStyle} />
      <Line parts={subtitle} size={66} top={142} font={fontStyle} />
      <div
        style={{
          position: 'absolute',
          left: 40,
          bottom: 40,
          transform: 'rotate(-4deg)',
          background: '#facc15',
          color: '#1f2328',
          border: '6px solid #1f2328',
          borderRadius: 14,
          padding: '4px 22px',
          ...fontStyle,
          fontSize: 46,
        }}
      >
        {badge}
      </div>
    </AbsoluteFill>
  );
}
