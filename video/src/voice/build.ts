// 台本の各セリフの音声を作る。同じ話し手・同じ読みの音声は作り直さない(public/voice/ に残す)
// docs/06-explainer-video/README.md「音声」
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CHARACTERS } from '../characters.ts';
import type { Script } from '../script.ts';
import { audioQueryWithPauses, ELLIPSIS, ELLIPSIS_PAUSE_SEC, mouthSpans, queryDuration, synthesize, type MouthSpan } from './voicevox.ts';

export interface VoiceLine {
  /** 音声のファイル(Remotion の public/ からの道のり) */
  file: string;
  /** 長さ(秒) */
  duration: number;
  /** 口を開けている区間(秒) */
  mouth: MouthSpan[];
}

const VOICE_DIR = 'public/voice';

export async function buildVoices(script: Script, log: (s: string) => void = console.log): Promise<VoiceLine[]> {
  mkdirSync(VOICE_DIR, { recursive: true });
  const result: VoiceLine[] = [];
  for (const [i, line] of script.lines.entries()) {
    const styleId = CHARACTERS[line.speaker].voicevoxStyleId;
    const reading = line.reading ?? line.text;
    // 「・・・」の間の長さを変えたら作り直すよう、「・・・」のある読みは間の長さも鍵に入れる
    const pause = ELLIPSIS.test(reading) ? `\npause=${ELLIPSIS_PAUSE_SEC}` : '';
    const key = createHash('sha1').update(`${styleId}\n${reading}${pause}`).digest('hex').slice(0, 16);
    const wav = `${VOICE_DIR}/${key}.wav`;
    const meta = `${VOICE_DIR}/${key}.json`;
    if (existsSync(wav) && existsSync(meta)) {
      result.push(JSON.parse(readFileSync(meta, 'utf-8')) as VoiceLine);
      continue;
    }
    const query = await audioQueryWithPauses(reading, styleId);
    writeFileSync(wav, await synthesize(query, styleId));
    const v: VoiceLine = { file: `voice/${key}.wav`, duration: queryDuration(query), mouth: mouthSpans(query) };
    writeFileSync(meta, JSON.stringify(v));
    result.push(v);
    log(`${i + 1}/${script.lines.length} ${CHARACTERS[line.speaker].name}: ${line.text}`);
  }
  return result;
}
