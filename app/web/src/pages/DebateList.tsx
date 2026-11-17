// 議論の一覧(新しい順。下まで読むと続きを読む)。仕様: docs/04-app/README.md「画面の一覧」
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DebateSummary } from '@agorawl/api/types';
import { useServices } from '../context';
import { Avatar } from '../components/Avatar';
import { JumpButtons } from '../components/JumpButtons';
import { formatDateTime, isAdminProfile, participantModel, positionsOf, statusLabel } from '../logic';

export function DebateList() {
  const { api, auth } = useServices();
  const [items, setItems] = useState<DebateSummary[]>([]);
  // 管理者には、カードに「隠す」「見せる」と、終わった議論の「削除」を出す(docs/04-app/README.md「議論を隠す」「議論を消す」)
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void auth.getUser().then((u) => setAdmin(isAdminProfile(u?.profile)));
  }, [auth]);
  const remove = async (d: DebateSummary) => {
    if (!window.confirm(`「${d.theme}」を削除します。発言と判定も消え、元に戻せません。本当に削除しますか?`)) return;
    try {
      await api.deleteDebate(d.debateId);
      setItems((cur) => cur.filter((c) => c.debateId !== d.debateId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  // 確かめずに切り替える(元に戻せるため)。一覧からは除かず、ボタンと札を切り替える
  const toggleHidden = async (d: DebateSummary) => {
    const hidden = !d.hidden;
    try {
      await api.setHidden(d.debateId, hidden);
      setItems((cur) => cur.map((c) => (c.debateId === d.debateId ? { ...c, hidden } : c)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await api.listDebates(cursor);
      setItems((cur) => [...cur, ...res.items.filter((i) => !cur.some((c) => c.debateId === i.debateId))]);
      setCursor(res.nextCursor);
      setHasMore(Boolean(res.nextCursor));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, cursor, hasMore, loading]);

  useEffect(() => {
    void loadMore();
    // 最初の1回だけ読む。続きは「もっと見る」で読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="page">
      <div className="page-head sticky">
        <h1>
          議論の一覧 <span className="count">{items.length}件{hasMore ? '(続きあり)' : ''}</span>
        </h1>
        <Link className="button primary" to="/new">
          議論を始める
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      <ul className="debate-list">
        {items.map((d) => {
          const deletable = admin && d.status !== 'running';
          return (
          <li key={d.debateId} className={admin ? (deletable ? 'admin-actions deletable' : 'admin-actions') : undefined}>
            {/* テーマのリンクがカード全体を覆う(CSS)。カードのどこを押しても議論の画面へ移り、
                「この設定で作る」と「削除」は、その上に重ねて別に押せる(docs/04-app/README.md「画面の一覧」) */}
            <div className="debate-card">
              <Link to={`/debates/${d.debateId}`} className="debate-card-theme">
                {d.theme}
              </Link>
              <div className="matchup compact">
                <div className="matchup-slot pro">
                  <Avatar modelId={participantModel(d, 'pro')} role="pro" />
                  <div className="matchup-side pro">
                    <span className="matchup-role">先攻</span>
                    <span className="matchup-name">{positionsOf(d).pro}</span>
                  </div>
                </div>
                <span className="matchup-vs">VS</span>
                <div className="matchup-slot con">
                  <div className="matchup-side con">
                    <span className="matchup-role">後攻</span>
                    <span className="matchup-name">{positionsOf(d).con}</span>
                  </div>
                  <Avatar modelId={participantModel(d, 'con')} role="con" />
                </div>
              </div>
              <div className="head-chips">
                <span className={`chip status ${d.status}`}>{statusLabel(d.status)}</span>
                {admin && d.hidden && <span className="chip chip-hidden">非公開</span>}
                {/* 終了した議論だけ(議論中・失敗には出さない) */}
                {d.status === 'done' && (
                  <Link to={`/new?from=${encodeURIComponent(d.debateId)}`} className="chip chip-action">
                    この設定で作る
                  </Link>
                )}
                <span className="chip">{formatDateTime(d.createdAt)}</span>
              </div>
              {admin && (
                <div className="debate-admin">
                  <button type="button" className="button small debate-hide" onClick={() => void toggleHidden(d)}>
                    {d.hidden ? '見せる' : '隠す'}
                  </button>
                  {deletable && (
                    <button type="button" className="button small debate-delete" onClick={() => void remove(d)}>
                      削除
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
          );
        })}
      </ul>
      {!loading && items.length === 0 && !error && <p className="muted">まだ議論がありません。</p>}
      {hasMore && (
        <button className="button" onClick={() => void loadMore()} disabled={loading}>
          {loading ? '読み込み中…' : 'もっと見る'}
        </button>
      )}
      <JumpButtons
        targets={[
          { label: '先頭へ', to: 'top', arrow: 'up' },
          { label: '一番下へ', to: 'bottom', arrow: 'down', arrowAfter: true },
        ]}
      />
    </main>
  );
}
