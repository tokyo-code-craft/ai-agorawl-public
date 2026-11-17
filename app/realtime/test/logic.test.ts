import { describe, expect, it } from 'vitest';
import { ClientError, CONNECTION_TTL_SECONDS, connectionTtl, parseSubscribe, toBroadcast, adminContext } from '../src/logic';

describe('connectionTtl', () => {
  it('接続時刻 + 2時間(UNIX秒)', () => {
    expect(CONNECTION_TTL_SECONDS).toBe(7200);
    expect(connectionTtl(1_700_000_000_500)).toBe(1_700_000_000 + 7200);
  });
});

describe('parseSubscribe', () => {
  it('議論IDを読む。前後の空白は除く', () => {
    expect(parseSubscribe(JSON.stringify({ action: 'subscribe', debateId: ' d1 ' }))).toBe('d1');
  });

  it('議論IDがない、JSONでない本文は ClientError', () => {
    for (const b of [undefined, '{壊れた', 'null', '{"action":"subscribe"}', '{"debateId":""}', '{"debateId":1}']) {
      expect(() => parseSubscribe(b)).toThrow(ClientError);
    }
  });
});

describe('toBroadcast', () => {
  it('Messagesの項目は発言として、作戦メモを除いて送る', () => {
    const item = {
      debateId: 'd1',
      turn: 3,
      role: 'pro',
      modelId: 'm',
      content: '発言',
      createdAt: 't',
      notes: { claims: [], rebuttals: [] },
    };
    const { debateId, payload } = toBroadcast(item);
    expect(debateId).toBe('d1');
    expect(payload.type).toBe('message');
    expect(payload).toEqual({
      type: 'message',
      message: { debateId: 'd1', turn: 3, role: 'pro', modelId: 'm', content: '発言', createdAt: 't' },
    });
  });

  it('Debatesの項目は議論として、listKey を除いて送る', () => {
    const item = { debateId: 'd1', status: 'done', listKey: 'ALL', verdict: { judgments: [], winner: 'con' } };
    const { payload } = toBroadcast(item);
    expect(payload).toEqual({ type: 'debate', debate: { debateId: 'd1', status: 'done', verdict: { judgments: [], winner: 'con' } } });
  });

  it('debateId がない項目はエラー', () => {
    expect(() => toBroadcast({ turn: 1 })).toThrow();
  });
});

describe('adminContext(管理者かどうかをオーソライザーから各ルートへ渡す)', () => {
  it('cognito:groups に admin があれば true', () => {
    expect(adminContext(['admin'])).toBe('true');
    expect(adminContext(['x', 'admin'])).toBe('true');
    expect(adminContext(['x'])).toBe('false');
    expect(adminContext(undefined)).toBe('false');
    expect(adminContext('admin')).toBe('false');
  });
});
