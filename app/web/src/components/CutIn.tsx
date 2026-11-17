// 議論の画面を開いたときのカットイン。「AI言い合いバトル」の文字、テーマ、討論者の2人が向かい合って指さし合う姿を出し、
// 押したら消す。仕様: docs/04-app/README.md「カットイン」
import { useEffect, useRef, useState } from 'react';
import type { Debate, DebaterRole, Positions } from '@agorawl/contract';
import { characterPose, participantModel, prefersReducedMotion } from '../logic';

/** 覆って読み込みを待つ(cover)、出して押されるのを待つ(play)、消えていく(leaving)、出さない・終わった(off) */
export type CutInPhase = 'cover' | 'play' | 'leaving' | 'off';
type Picture = { src: string; name: string };
type Pictures = Record<DebaterRole, Picture | null>;

/** 押してから消えるまで(ミリ秒)。CSS のアニメーション(styles.css「カットイン」の .cutin.leaving)と合わせる */
const LEAVE_MS = 300;

/** 「AI言い合いバトル」の1字ずつ。「AI言い合い」は先攻の色、「バトル」は後攻の色(表紙と同じ) */
const TITLE = [...'AI言い合いバトル'];
const PRO_LENGTH = [...'AI言い合い'].length;

/** タッチで操作する端末か(「TAP TO START」と「CLICK TO START」を出し分ける) */
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const initialPhase = (): CutInPhase => (prefersReducedMotion() ? 'off' : 'cover');

/** 絵を読み込む。読み込めなければ null(その側は絵なしで出す) */
function load(p: Picture | null): Promise<Picture | null> {
  if (!p) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(p);
    img.onerror = () => resolve(null);
    img.src = p.src;
  });
}

/** カットインの進み方。議論と絵を読み込んでから出し、押されたら消して off にする */
export function useCutIn(debateId: string, debate: Pick<Debate, 'participants'> | null, failed: boolean) {
  const [phase, setPhase] = useState<CutInPhase>(initialPhase);
  const [pictures, setPictures] = useState<Pictures>({ pro: null, con: null });
  // 出しているときは0.3秒かけて消し、読み込み中なら、すぐ消す
  const skip = () => setPhase((p) => (p === 'play' ? 'leaving' : p === 'leaving' ? p : 'off'));

  // 別の議論に移ったら、最初からやり直す
  useEffect(() => setPhase(initialPhase()), [debateId]);

  // 議論を読み込めなかったときは出さない
  useEffect(() => {
    if (phase === 'cover' && failed) setPhase('off');
  }, [phase, failed]);

  const proModel = debate ? participantModel(debate, 'pro') : null;
  const conModel = debate ? participantModel(debate, 'con') : null;
  useEffect(() => {
    if (phase !== 'cover' || proModel === null || conModel === null) return;
    let cancelled = false;
    Promise.all([load(characterPose(proModel, 'debate')), load(characterPose(conModel, 'debate'))]).then(([pro, con]) => {
      if (cancelled) return;
      // 両方とも絵がなければ出さない
      if (!pro && !con) return setPhase('off');
      setPictures({ pro, con });
      setPhase('play');
    });
    return () => {
      cancelled = true;
    };
  }, [phase, proModel, conModel]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('off'), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Escキーで消す(Enter とスペースは、入力を向けた「START」のボタンで受ける)
  useEffect(() => {
    if (phase === 'off') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  return { phase, pictures, skip };
}

/**
 * カットインの表示。どこを押しても消す。文字と絵は見出しと同じ中身なので読み上げからは隠し、
 * 「START」のボタンだけを読み上げとキーボードで押せるようにする
 */
export function CutIn({
  phase,
  pictures,
  positions,
  theme,
  onSkip,
}: {
  phase: CutInPhase;
  pictures: Pictures;
  positions: Positions | null;
  theme: string | null;
  onSkip: () => void;
}) {
  const start = useRef<HTMLButtonElement>(null);
  const shown = phase === 'play' || phase === 'leaving';
  // 出したら「START」のボタンに入力を向け、Enter とスペースで消せるようにする
  useEffect(() => {
    if (phase === 'play') start.current?.focus();
  }, [phase]);
  if (phase === 'off') return null;
  return (
    <div className={`cutin ${phase}`} onClick={onSkip}>
      {shown && positions && (
        <div className="cutin-content">
          <div className="cutin-head" aria-hidden="true">
            <p className="cutin-title">
              {TITLE.map((c, i) => (
                <span key={i} className={i < PRO_LENGTH ? 'pro' : 'con'}>
                  {c}
                </span>
              ))}
            </p>
            {theme && <p className="cutin-theme">「{theme}」</p>}
          </div>
          <div className="cutin-stage" aria-hidden="true">
            <Side role="pro" picture={pictures.pro} name={positions.pro} />
            <span className="cutin-vs">VS</span>
            <Side role="con" picture={pictures.con} name={positions.con} />
          </div>
          <button ref={start} type="button" className="cutin-start" aria-label="議論を見る">
            {isTouch() ? 'TAP TO START' : 'CLICK TO START'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 片側。後攻の絵は左右を反転して(CSS)、先攻と向かい合わせる。絵がなければ立場の札だけ */
function Side({ role, picture, name }: { role: DebaterRole; picture: Picture | null; name: string }) {
  return (
    <div className={`cutin-side ${role}`}>
      {/* 絵がなくても枠は置き、名前の札の行を相手の側とそろえる */}
      {picture ? <img className="cutin-img" src={picture.src} alt="" /> : <span className="cutin-img-empty" />}
      <span className="cutin-name">{name}</span>
    </div>
  );
}
