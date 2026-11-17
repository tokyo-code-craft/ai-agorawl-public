// 採用したときの記録(Markdown)。仕様: docs/05-persona-illustration/README.md「記録」
import type { Answer, JudgeAnswer } from './answer';
import type { Character } from './characters';

/** 候補1枚ごとに out/<ID>/<番号>.json に残す情報 */
export interface CandidateMeta {
  file: string;
  seed: number;
  prompt: string;
  negativePrompt: string;
  modelId: string;
  aspectRatio: string;
  generatedAt: string;
}

/** answers/<ID>.json の中身。審判の答えは JudgeAnswer */
export interface SavedAnswer<A extends Answer | JudgeAnswer = Answer> {
  question: string;
  modelId: string;
  answeredAt: string;
  answer: A;
  /** モデルの応答そのもの(読み取りの確認用) */
  raw: string;
}

export interface RecordInput {
  character: Character;
  /** 採用した候補の番号 */
  adopted: number;
  /** 採用した画像の、記録のファイルからの相対パス */
  imagePath: string;
  backgroundRemovedBy: string;
  adoptedAt: string;
  answer: SavedAnswer;
  /** それまでに出したすべての候補(番号の順) */
  candidates: (CandidateMeta & { number: number })[];
}

const ANSWER_LABELS: [keyof Answer, string][] = [
  ['motif', '何か'],
  ['reason', '理由'],
  ['colors', '色'],
  ['outfit', '服装'],
  ['prop', '持ち物'],
  ['pose', 'しぐさ'],
  ['expression', '表情'],
  ['personality', '性格'],
  ['imagePrompt', '画像生成への外見の指示'],
];

const cell = (v: string | string[]) => (Array.isArray(v) ? v.join('、') : v).replace(/\|/g, '\|').replace(/\n/g, ' ');
/** コードブロック。中身に ``` があっても崩れないよう、中身の最長の ` の並びより長い囲みにする */
const block = (s: string) => {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${s.trimEnd()}\n${fence}`;
};

export function buildRecord(r: RecordInput): string {
  const adopted = r.candidates.find((c) => c.number === r.adopted);
  if (!adopted) throw new Error(`採用した候補の情報がありません: ${r.adopted}`);

  // 使った指示ごとにまとめ、候補の表では「指示1」「指示2」と呼ぶ
  const prompts: string[] = [];
  const promptNo = (p: string) => {
    if (!prompts.includes(p)) prompts.push(p);
    return prompts.indexOf(p) + 1;
  };
  const rows = r.candidates.map(
    (c) =>
      `| ${c.number}${c.number === r.adopted ? '(採用)' : ''} | ${c.seed} | 指示${promptNo(c.prompt)} | ${c.modelId} | ${c.generatedAt} |`,
  );
  const negatives = [...new Set(r.candidates.map((c) => c.negativePrompt))];

  return [
    `# 立ち絵の記録: ${r.character.name}(${r.character.id})`,
    '',
    'このファイルは `npm run generate-illustration -- adopt` が書く。仕様: `docs/05-persona-illustration/README.md`「記録」',
    '',
    '## 採用した画像',
    '',
    `![${r.character.name}](${r.imagePath})`,
    '',
    '| 項目 | 内容 |',
    '|---|---|',
    `| 採用した候補 | ${r.adopted} |`,
    `| 採用した日時 | ${r.adoptedAt} |`,
    `| 画像生成のモデル | ${adopted.modelId} |`,
    `| 縦横比 | ${adopted.aspectRatio} |`,
    `| シード | ${adopted.seed} |`,
    `| 生成した日時 | ${adopted.generatedAt} |`,
    `| 背景を消したモデル | ${r.backgroundRemovedBy} |`,
    '',
    '画像の指示(プロンプト):',
    '',
    block(adopted.prompt),
    '',
    '描かせないもの(ネガティブプロンプト):',
    '',
    block(adopted.negativePrompt),
    '',
    '## AIへの質問と答え',
    '',
    `| 項目 | 内容 |`,
    '|---|---|',
    `| 聞いたモデル | ${r.answer.modelId} |`,
    `| 答えた日時 | ${r.answer.answeredAt} |`,
    '',
    '質問:',
    '',
    block(r.answer.question),
    '',
    '答え:',
    '',
    '| 項目 | 答え |',
    '|---|---|',
    ...ANSWER_LABELS.map(([k, label]) => `| ${label}(\`${k}\`) | ${cell(r.answer.answer[k])} |`),
    '',
    '応答そのもの:',
    '',
    block(r.answer.raw),
    '',
    '## 出したすべての候補',
    '',
    '| 番号 | シード | 指示 | モデル | 生成した日時 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...prompts.flatMap((p, i) => [`指示${i + 1}:`, '', block(p), '']),
    ...(negatives.length > 1 ? negatives.flatMap((n, i) => [`描かせないもの${i + 1}:`, '', block(n), '']) : []),
  ].join('\n');
}
