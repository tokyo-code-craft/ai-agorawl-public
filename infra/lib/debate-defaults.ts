// 議論の作成の既定値(先攻・後攻の既定のモデルと審判)と、選べる討論者のモデル。
// 既定値は docs/03-engine/README.md「動作確認用のモデルの組み合わせ」と同じ。選べるモデルは docs/04-app/README.md「選べるモデル」。
// HTTP APIのLambdaに環境変数で渡す(docs/04-app/README.md「HTTP API」)
import type { Judge, Participant } from '@agorawl/contract';

type ModelOption = { modelId: string; name: string; feature: string };

export const DEBATE_DEFAULTS: { participants: Participant[]; judges: Judge[]; models: ModelOption[]; judgeModels: ModelOption[] } = {
  participants: [
    { role: 'pro', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
    { role: 'con', modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
  ],
  judges: [
    { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'logic' },
    { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'evidence' },
    { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'exchange' },
  ],
  models: [
    { modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Claude Haiku 4.5', feature: '速くて安い。いつもの討論者' },
    { modelId: 'jp.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6', feature: '賢さと速さのバランス型' },
    {
      modelId: 'global.anthropic.claude-opus-4-6-v1',
      name: 'Claude Opus 4.6',
      feature: 'いちばん賢いが、遅くて高い',
    },
    { modelId: 'openai.gpt-oss-20b-1:0', name: 'OpenAI gpt-oss-20b', feature: '小さくて速い。考えてから話す' },
    { modelId: 'openai.gpt-oss-120b-1:0', name: 'OpenAI gpt-oss-120b', feature: 'OpenAI の大きいほう。じっくり考えてから話す' },
    {
      modelId: 'mistral.mistral-large-3-675b-instruct',
      name: 'Mistral Large 3',
      feature: 'Mistral の大きいモデル。長めに話し、相手の主張に一つずつ答える',
    },
  ],
  // 審判で選べるモデル(docs/04-app/README.md「選べるモデル」の「審判で選べるモデル」)
  judgeModels: [
    { modelId: 'global.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6', feature: '議論を深く読み比べる。' },
  ],
};

/** 議論を作る前に、入力の内容を確かめるモデル(docs/04-app/README.md「入力の内容の確認」) */
export const CONTENT_CHECK_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
