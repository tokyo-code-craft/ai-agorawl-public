// 表紙。ログインしていない人に、どの画面のURLでも出す。仕様: docs/04-app/README.md「表紙」
import { useState } from 'react';

/** 1字ずつ飛び込ませる。「AI言い合い」は先攻の色、「バトル」は後攻の色 */
const TITLE = [...'AI言い合いバトル'];
const PRO_LENGTH = [...'AI言い合い'].length;
/** 1字ごとに遅らせる秒数と、最初の字までの秒数(styles.css の .cover-char の動きと合わせる) */
const STEP_S = 0.16;
const START_S = 0.15;

export function Cover({ onLogin }: { onLogin: () => Promise<void> }) {
  const [moving, setMoving] = useState(false);
  const login = () => {
    setMoving(true);
    void onLogin().catch(() => setMoving(false));
  };
  return (
    <>
      {/* 背景の模様(docs/04-app/README.md「背景」) */}
      <div className="backdrop" aria-hidden="true" />
      <main className="cover">
        <h1 className="cover-title" aria-label="AI言い合いバトル">
          {TITLE.map((c, i) => (
            <span
              key={i}
              className={`cover-char ${i < PRO_LENGTH ? 'pro' : 'con'}`}
              aria-hidden="true"
              style={{ animationDelay: `${START_S + i * STEP_S}s` }}
            >
              {c}
            </span>
          ))}
        </h1>
        <button type="button" className="button primary cover-login" onClick={login} disabled={moving}>
          ログイン
        </button>
      </main>
    </>
  );
}
