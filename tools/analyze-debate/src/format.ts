// 指標の表示(Markdownの表)。2件以上の議論は、列を横に並べて比べる。
import { CRITERIA, type DebaterRole } from '@agorawl/contract';
import type { DebateMetrics, SideMetrics } from './metrics';

const SIDES: DebaterRole[] = ['pro', 'con'];
const SIDE_LABELS: Record<DebaterRole, string> = { pro: '先攻', con: '後攻' };
const END_REASON_LABELS = { maxTurns: '最大ターン数', conceded: '投了', exhausted: '引き分け(攻め手が尽きた)' } as const;

export function formatReport(debates: DebateMetrics[]): string {
  return [formatOverview(debates), '', formatClaims(debates)].join('\n');
}

function formatOverview(debates: DebateMetrics[]): string {
  const rows: [string, ...string[]][] = [
    ['議論ID', ...debates.map((d) => `\`${d.debateId}\``)],
    ['テーマ', ...debates.map((d) => d.theme)],
    ['立場', ...debates.map((d) => `先攻「${d.positions.pro}」/ 後攻「${d.positions.con}」`)],
    ['ターン数', ...debates.map((d) => String(d.turns))],
    [
      '終了理由',
      ...debates.map((d) => {
        if (!d.endReason) return '(実行中か失敗)';
        const label = END_REASON_LABELS[d.endReason];
        return d.concededBy ? `${label}(${SIDE_LABELS[d.concededBy]})` : label;
      }),
    ],
    [
      '判定',
      ...debates.map((d) =>
        d.judgments.length === 0
          ? '(なし)'
          : d.judgments
              .map((j) => {
                const side = (r: DebaterRole) =>
                  `${SIDE_LABELS[r]}${j[r].total}(${CRITERIA.map((k) => `${k} ${j[r].scores[k]}`).join('、')})`;
                const winner = j.winner === 'draw' ? '引き分け' : `${SIDE_LABELS[j.winner]}の勝ち`;
                return `${winner}: ${side('pro')} / ${side('con')}`;
              })
              .join('<br>'),
      ),
    ],
  ];
  return ['## 議論の概要', '', ...table(['', ...debates.map((_, i) => `議論${i + 1}`)], rows)].join('\n');
}

function formatClaims(debates: DebateMetrics[]): string {
  const columns = debates.flatMap((d, i) => SIDES.map((role) => ({ label: `議論${i + 1} ${SIDE_LABELS[role]}`, m: d.sides[role] })));
  const row = (label: string, value: (m: SideMetrics) => string): [string, ...string[]] => [
    label,
    ...columns.map((c) => (c.m ? value(c.m) : '-')),
  ];
  const rows = [
    row('自分の発言の数', (m) => String(m.turns)),
    row('攻防の発言の字数(平均)', (m) => (m.speech ? String(Math.round(m.speech.avgLength)) : '-')),
    row('相手の発言の引用(平均回数)', (m) => (m.speech ? m.speech.avgOpponentQuotes.toFixed(1) : '-')),
    row('論点を並べる形の発言', (m) => (m.speech ? `${Math.round(m.speech.enumeratedShare * 100)}%` : '-')),
    row('1回の発言で動かした反論(平均)', (m) => (m.speech ? m.speech.avgMovedRebuttals.toFixed(1) : '-')),
    row('立論の主張', (m) => String(m.openingClaims)),
    row('途中で足した主張', (m) => String(m.addedClaimIds.length)),
    row('うち「相手」を含む', (m) => {
      const ids = m.addedClaimsMentioningOpponent;
      return ids.length === 0 ? '0' : `${ids.length}(${ids.join(', ')})`;
    }),
    row('最終の主張', (m) => String(m.finalClaims)),
    row('点数: 上げた / 下げた / 同じ', (m) => `${m.scoreChanges.up} / ${m.scoreChanges.down} / ${m.scoreChanges.same}`),
    row('最終の点数の分布', (m) =>
      Object.entries(m.finalScoreDistribution)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([score, n]) => `${score}点×${n}`)
        .join('、'),
    ),
    row('捨てた主張', (m) => String(m.abandonedClaims)),
    row('主張を捨てた発言 / うち撤回を述べた', (m) => {
      const w = m.withdrawals;
      const detail = w.map((x) => `ターン${x.turn} ${x.claimIds.join(', ')}${x.declared ? '' : '(述べず)'}`).join('、');
      return `${w.length} / ${w.filter((x) => x.declared).length}${detail ? `(${detail})` : ''}`;
    }),
    row('守っている主張の推移', (m) => m.defendingByTurn.map((x) => x.defending).join(' ')),
    row('見込みと審判の差(平均)', (m) => (m.calibration ? m.calibration.meanAbsDiff.toFixed(1) : '-')),
    row('見込みが審判より 高い / 低い / 同じ', (m) =>
      m.calibration ? `${m.calibration.over} / ${m.calibration.under} / ${m.calibration.same}` : '-',
    ),
    row('審判が3点以下と見て、守っていた主張', (m) => (m.calibration ? String(m.calibration.judgedWeakButDefended) : '-')),
  ];
  return [
    '## 作戦メモの主張',
    '',
    ...table(['', ...columns.map((c) => c.label)], rows),
    '',
    '- 「相手」を含む主張は、主張に反論の言い直しが混ざっていないかの目安(docs/03-engine/analysis.md)。',
    '- 点数の変化は、前回の自分の作戦メモと同じIDの主張どうしで比べる。',
    '- 守っている主張の推移は、自分の発言ごとの数(ターン順)。',
    '- 発言の形は、攻防の発言(立論と投了を除く)についての目安。相手の発言の引用は「相手は『」などの形、並べる形は「第一に」「まず、」「三つ」などの言葉で判定する。',
    '- 並べる形は、1つの主張を何段にも掘り下げる発言でも出る。論点を選んでいるかは、動かした反論(前回の作戦メモから追加・変更した反論)の数で見る。',
    '- 撤回を述べたかは、発言に「撤回」「取り下げ」「取下げ」を含むかで判定する目安(投了の発言は数えない)。',
    '- 見込みと審判の比較は、最終の作戦メモの主張の点数と、1人目の審判の主張ごとの点数を、同じIDで比べる(審判が主張ごとの点数を付けていない議論は「-」)。',
  ].join('\n');
}

function table(header: string[], rows: string[][]): string[] {
  const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)];
}
