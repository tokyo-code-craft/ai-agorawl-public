// PSD のレイヤーの木を読む(画像は読まない)。docs/06-explainer-video/README.md「立ち絵」
import { readFileSync } from 'node:fs';
import { readPsd, type Layer } from 'ag-psd';

export interface LayerNode {
  /** 親からの道のり(例: 「!目/*普通目」) */
  path: string;
  name: string;
  hidden: boolean;
  isGroup: boolean;
  children: LayerNode[];
}

function toNode(layer: Layer, parent: string): LayerNode {
  const name = layer.name ?? '';
  const path = parent ? `${parent}/${name}` : name;
  return {
    path,
    name,
    hidden: !!layer.hidden,
    isGroup: !!layer.children,
    children: (layer.children ?? []).map((c) => toNode(c, path)),
  };
}

export function readTree(file: string): LayerNode[] {
  const psd = readPsd(readFileSync(file), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  return (psd.children ?? []).map((c) => toNode(c, ''));
}

export function formatTree(nodes: LayerNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.isGroup ? '▸ ' : '- '}${n.name}${n.hidden ? '  (非表示)' : ''}`,
    ...formatTree(n.children, depth + 1),
  ]);
}
