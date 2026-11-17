// 太く塗った矢印。文字の矢印(←↑↓)は端末のフォントで形や色が変わるため、SVGで描く。仕様: docs/04-app/README.md「矢印」

export type ArrowDirection = 'up' | 'down' | 'left';

/** 24×24 の枠に描く。三角の頭と太い軸 */
const PATHS: Record<ArrowDirection, string> = {
  up: 'M12 2 22 12h-6v10H8V12H2z',
  down: 'M12 22 2 12h6V2h8v10h6z',
  left: 'M2 12 12 2v6h10v8H12v6z',
};

/** 文字の色で塗る。飾りなので読み上げない */
export function Arrow({ direction }: { direction: ArrowDirection }) {
  return (
    <svg className="arrow-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[direction]} fill="currentColor" />
    </svg>
  );
}
