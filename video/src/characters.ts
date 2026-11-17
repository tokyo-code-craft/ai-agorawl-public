// 話し手の設定(声と立ち絵)。docs/06-explainer-video/README.md「話し手」「立ち絵」
// 立ち絵の PSD はリポジトリに入れない。入手の手順は video/README.md

export type SpeakerId = 'zundamon' | 'metan';
export type MouthState = 'closed' | 'open';

export interface Expression {
  /** 表示にするレイヤー(PSD のレイヤーの道のり) */
  show: string[];
  /** 口を閉じたときと開いたときのレイヤー */
  mouth: Record<MouthState, string>;
}

export interface Character {
  name: string;
  /** 立ち絵の左右を反転するか(画面の真ん中を向かせるため) */
  flip?: boolean;
  /** 字幕の枠の色 */
  color: string;
  /** VOICEVOX の話者(スタイル)の ID */
  voicevoxStyleId: number;
  /** 立ち絵の PSD(video/ からの道のり)。ないときは仮の絵 */
  psd: string;
  /** すべての表情に共通して表示にするレイヤー */
  base: string[];
  /** 表情の名前 → レイヤー。台本の expression で選ぶ。normal は必ず置く */
  expressions: Record<string, Expression>;
}

export const CHARACTERS: Record<SpeakerId, Character> = {
  zundamon: {
    name: 'ずんだもん',
    color: '#6dbb3c',
    voicevoxStyleId: 3,
    psd: 'assets/zundamon/zundamon.psd',
    base: ['*服装1/*いつもの服', '*服装1/!左腕/*基本', '*服装1/!右腕/*基本', '!顔色/*ほっぺ', '!枝豆/*枝豆通常'],
    expressions: {
      normal: {
        show: ['!眉/*普通眉', '!目/*目セット/*普通白目', '!目/*目セット/!黒目/*普通目'],
        mouth: { closed: '!口/*むふ', open: '!口/*ほあ' },
      },
      smile: {
        show: ['!眉/*普通眉', '!目/*にっこり'],
        mouth: { closed: '!口/*むふ', open: '!口/*ほあー' },
      },
      surprised: {
        show: ['!眉/*上がり眉', '!目/*〇〇'],
        mouth: { closed: '!口/*お', open: '!口/*ほあー' },
      },
      troubled: {
        show: ['!眉/*困り眉1', '!目/*目セット/*普通白目', '!目/*目セット/!黒目/*目逸らし'],
        mouth: { closed: '!口/*むー', open: '!口/*ほあ' },
      },
    },
  },
  metan: {
    name: '四国めたん',
    // 絵は左(画面の外)を向いている。画面の左に置くので、反転して右を向かせる
    flip: true,
    color: '#e0559b',
    voicevoxStyleId: 2,
    psd: 'assets/metan/metan.psd',
    base: ['*白ロリ服/!右腕/*普通', '*白ロリ服/!左腕/*普通', '!顔色/*普通2'],
    expressions: {
      normal: {
        show: ['!眉/*ごきげん', '!目/*目セット/*普通白目', '!目/*目セット/!黒目/*普通目'],
        mouth: { closed: '!口/*ほほえみ', open: '!口/*わあー' },
      },
      smile: {
        show: ['!眉/*ごきげん', '!目/*目閉じ'],
        mouth: { closed: '!口/*ほほえみ', open: '!口/*わあー' },
      },
      surprised: {
        show: ['!眉/*ごきげん', '!目/*○○'],
        mouth: { closed: '!口/*お', open: '!口/*わあー' },
      },
      troubled: {
        show: ['!眉/*こまり', '!目/*目セット/*普通白目', '!目/*目セット/!黒目/*目そらし'],
        mouth: { closed: '!口/*む', open: '!口/*△' },
      },
    },
  },
};

/** 立ち絵の PNG の置き場所(Remotion の public/ からの道のり) */
export const tachiePath = (speaker: SpeakerId, expression: string, mouth: MouthState) =>
  `characters/${speaker}/${expression}-${mouth}.png`;
