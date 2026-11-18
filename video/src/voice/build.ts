// 台本の各セリフの音声を作る。同じ話し手・同じ読みの音声は作り直さない(public/voice/ に残す)
// docs/06-explainer-video/README.md「音声」
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CHARACTERS, type SpeakerId } from '../characters.ts';
import { SPEED, type Script } from '../script.ts';
import { audioQueryWithPauses, ELLIPSIS, ELLIPSIS_PAUSE_SEC, mouthSpans, queryDuration, synthesize, type MouthSpan } from './voicevox.ts';

export interface VoiceLine {
  /** 音声のファイル(Remotion の public/ からの道のり) */
  file: string;
  /** 長さ(秒) */
  duration: number;
  /** 口を開けている区間(秒) */
  mouth: MouthSpan[];
  /** 同時に言うもう1人(行の with)の音声 */
  together?: VoiceLine;
}

const VOICE_DIR = 'public/voice';

export async function buildVoices(script: Script, log: (s: string) => void = console.log): Promise<VoiceLine[]> {
  mkdirSync(VOICE_DIR, { recursive: true });
  const result: VoiceLine[] = [];
  const speed = script.speed ?? SPEED;
  for (const [i, line] of script.lines.entries()) {
    const v = await voiceOf(line.speaker, line.reading ?? line.text, speed, () => log(`${i + 1}/${script.lines.length} ${CHARACTERS[line.speaker].name}: ${line.text}`));
    if (line.with) {
      v.together = await voiceOf(line.with, line.reading ?? line.text, speed, () => log(`${i + 1}/${script.lines.length} ${CHARACTERS[line.with!].name}: ${line.text}`));
    }
    result.push(v);
  }
  return result;
}

/** 話し手と読みと速さの音声(作ってあれば、作り直さない) */
async function voiceOf(speaker: SpeakerId, reading: string, speed: number, onBuild: () => void): Promise<VoiceLine> {
  const styleId = CHARACTERS[speaker].voicevoxStyleId;
  // 「・・・」の間の長さを変えたら作り直すよう、「・・・」のある読みは間の長さも鍵に入れる
  const pause = ELLIPSIS.test(reading) ? `\npause=${ELLIPSIS_PAUSE_SEC}` : '';
  // 速さを変えたら作り直すよう、1.0 でない速さも鍵に入れる(1.0 の音声は、速さを足す前の鍵のまま使う)
  const rate = speed === 1 ? '' : `\nspeed=${speed}`;
  const key = createHash('sha1').update(`${styleId}\n${reading}${pause}${rate}`).digest('hex').slice(0, 16);
  const wav = `${VOICE_DIR}/${key}.wav`;
  const meta = `${VOICE_DIR}/${key}.json`;
  if (existsSync(wav) && existsSync(meta)) return JSON.parse(readFileSync(meta, 'utf-8')) as VoiceLine;
  const query = await audioQueryWithPauses(reading, styleId, speed);
  writeFileSync(wav, await synthesize(query, styleId));
  const v: VoiceLine = { file: `voice/${key}.wav`, duration: queryDuration(query), mouth: mouthSpans(query) };
  writeFileSync(meta, JSON.stringify(v));
  onBuild();
  return v;
}
