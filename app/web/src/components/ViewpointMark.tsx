// 審判の観点の持ち物の印(論理: 天秤、根拠: 虫めがね、反論・応答: 盾と交差した旗)。
// 絵は /characters/judge-mark-<観点>.png(丸の外は透明)。
// 仕様: docs/04-app/README.md「判定の節」、docs/05-persona-illustration/README.md「立ち絵」
import type { JudgeViewpoint } from '@agorawl/contract';

export function ViewpointMark({ viewpoint }: { viewpoint: JudgeViewpoint }) {
  return <img className="viewpoint-mark" src={`/characters/judge-mark-${viewpoint}.png`} alt="" />;
}
