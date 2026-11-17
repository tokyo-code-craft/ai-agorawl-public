// Web検索。検索用のモデル(Nova 2 Lite の Web Grounding)に調べさせ、要約と出典URLを返す。
// 仕様: docs/03-engine/README.md「Web検索と資料一覧」、docs/03-engine/prompts.md「検索用のモデルへの指示」
import { BedrockRuntimeClient, ConverseCommand, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { requireEnv } from './aws';
import { logConverse } from './converse-output';
import { truncateSummary } from './sources';

const SEARCH_MODEL_ID = requireEnv('SEARCH_MODEL_ID');
const SEARCH_REGION = requireEnv('SEARCH_REGION');
const INFERENCE_CONFIG = { maxTokens: 1500, temperature: 0.3 };

const client = new BedrockRuntimeClient({ region: SEARCH_REGION });

const SYSTEM_PROMPT = [
  'あなたは調査担当です。依頼された内容をWebで検索し、議論の根拠になる事実を日本語で簡潔にまとめてください。',
  '守ること:',
  '- 事実のみを書く。意見、推測、結論、評価(「〜が重要である」「〜ことが分かる」など)は書かない。',
  '- 検索語がどちらかの立場に寄っていても、まとめは中立に書く。',
  '- 数字や固有名詞は、検索結果にあるとおりに書き、誰の調査・発表かを添える。',
  '- 公的機関(省庁、自治体、国際機関)、研究機関、報道機関の情報を優先する。個人のブログは、ほかに情報がない場合だけ使う。',
  '- 3件まで、合わせて400字以内にする。見出しや箇条書きの記号は使わない。',
  '- 見つからなければ「該当する情報は見つかりませんでした」と書く。',
].join('\n');

// Web Grounding はSDKの型にまだない「システムツール」のため、型を合わせて渡す
const GROUNDING_TOOL = { systemTool: { name: 'nova_grounding' } } as unknown as Tool;

export async function webSearch(query: string, theme: string): Promise<{ text: string; urls: string[] }> {
  const res = await client.send(
    new ConverseCommand({
      modelId: SEARCH_MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: [{ text: `調べる内容: ${query}(議論のテーマ:「${theme}」)` }] }],
      toolConfig: { tools: [GROUNDING_TOOL] },
      inferenceConfig: INFERENCE_CONFIG,
    }),
  );
  // 要約は長すぎれば切り詰めて使うため、最大トークン数で切れても生成し直さない
  logConverse(SEARCH_MODEL_ID, res);
  const blocks = (res.output?.message?.content ?? []) as Array<Record<string, any>>;
  const text = blocks
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('')
    .trim();
  const urls = [
    ...new Set(
      blocks.flatMap((b) =>
        ((b.citationsContent?.citations ?? []) as Array<Record<string, any>>)
          .map((c) => c.location?.web?.url)
          .filter((u): u is string => typeof u === 'string'),
      ),
    ),
  ];
  return { text: truncateSummary(text || '該当する情報は見つかりませんでした'), urls };
}
