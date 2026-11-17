// 結果の節。議論が終わったときに、先攻と後攻の絵で勝ち負けを見せる。仕様: docs/04-app/README.md「結果の節」
import { useEffect, useRef, useState } from 'react';
import type { Debate, DebaterRole, Positions } from '@agorawl/contract';
import { characterPose, endReasonLabel, OUTCOME_POSE, participantModel, sideOutcomes, winnerLabel, type SideOutcome } from '../logic';
import { majorityText } from '../verdict';

const OUTCOME_LABELS: Record<SideOutcome, string> = { win: '勝ち', lose: '負け', draw: '引き分け', waiting: '' };

export function ResultSection({
  debate,
  positions,
}: {
  debate: Pick<Debate, 'status' | 'endReason' | 'concededBy' | 'verdict' | 'participants'>;
  positions: Positions;
}) {
  const outcomes = sideOutcomes(debate);
  const verdict = debate.verdict;
  const text =
    verdict && verdict.judgments.length > 0 ? majorityText(verdict, positions) : winnerLabel({ ...debate, positions, winner: verdict?.winner });
  const waiting = outcomes?.pro === 'waiting';

  // 画面に入ったら、勝った側の絵を1回飛び跳ねさせる(CSS。動きを減らす設定では動かさない)
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <section className={`result ${seen ? 'seen' : ''}`} id="result" ref={ref}>
      <h2>{debate.status === 'failed' ? '議論は途中で止まりました' : '議論が終わりました'}</h2>
      {debate.endReason && <p className="result-reason">終了理由: {endReasonLabel(debate.endReason)}</p>}
      {text && <p className="winner big">{withVotesOnNewLine(text)}</p>}
      {outcomes && (
        <div className="result-sides">
          {(['pro', 'con'] as const).map((role) => (
            <Side key={role} role={role} outcome={outcomes[role]} modelId={participantModel(debate, role)} name={positions[role]} />
          ))}
        </div>
      )}
      {waiting && <p className="muted">判定を待っています…</p>}
    </section>
  );
}

/** 「(審判3人のうち2人)」などの審判の人数の部分は、改行して2行目に出す(docs/04-app/README.md「結果の節」) */
function withVotesOnNewLine(text: string) {
  const i = text.lastIndexOf('(審判');
  if (i <= 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <br />
      {text.slice(i)}
    </>
  );
}

/** 片側の絵と札。後攻の絵は左右を反転して(CSS)、向かい合わせる。絵のないモデルは札と文字だけ */
function Side({ role, outcome, modelId, name }: { role: DebaterRole; outcome: SideOutcome; modelId: string; name: string }) {
  const picture = characterPose(modelId, OUTCOME_POSE[outcome]);
  const label = OUTCOME_LABELS[outcome];
  return (
    <div className={`result-side ${role} ${outcome}`}>
      {/* 絵がなくても枠は置き、札と文字の行を相手の側とそろえる(行の高さは .result-sides で共有する) */}
      {picture ? (
        <div className="result-figure">
          <img className="result-img" src={picture.src} alt={`${picture.name}(${label || '判定待ち'})`} loading="lazy" />
        </div>
      ) : (
        <div className="result-figure empty" />
      )}
      <div className={`matchup-side ${role}`}>
        <span className="matchup-role">{role === 'pro' ? '先攻' : '後攻'}</span>
        <span className="matchup-name">{name}</span>
      </div>
      {label && <span className="result-label">{label}</span>}
    </div>
  );
}
