// 画面の右下に常に出す移動のボタン。仕様: docs/04-app/README.md「議論の画面」の「移動のボタン」、「画面の一覧」
import { scrollBehavior } from '../logic';
import { Arrow } from './Arrow';

/** 移る先。'top' はページの先頭、'bottom' はページの最後、それ以外は要素のID */
export interface JumpTarget {
  label: string;
  to: 'top' | 'bottom' | string;
  /** 矢印の向き */
  arrow: 'up' | 'down';
  /** 矢印を文字の後ろに置く(既定は前。docs/04-app/README.md「矢印」の「並べ方」) */
  arrowAfter?: boolean;
  primary?: boolean;
}

export function JumpButtons({ targets }: { targets: JumpTarget[] }) {
  const jump = (to: string) => {
    const behavior = scrollBehavior();
    if (to === 'top') window.scrollTo({ top: 0, behavior });
    else if (to === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
    else document.getElementById(to)?.scrollIntoView({ behavior, block: 'start' });
  };
  return (
    <nav className="jump" aria-label="ページ内の移動">
      {targets.map((t) => (
        <button key={t.to} type="button" className={`button small ${t.primary ? 'primary' : ''}`} onClick={() => jump(t.to)}>
          {!t.arrowAfter && <Arrow direction={t.arrow} />}
          {t.label}
          {t.arrowAfter && <Arrow direction={t.arrow} />}
        </button>
      ))}
    </nav>
  );
}
