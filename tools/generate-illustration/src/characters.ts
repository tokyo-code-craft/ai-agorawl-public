// 立ち絵のキャラクターの定義と、共通のスタイル指示。仕様: docs/05-persona-illustration/README.md「立ち絵」
// 画像の指示は、画像生成のモデルが読むため英語で書く

export interface Character {
  /** ファイル名に使う(英小文字・数字・-) */
  id: string;
  /** 表示用の名前 */
  name: string;
  /** 見た目を聞くモデル(Bedrock、東京リージョン) */
  askModelId: string;
  /** 審判か。審判は別の文面で聞き、持ち物を観点ごとに答えさせる(仕様: 「審判に聞く」) */
  judge?: boolean;
}

export const CHARACTERS: Character[] = [
  { id: 'claude', name: 'Claude', askModelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
  { id: 'openai', name: 'OpenAI', askModelId: 'openai.gpt-oss-120b-1:0' },
  { id: 'mistral', name: 'Mistral', askModelId: 'mistral.mistral-large-3-675b-instruct' },
  { id: 'judge', name: '審判', askModelId: 'global.anthropic.claude-opus-4-6-v1', judge: true },
];

/** 全員で固定する画風の指示(コミカルで、ゆるキャラ風の2D)。画風を効かせるため、2Dの指示を先頭に置く */
export const STYLE =
  'flat 2D vector illustration, cartoon drawing, thick clean black outlines, flat colors with no shading, ' +
  'Japanese yuru-chara mascot character, comical and cute, simple rounded body, big head, short limbs, ' +
  'full body standing pose facing forward, the whole body visible with margin around it, plain white background, single character';

/** 描かせないもの */
export const NEGATIVE =
  'text, letters, words, numbers, logo, emblem, badge, name tag, watermark, signature, ' +
  '3d, 3d render, figure, figurine, plush, clay, toy, realistic, photo, glossy, shading, ' +
  'scary, multiple characters, cropped body, background scenery';

/**
 * 正面以外のポーズ。正面の立ち姿を手本に、ツールの外(Gemini)で作った絵を adopt-pose で置く。
 * 仕様: docs/05-persona-illustration/README.md「ポーズ」
 */
export const POSES = ['debate', 'win', 'lose', 'think'] as const;
export type PoseId = (typeof POSES)[number];
