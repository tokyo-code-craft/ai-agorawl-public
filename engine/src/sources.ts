// 資料一覧の組み立てと、発言の引用番号の取り出し。仕様: docs/03-engine/README.md「Web検索と資料一覧」
import type { DebaterRole, Message, Positions, Role, Source } from '@agorawl/contract';

/**
 * 話者のラベル。立場の名前(positions)を使う。
 * viewer(先攻・後攻)を渡すと本人の視点で「あなた(週休3日制)」「相手(週休2日制)」、
 * 渡さなければ第三者の視点で「週休3日制側」と書く。
 */
export function sideLabel(role: Role, positions: Positions, viewer?: DebaterRole): string {
  const position = positions[role];
  if (!viewer) return `${position}側`;
  return `${role === viewer ? 'あなた' : '相手'}(${position})`;
}

/** 資料一覧: 全発言の sources をターン順に並べたもの */
export function collectSources(messages: Pick<Message, 'turn' | 'sources'>[]): Source[] {
  return [...messages].sort((a, b) => a.turn - b.turn).flatMap((m) => m.sources ?? []);
}

/** 次に登録する資料の番号 */
export function nextSourceId(sources: Source[]): number {
  return sources.reduce((max, s) => Math.max(max, s.id), 0) + 1;
}

/**
 * プロンプト用の資料一覧の行。
 * 検索した側は sideLabel で書く(viewer を渡すと本人の視点)。
 */
export function sourceLines(sources: Source[], positions: Positions, viewer?: DebaterRole): string[] {
  if (sources.length === 0) return ['(まだありません)'];
  return sources.map((s) => {
    const who = sideLabel(s.role, positions, viewer);
    const urls = s.urls.length ? s.urls.join(' ') : '(なし)';
    return `[${s.id}] 検索語「${s.query}」(ターン${s.turn} ${who}が検索): ${s.text} 出典: ${urls}`;
  });
}

/** 検索の結果として討論者に返す文 */
export function searchResultText(source: Source): string {
  const urls = source.urls.length ? source.urls.join(' ') : 'なし';
  return `[${source.id}] ${source.text}(出典: ${urls})`;
}

/** 発言から引用番号([n])を取り出す。重複なし、昇順。資料一覧にない番号は invalid に分ける */
export function extractCitations(speech: string, sources: Source[]): { citations: number[]; invalid: number[] } {
  const known = new Set(sources.map((s) => s.id));
  const cited = [...new Set([...speech.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return { citations: cited, invalid: cited.filter((n) => !known.has(n)) };
}

/** 検索の要約の上限(文字数) */
export const SUMMARY_MAX_LENGTH = 600;

/** 要約が上限を超えたら、上限以内で最後の「。」までに切り詰めて「(以下省略)」を付ける */
export function truncateSummary(text: string, max = SUMMARY_MAX_LENGTH): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join('');
  const end = head.lastIndexOf('。');
  return `${end >= 0 ? head.slice(0, end + 1) : head}(以下省略)`;
}
