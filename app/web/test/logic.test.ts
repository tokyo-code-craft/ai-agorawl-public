import { describe, expect, it } from 'vitest';
import type { Message } from '@agorawl/contract';
import { copySettings, isAdminProfile, characterIcon, characterPose, groupByCharacter, modelStars, sideOutcomes, collectSources, participantModel, mergeMessages, positionsOf, splitCitations, stageLabel, reconnectDelay, speakerLabel, TURN_OPTIONS, winnerLabel } from '../src/logic';

const m = (turn: number, content = `発言${turn}`): Message => ({
  debateId: 'd1',
  turn,
  role: turn % 2 === 1 ? 'pro' : 'con',
  modelId: 'm',
  content,
  createdAt: 't',
});
const POSITIONS = { pro: '虎派', con: '熊派' };

describe('mergeMessages', () => {
  it('turn で重複を除き、turn の順に並べる。同じ turn は後から来たほうで置き換える', () => {
    const merged = mergeMessages([m(1), m(3)], [m(2), m(3, '取り直した発言3')]);
    expect(merged.map((x) => x.turn)).toEqual([1, 2, 3]);
    expect(merged[2]?.content).toBe('取り直した発言3');
    expect(mergeMessages([], [])).toEqual([]);
  });
});

describe('reconnectDelay', () => {
  it('1秒から倍に延ばし、最大30秒', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe('TURN_OPTIONS', () => {
  it('4〜10の偶数(HTTP APIで作れるのは10ターンまで)', () => {
    expect(TURN_OPTIONS[0]).toBe(4);
    expect(TURN_OPTIONS.at(-1)).toBe(10);
    expect(TURN_OPTIONS.every((n) => n % 2 === 0)).toBe(true);
  });
});

describe('winnerLabel', () => {
  it('判定の多数決、投了、引き分けを立場の名前で表す', () => {
    expect(winnerLabel({ positions: POSITIONS, endReason: 'maxTurns', winner: 'con' })).toBe('熊派の勝ち');
    expect(winnerLabel({ positions: POSITIONS, endReason: 'maxTurns', winner: 'draw' })).toBe('引き分け');
    expect(winnerLabel({ positions: POSITIONS, endReason: 'conceded', concededBy: 'pro' })).toBe('熊派の勝ち(投了)');
    expect(winnerLabel({ positions: POSITIONS, endReason: 'exhausted' })).toBe('引き分け');
    expect(winnerLabel({ positions: POSITIONS })).toBe('');
  });
});

describe('speakerLabel', () => {
  it('先攻・後攻は立場の名前、それ以外(司会を廃止する前の議論)は「司会」', () => {
    expect(speakerLabel('pro', POSITIONS)).toBe('虎派');
    expect(speakerLabel('moderator', POSITIONS)).toBe('司会');
  });
});

describe('collectSources', () => {
  it('各発言の資料を、番号の順に並べる', () => {
    const src = (id: number, turn: number) => ({ id, turn, role: 'pro' as const, query: `q${id}`, text: `要約${id}`, urls: [] });
    const messages = [{ ...m(3), sources: [src(3, 3), src(4, 3)] }, { ...m(1), sources: [src(1, 1)] }, m(2)];
    expect(collectSources(messages).map((s) => s.id)).toEqual([1, 3, 4]);
    expect(collectSources([])).toEqual([]);
  });
});

describe('splitCitations', () => {
  it('資料の番号とそれ以外の文字に分ける', () => {
    expect(splitCitations('資料[13][18]の引用が的確。[5]も')).toEqual(['資料', 13, 18, 'の引用が的確。', 5, 'も']);
    expect(splitCitations('番号なし')).toEqual(['番号なし']);
    expect(splitCitations('[1]')).toEqual([1]);
    expect(splitCitations('[x] と [ 2 ]')).toEqual(['[x] と [ 2 ]']);
  });
});

describe('stageLabel', () => {
  it('立論はターン1・2、ほかは攻防。投了の発言は投了', () => {
    expect([1, 2, 3, 10].map((turn) => stageLabel({ turn, role: turn % 2 ? 'pro' : 'con' }))).toEqual(['立論', '立論', '攻防', '攻防']);
    expect(stageLabel({ turn: 5, role: 'pro', conceded: true })).toBe('投了');
  });
});

describe('positionsOf', () => {
  it('立場の名前を持たない古い議論は「賛成」「反対」', () => {
    expect(positionsOf({ positions: POSITIONS })).toEqual(POSITIONS);
    expect(positionsOf({})).toEqual({ pro: '賛成', con: '反対' });
  });
});

describe('characterIcon', () => {
  it('Claude のモデルには Claude のアイコン', () => {
    expect(characterIcon('jp.anthropic.claude-haiku-4-5-20251001-v1:0')).toEqual({ src: '/characters/claude-icon.png', name: 'Claude' });
    expect(characterIcon('anthropic.claude-opus-5-5')).toEqual({ src: '/characters/claude-icon.png', name: 'Claude' });
  });

  it('立ち絵のないモデルは null', () => {
    expect(characterIcon('openai.gpt-oss-20b-1:0')).toEqual({ src: '/characters/openai-icon.png', name: 'OpenAI' });
    expect(characterIcon('deepseek.v3.2')).toBeNull();
  });
});

describe('characterPose', () => {
  it('ポーズの縮めた版の絵。立ち絵のないモデルは null', () => {
    expect(characterPose('jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'debate')).toEqual({ src: '/characters/claude-debate-sm.png', name: 'Claude' });
    expect(characterPose('openai.gpt-oss-120b-1:0', 'win')).toEqual({ src: '/characters/openai-win-sm.png', name: 'OpenAI' });
    expect(characterPose('deepseek.v3.2', 'debate')).toBeNull();
  });

  it('正面の立ち姿も縮めた版を出す(AIを選ぶ画面)。global の推論プロファイルでも同じキャラクター', () => {
    expect(characterPose('global.anthropic.claude-opus-4-6-v1', 'front')).toEqual({ src: '/characters/claude-front-sm.png', name: 'Claude' });
  });
});

describe('groupByCharacter', () => {
  it('グループごとに、最初に出てくる順にまとめる。立ち絵のないモデルは最後のグループ', () => {
    const ids = [
      'deepseek.v3.2',
      'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
      'openai.gpt-oss-20b-1:0',
      'jp.anthropic.claude-sonnet-4-6',
      'openai.gpt-oss-120b-1:0',
    ];
    const groups = groupByCharacter(ids.map((modelId) => ({ modelId })));
    expect(groups.map((g) => [g.character?.name ?? null, g.models.map((m) => m.modelId)])).toEqual([
      ['Claude', ['jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'jp.anthropic.claude-sonnet-4-6']],
      ['OpenAI', ['openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0']],
      [null, ['deepseek.v3.2']],
    ]);
    expect(groups[0].character?.profile.reason).toBe('知識や議論に関連した賢さの象徴であり、大きな目は異なる視点をじっくり観察するため');
    expect(groups[1].character?.profile.motif).toBe('タコ');
  });

  it('立ち絵のないモデルがなければ、そのグループは作らない', () => {
    expect(groupByCharacter([{ modelId: 'openai.gpt-oss-20b-1:0' }]).map((g) => g.character?.id)).toEqual(['openai']);
  });
});

describe('participantModel', () => {
  it('先攻と後攻のモデルID。なければ空文字', () => {
    const participants = [
      { role: 'pro' as const, modelId: 'a' },
      { role: 'con' as const, modelId: 'b' },
    ];
    expect(participantModel({ participants }, 'pro')).toBe('a');
    expect(participantModel({ participants }, 'con')).toBe('b');
    expect(participantModel({ participants: [] }, 'con')).toBe('');
  });
});

describe('modelStars', () => {
  it('Claude は Haiku 1、Sonnet 2、Opus 3。版の違いでは変えない', () => {
    expect(modelStars('jp.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(1);
    expect(modelStars('anthropic.claude-sonnet-5-5')).toBe(2);
    expect(modelStars('us.anthropic.claude-opus-5-5')).toBe(3);
    expect(modelStars('anthropic.claude-haiku-5-5')).toBe(1);
  });

  it('OpenAI は gpt-oss-20b 1、gpt-oss-120b 2(120b を 20b と取り違えない)', () => {
    expect(modelStars('openai.gpt-oss-20b-1:0')).toBe(1);
    expect(modelStars('openai.gpt-oss-120b-1:0')).toBe(2);
  });

  it('Mistral は Large 1', () => {
    expect(modelStars('mistral.mistral-large-3-675b-instruct')).toBe(1);
    expect(characterIcon('mistral.mistral-large-3-675b-instruct')).toEqual({ src: '/characters/mistral-icon.png', name: 'Mistral' });
  });

  it('決まりにないモデルは0', () => {
    expect(modelStars('deepseek.v3.2')).toBe(0);
    expect(modelStars('openai.gpt-unknown')).toBe(0);
    expect(modelStars('anthropic.claude-unknown')).toBe(0);
    expect(modelStars('')).toBe(0);
  });
});

describe('sideOutcomes', () => {
  it('判定の勝者が勝ち、相手が負け', () => {
    expect(sideOutcomes({ status: 'done', endReason: 'maxTurns', verdict: { judgments: [], winner: 'con' } })).toEqual({ pro: 'lose', con: 'win' });
  });

  it('投了した側が負け', () => {
    expect(sideOutcomes({ status: 'done', endReason: 'conceded', concededBy: 'pro' })).toEqual({ pro: 'lose', con: 'win' });
  });

  it('引き分け(判定の引き分け、両者の攻め手が尽きた)', () => {
    expect(sideOutcomes({ status: 'done', endReason: 'exhausted' })).toEqual({ pro: 'draw', con: 'draw' });
    expect(sideOutcomes({ status: 'done', endReason: 'maxTurns', verdict: { judgments: [], winner: 'draw' } })).toEqual({ pro: 'draw', con: 'draw' });
  });

  it('最大ターン数で終わり、判定がまだなければ判定待ち', () => {
    expect(sideOutcomes({ status: 'done', endReason: 'maxTurns' })).toEqual({ pro: 'waiting', con: 'waiting' });
  });

  it('失敗と議論中は null', () => {
    expect(sideOutcomes({ status: 'failed' })).toBeNull();
    expect(sideOutcomes({ status: 'running' })).toBeNull();
  });
});

describe('isAdminProfile', () => {
  it('cognito:groups に admin があれば管理者', () => {
    expect(isAdminProfile({ 'cognito:groups': ['admin'] })).toBe(true);
    expect(isAdminProfile({ 'cognito:groups': ['other'] })).toBe(false);
    expect(isAdminProfile({})).toBe(false);
    expect(isAdminProfile(undefined)).toBe(false);
  });
});

describe('copySettings', () => {
  const catalog = {
    models: [
      { modelId: 'haiku', name: 'Haiku', feature: '' },
      { modelId: 'mistral', name: 'Mistral', feature: '' },
    ],
    judgeModels: [{ modelId: 'opus', name: 'Opus', feature: '' }],
  };
  const debate = {
    theme: '虎と熊はどちらが強いか',
    positions: { pro: '虎派', con: '熊派' },
    participants: [
      { role: 'pro' as const, modelId: 'haiku' },
      { role: 'con' as const, modelId: 'mistral' },
    ],
    judges: [{ modelId: 'opus' }, { modelId: 'opus' }],
    maxTurns: 8,
  };

  it('テーマ、立場、討論者と審判のAI、ターン数を写す', () => {
    expect(copySettings(debate, catalog)).toEqual({
      theme: '虎と熊はどちらが強いか',
      pro: '虎派',
      con: '熊派',
      maxTurns: 8,
      models: { pro: 'haiku', con: 'mistral', judge: 'opus' },
      notes: [],
    });
  });

  it('今は選べないAIと、選べないターン数は既定のままにし、案内を残す', () => {
    const s = copySettings({ ...debate, participants: [{ role: 'pro', modelId: 'old' }, debate.participants[1]], maxTurns: 11 }, catalog);
    expect(s.models).toEqual({ con: 'mistral', judge: 'opus' });
    expect(s.maxTurns).toBe(10);
    expect(s.notes).toEqual(['元の先攻のAI(old)は今は選べないため、既定のAIにしました', '元のターン数(11ターン)は選べないため、10ターンにしました']);
  });

  it('立場の名前を持たない古い議論は「賛成」「反対」にする。AIの一覧がなければAIは写さない', () => {
    const { positions: _, ...old } = debate;
    const s = copySettings(old, null);
    expect([s.pro, s.con]).toEqual(['賛成', '反対']);
    expect(s.models).toEqual({});
    expect(s.notes).toEqual(['AIの一覧を読み込めなかったため、討論者と審判のAIは既定のAIにしました']);
  });
});
