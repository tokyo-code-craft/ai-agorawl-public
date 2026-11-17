// 開発用CLI: 立ち絵の見た目をAIに聞き、候補を出し、採用した絵の背景を消して置く。本番スタックには含めない
// 使い方:
//   npm run generate-illustration -- ask <ID>
//   npm run generate-illustration -- generate <ID> [枚数(既定4)] [モデル: core(既定)|ultra|sd35]
//   npm run generate-illustration -- adopt <ID> <候補の番号>
//   npm run generate-illustration -- adopt-pose <ID> <front|ポーズ> <画像のパス>
//   npm run generate-illustration -- shrink <ID>
//   npm run generate-illustration -- icon <ID>
// 仕様: docs/05-persona-illustration/README.md「見た目をAIに聞く」「ポーズ」「生成ツールの流れ」
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildImagePrompt, JUDGE_QUESTION, parseAnswer, parseJudgeAnswer, QUESTION, type Answer, type JudgeAnswer } from './answer';
import { CHARACTERS, NEGATIVE, POSES, type Character, type PoseId } from './characters';
import sharp from 'sharp';
import { ICON_SIZE, iconCrop, opaqueBounds, trimBox } from './icon';
import { buildRecord, type CandidateMeta, type SavedAnswer } from './record';

/** 見た目を聞くモデルのリージョン(議論と同じ東京) */
const ASK_REGION = 'ap-northeast-1';
/** 画像生成のリージョン(東京には画像生成のモデルがない) */
const REGION = 'us-west-2';
/** 画像生成のモデル。既定は Core(安い)。指示を守らせたいときは上位のモデルを選ぶ */
const GENERATE_MODELS: Record<string, { modelId: string; extra?: Record<string, unknown> }> = {
  core: { modelId: 'stability.stable-image-core-v1:1' },
  ultra: { modelId: 'stability.stable-image-ultra-v1:1' },
  sd35: { modelId: 'stability.sd3-5-large-v1:0', extra: { mode: 'text-to-image' } },
};
/** 背景の削除は推論プロファイル(us.)経由でしか呼べない */
const REMOVE_BG_MODEL = 'us.stability.stable-image-remove-background-v1:0';
/** 1羽の全身の立ち姿なので縦長 */
const ASPECT_RATIO = '2:3';

const TOOL_DIR = join(__dirname, '..');
const OUT_DIR = join(TOOL_DIR, 'out');
const ANSWERS_DIR = join(TOOL_DIR, 'answers');
const ADOPTED_DIR = join(TOOL_DIR, '../../app/web/public/characters');
const RECORDS_DIR = join(TOOL_DIR, 'records');

const bedrock = new BedrockRuntimeClient({ region: REGION });

async function invoke(modelId: string, body: unknown): Promise<{ images?: string[]; seeds?: number[]; finish_reasons?: (string | null)[] }> {
  const res = await bedrock.send(
    new InvokeModelCommand({ modelId, contentType: 'application/json', accept: 'application/json', body: JSON.stringify(body) }),
  );
  return JSON.parse(new TextDecoder().decode(res.body));
}

function findCharacter(id: string | undefined): Character {
  const c = CHARACTERS.find((x) => x.id === id);
  if (!c) throw new Error(`キャラクターが見つかりません: ${id}(あるもの: ${CHARACTERS.map((x) => x.id).join(', ')})`);
  return c;
}

const answerPath = (c: Character) => join(ANSWERS_DIR, `${c.id}.json`);

async function ask(c: Character) {
  const path = answerPath(c);
  if (existsSync(path)) throw new Error(`答えがあります。聞き直すときは、先に消してください: ${path}`);
  console.log(`${c.name} に見た目を聞きます(${c.askModelId}、${ASK_REGION})`);
  // 審判は別の文面で聞き、持ち物を観点ごとに答えさせる(仕様: 「審判に聞く」)
  const question = c.judge ? JUDGE_QUESTION : QUESTION;
  const res = await new BedrockRuntimeClient({ region: ASK_REGION }).send(
    new ConverseCommand({
      modelId: c.askModelId,
      messages: [{ role: 'user', content: [{ text: question }] }],
      inferenceConfig: { maxTokens: 1500 },
    }),
  );
  const raw = (res.output?.message?.content ?? []).map((b) => b.text ?? '').join('');
  if (res.stopReason === 'max_tokens') throw new Error(`応答が途中で切れました:\n${raw}`);
  let answer: Answer | JudgeAnswer;
  try {
    answer = c.judge ? parseJudgeAnswer(raw) : parseAnswer(raw);
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : err}\n応答:\n${raw}`);
  }
  const saved: SavedAnswer<Answer | JudgeAnswer> = { question, modelId: c.askModelId, answeredAt: new Date().toISOString(), answer, raw };
  mkdirSync(ANSWERS_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(saved, null, 2) + '\n');
  console.log(JSON.stringify(answer, null, 2));
  console.log(`保存しました: ${path}`);
}

function loadAnswer(c: Character): SavedAnswer {
  // 審判の正面の絵(観点ごとの持ち物)を作る手順は、ツールにまだ組み込んでいない
  if (c.judge) throw new Error('審判の絵の候補を出す手順は、まだツールにありません(Issue #71)');
  const path = answerPath(c);
  if (!existsSync(path)) throw new Error(`答えがありません。先に聞いてください: npm run generate-illustration -- ask ${c.id}`);
  return JSON.parse(readFileSync(path, 'utf8')) as SavedAnswer;
}

async function generate(c: Character, count: number, model: (typeof GENERATE_MODELS)[string]) {
  const prompt = buildImagePrompt(loadAnswer(c).answer);
  const dir = join(OUT_DIR, c.id);
  mkdirSync(dir, { recursive: true });
  // 前に出した候補の続きの番号から振る(上書きしない)
  const start = readdirSync(dir).filter((f) => /^\d+\.png$/.test(f)).length + 1;
  for (let i = 0; i < count; i++) {
    const n = start + i;
    const seed = Math.floor(Math.random() * 4_294_967_295);
    const res = await invoke(model.modelId, {
      ...model.extra,
      prompt,
      negative_prompt: NEGATIVE,
      aspect_ratio: ASPECT_RATIO,
      seed,
      output_format: 'png',
    });
    const image = res.images?.[0];
    const reason = res.finish_reasons?.[0];
    if (!image || reason) {
      console.error(`  ${n}: 生成できませんでした(${reason ?? '画像なし'})`);
      continue;
    }
    writeFileSync(join(dir, `${n}.png`), Buffer.from(image, 'base64'));
    const meta: CandidateMeta = {
      file: `${n}.png`,
      seed: res.seeds?.[0] ?? seed,
      prompt,
      negativePrompt: NEGATIVE,
      modelId: model.modelId,
      aspectRatio: ASPECT_RATIO,
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, `${n}.json`), JSON.stringify(meta, null, 2) + '\n');
    console.log(`  ${n}: ${join(dir, `${n}.png`)}`);
  }
}

async function adopt(c: Character, n: string | undefined) {
  if (!n) throw new Error('候補の番号を指定してください');
  const dir = join(OUT_DIR, c.id);
  const src = join(dir, `${n}.png`);
  if (!existsSync(src)) throw new Error(`候補が見つかりません: ${src}`);
  const dest = frontPath(c);
  if (existsSync(dest)) throw new Error(`採用済みの画像があります。差し替えるときは、先に消してください: ${dest}`);

  // 記録は、費用のかかる背景の削除より先に組み立て、足りない情報があればここで止める
  const candidates = readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => ({ number: Number(f.replace('.json', '')), ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as CandidateMeta) }))
    .sort((a, b) => a.number - b.number);
  // <ID>.md にしない。Windows では claude.md が Claude Code の指示のファイル(CLAUDE.md)と同じ名前に扱われるため
  const recordPath = join(RECORDS_DIR, `${c.id}.record.md`);
  const record = buildRecord({
    character: c,
    adopted: Number(n),
    imagePath: relative(RECORDS_DIR, dest).replace(/\\/g, '/'),
    backgroundRemovedBy: REMOVE_BG_MODEL,
    adoptedAt: new Date().toISOString(),
    answer: loadAnswer(c),
    candidates,
  });

  const res = await invoke(REMOVE_BG_MODEL, { image: readFileSync(src).toString('base64'), output_format: 'png' });
  const image = res.images?.[0];
  if (!image) throw new Error(`背景を消せませんでした(${res.finish_reasons?.[0] ?? '画像なし'})`);
  mkdirSync(ADOPTED_DIR, { recursive: true });
  writeFileSync(dest, Buffer.from(image, 'base64'));
  mkdirSync(RECORDS_DIR, { recursive: true });
  writeFileSync(recordPath, record);
  console.log(`採用しました: ${dest}`);
  console.log(`記録しました: ${recordPath}`);
  await makeIcon(c);
  await shrinkPose(c, 'front');
}

/** 採用した立ち絵から、頭から胸のあたりを切り出したアイコンを作る(Bedrock は呼ばない) */
async function makeIcon(c: Character) {
  const src = frontPath(c);
  if (!existsSync(src)) throw new Error(`採用した正面の立ち姿がありません: ${src}`);
  const { data, info } = await sharp(src).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const crop = iconCrop(opaqueBounds(new Uint8Array(data), info.width, info.height), info.width, info.height);
  const dest = join(ADOPTED_DIR, `${c.id}-icon.png`);
  await sharp(src)
    .extract(crop)
    .resize(ICON_SIZE, ICON_SIZE)
    .png({ compressionLevel: 9, palette: true })
    .toFile(dest);
  console.log(`アイコンを作りました: ${dest}(切り出し: ${crop.left},${crop.top} から ${crop.width}px 四方)`);
}

/** 採用した正面の立ち姿 */
const frontPath = (c: Character) => join(ADOPTED_DIR, `${c.id}-front.png`);

/**
 * ツールの外(Gemini)で作ったポーズの絵の背景を消し、余白を切りそろえて置く。
 * front(正面の立ち姿)は、ツールで描けなかったときに使い、アイコンも作る
 */
async function adoptPose(c: Character, poseId: PoseId | 'front', srcArg: string | undefined) {
  if (!srcArg) throw new Error('画像のパスを指定してください');
  // npm の -w で動かすと作業場所がツールのフォルダになるため、npm を実行した場所から解決する
  const src = resolve(process.env.INIT_CWD ?? process.cwd(), srcArg);
  if (!existsSync(src)) throw new Error(`画像が見つかりません: ${src}`);
  const dest = join(ADOPTED_DIR, `${c.id}-${poseId}.png`);
  if (existsSync(dest)) throw new Error(`採用済みの画像があります。差し替えるときは、先に消してください: ${dest}`);

  // 背景の削除は PNG・JPEG・WebP を受け付ける。形式をそろえるため PNG にして渡す
  const input = await sharp(src).png().toBuffer();
  const res = await invoke(REMOVE_BG_MODEL, { image: input.toString('base64'), output_format: 'png' });
  const image = res.images?.[0];
  if (!image) throw new Error(`背景を消せませんでした(${res.finish_reasons?.[0] ?? '画像なし'})`);
  const removed = Buffer.from(image, 'base64');
  const { data, info } = await sharp(removed).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const box = trimBox(opaqueBounds(new Uint8Array(data), info.width, info.height), info.width, info.height);
  mkdirSync(ADOPTED_DIR, { recursive: true });
  await sharp(removed).extract(box).png({ compressionLevel: 9 }).toFile(dest);
  console.log(`採用しました: ${dest}(${box.width}×${box.height}px)`);
  await shrinkPose(c, poseId);
  if (poseId === 'front') await makeIcon(c);
  console.log(`記録は手で書いてください: ${join(RECORDS_DIR, `${c.id}.poses.md`)}`);
}

/** 画面に出す、縮めた版の高さ(px)。画面で出す最大の高さ360pxの2倍 */
const SMALL_HEIGHT = 720;

/**
 * 画面用に縮めた版(<ID>-<ポーズ>-sm.png)を作る(Bedrock は呼ばない)。
 * 正面の立ち姿は余白を切りそろえずに置いているため、ほかのポーズと同じく輪郭のまわりの余白を切りそろえてから縮める
 */
async function shrinkPose(c: Character, poseId: PoseId | 'front') {
  const src = join(ADOPTED_DIR, `${c.id}-${poseId}.png`);
  const dest = join(ADOPTED_DIR, `${c.id}-${poseId}-sm.png`);
  let image = sharp(src);
  if (poseId === 'front') {
    const { data, info } = await sharp(src).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    image = image.extract(trimBox(opaqueBounds(new Uint8Array(data), info.width, info.height), info.width, info.height));
  }
  // 元の絵より大きくはしない。色数を減らして軽くする
  const info = await image
    .resize({ height: SMALL_HEIGHT, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toFile(dest);
  console.log(`縮めた版を作りました: ${dest}(${info.width}×${info.height}px、${Math.round(info.size / 1024)}KB)`);
}

/** 置いてある絵(正面の立ち姿と、ポーズの絵)すべての、縮めた版を作り直す */
async function shrinkAll(c: Character) {
  const adopted = (['front', ...POSES] as const).filter((p) => existsSync(join(ADOPTED_DIR, `${c.id}-${p}.png`)));
  if (adopted.length === 0) throw new Error(`置いてあるポーズの絵がありません: ${ADOPTED_DIR}`);
  for (const p of adopted) await shrinkPose(c, p);
}

async function main() {
  const [command, id, arg, modelName] = process.argv.slice(2);
  if (command === 'ask') {
    await ask(findCharacter(id));
  } else if (command === 'generate') {
    const count = arg ? Number(arg) : 4;
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('枚数は1〜10にしてください');
    const c = findCharacter(id);
    const model = GENERATE_MODELS[modelName ?? 'core'];
    if (!model) throw new Error(`モデルは ${Object.keys(GENERATE_MODELS).join(' / ')} のどれかにしてください`);
    console.log(`${c.name} の候補を ${count} 枚出します(${model.modelId}、${REGION})`);
    await generate(c, count, model);
  } else if (command === 'adopt') {
    await adopt(findCharacter(id), arg);
  } else if (command === 'adopt-pose') {
    const c = findCharacter(id);
    const p = (['front', ...POSES] as const).find((x) => x === arg);
    if (!p) throw new Error(`ポーズは front / ${POSES.join(' / ')} のどれかにしてください`);
    await adoptPose(c, p, modelName);
  } else if (command === 'shrink') {
    await shrinkAll(findCharacter(id));
  } else if (command === 'icon') {
    await makeIcon(findCharacter(id));
  } else {
    console.error('使い方: npm run generate-illustration -- <ask <ID> | generate <ID> [枚数] [core|ultra|sd35] | adopt <ID> <候補の番号> | adopt-pose <ID> <front|ポーズ> <画像のパス> | shrink <ID> | icon <ID>>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
