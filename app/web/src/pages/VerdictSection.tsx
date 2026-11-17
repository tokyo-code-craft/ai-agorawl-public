// 判定の節(判定の内訳の節: 多数決の結果と審判ごとのカード。項目ごとの点数の節)。仕様: docs/04-app/README.md「判定の節」
import { useContext, useMemo, useState } from 'react';
import { CRITERIA, type DebaterRole, type Message, type Positions, type Source, type Verdict } from '@agorawl/contract';

type Judgment = Verdict['judgments'][number];
import { CitationContext, Modal, TextWithCitations } from './Sources';
import {
  CRITERION_LABELS,
  ID_LEGEND,
  itemRows,
  JUDGE_FIGURE,
  judgeNameParts,
  sideWinner,
  splitItemRefs,
  verdictSummary,
  VIEWPOINTS,
  type ItemRef,
  type ItemRow,
} from '../verdict';

/** 側ごとの、IDから項目の行を引く表(項目ごとの点数の表と同じ項目) */
type ItemLookup = Record<DebaterRole, Map<string, ItemRow>>;
import { ViewpointMark } from '../components/ViewpointMark';

export function VerdictSection({
  verdict,
  positions,
  messages,
  sources,
}: {
  verdict: Verdict;
  positions: Positions;
  messages: Message[];
  /** 理由の文の資料の番号を押したときに出す資料 */
  sources: Map<number, Source>;
}) {
  const { judgments } = verdict;
  const items = useMemo<ItemLookup>(
    () => ({
      pro: new Map(itemRows(messages, 'pro', judgments).map((r) => [r.id, r])),
      con: new Map(itemRows(messages, 'con', judgments).map((r) => [r.id, r])),
    }),
    [messages, judgments],
  );
  return (
    <>
      <section className="verdict" id="verdict">
        <h2>判定の内訳</h2>
        <p className="verdict-summary">{verdictSummary(verdict, positions)}</p>
        {/* 審判の理由の文に出てくる C1・R1 などの説明(項目ごとの点数の節と同じ文と見た目) */}
        <p className="muted small">{ID_LEGEND}</p>
        <div className="judges">
          {judgments.map((j, i) => (
            <JudgeCard key={j.modelId + i} judgment={j} index={i} positions={positions} sources={sources} items={items} />
          ))}
        </div>
      </section>
      <ItemTables positions={positions} messages={messages} verdict={verdict} />
    </>
  );
}

/** 審判1人のカード。名前、勝者、合計点を見せ、4項目の点数と理由は「詳しく見る」で開く */
function JudgeCard({
  judgment: j,
  index,
  positions,
  sources,
  items,
}: {
  judgment: Judgment;
  index: number;
  positions: Positions;
  sources: Map<number, Source>;
  items: ItemLookup;
}) {
  const [open, setOpen] = useState(false);
  const name = judgeNameParts(index, j.modelId, j.viewpoint);
  return (
    <article className={`judge-card ${open ? 'open' : ''}`}>
      <div className="judge-head">
        {/* 審判の絵と観点の印は飾り。名前と観点の説明で伝わるため読み上げない */}
        <div className="judge-figure" aria-hidden="true">
          <img className="judge-figure-img" src={JUDGE_FIGURE} alt="" />
          {j.viewpoint && <ViewpointMark viewpoint={j.viewpoint} />}
        </div>
        <div className="judge-head-text">
          <h3>
            <span className="judge-label">{name.label}</span>
            <span className="judge-model">{name.model}</span>
          </h3>
          {j.viewpoint && <p className="judge-viewpoint muted small">{VIEWPOINTS[j.viewpoint].description}</p>}
        </div>
      </div>
      {/* 勝者は見出しの外の1行にし、カードどうしで横にそろえる。勝った側の色の帯で出す */}
      <p className={`judge-winner ${j.winner}`}>{sideWinner(j.winner, positions)}</p>
      {(['pro', 'con'] as const).map((role) => (
        <div key={role} className={`judge-side ${role}`}>
          <div className="judge-side-head">
            <span className="speaker">{positions[role]}</span>
            <span className="total">{j[role].total}点</span>
          </div>
        </div>
      ))}
      <button type="button" className="button small judge-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '閉じる' : '詳しく見る'}
      </button>
      {/* 開いた中身は、横にそろえる行の外(カードのいちばん下)に出し、押したカードだけを伸ばす */}
      {open && (
        <div className="judge-details">
          {(['pro', 'con'] as const).map((role) => (
            <div key={role} className={`judge-detail ${role}`}>
              <span className="speaker">{positions[role]}</span>
              <div className="criteria">
                {CRITERIA.map((c) => (
                  <span key={c}>
                    {CRITERION_LABELS[c]} {j[role].scores[c]}
                    {(j.weights?.[c] ?? 1) > 1 && `×${j.weights![c]}`}
                  </span>
                ))}
              </div>
              <p className="reason">
                <TextWithCitations
                  text={j[role].reason}
                  sources={sources}
                  positions={positions}
                  renderText={(t) => <TextWithItemRefs text={t} items={items} positions={positions} />}
                />
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** 文の中の項目のID(「先攻C1」など)を押せるようにし、押すと窓で項目の中身を出す。項目の表にないIDは文字のまま */
function TextWithItemRefs({ text, items, positions }: { text: string; items: ItemLookup; positions: Positions }) {
  const [open, setOpen] = useState<ItemRef | null>(null);
  const opened = open && items[open.role].get(open.id);
  return (
    <>
      {splitItemRefs(text).map((p, i) =>
        typeof p === 'string' || !items[p.role].has(p.id) ? (
          <span key={i}>{typeof p === 'string' ? p : p.text}</span>
        ) : (
          <button key={i} type="button" className="cite inline" onClick={() => setOpen(p)}>
            {p.text}
          </button>
        ),
      )}
      {open && opened && (
        <Modal onClose={() => setOpen(null)}>
          <ItemBody role={open.role} row={opened} positions={positions} />
        </Modal>
      )}
    </>
  );
}

/** 項目1件の中身(見出し、内容、反論の対象、討論者と審判の点数)。内容の資料の番号も押せるようにする */
function ItemBody({ role, row, positions }: { role: DebaterRole; row: ItemRow; positions: Positions }) {
  const cite = useContext(CitationContext);
  const withCitations = (text: string) => (cite ? <TextWithCitations text={text} sources={cite.sources} positions={cite.positions} /> : text);
  return (
    <div className="item-modal">
      <h3 className={`item-modal-head ${role}`}>
        {positions[role]}({role === 'pro' ? '先攻' : '後攻'})の{row.kind === 'claim' ? '主張' : '反論'} {row.id}
      </h3>
      <p className="item-modal-text">{withCitations(row.text)}</p>
      {row.target && <p className="muted small">対象: {withCitations(row.target)}</p>}
      <p className="item-modal-scores small">
        討論者 {row.score} / 審判 {row.judgeScores.join('・')}
      </p>
    </div>
  );
}

/** 項目ごとの点数の表(先攻と後攻)。「項目ごとの点数を開く」で開く */
function ItemTables({ positions, messages, verdict }: { positions: Positions; messages: Message[]; verdict: Verdict }) {
  const [open, setOpen] = useState(false);
  const hasRows = (['pro', 'con'] as const).some((role) => itemRows(messages, role, verdict.judgments).length > 0);
  if (!hasRows) return null;
  return (
    <section className="items-section" id="items">
      <h2>項目ごとの点数</h2>
      <button type="button" className="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '項目ごとの点数を閉じる' : '項目ごとの点数を開く'}
      </button>
      {open &&
        (['pro', 'con'] as const).map((role) => <ItemTable key={role} role={role} positions={positions} messages={messages} verdict={verdict} />)}
    </section>
  );
}

function ItemTable({ role, positions, messages, verdict }: { role: DebaterRole; positions: Positions; messages: Message[]; verdict: Verdict }) {
  const rows = itemRows(messages, role, verdict.judgments);
  if (rows.length === 0) return null;
  return (
    <div className="items">
      <h3 className={`items-head ${role}`}>{positions[role]}の主張と反論</h3>
      <p className="muted small">{ID_LEGEND}点数は0〜10。討論者は自分で見込みを付け、審判は項目のIDと内容だけを見て付ける。「-」は審判に渡していない項目(最後の発言で初めて足した反論)。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>種類・ID</th>
              <th>内容</th>
              <th>討論者</th>
              {verdict.judgments.map((_, i) => (
                <th key={i}>審判{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="id">
                  {r.kind === 'claim' ? '主張' : '反論'} {r.id}
                </td>
                <td>
                  <Clamp text={r.target ? `${r.text}(対象: ${r.target})` : r.text} />
                </td>
                <td className="num">{r.score}</td>
                {r.judgeScores.map((s, i) => (
                  <td key={i} className="num">
                    {s}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* スマートフォンの幅では、表の代わりに1件ずつのカードにする(docs/04-app/README.md「判定の節」) */}
      <ul className="item-cards">
        {rows.map((r) => (
          <li key={r.id} className="item-card">
            <div className="item-card-head">
              <span className="id">
                {r.kind === 'claim' ? '主張' : '反論'} {r.id}
              </span>
              <span className="item-card-scores">
                討論者 {r.score} / 審判 {r.judgeScores.join('・')}
              </span>
            </div>
            <Clamp text={r.target ? `${r.text}(対象: ${r.target})` : r.text} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 長い内容は2行で切り、押すと全文を開く。資料の番号([3]など)は押せるようにし、押すと資料の窓を出す
 * (番号を押したときは全文を開け閉めしない)。番号のボタンを中に置くため、全体は button ではなく、ボタンの役割の div にする
 */
export function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const cite = useContext(CitationContext);
  const toggle = () => setOpen((o) => !o);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      className={`clamp ${open ? 'open' : ''}`}
      onClick={toggle}
      onKeyDown={(e) => {
        // 中の番号のボタンで押したキーは、番号のボタンに任せる
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          toggle();
        }
      }}
      title={open ? '閉じる' : '全文を開く'}
    >
      {cite ? <TextWithCitations text={text} sources={cite.sources} positions={cite.positions} /> : text}
    </div>
  );
}
