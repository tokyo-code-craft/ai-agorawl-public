// 掛け合いの映像。docs/06-explainer-video/README.md「映像」
import { AbsoluteFill, Freeze, Html5Audio, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { CHARACTERS, tachiePath, type SpeakerId } from '../characters.ts';
import { FADE_SEC, FPS, GAP_SEC, isMouthOpen, screenSegments, type ScreenSegment, type TimedLine } from '../timeline.ts';

export interface ExplainerProps extends Record<string, unknown> {
  title: string;
  lines: TimedLine[];
  totalFrames: number;
  /** 背景の画像(Remotion の public/ からの道のり)。ないときは既定の色 */
  background?: string;
  /** BGM(Remotion の public/ からの道のりと音量)。ないときは流さない */
  bgm?: { file: string; volume: number };
  /** 立ち絵の PNG がある話し手と、その絵の大きさと、頭のてっぺんの位置(画素)。ない話し手は仮の絵 */
  tachie: Partial<Record<SpeakerId, TachieSize>>;
  /** 録った画面の映像(場面の ID → ファイル)。ない場面は、場面の ID を書いた枠を出す */
  screens: Record<string, ScreenFile>;
}

export interface ScreenFile {
  /** Remotion の public/ からの道のり */
  file: string;
  kind: 'video' | 'still';
  /** 動画の場面: 長さ(フレーム) */
  frames?: number;
}

export interface TachieSize {
  width: number;
  height: number;
  /** 絵の上の端から、頭のてっぺん(透けていない画素のいちばん上)まで */
  headTop: number;
}

/** BGM を大きくしていく時間と、小さくしていく時間(秒) */
/** 文字の字体。sans-serif だけでは中国語の字体が選ばれ、「判」などが中国語の字形になる(docs/06-explainer-video/README.md「文字の字体」) */
const JA_FONT = "'Noto Sans JP', 'Yu Gothic', YuGothic, 'Meiryo', sans-serif";
const BGM_FADE_IN_SEC = 1;
const BGM_FADE_OUT_SEC = 2;

/** 画面の左に四国めたん、右にずんだもん */
const SIDE: Record<SpeakerId, 'left' | 'right'> = { metan: 'left', zundamon: 'right' };

export function Explainer({ title, lines, tachie, bgm, background, totalFrames, screens }: ExplainerProps) {
  const frame = useCurrentFrame();
  const gap = Math.round(GAP_SEC * FPS);
  // 字幕は、次のセリフが始まるまで残す
  const current = [...lines].reverse().find((l) => l.from <= frame) ?? null;
  const speaking = current && frame < current.from + current.frames ? current : null;

  // 話し手ごとの表情は、その話し手の直前のセリフの表情
  const expressionOf = (id: SpeakerId) =>
    [...lines].reverse().find((l) => l.speaker === id && l.from <= frame + gap)?.expression ?? 'normal';

  // 画面の映像を出している間は、画面を大きく出し、2人を左右の下に小さく出す
  const segments = screenSegments(lines, totalFrames);
  const showing = segments.some((s) => s.from <= frame && frame < s.from + s.frames);

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg, #fdf6e3 0%, #e8f0fb 100%)', fontFamily: JA_FONT }} lang="ja">
      {/* 背景の画像は、画面いっぱいに広げる(縦横の比が違えば、はみ出た分を切る) */}
      {background && <Img src={staticFile(background)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}

      {/* 題。背景の画像の上でも読めるよう、白い札にのせる。画面の映像を出している間は出さない */}
      {!showing && <div
        style={{
          position: 'absolute',
          top: 32,
          left: 48,
          padding: '8px 24px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.85)',
          fontSize: 40,
          fontWeight: 700,
          color: '#334',
        }}
      >
        {title}
      </div>}

      {segments.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.frames} layout="none">
          <Screen segment={s} file={screens[s.id]} />
        </Sequence>
      ))}

      {(Object.keys(SIDE) as SpeakerId[]).map((id) => {
        const active = current?.speaker === id;
        const open = !!speaking && speaking.speaker === id && isMouthOpen(speaking.voice, (frame - speaking.from) / FPS);
        return (
          <Tachie
            key={id}
            id={id}
            side={SIDE[id]}
            active={active}
            expression={expressionOf(id)}
            open={open}
            size={tachie[id]}
            small={showing}
          />
        );
      })}

      {current && <Subtitle line={current} />}

      {bgm && (
        <Html5Audio
          src={staticFile(bgm.file)}
          loop
          // 最初の1秒で大きくし、最後の2秒で小さくして消す
          volume={(f) => bgm.volume * Math.max(0, Math.min(1, f / (BGM_FADE_IN_SEC * FPS), (totalFrames - f) / (BGM_FADE_OUT_SEC * FPS)))}
        />
      )}

      {lines.map((l, i) => (
        <Sequence key={i} from={l.from} durationInFrames={l.frames} layout="none">
          <Html5Audio src={staticFile(l.voice.file)} />
        </Sequence>
      ))}

      {/* 始めは黒から明るくし、終わりは黒にする */}
      <AbsoluteFill
        style={{
          background: '#000',
          opacity: Math.max(0, 1 - frame / (FADE_SEC * FPS), 1 - (totalFrames - 1 - frame) / (FADE_SEC * FPS)),
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
}

/** 立ち絵を縮める倍率(PSD の画素 → 画面の画素)。2人とも同じ倍率にする。画面の映像を出している間は小さくする */
const TACHIE_SCALE = 0.8;
const TACHIE_SCALE_SMALL = 0.45;
/** 頭のてっぺんの位置(画面の上から)。2人ともここにそろえる */
const HEAD_TOP = 290;
const HEAD_TOP_SMALL = 640;

/** 画面の映像を出す枠(1920×1080 の中) */
const SCREEN_BOX = { left: 200, top: 24, width: 1520, height: 855 };

function Screen({ segment, file }: { segment: ScreenSegment; file?: ScreenFile }) {
  const frame = useCurrentFrame();
  const box: React.CSSProperties = {
    position: 'absolute',
    ...SCREEN_BOX,
    overflow: 'hidden',
    borderRadius: 16,
    border: '4px solid #fff',
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    background: '#222',
  };
  if (!file) {
    // まだ録っていない場面
    return (
      <div style={{ ...box, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 48 }}>
        画面: {segment.id}(未録画)
      </div>
    );
  }
  if (file.kind === 'still') {
    const scale = interpolate(frame, [0, segment.frames], [1, segment.zoom], { extrapolateRight: 'clamp' });
    const [fx, fy] = segment.focus;
    return (
      <div style={box}>
        <Img
          src={staticFile(file.file)}
          style={{ width: '100%', height: '100%', transform: `scale(${scale})`, transformOrigin: `${fx * 100}% ${fy * 100}%` }}
        />
      </div>
    );
  }
  // 動画の場面。録った長さより長く出すときは、最後の画面で止める
  const startFrame = Math.round(segment.start * FPS);
  const remaining = (file.frames ?? Infinity) - startFrame;
  const video = <OffthreadVideo src={staticFile(file.file)} startFrom={startFrame} muted style={{ width: '100%', height: '100%' }} />;
  return <div style={box}>{frame >= remaining - 1 ? <Freeze frame={Math.max(0, remaining - 2)}>{video}</Freeze> : video}</div>;
}

function Tachie(props: {
  id: SpeakerId;
  side: 'left' | 'right';
  active: boolean;
  expression: string;
  open: boolean;
  size?: TachieSize;
  small: boolean;
}) {
  const { id, side, active, expression, open, size, small } = props;
  const k = small ? TACHIE_SCALE_SMALL : TACHIE_SCALE;
  const c = CHARACTERS[id];
  const style: React.CSSProperties = {
    position: 'absolute',
    // 頭のてっぺんを2人でそろえ、腰から上を出す。絵の左右の余白のぶん、画面の端に寄せる
    top: (small ? HEAD_TOP_SMALL : HEAD_TOP) - (size?.headTop ?? 0) * k,
    [side]: small ? -40 : -60,
    height: (size?.height ?? 1650) * k,
    // 話している側をはっきり出す。大きさと位置は変えない(切り替わるたびに絵が動いて見えるため)
    filter: active ? 'none' : 'brightness(0.8) saturate(0.7)',
  };
  if (size) {
    return (
      <div style={style}>
        <Img
          src={staticFile(tachiePath(id, expression, open ? 'open' : 'closed'))}
          // 画面の真ん中(相手の側)を向くように、左右を反転する話し手がいる
          style={{ height: '100%', transform: c.flip ? 'scaleX(-1)' : undefined }}
        />
      </div>
    );
  }
  // 仮の絵(立ち絵の PSD がまだない話し手)
  return (
    <div style={{ ...style, width: 520, height: 900, top: 260, [side]: 40, borderRadius: '260px 260px 40px 40px', background: c.color, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 56, fontWeight: 700 }}>{c.name}</div>
        <div style={{ fontSize: 28, opacity: 0.9 }}>(仮の絵)</div>
        <div style={{ margin: '40px auto 0', width: 120, height: open ? 70 : 12, borderRadius: 60, background: '#5a1d3a' }} />
      </div>
    </div>
  );
}

function Subtitle({ line }: { line: TimedLine }) {
  const c = CHARACTERS[line.speaker];
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 50,
        transform: 'translateX(-50%)',
        width: 1000,
        padding: '24px 36px',
        background: 'rgba(255,255,255,0.94)',
        border: `6px solid ${c.color}`,
        borderRadius: 24,
        fontSize: 48,
        lineHeight: 1.4,
        fontWeight: 700,
        color: '#222',
      }}
    >
      <div style={{ fontSize: 28, color: c.color, marginBottom: 4 }}>{c.name}</div>
      {line.text}
    </div>
  );
}
