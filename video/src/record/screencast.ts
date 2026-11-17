// 画面を細かいまま動画で録る。Playwright の録画は画面の表示の大きさ(1280×720)でしか録れないため、
// Chrome の画面配信(CDP の Page.startScreencast)で、表示の細かさ(1.5倍)のままの画像を受け取り、ffmpeg で mp4 にする。
// docs/06-explainer-video/README.md「画面の映像」
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from 'playwright';

/** Remotion に同梱の ffmpeg(video/ で npm install すると入る) */
const FFMPEG = 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe';
const FPS = 30;
/** 録る画像の幅(1280 の表示の 1.5 倍) */
const WIDTH = 1920;
/** 上限を表示の細かさより大きくしておくと、細かいまま(1920×1080)届く */
const SCREENCAST = { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: 3840, maxHeight: 2160 };

interface Frame {
  file: string;
  /** 受け取った時刻(秒) */
  at: number;
}

export class Screencast {
  private frames: Frame[] = [];
  private cdp?: CDPSession;
  private started = 0;

  constructor(private page: Page, private dir: string) {}

  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.started = Date.now() / 1000;
    this.cdp = await this.page.context().newCDPSession(this.page);
    const cdp = this.cdp;
    const send = cdp.send as (m: string, p?: object) => Promise<unknown>;
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      // 型の定義に含まれていない命令のため、名前を広げて送る
      send.call(cdp, 'Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      if (this.stopped) return;
      const data = Buffer.from(f.data, 'base64');
      // 大きさの違う画像(ページを開く前のものなど)が混ざると、動画の大きさがそろわないので捨てる
      if (jpegWidth(data) !== WIDTH) return;
      const file = join(this.dir, `${String(this.frames.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, data);
      this.frames.push({ file, at: f.metadata.timestamp ?? Date.now() / 1000 });
    });
    // 別のサイト(Cognito のログイン画面)へ移ると、配信が止まることがある。読み込みのたびに始め直す
    const restart = async () => {
      await send.call(cdp, 'Page.stopScreencast').catch(() => {});
      await send.call(cdp, 'Page.startScreencast', SCREENCAST).catch(() => {});
    };
    await restart();
    this.page.on('load', () => {
      if (!this.stopped) void restart();
    });
  }

  private stopped = false;

  /** 録るのをやめ、mp4 にする。画面が変わらない間は、前の画像を出し続ける */
  async stop(out: string) {
    const end = Date.now() / 1000;
    this.stopped = true;
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    await this.cdp?.detach().catch(() => {});
    if (this.frames.length === 0) throw new Error('画面の画像を1枚も受け取れなかった');
    // ffmpeg の concat で、各画像を次の画像までの長さだけ出す
    const lines: string[] = [];
    const first = Math.min(this.started, this.frames[0].at);
    this.frames.forEach((f, i) => {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].at : end;
      const start = i === 0 ? first : f.at;
      lines.push(`file '${f.file.replace(/\\/g, '/').split('/').pop()}'`, `duration ${Math.max(1 / FPS, next - start).toFixed(4)}`);
    });
    lines.push(`file '${this.frames[this.frames.length - 1].file.replace(/\\/g, '/').split('/').pop()}'`);
    const list = join(this.dir, 'frames.txt');
    writeFileSync(list, `${lines.join('\n')}\n`);
    execFileSync(
      FFMPEG,
      ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', out],
      { stdio: 'inherit' },
    );
    if (!process.env.KEEP_FRAMES) rmSync(this.dir, { recursive: true, force: true });
  }
}

/** JPEG の幅(SOF の区切りから読む) */
function jpegWidth(d: Buffer): number {
  let i = 2;
  while (i + 9 < d.length && d[i] === 0xff) {
    const marker = d[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return d.readUInt16BE(i + 7);
    i += 2 + d.readUInt16BE(i + 2);
  }
  return 0;
}
