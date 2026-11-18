// VOICEVOX のエンジン(Docker で起動)を呼び、セリフの音声と、口を開ける時間を作る。
// docs/06-explainer-video/README.md「音声」「口パク」

export const VOICEVOX_URL = process.env.VOICEVOX_URL ?? 'http://localhost:50021';

interface Mora {
  text: string;
  consonant?: string | null;
  pitch?: number;
  consonant_length: number | null;
  vowel: string;
  vowel_length: number;
}

interface AccentPhrase {
  moras: Mora[];
  pause_mora: Mora | null;
}

export interface AudioQuery {
  accent_phrases: AccentPhrase[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  [key: string]: unknown;
}

/** 口を開けている区間(秒)。[始まり, 終わり] */
export type MouthSpan = [number, number];

/** 口を閉じる音(撥音「ン」、促音「ッ」、無声化した母音、間) */
const CLOSED_VOWELS = new Set(['N', 'cl', 'pau', 'A', 'I', 'U', 'E', 'O']);

/**
 * モーラの長さから、口を開ける区間を決める。子音の間は閉じ、母音の間は開ける。
 * 続く区間はつなげず、モーラごとに分ける(口がぱくぱく動いて見えるように)
 */
export function mouthSpans(query: AudioQuery): MouthSpan[] {
  const speed = query.speedScale || 1;
  const spans: MouthSpan[] = [];
  let t = query.prePhonemeLength;
  for (const phrase of query.accent_phrases) {
    const moras = phrase.pause_mora ? [...phrase.moras, phrase.pause_mora] : phrase.moras;
    for (const m of moras) {
      t += m.consonant_length ?? 0;
      const start = t;
      t += m.vowel_length;
      if (!CLOSED_VOWELS.has(m.vowel) && m.vowel_length > 0) spans.push([start / speed, t / speed]);
    }
  }
  return spans;
}

/** 音声の長さ(秒)。間と前後の無音を含む */
export function queryDuration(query: AudioQuery): number {
  let t = query.prePhonemeLength + query.postPhonemeLength;
  for (const phrase of query.accent_phrases) {
    const moras = phrase.pause_mora ? [...phrase.moras, phrase.pause_mora] : phrase.moras;
    for (const m of moras) t += (m.consonant_length ?? 0) + m.vowel_length;
  }
  return t / (query.speedScale || 1);
}

async function post(path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${VOICEVOX_URL}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`VOICEVOX(${VOICEVOX_URL})につながらない。video/README.md の手順でエンジンを起動する: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`VOICEVOX ${path}: ${res.status} ${await res.text()}`);
  return res;
}

/** speed は話す速さの倍率(省くと 1.0) */
export async function audioQuery(text: string, styleId: number, speed = 1): Promise<AudioQuery> {
  const res = await post(`/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`);
  const query = (await res.json()) as AudioQuery;
  query.speedScale = speed;
  return query;
}

/** 「・・・」(中黒2つ以上)と「…」。docs/06-explainer-video/README.md「「・・・」の間」 */
export const ELLIPSIS = /・{2,}|…+/;
/** 「・・・」の間(秒) */
export const ELLIPSIS_PAUSE_SEC = 1.0;

/**
 * 読みを「・・・」で区切って問い合わせ、つないで1つにする。文の途中の「・・・」は1.0秒の間に、文の頭の「・・・」は話し始める前の1.0秒にする。
 * 文の終わりの「・・・」は何もしない。「・・・」がなければ、そのまま問い合わせる
 */
export async function audioQueryWithPauses(text: string, styleId: number, speed = 1): Promise<AudioQuery> {
  const parts = text.split(new RegExp(ELLIPSIS.source, 'g'));
  if (parts.length === 1) return audioQuery(text, styleId, speed);
  let query: AudioQuery | null = null;
  let lead = 0;
  for (const [i, part] of parts.entries()) {
    const q = part.trim() ? await audioQuery(part, styleId, speed) : null;
    if (!q || q.accent_phrases.length === 0) {
      // 文の頭の「・・・」(まだ声がない)は、話し始める前の間にする
      if (!query && i < parts.length - 1) lead = ELLIPSIS_PAUSE_SEC;
      continue;
    }
    if (!query) {
      query = q;
    } else {
      query.accent_phrases.push(...q.accent_phrases);
      query.postPhonemeLength = q.postPhonemeLength;
    }
    // 続きがあれば、最後の句の後ろに「・・・」の間を置く
    if (i < parts.length - 1 && parts.slice(i + 1).some((p) => p.trim())) {
      const last = query.accent_phrases[query.accent_phrases.length - 1];
      last.pause_mora = { text: '、', consonant: null, consonant_length: null, vowel: 'pau', vowel_length: ELLIPSIS_PAUSE_SEC * (query.speedScale || 1), pitch: 0 };
    }
  }
  if (!query) return audioQuery(text, styleId, speed);
  query.prePhonemeLength += lead * (query.speedScale || 1);
  return query;
}

export async function synthesize(query: AudioQuery, styleId: number): Promise<Buffer> {
  const res = await post(`/synthesis?speaker=${styleId}`, query);
  return Buffer.from(await res.arrayBuffer());
}
