// 議論の画面。先攻を左、後攻を右に並べ、届いた発言を下に足す。仕様: docs/04-app/README.md「議論の画面」
import { useMemo, useState } from 'react';
import type { DebaterNotes } from '@agorawl/contract';
import { Link, useParams } from 'react-router';
import { useServices } from '../context';
import { Arrow } from '../components/Arrow';
import { Avatar } from '../components/Avatar';
import { CutIn, useCutIn } from '../components/CutIn';
import { JumpButtons } from '../components/JumpButtons';
import { NewTurnNotice, turnElementId, useNewTurns } from '../components/NewTurnNotice';
import { collectSources, formatDateTime, participantModel, positionsOf, speakerLabel, stageLabel, statusLabel } from '../logic';
import { useDebateStream } from '../useDebateStream';
import { claimStatusLabel, ID_LEGEND, rebuttalStatusLabel } from '../verdict';
import { CitationContext, Citations, SourcesSection, TextWithCitations } from './Sources';
import { ResultSection } from './ResultSection';
import { Clamp, VerdictSection } from './VerdictSection';

export function DebateView() {
  const { debateId = '' } = useParams();
  const { api, auth, config } = useServices();
  const deps = useMemo(() => ({ api, auth, webSocketUrl: config.webSocketUrl }), [api, auth, config.webSocketUrl]);
  const { debate, messages, live, error } = useDebateStream(debateId, deps);
  const cutIn = useCutIn(debateId, debate, Boolean(error && !debate));
  const sources = useMemo(() => collectSources(messages), [messages]);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  // 作戦メモを開いている発言のターン
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const toggleNotes = (turn: number) =>
    setOpenNotes((cur) => {
      const next = new Set(cur);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });

  // 発言が届いても画面は動かさず、まだ見ていない発言があれば画面の下で知らせる
  const turns = useMemo(() => messages.map((m) => m.turn), [messages]);
  const newTurns = useNewTurns(turns, debate !== null);

  if (error && !debate) {
    return (
      <main className="page">
        <p className="error">{error}</p>
        <Link to="/">一覧へ戻る</Link>
      </main>
    );
  }
  // 読み込み中も、カットインの覆いを先に出す
  const cutInView = (
    <CutIn phase={cutIn.phase} pictures={cutIn.pictures} positions={debate ? positionsOf(debate) : null} theme={debate?.theme ?? null} onSkip={cutIn.skip} />
  );
  if (!debate)
    return (
      <main className="page muted">
        読み込み中…
        {cutInView}
      </main>
    );

  const running = debate.status === 'running';
  const positions = positionsOf(debate);

  return (
    // 項目の内容(作戦メモ、項目ごとの点数、項目の窓)の資料の番号も押せるように、資料一覧を画面の全体に渡す
    <CitationContext.Provider value={{ sources: sourceById, positions }}>
    <main className="page">
      <Link to="/" className="back">
        <Arrow direction="left" />
        一覧へ
      </Link>
      <div className="debate-head">
        <h1 className="debate-title">{debate.theme}</h1>
        <div className="matchup">
          <div className="matchup-slot pro">
            <Avatar modelId={participantModel(debate, 'pro')} role="pro" />
            <div className="matchup-side pro">
              <span className="matchup-role">先攻</span>
              <span className="matchup-name">{positions.pro}</span>
            </div>
          </div>
          <span className="matchup-vs">VS</span>
          <div className="matchup-slot con">
            <div className="matchup-side con">
              <span className="matchup-role">後攻</span>
              <span className="matchup-name">{positions.con}</span>
            </div>
            <Avatar modelId={participantModel(debate, 'con')} role="con" />
          </div>
        </div>
        <div className="head-chips">
          <span className={`chip status ${debate.status}`}>{statusLabel(debate.status)}</span>
          <span className="chip">
            {messages.filter((m) => m.role === 'pro' || m.role === 'con').length} / {debate.maxTurns}ターン
          </span>
          <span className="chip">{formatDateTime(debate.createdAt)}</span>
          {running && <span className={`chip live ${live ? 'on' : 'off'}`}>{live ? '● 接続中' : '○ 再接続中…'}</span>}
        </div>
      </div>

      <ol className="speeches">
        {messages.map((m) => (
          <li key={m.turn} id={turnElementId(m.turn)} data-turn={m.turn} className={`speech ${m.role}`}>
            <Avatar modelId={m.modelId} role={m.role} />
            <div className="bubble">
              <div className="speech-head">
                <span className="turn-label">
                  ターン{m.turn}・{stageLabel(m)}
                </span>
                <span className="speaker">{speakerLabel(m.role, positions)}</span>
                {m.conceded && <span className="mark">投了</span>}
                {m.exhausted && <span className="mark">引き分け</span>}
              </div>
              <div className="speech-body">
                <TextWithCitations text={m.content} sources={sourceById} positions={positions} />
              </div>
              {m.citations?.length ? (
                <Citations citations={m.citations} invalid={m.invalidCitations ?? []} sources={sourceById} positions={positions} />
              ) : null}
              {/* 作戦メモは議論の終了後だけ(進行中はAPIも返さない) */}
              {!running && m.notes && (
                <>
                  <button type="button" className="button small notes-toggle" onClick={() => toggleNotes(m.turn)}>
                    {openNotes.has(m.turn) ? '作戦メモを閉じる' : '作戦メモ'}
                  </button>
                  {openNotes.has(m.turn) && <NotesView notes={m.notes} />}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>

      <SourcesSection sources={sources} positions={positions} />

      {running && <p className="waiting">議論中です。次の発言を待っています…</p>}
      {/* 結果(絵で勝ち負け)、判定の内訳、項目ごとの点数の順(docs/04-app/README.md「議論の画面」の「結果と判定」) */}
      {!running && <ResultSection debate={debate} positions={positions} />}
      {!running && debate.verdict && debate.verdict.judgments.length > 0 && (
        <VerdictSection verdict={debate.verdict} positions={positions} messages={messages} sources={sourceById} />
      )}
      {error && <p className="error">{error}</p>}

      {/* どの位置からでも移れるボタン(docs/04-app/README.md「議論の画面」の「移動のボタン」) */}
      <JumpButtons
        targets={[
          { label: '先頭へ', to: 'top', arrow: 'up' },
          ...(!running ? [{ label: '結果へ', to: 'result', arrow: 'down', arrowAfter: true, primary: true } as const] : []),
        ]}
      />
      <NewTurnNotice range={newTurns} />
      {cutInView}
    </main>
    </CitationContext.Provider>
  );
}

/** その発言の時点の作戦メモ(主張一覧と反論一覧) */
function NotesView({ notes }: { notes: DebaterNotes }) {
  return (
    <div className="notes">
      <p className="muted small">{ID_LEGEND}</p>
      <div className="notes-title">主張</div>
      <ul>
        {notes.claims.map((c) => (
          <li key={c.id}>
            <span className="id">{c.id}</span> <span className="num">{c.score}点</span> <span className="status-cell">{claimStatusLabel(c.status)}</span>{' '}
            <Clamp text={c.text} />
          </li>
        ))}
      </ul>
      <div className="notes-title">反論</div>
      {notes.rebuttals.length === 0 ? (
        <p className="muted small">なし</p>
      ) : (
        <ul>
          {notes.rebuttals.map((r) => (
            <li key={r.id}>
              <span className="id">{r.id}</span> <span className="num">{r.score}点</span>{' '}
              <span className="status-cell">{rebuttalStatusLabel(r.status)}</span> <Clamp text={`${r.text}(対象: ${r.target})`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
