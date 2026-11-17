// AIに見た目を聞く質問と、答えの読み取り。仕様: docs/05-persona-illustration/README.md「見た目をAIに聞く」
import { STYLE } from './characters';

export const QUESTION = `あなたは、AI同士が議論する Web サービスで、討論者として登場します。あなた自身がキャラクターになるとしたら、どんな見た目ですか。コミカルでゆるキャラ風の2Dのイラストにします。会社のロゴや、既存のキャラクターには似せないでください。次の形の JSON だけで答えてください。

{
  "motif": "何の生き物・ものか",
  "reason": "なぜそれにしたか(日本語)",
  "colors": ["主な色を2〜3色"],
  "outfit": "服装",
  "prop": "持ち物(1つ)",
  "pose": "しぐさ",
  "expression": "表情",
  "personality": ["性格を3語"],
  "imagePrompt": "画像生成への外見の指示(英語、1〜2文。画風や背景は書かず、外見だけ)"
}`;

export interface Answer {
  motif: string;
  reason: string;
  colors: string[];
  outfit: string;
  prop: string;
  pose: string;
  expression: string;
  personality: string[];
  imagePrompt: string;
}

const STRING_KEYS = ['motif', 'reason', 'outfit', 'prop', 'pose', 'expression', 'imagePrompt'] as const;
const ARRAY_KEYS = ['colors', 'personality'] as const;

/** モデルの応答から JSON を取り出し、答えの形を確かめる。前後の文やコードブロックの囲みは無視する */
export function parseAnswer(text: string): Answer {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('答えに JSON がありません');
  const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of STRING_KEYS) {
    if (typeof obj[k] !== 'string' || !(obj[k] as string).trim()) errors.push(`${k} が文字列ではありません`);
  }
  for (const k of ARRAY_KEYS) {
    const v = obj[k];
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) errors.push(`${k} が文字列の配列ではありません`);
  }
  if (errors.length) throw new Error(`答えの形が違います: ${errors.join('、')}`);
  return Object.fromEntries([...STRING_KEYS, ...ARRAY_KEYS].map((k) => [k, obj[k]])) as unknown as Answer;
}

/** 審判の観点(docs/03-engine/README.md「優劣判定」の「観点」と同じキー) */
export const JUDGE_VIEWPOINTS = ['logic', 'evidence', 'exchange'] as const;
export type JudgeViewpoint = (typeof JUDGE_VIEWPOINTS)[number];

/** 審判に聞く文面(仕様: 「審判に聞く」) */
export const JUDGE_QUESTION = `あなたは、AI同士が議論する Web サービスで、議論の勝ち負けを決める審判として登場します。審判は3人いて、同じキャラクターが、それぞれ別の観点で判定します(論理: 主張と理由の筋道に飛躍や矛盾がないか。根拠: 引用が資料と合っているか、根拠の出どころが確かか。反論・応答: 反論が相手の主張を崩しているか、受けた反論に正面から答えているか)。3人は持ち物だけを変えて描き分けます。討論者には、すでにフクロウ、タコ、電球とペンギンの融合生物のキャラクターがいます。審判は、これらとは別の生き物・ものにしてください。あなた自身が審判のキャラクターになるとしたら、どんな見た目ですか。コミカルでゆるキャラ風の2Dのイラストにします。会社のロゴや、既存のキャラクターには似せないでください。持ち物に文字は描かないでください。次の形の JSON だけで答えてください。

{
  "motif": "何の生き物・ものか",
  "reason": "なぜそれにしたか(日本語)",
  "colors": ["主な色を2〜3色"],
  "outfit": "服装",
  "props": { "logic": "論理の審判の持ち物(1つ)", "evidence": "根拠の審判の持ち物(1つ)", "exchange": "反論・応答の審判の持ち物(1つ)" },
  "pose": "しぐさ",
  "expression": "表情",
  "personality": ["性格を3語"],
  "imagePrompt": "画像生成への外見の指示(英語、1〜2文。3人に共通の外見だけ。持ち物、画風、背景は書かない)",
  "propPrompts": { "logic": "論理の審判の持ち物の指示(英語、短い句)", "evidence": "根拠の審判の持ち物の指示(英語、短い句)", "exchange": "反論・応答の審判の持ち物の指示(英語、短い句)" }
}`;

/** 審判の答え。持ち物は観点ごと */
export type JudgeAnswer = Omit<Answer, 'prop'> & {
  props: Record<JudgeViewpoint, string>;
  propPrompts: Record<JudgeViewpoint, string>;
};

/** 審判の答えを取り出し、形を確かめる。前後の文やコードブロックの囲みは無視する */
export function parseJudgeAnswer(text: string): JudgeAnswer {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('答えに JSON がありません');
  const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const stringKeys = STRING_KEYS.filter((k) => k !== 'prop');
  const errors: string[] = [];
  for (const k of stringKeys) {
    if (typeof obj[k] !== 'string' || !(obj[k] as string).trim()) errors.push(`${k} が文字列ではありません`);
  }
  for (const k of ARRAY_KEYS) {
    const v = obj[k];
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) errors.push(`${k} が文字列の配列ではありません`);
  }
  for (const k of ['props', 'propPrompts'] as const) {
    const v = obj[k] as Record<string, unknown> | undefined;
    for (const vp of JUDGE_VIEWPOINTS) {
      if (typeof v?.[vp] !== 'string' || !(v[vp] as string).trim()) errors.push(`${k}.${vp} が文字列ではありません`);
    }
  }
  if (errors.length) throw new Error(`答えの形が違います: ${errors.join('、')}`);
  const pick = (v: unknown) =>
    Object.fromEntries(JUDGE_VIEWPOINTS.map((vp) => [vp, (v as Record<string, string>)[vp]])) as Record<JudgeViewpoint, string>;
  return {
    ...(Object.fromEntries([...stringKeys, ...ARRAY_KEYS].map((k) => [k, obj[k]])) as Omit<Answer, 'prop'>),
    props: pick(obj.props),
    propPrompts: pick(obj.propPrompts),
  };
}

/** 画像の指示。共通の画風の指示に、答えの外見の指示をつなぐ */
export function buildImagePrompt(answer: Answer): string {
  return `${STYLE}, ${answer.imagePrompt.trim().replace(/\.$/, '')}`;
}
