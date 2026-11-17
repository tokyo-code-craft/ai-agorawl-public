import { describe, expect, it } from 'vitest';
import type { Source } from '@agorawl/contract';
import { collectSources, extractCitations, nextSourceId, searchResultText, truncateSummary } from '../src/sources';

const src = (id: number, turn: number): Source => ({
  id,
  turn,
  role: turn % 2 === 1 ? 'pro' : 'con',
  query: `q${id}`,
  text: `t${id}`,
  urls: [`https://example.com/${id}`],
});

describe('資料一覧', () => {
  it('全発言の資料をターン順に並べ、次の番号は最大+1', () => {
    const sources = collectSources([
      { turn: 3, sources: [src(3, 3)] },
      { turn: 1, sources: [src(1, 1), src(2, 1)] },
      { turn: 2 },
    ]);
    expect(sources.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(nextSourceId(sources)).toBe(4);
    expect(nextSourceId([])).toBe(1);
  });

  it('検索結果は番号と出典付きで返す', () => {
    expect(searchResultText(src(5, 1))).toBe('[5] t5(出典: https://example.com/5)');
  });
});

describe('truncateSummary', () => {
  it('上限以内ならそのまま', () => {
    expect(truncateSummary('短い。', 10)).toBe('短い。');
  });
  it('上限を超えたら最後の「。」までに切り詰める', () => {
    expect(truncateSummary('一文目。二文目。三文目が長い', 10)).toBe('一文目。二文目。(以下省略)');
  });
  it('「。」がなければ上限で切る', () => {
    expect(truncateSummary('あいうえおかきくけこさしす', 5)).toBe('あいうえお(以下省略)');
  });
});

describe('extractCitations', () => {
  it('引用番号を重複なし・昇順で取り出し、資料一覧にない番号を分ける', () => {
    const r = extractCitations('[2]によれば…。また[1]と[2]、[9]も。', [src(1, 1), src(2, 1)]);
    expect(r.citations).toEqual([1, 2, 9]);
    expect(r.invalid).toEqual([9]);
  });

  it('引用がなければ空', () => {
    expect(extractCitations('引用なし', [])).toEqual({ citations: [], invalid: [] });
  });
});
