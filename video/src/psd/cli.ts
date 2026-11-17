// 立ち絵の PSD から、表情ごとに口を閉じた絵と開いた絵の PNG を作る。docs/06-explainer-video/README.md「立ち絵」
// 使い方:
//   npm run psd -- tree <話し手>   レイヤーの木を出す(表情の設定を書くとき用)
//   npm run psd -- build [話し手]  public/characters/<話し手>/<表情>-<closed|open>.png を作る
import { existsSync } from 'node:fs';
import { CHARACTERS, tachiePath, type SpeakerId } from '../characters.ts';
import { composite, loadPsd, selectVisible, writePng } from './compose.ts';
import { formatTree, readTree } from './tree.ts';

const [command, who] = process.argv.slice(2);
const speakers = (who ? [who] : Object.keys(CHARACTERS)) as SpeakerId[];

for (const id of speakers) {
  const c = CHARACTERS[id];
  if (!c) throw new Error(`話し手がいない: ${id}`);
  if (!existsSync(c.psd)) {
    console.log(`${c.name}: ${c.psd} がないため飛ばします(仮の絵で表示します)`);
    continue;
  }
  if (command === 'tree') {
    console.log(formatTree(readTree(c.psd)).join('\n'));
  } else if (command === 'build') {
    const psd = loadPsd(c.psd);
    for (const [expr, e] of Object.entries(c.expressions)) {
      for (const mouth of ['closed', 'open'] as const) {
        const visible = selectVisible(psd, [...c.base, ...e.show, e.mouth[mouth]]);
        const file = `public/${tachiePath(id, expr, mouth)}`;
        writePng(composite(psd, visible), file);
        console.log(file);
      }
    }
  } else {
    console.error('使い方: npm run psd -- <tree|build> [話し手]');
    process.exit(1);
  }
}
