// 新しい発言の知らせ。開いた後に届いた発言が、まだ画面に入っていなければ、画面の下にボタンを出す。
// 仕様: docs/04-app/README.md「議論の画面」の「新しい発言の知らせ」
import { useEffect, useRef, useState } from 'react';
import { scrollBehavior } from '../logic';
import { Arrow } from './Arrow';

/** 発言の要素のID(議論の画面の発言の li に付ける) */
export const turnElementId = (turn: number) => `turn-${turn}`;

/**
 * まだ見ていない発言の範囲(最も古いターンと最新のターン)。見ていなければ null。
 * ready になった時点(議論を読み込んだとき)にあった発言は、知らせない
 */
export function useNewTurns(turns: number[], ready: boolean): { from: number; to: number } | null {
  // 開いたときにあった発言の最後のターン
  const baseline = useRef<number | null>(null);
  // まだ見ていない発言のうち、最も古いターン
  const [firstUnseen, setFirstUnseen] = useState<number | null>(null);
  const latest = turns.length > 0 ? Math.max(...turns) : 0;

  useEffect(() => {
    // 読み込み中(別の議論に移ったときも)は、最初からやり直す
    if (!ready) {
      baseline.current = null;
      setFirstUnseen(null);
      return;
    }
    if (baseline.current === null) {
      baseline.current = latest;
      return;
    }
    if (latest > baseline.current) {
      const first = baseline.current + 1;
      baseline.current = latest;
      setFirstUnseen((cur) => cur ?? first);
    }
  }, [ready, latest]);

  // 見ていない発言が画面に入ったら、そこまでを見たことにする
  useEffect(() => {
    if (firstUnseen === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.turn));
        if (seen.length === 0) return;
        const upTo = Math.max(...seen);
        setFirstUnseen((cur) => (cur === null || upTo < cur ? cur : upTo >= latest ? null : upTo + 1));
      },
      { threshold: 0.2 },
    );
    for (let t = firstUnseen; t <= latest; t++) {
      const el = document.getElementById(turnElementId(t));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [firstUnseen, latest]);

  return firstUnseen === null || firstUnseen > latest ? null : { from: firstUnseen, to: latest };
}

/** 画面の下の真ん中に出すボタン。押すと、まだ見ていない発言のうち最も古いものへ移る */
export function NewTurnNotice({ range }: { range: { from: number; to: number } | null }) {
  if (!range) return null;
  const label = range.from === range.to ? `ターン${range.from}が届きました` : `ターン${range.from}〜${range.to}が届きました`;
  const jump = () => document.getElementById(turnElementId(range.from))?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  return (
    <div className="new-turn" role="status">
      <button type="button" className="button primary new-turn-button" onClick={jump}>
        {label}
        <Arrow direction="down" />
      </button>
    </div>
  );
}
