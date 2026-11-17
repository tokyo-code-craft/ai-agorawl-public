import { describe, expect, it } from 'vitest';
import { buildLockNotice, decide } from '../src/logic';

describe('decide', () => {
  it('3回続けて間違えるまでは止めない(足した後の値が1〜3)', () => {
    for (const n of [1, 2, 3]) expect(decide(n)).toEqual({ lock: false, notify: false });
  });

  it('3回続けて間違えた後のログイン(4)で止め、知らせる', () => {
    expect(decide(4)).toEqual({ lock: true, notify: true });
  });

  it('止めた後も断り続けるが、知らせるのは最初の1回だけ', () => {
    for (const n of [5, 10]) expect(decide(n)).toEqual({ lock: true, notify: false });
  });
});

describe('buildLockNotice', () => {
  it('件名にメールアドレス、本文に時刻と解除のコマンドを書く', () => {
    const n = buildLockNotice('you@example.com', '2026-11-13T00:00:00.000Z');
    expect(n.subject).toBe('[Agorawl] ログインを止めました: you@example.com');
    expect(n.message).toContain('止めた時刻: 2026-11-13T00:00:00.000Z');
    expect(n.message).toContain('npm run unlock-user -- you@example.com');
  });
});
