// 判定の節の組み立て(多数決の内訳、審判の名前、項目ごとの点数)。画面に触れない部分。
// 仕様: docs/04-app/README.md「判定の節」
import { VIEWPOINT_WEIGHT, type DebaterNotes, type DebaterRole, type JudgeViewpoint, type Judgment, type Message, type Positions, type Verdict } from '@agorawl/contract';

/** 表示用のモデル名。知らないモデルIDは、そのまま出す */
const MODEL_NAMES: Record<string, string> = {
  'openai.gpt-oss-120b-1:0': 'OpenAI gpt-oss-120b',
  'qwen.qwen3-235b-a22b-2507-v1:0': 'Qwen3 235B',
  'deepseek.v3.2': 'DeepSeek V3.2',
  'global.anthropic.claude-opus-4-6-v1': 'Claude Opus 4.6',
};

/** 審判の絵(モデルによらず1つ。docs/04-app/README.md「判定の節」) */
export const JUDGE_FIGURE = '/characters/judge-front-sm.png';

/** 審判の観点の名前と説明(docs/04-app/README.md「判定の節」) */
export const VIEWPOINTS: Record<JudgeViewpoint, { short: string; name: string; description: string }> = {
  logic: { short: '論理', name: '論理の審判', description: '主張と理由の筋道、前の発言との矛盾を特に注意して見る' },
  evidence: { short: '根拠', name: '根拠の審判', description: '引用が資料と合っているか、根拠の出どころが確かかを特に注意して見る' },
  exchange: { short: '反論・応答', name: '反論・応答の審判', description: '反論が相手の主張を崩しているか、受けた反論に正面から答えているかを特に注意して見る' },
};

/** 審判の名前。例:「審判1(OpenAI gpt-oss-120b)」、観点があれば「審判1 論理の審判(Claude Opus 4.6)」 */
export function judgeName(index: number, modelId: string, viewpoint?: JudgeViewpoint): string {
  const { label, model } = judgeNameParts(index, modelId, viewpoint);
  return `${label}${model}`;
}

/** 審判の名前を、番号と観点(「審判1 論理の審判」)と、モデル名(「(Claude Opus 4.6)」)に分ける。カードでは2行に分けて出す */
export function judgeNameParts(index: number, modelId: string, viewpoint?: JudgeViewpoint): { label: string; model: string } {
  const vp = viewpoint ? VIEWPOINTS[viewpoint] : undefined;
  return { label: vp ? `審判${index + 1} ${vp.name}` : `審判${index + 1}`, model: `(${MODEL_NAMES[modelId] ?? modelId})` };
}

/** 勝者の名前(引き分けは「引き分け」) */
export function sideWinner(winner: Judgment['winner'], positions: Positions): string {
  return winner === 'draw' ? '引き分け' : `${positions[winner]}の勝ち`;
}

/**
 * 多数決の結果。何人の審判がその勝者を選んだかも示す。
 * 多数決の勝者がない(項目を加える前の)判定は、1人目の審判の勝者を出す
 */
export function majorityText(verdict: Verdict, positions: Positions): string {
  const n = verdict.judgments.length;
  const winner = verdict.winner ?? verdict.judgments[0]?.winner;
  if (!winner) return '';
  const votes = verdict.judgments.filter((j) => j.winner === winner).length;
  if (n <= 1) return sideWinner(winner, positions);
  // 過半数の審判が同じ勝者を選ばなかった引き分け
  if (winner === 'draw' && votes * 2 <= n) return `引き分け(審判${n}人の判定が分かれた)`;
  return `${sideWinner(winner, positions)}(審判${n}人のうち${votes}人)`;
}

/** IDの説明(docs/04-app/README.md「判定の節」) */
export const ID_LEGEND = 'C1、C2…は主張(自分の立場が良い理由)、R1、R2…は反論(相手の主張の弱さを突く指摘)。番号は先攻と後攻で別々に振る。';

export const CRITERION_LABELS = { logic: '論理', evidence: '根拠', rebuttal: '反論', response: '応答' } as const;

/**
 * 判定の内訳の節の先頭の文。審判が何で採点し、誰がどちらを選び、多数決でどうなったか。
 * 例:「審判3人が、両者を4項目(論理・根拠・反論・応答。各0〜10点、合計40点)で採点し、それぞれ勝者を選びました。
 * 熊派を選んだのは2人(審判1・審判3)、虎派を選んだのは1人(審判2)です。過半数の審判が選んだ熊派の勝ちです。」
 */
export function verdictSummary(verdict: Verdict, positions: Positions): string {
  const { judgments } = verdict;
  const n = judgments.length;
  if (n === 0) return '';
  const labels = Object.values(CRITERION_LABELS);
  // すべての審判が重みを持てば、観点の項目を重くして合計したことを書く
  const scoring = judgments.every((j) => j.weights)
    ? `両者を${labels.length}項目(${labels.join('・')}。各0〜10点)で採点し、観点の項目の点を${VIEWPOINT_WEIGHT}倍にして合計し`
    : `両者を${labels.length}項目(${labels.join('・')}。各0〜10点、合計${labels.length * 10}点)で採点し`;
  if (n === 1) {
    const w = judgments[0].winner;
    return `審判1人が、${scoring}、${w === 'draw' ? '引き分けとしました' : `${positions[w]}を勝者に選びました`}。`;
  }

  // 選んだ人の多い順(同じなら先攻、後攻、引き分けの順)。選んだ人がいない側は書かない
  const groups = (['pro', 'con', 'draw'] as const)
    .map((w) => ({ w, judges: judgments.flatMap((j, i) => (j.winner === w ? [`審判${i + 1}`] : [])) }))
    .filter((g) => g.judges.length > 0)
    .sort((a, b) => b.judges.length - a.judges.length);
  const picks = groups
    .map((g) => `${g.w === 'draw' ? '引き分けとした' : `${positions[g.w]}を選んだ`}のは${g.judges.length}人(${g.judges.join('・')})`)
    .join('、');
  // すべての審判に観点があれば、審判ごとの観点を示す
  const allViewpoints = judgments.every((j) => j.viewpoint)
    ? `それぞれ別の観点(${judgments.map((j, i) => `審判${i + 1}は${VIEWPOINTS[j.viewpoint!].short}`).join('、')})から、`
    : '';
  const sentences = [`審判${n}人が、${allViewpoints}${scoring}、それぞれ勝者を選びました。`, `${picks}です。`];

  // 多数決の勝者がない(多数決を入れる前の)判定は、結論の文を出さない
  const winner = verdict.winner;
  if (winner === 'draw') {
    const drawVotes = judgments.filter((j) => j.winner === 'draw').length;
    sentences.push(drawVotes * 2 > n ? '過半数の審判が引き分けとしたため、引き分けです。' : '過半数の審判が同じ側を選ばなかったため、引き分けです。');
  } else if (winner) {
    sentences.push(`過半数の審判が選んだ${positions[winner]}の勝ちです。`);
  }
  return sentences.join('');
}

const CLAIM_STATUS = { defending: '守る', abandoned: '捨てる' } as const;
const REBUTTAL_STATUS = { won: '獲得', pursuing: '追及中', dropped: '断念' } as const;

export interface ItemRow {
  id: string;
  kind: 'claim' | 'rebuttal';
  text: string;
  /** 反論の対象 */
  target?: string;
  /** 討論者の状態(守る・捨てる、獲得・追及中・断念) */
  status: string;
  /** 討論者の点数 */
  score: number;
  /** 審判ごとの点数(judgments の順)。審判に渡していない項目は '-' */
  judgeScores: (number | '-')[];
}

/** 審判の理由の文の中の項目のID(「先攻C1」「後攻R2」など) */
export interface ItemRef {
  role: DebaterRole;
  /** 側を外したID(「C1」など。作戦メモと同じ形) */
  id: string;
  /** 文の中の書き方(「先攻C1」など) */
  text: string;
}

const SIDE_OF: Record<string, DebaterRole> = { 先攻: 'pro', 後攻: 'con' };

/**
 * 文を、ふつうの文字と項目のID(先攻・後攻を頭に付けたもの)に分ける。審判は理由の文でこの書き方を使う。
 * 「先攻R3・R9」のように「・」でつないだ2つめ以降は、頭を省いても同じ側のIDとする
 */
export function splitItemRefs(text: string): (string | ItemRef)[] {
  const parts: (string | ItemRef)[] = [];
  let last = 0;
  for (const m of text.matchAll(/(先攻|後攻)([CR]\d+(?:・[CR]\d+)*)/g)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const role = SIDE_OF[m[1]];
    m[2].split('・').forEach((id, i) => {
      if (i > 0) parts.push('・');
      parts.push({ role, id, text: i === 0 ? `${m[1]}${id}` : id });
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** その側の最後の作戦メモ */
export function lastNotes(messages: Message[], role: DebaterRole): DebaterNotes | undefined {
  return [...messages].sort((a, b) => b.turn - a.turn).find((m) => m.role === role && m.notes)?.notes;
}

/**
 * 項目ごとの点数の表の行。項目は、その側の最後の作戦メモにあるもの。
 * 審判が項目ごとの点数を付けていない(古い)判定なら、空
 */
export function itemRows(messages: Message[], role: DebaterRole, judgments: Judgment[]): ItemRow[] {
  const scored = judgments.some((j) => j[role].claims || j[role].rebuttals);
  const notes = lastNotes(messages, role);
  if (!scored || !notes) return [];
  const judged = (kind: 'claims' | 'rebuttals', id: string) =>
    judgments.map((j) => j[role][kind]?.find((x) => x.id === id)?.score ?? ('-' as const));
  return [
    ...notes.claims.map((c) => ({
      id: c.id,
      kind: 'claim' as const,
      text: c.text,
      status: CLAIM_STATUS[c.status],
      score: c.score,
      judgeScores: judged('claims', c.id),
    })),
    ...notes.rebuttals.map((r) => ({
      id: r.id,
      kind: 'rebuttal' as const,
      text: r.text,
      target: r.target,
      status: REBUTTAL_STATUS[r.status],
      score: r.score,
      judgeScores: judged('rebuttals', r.id),
    })),
  ];
}

/** 作戦メモの状態の表示(発言ごとの作戦メモで使う) */
export const claimStatusLabel = (s: keyof typeof CLAIM_STATUS) => CLAIM_STATUS[s];
export const rebuttalStatusLabel = (s: keyof typeof REBUTTAL_STATUS) => REBUTTAL_STATUS[s];
