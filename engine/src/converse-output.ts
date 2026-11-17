// Converse API の応答の扱い。仕様: docs/03-engine/README.md「発言生成Lambdaの入出力」
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { OutputFormatError } from './errors';

export type ConverseResult = Pick<ConverseCommandOutput, 'output' | 'stopReason' | 'usage'>;

/** 呼び出しごとに、モデルID・stopReason・出力のトークン数をログに残す */
export function logConverse(modelId: string, res: ConverseResult): void {
  console.log(JSON.stringify({ converse: { modelId, stopReason: res.stopReason, outputTokens: res.usage?.outputTokens } }));
}

/**
 * 応答の本文(text のブロックをつないだもの)を返す。
 * 推論の過程(reasoningContent)を返すモデルもあるため、text のブロックだけを使う。
 * 最大トークン数で切れていたら、途中で切れた文を保存しないよう OutputFormatError にする(再試行で生成し直す)。
 */
export function textOf(res: ConverseResult, modelId: string): string {
  const text = (res.output?.message?.content ?? [])
    .map((block) => block.text ?? '')
    .join('')
    .trim();
  if (res.stopReason === 'max_tokens') {
    // どの部分が出力を膨らませたかを確かめるため、切れた時点までの字数を残す
    const sections = sectionLengths(text);
    if (sections) console.log(JSON.stringify({ truncated: { modelId, ...sections } }));
    throw new OutputFormatError(`応答が最大トークン数で切れました: ${modelId}`);
  }
  if (!text) throw new Error(`モデルの応答に本文がありません: ${modelId}`);
  return text;
}

const SECTION_TAGS = ['notes', 'speech'] as const;

/**
 * 先攻・後攻の出力の、作戦メモと発言の中身の字数(閉じタグがなければ次のタグか末尾まで)。
 * どのタグもなければ undefined。仕様: docs/03-engine/README.md「発言生成Lambdaの入出力」
 */
export function sectionLengths(text: string): Record<(typeof SECTION_TAGS)[number] | 'total', number> | undefined {
  const lengths = { notes: 0, speech: 0, total: text.length };
  let found = false;
  for (const tag of SECTION_TAGS) {
    const m = new RegExp('<' + tag + '>([\\s\\S]*?)(?:</' + tag + '>|(?=<(?:notes|speech)>)|$)').exec(text);
    if (m) {
      found = true;
      lengths[tag] = m[1]!.trim().length;
    }
  }
  return found ? lengths : undefined;
}
