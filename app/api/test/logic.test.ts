import { describe, expect, it } from 'vitest';
import type { Debate, Message } from '@agorawl/contract';
import {
  accountType,
  BadRequestError,
  buildDebate,
  dailyCounter,
  toAccounts,
  buildStartNotice,
  decodeCursor,
  encodeCursor,
  isAdmin,
  parseDefaults,
  listModels,
  parseLimit,
  toSummary,
  visibleMessages,
  withoutListKey,
} from '../src/logic';

const DEFAULTS = {
  participants: [
    { role: 'pro' as const, modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
    { role: 'con' as const, modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0' },
  ],
  judges: [
    { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'logic' as const },
    { modelId: 'global.anthropic.claude-opus-4-6-v1', viewpoint: 'evidence' as const },
  ],
  models: [
    { modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Claude Haiku 4.5', feature: '速い' },
    { modelId: 'jp.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6', feature: 'バランス' },
  ],
  judgeModels: [
    { modelId: 'global.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6', feature: '深く読む' },
    { modelId: 'jp.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6', feature: 'バランス' },
  ],
};
const CTX = { debateId: 'd1', ownerId: 'u1', now: '2026-11-12T00:00:00.000Z' };
const body = (v: unknown) => JSON.stringify(v);

describe('buildDebate', () => {
  it('既定値と合わせて、Debatesに保存する項目を作る。前後の空白は除く。maxTurns の省略時は10', () => {
    const d = buildDebate(body({ theme: ' 虎と熊 ', positions: { pro: ' 虎派', con: '熊派 ' } }), DEFAULTS, CTX);
    expect(d).toEqual({
      debateId: 'd1',
      ownerId: 'u1',
      theme: '虎と熊',
      positions: { pro: '虎派', con: '熊派' },
      status: 'running',
      participants: DEFAULTS.participants,
      judges: DEFAULTS.judges,
      maxTurns: 10,
      createdAt: '2026-11-12T00:00:00.000Z',
      listKey: 'ALL',
    });
    expect(buildDebate(body({ theme: 'テーマ', positions: { pro: 'a', con: 'b' }, maxTurns: 4 }), DEFAULTS, CTX).maxTurns).toBe(4);
  });

  it('HTTP APIで作れるのは10ターンまで。12ターン以上は400', () => {
    expect(buildDebate(body({ theme: 'テーマ', positions: { pro: 'a', con: 'b' }, maxTurns: 10 }), DEFAULTS, CTX).maxTurns).toBe(10);
    for (const maxTurns of [12, 30, 50]) {
      let caught: unknown;
      try {
        buildDebate(body({ theme: 'テーマ', positions: { pro: 'a', con: 'b' }, maxTurns }), DEFAULTS, CTX);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BadRequestError);
      expect((caught as BadRequestError).errors).toEqual(['ターン数は10以下にしてください']);
    }
  });

  it('検証の違反は、違反の一覧を持つ BadRequestError', () => {
    const cases = [
      { theme: '', positions: { pro: 'a', con: 'b' } },
      { theme: 'テーマ', positions: { pro: 'a', con: 'a' } },
      { theme: 'テーマ', positions: { pro: 'a', con: 'b' }, maxTurns: 11 },
      { theme: 'テーマ', positions: { pro: 'a', con: 'b' }, maxTurns: '10' },
      { theme: 'テーマ' },
    ];
    for (const c of cases) {
      try {
        buildDebate(body(c), DEFAULTS, CTX);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).errors.length).toBeGreaterThan(0);
      }
    }
  });

  it('JSONでない本文、オブジェクトでない本文は BadRequestError', () => {
    for (const b of [undefined, '{壊れた', '[]', '"文字列"', 'null']) {
      expect(() => buildDebate(b, DEFAULTS, CTX)).toThrow(BadRequestError);
    }
  });
});

describe('buildDebate の models.judge', () => {
  const base = { theme: 'テーマ', positions: { pro: 'a', con: 'b' } };

  it('省略すれば既定の審判。指定すれば全員のモデルを替え、人数と観点はそのまま', () => {
    expect(buildDebate(body(base), DEFAULTS, CTX).judges).toEqual(DEFAULTS.judges);
    expect(buildDebate(body({ ...base, models: { judge: 'jp.anthropic.claude-sonnet-4-6' } }), DEFAULTS, CTX).judges).toEqual([
      { modelId: 'jp.anthropic.claude-sonnet-4-6', viewpoint: 'logic' },
      { modelId: 'jp.anthropic.claude-sonnet-4-6', viewpoint: 'evidence' },
    ]);
  });

  it('審判で選べるモデルにないものは400(討論者で選べるモデルでも)', () => {
    for (const judge of ['jp.anthropic.claude-haiku-4-5-20251001-v1:0', 1]) {
      let caught: unknown;
      try {
        buildDebate(body({ ...base, models: { judge } }), DEFAULTS, CTX);
      } catch (e) {
        caught = e;
      }
      expect((caught as BadRequestError).errors).toEqual(['審判のAIは、選べるAIから選んでください']);
    }
  });
});

describe('buildDebate の models', () => {
  const base = { theme: 'テーマ', positions: { pro: 'a', con: 'b' } };
  const SONNET = 'jp.anthropic.claude-sonnet-4-6';
  const HAIKU = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

  it('選んだモデルで participants を作る。先攻と後攻で違ってよく、省略した側は既定のモデル', () => {
    expect(buildDebate(body({ ...base, models: { pro: SONNET } }), DEFAULTS, CTX).participants).toEqual([
      { role: 'pro', modelId: SONNET },
      { role: 'con', modelId: HAIKU },
    ]);
    expect(buildDebate(body({ ...base, models: { pro: SONNET, con: SONNET } }), DEFAULTS, CTX).participants.map((p) => p.modelId)).toEqual([
      SONNET,
      SONNET,
    ]);
  });

  it('選べるモデルにないもの、文字列でないもの、オブジェクトでない models は400', () => {
    for (const [models, message] of [
      [{ pro: 'global.anthropic.claude-opus-9' }, '先攻のAIは、選べるAIから選んでください'],
      [{ con: 1 }, '後攻のAIは、選べるAIから選んでください'],
      ['x', 'AIの指定の形が正しくありません'],
    ] as const) {
      try {
        buildDebate(body({ ...base, models }), DEFAULTS, CTX);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestError);
        expect((e as BadRequestError).errors).toEqual([message]);
      }
    }
  });
});

describe('listModels', () => {
  it('討論者と審判で選べるモデルと、先攻・後攻・審判の既定のモデルを返す', () => {
    expect(listModels(DEFAULTS)).toEqual({
      models: DEFAULTS.models,
      judgeModels: DEFAULTS.judgeModels,
      defaults: {
        pro: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
        con: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
        judge: 'global.anthropic.claude-opus-4-6-v1',
      },
    });
  });
});

describe('buildStartNotice', () => {
  const d = buildDebate(body({ theme: '虎と熊はどちらが強いか', positions: { pro: '虎派', con: '熊派' } }), DEFAULTS, CTX);

  it('件名にテーマ、本文に立場・ターン数・作成者・時刻・画面のURLを書く', () => {
    const n = buildStartNotice(d, 'https://example.cloudfront.net');
    expect(n.subject).toBe('[Agorawl] 議論が始まりました: 虎と熊はどちらが強いか');
    expect(n.message).toContain('テーマ: 虎と熊はどちらが強いか');
    expect(n.message).toContain('先攻: 虎派');
    expect(n.message).toContain('後攻: 熊派');
    expect(n.message).toContain('ターン数: 10');
    expect(n.message).toContain('作成者: u1');
    expect(n.message).toContain('作成の時刻: 2026-11-12T00:00:00.000Z');
    expect(n.message).toContain('議論の画面: https://example.cloudfront.net/debates/d1');
  });

  it('件名は100文字までに切り詰め、改行は空白にする', () => {
    // 改行は作成時の検証で断るが、検証を入れる前に作った議論には残りうる
    const base = buildDebate(body({ theme: 'テーマ', positions: { pro: 'a', con: 'b' } }), DEFAULTS, CTX);
    const long = { ...base, theme: `${'あ'.repeat(50)}\n${'い'.repeat(100)}` };
    const { subject } = buildStartNotice(long, 'https://example.cloudfront.net');
    expect(subject.length).toBe(100);
    expect(subject.endsWith('…')).toBe(true);
    expect(subject).not.toContain('\n');
  });
});

describe('parseDefaults', () => {
  it('participants、judges、models、judgeModels の配列を持つJSONを読む', () => {
    expect(parseDefaults(JSON.stringify(DEFAULTS))).toEqual(DEFAULTS);
    expect(() => parseDefaults(undefined)).toThrow();
    expect(() => parseDefaults('{"participants":[]}')).toThrow();
    // 既定のモデルが選べるモデルにない
    expect(() => parseDefaults(JSON.stringify({ ...DEFAULTS, models: DEFAULTS.models.slice(1) }))).toThrow();
    // 審判で選べるモデルがない、既定の審判が審判で選べるモデルにない、既定の審判のモデルがそろっていない
    const { judgeModels: _omit, ...noJudgeModels } = DEFAULTS;
    expect(() => parseDefaults(JSON.stringify(noJudgeModels))).toThrow();
    expect(() => parseDefaults(JSON.stringify({ ...DEFAULTS, judgeModels: DEFAULTS.judgeModels.slice(1) }))).toThrow();
    expect(() => parseDefaults(JSON.stringify({ ...DEFAULTS, judges: [...DEFAULTS.judges, { modelId: 'jp.anthropic.claude-sonnet-4-6' }] }))).toThrow();
    expect(() => parseDefaults(JSON.stringify({ ...DEFAULTS, judges: [] }))).toThrow();
  });
});

describe('parseLimit', () => {
  it('1〜50の整数。省略時は20', () => {
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('50')).toBe(50);
    for (const v of ['0', '51', '1.5', 'abc', '']) expect(() => parseLimit(v)).toThrow(BadRequestError);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('続きの位置を文字列にして戻せる。続きがなければ undefined', () => {
    const key = { debateId: 'd1', listKey: 'ALL', createdAt: '2026-11-12T00:00:00.000Z' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    expect(encodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it('読めない cursor は BadRequestError', () => {
    for (const c of ['@@@', Buffer.from('[1]').toString('base64url'), Buffer.from('壊れた').toString('base64url')]) {
      expect(() => decodeCursor(c)).toThrow(BadRequestError);
    }
  });
});

const debate: Debate = {
  debateId: 'd1',
  ownerId: 'u1',
  theme: 'テーマ',
  positions: { pro: '虎派', con: '熊派' },
  status: 'done',
  participants: DEFAULTS.participants,
  judges: DEFAULTS.judges,
  maxTurns: 10,
  createdAt: '2026-11-12T00:00:00.000Z',
  listKey: 'ALL',
  endReason: 'maxTurns',
  verdict: { judgments: [], winner: 'con' },
};

describe('toSummary / withoutListKey', () => {
  it('一覧の1件は、判定の詳細を含めず、多数決の勝者だけを持つ。討論者のモデルは持ち、審判は持たない', () => {
    expect(toSummary(debate)).toEqual({
      debateId: 'd1',
      theme: 'テーマ',
      positions: { pro: '虎派', con: '熊派' },
      participants: DEFAULTS.participants,
      status: 'done',
      maxTurns: 10,
      createdAt: '2026-11-12T00:00:00.000Z',
      endReason: 'maxTurns',
      winner: 'con',
    });
    const running = toSummary({ ...debate, status: 'running', endReason: undefined, verdict: undefined });
    expect(running).not.toHaveProperty('endReason');
    expect(running).not.toHaveProperty('winner');
  });

  it('議論の応答は listKey を持たない', () => {
    expect(withoutListKey(debate)).not.toHaveProperty('listKey');
    expect(withoutListKey(debate).verdict).toEqual(debate.verdict);
  });
});

describe('visibleMessages', () => {
  const m = (turn: number): Message => ({
    debateId: 'd1',
    turn,
    role: turn % 2 === 1 ? 'pro' : 'con',
    modelId: 'm',
    content: `発言${turn}`,
    createdAt: 't',
    notes: { claims: [], rebuttals: [] },
  });

  it('turn の順に並べる。議論が running の間は作戦メモを除く', () => {
    const running = visibleMessages([m(2), m(1)], 'running');
    expect(running.map((x) => x.turn)).toEqual([1, 2]);
    expect(running.every((x) => !('notes' in x))).toBe(true);
    expect(visibleMessages([m(2), m(1)], 'done').every((x) => x.notes)).toBe(true);
    expect(visibleMessages([m(1)], 'failed')[0]?.notes).toBeDefined();
  });
});

describe('isAdmin', () => {
  it('JWTオーソライザーの文字列の形("[admin other]")から、admin を見つける', () => {
    expect(isAdmin({ 'cognito:groups': '[admin]' })).toBe(true);
    expect(isAdmin({ 'cognito:groups': '[other admin]' })).toBe(true);
    expect(isAdmin({ 'cognito:groups': '[administrators]' })).toBe(false);
  });

  it('配列の形でも読む', () => {
    expect(isAdmin({ 'cognito:groups': ['admin'] })).toBe(true);
  });

  it('グループがなければ管理者ではない', () => {
    expect(isAdmin({ sub: 'user-1' })).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('accountType(docs/04-app/README.md「アカウントの種類」)', () => {
  it('admin なら管理者、demo ならデモ、どちらもなければ一般', () => {
    expect(accountType({ 'cognito:groups': '[admin]' })).toBe('admin');
    expect(accountType({ 'cognito:groups': '[demo]' })).toBe('demo');
    expect(accountType({ 'cognito:groups': ['demo'] })).toBe('demo');
    expect(accountType({ sub: 'u-1' })).toBe('general');
  });

  it('両方に入っていれば管理者', () => {
    expect(accountType({ 'cognito:groups': '[demo admin]' })).toBe('admin');
  });
});

describe('dailyCounter(docs/04-app/README.md「デモのアカウントが1日に作れる議論」)', () => {
  it('日本時間の0時で日付が変わる', () => {
    expect(dailyCounter('u-1', new Date('2026-11-15T14:59:59.000Z')).counterKey).toBe('u-1#2026-11-15');
    expect(dailyCounter('u-1', new Date('2026-11-15T15:00:00.000Z')).counterKey).toBe('u-1#2026-11-16');
  });

  it('行は2日後に消す', () => {
    const now = new Date('2026-11-15T00:00:00.000Z');
    expect(dailyCounter('u-1', now).expiresAt).toBe(now.getTime() / 1000 + 2 * 24 * 60 * 60);
  });
});

describe('toAccounts', () => {
  it('グループから種類を決め、止めたユーザーは enabled: false、作った時刻の古い順に並べる', () => {
    const user = (name: string, email: string, created: string, enabled = true) => ({
      Username: name,
      Attributes: [{ Name: 'email', Value: email }],
      Enabled: enabled,
      UserCreateDate: new Date(created),
    });
    const items = toAccounts(
      [
        user('u-demo', 'demo@example.com', '2026-11-15T00:00:00.000Z'),
        user('u-admin', 'dev@example.com', '2026-11-01T00:00:00.000Z'),
        user('u-general', 'general@example.com', '2026-11-10T00:00:00.000Z', false),
      ],
      { admin: new Set(['u-admin']), demo: new Set(['u-demo']) },
    );
    expect(items).toEqual([
      { email: 'dev@example.com', type: 'admin', enabled: true, createdAt: '2026-11-01T00:00:00.000Z' },
      { email: 'general@example.com', type: 'general', enabled: false, createdAt: '2026-11-10T00:00:00.000Z' },
      { email: 'demo@example.com', type: 'demo', enabled: true, createdAt: '2026-11-15T00:00:00.000Z' },
    ]);
  });
});
