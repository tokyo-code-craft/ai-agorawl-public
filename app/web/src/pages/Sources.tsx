// 引用の番号から資料の中身を開く部品と、資料一覧の節。仕様: docs/04-app/README.md「議論の画面」「資料一覧の節」
import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Positions, Source } from '@agorawl/contract';
import { speakerLabel, splitCitations } from '../logic';

/**
 * 議論の画面の資料一覧。項目の内容(項目ごとの点数、作戦メモ、項目の窓)の資料の番号を押せるようにするために、
 * 議論の画面の全体に渡す。ないところでは、番号はただの文字のまま
 */
export const CitationContext = createContext<{ sources: Map<number, Source>; positions: Positions } | null>(null);

/** 資料1件の中身(検索語、どちらがどのターンで調べたか、要約、出典のURL) */
function SourceBody({ source, positions }: { source: Source; positions: Positions }) {
  return (
    <>
      <div className="source-head">
        <span className="source-id">[{source.id}]</span> 「{source.query}」
        <span className="muted small">
          (ターン{source.turn} {speakerLabel(source.role, positions)}が検索)
        </span>
      </div>
      <p className="source-text">{source.text}</p>
      <div className="source-urls small">
        出典:{' '}
        {source.urls.length === 0
          ? 'なし'
          : source.urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                {u}
              </a>
            ))}
      </div>
    </>
  );
}

/** 資料の中身を出す窓 */
function SourceModal({ source, positions, onClose }: { source: Source; positions: Positions; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <SourceBody source={source} positions={positions} />
    </Modal>
  );
}

/**
 * 窓(モーダル)。資料の中身と、審判の理由の文の項目の中身に使う。ブラウザの dialog を使う(Escキーで閉じる、背面を操作させない)。
 * 窓の外を押しても閉じる。閉じても、ページの位置は変わらない
 */
export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // 開いたら窓を出す。閉じたあとは部品ごと消えるので、後始末で close しない(開発時に効果が2回走っても閉じないように)
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="source-modal"
      onClose={onClose}
      onClick={(e) => {
        // 窓の中で押したことを、窓を置いた外側の部品(全文を開く項目の内容など)に伝えない
        e.stopPropagation();
        // 窓の外(背景)を押したら閉じる
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="source-modal-body">
        {children}
        <button type="button" className="button" onClick={onClose} autoFocus>
          閉じる
        </button>
      </div>
    </dialog>
  );
}

/** 発言の引用の番号。押すと、窓(モーダル)で資料の中身を出す */
export function Citations({
  citations,
  invalid,
  sources,
  positions,
}: {
  citations: number[];
  invalid: number[];
  sources: Map<number, Source>;
  positions: Positions;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const opened = open === null ? undefined : sources.get(open);
  return (
    <div className="citations">
      引用:{' '}
      {citations.map((n) =>
        invalid.includes(n) || !sources.has(n) ? (
          <span key={n} className="cite invalid" title="資料一覧にない番号">
            [{n}] 資料一覧にない番号
          </span>
        ) : (
          <button key={n} type="button" className="cite" onClick={() => setOpen(n)}>
            [{n}]
          </button>
        ),
      )}
      {opened && <SourceModal source={opened} positions={positions} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 文の中の資料の番号([3] など)を押せるようにする。資料一覧にない番号は、ただの文字のまま */
export function TextWithCitations({
  text,
  sources,
  positions,
  renderText,
}: {
  text: string;
  sources: Map<number, Source>;
  positions: Positions;
  /** 番号以外の文字の出し方(審判の理由の文で、項目のIDを押せるようにするため)。なければ、そのまま出す */
  renderText?: (text: string) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const opened = open === null ? undefined : sources.get(open);
  return (
    <>
      {splitCitations(text).map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{renderText ? renderText(p) : p}</span>
        ) : !sources.has(p) ? (
          <span key={i}>{`[${p}]`}</span>
        ) : (
          <button
            key={i}
            type="button"
            className="cite inline"
            onClick={(e) => {
              // 番号を押したときは、外側の部品(全文を開く項目の内容など)を動かさない
              e.stopPropagation();
              setOpen(p);
            }}
          >
            [{p}]
          </button>
        ),
      )}
      {opened && <SourceModal source={opened} positions={positions} onClose={() => setOpen(null)} />}
    </>
  );
}

/** 資料一覧の節。初めは閉じておき、開いたときだけ、すべての資料を番号順に並べる(ページを長くしないため) */
export function SourcesSection({ sources, positions }: { sources: Source[]; positions: Positions }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <section className="sources" id="sources">
      <button type="button" className="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? `資料一覧(${sources.length}件)を閉じる` : `資料一覧(${sources.length}件)を開く`}
      </button>
      {open && (
        <>
      <p className="muted small">
        討論者がWeb検索で集めた資料。要約は検索用のAIがまとめたもので、元のページの本文ではない。出典のURLで確かめられる。両者と審判が同じ資料一覧を読む。
      </p>
      <ol className="source-list">
        {sources.map((s) => (
          <li key={s.id} id={`source-${s.id}`}>
            <SourceBody source={s} positions={positions} />
          </li>
        ))}
      </ol>
        </>
      )}
    </section>
  );
}
