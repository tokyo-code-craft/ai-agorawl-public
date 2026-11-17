import { describe, expect, it } from 'vitest';
import type { DebaterNotes, Positions } from '@agorawl/contract';
import {
  buildConcessionSystemPrompt,
  buildConcessionUserMessage,
  buildDebaterSystemPrompt,
  buildDebaterUserMessage,
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  EVALUATION_CRITERIA,
  visibleToDebater,
} from '../src/prompts';

const NOTES: DebaterNotes = {
  claims: [{ id: 'C1', text: '通勤がない', score: 7, status: 'defending' }],
  rebuttals: [{ id: 'R1', target: '対面の価値', text: '代替できる', score: 5, status: 'pursuing' }],
};

const POSITIONS: Positions = { pro: '週休3日制', con: '週休2日制' };
const SETTING = { theme: '週休は何日がよいか', positions: POSITIONS };

describe('buildDebaterSystemPrompt', () => {
  it('テーマ、自分と相手の立場、根拠のルール、出力の形式を含む', () => {
    const p = buildDebaterSystemPrompt('con', SETTING);
    expect(p).toContain('テーマ:「週休は何日がよいか」');
    expect(p).toContain('あなたの立場:「週休2日制」');
    expect(p).toContain('相手の立場:「週休3日制」');
    expect(p).toContain('立場(「週休2日制」)は最後まで変えない');
    expect(p).toContain('主張は、自分の立場(「週休2日制」)が良い理由で、相手の主張がなくても成り立つもの');
    expect(p).toContain('相手の主張の弱さを突く論点は、主張ではなく反論一覧に書く');
    expect(p).toContain('自分の立場に反する内容は書かない');
    expect(p).not.toMatch(/賛成|反対/);
    expect(p).toContain('統計の数字');
    expect(p).toContain('<notes>');
    expect(p).toContain('<speech>');
    expect(p).toContain('作戦については、発言で触れない。ただし、主張の撤回は発言で述べてよい');
    // 撤回するかは評価の基準(logic)で促し、発言のルールでは指示しない
    expect(p).not.toContain('撤回すると発言で述べる');
    expect(p).toContain('撤回を発言で明言し、残る主張で論じる');
    expect(p).toContain('資料一覧の番号を付けて引用するときだけ');
    expect(p).toContain('search ツール');
  });
});

describe('buildDebaterUserMessage', () => {
  it('ターン1: 履歴と作戦メモは「まだありません」、立論の指示', () => {
    const m = buildDebaterUserMessage({
      role: 'pro',
      positions: POSITIONS,
      history: [],
      sources: [],
      previousNotes: undefined,
      turn: 1,
      stage: 'opening',
      remaining: 7,
    });
    expect(m).toBe(
      [
        'これまでの発言:',
        '(まだありません)',
        '',
        '資料一覧:',
        '(まだありません)',
        '',
        'あなたの前回の作戦メモ:',
        '(まだありません)',
        '',
        'あなたの番です(ターン1、立論)。このターンを含めて、あなたの発言は残り7回です。',
        '自分の立場の主張を2〜3点立てて主張一覧を作り、述べてください。立論では相手の発言を見ずに述べるので、反論一覧は空にしてください。',
      ].join('\n'),
    );
  });

  it('自分の最初の攻防(ターン3・4)では、相手の立論への反論一覧を作らせ、反論を受けていなければ守りは不要と伝える', () => {
    for (const [role, turn] of [['pro', 3], ['con', 4]] as const) {
      const m = buildDebaterUserMessage({
        role,
        positions: POSITIONS,
        history: [
          { turn: 1, role: 'pro', content: '先攻の立論' },
          { turn: 2, role: 'con', content: '後攻の立論' },
        ],
        sources: [],
        previousNotes: NOTES,
        turn,
        stage: 'exchange',
        remaining: 6,
      });
      expect(m).toContain('[ターン2 ' + (role === 'pro' ? '相手(週休2日制)' : 'あなた(週休2日制)') + '・立論] 後攻の立論');
      expect(m).toContain(`あなたの番です(ターン${turn}、攻防)`);
      expect(m).toContain('相手の立論を読み、相手の主張への反論を反論一覧に加えて追及してください');
      expect(m).toContain('まだ反論を受けていなければ、守りは要りません');
    }
  });

  it('2回目以降は前回の作戦メモを渡し、守りと攻めを指示する。話者と検索した側は立場の名前で書き、モデル名は含めない', () => {
    const m = buildDebaterUserMessage({
      role: 'pro',
      positions: POSITIONS,
      history: [
        { turn: 1, role: 'pro', content: '先攻の立論' },
        { turn: 2, role: 'con', content: '後攻の立論' },
        { turn: 3, role: 'pro', content: '先攻の攻め' },
        { turn: 4, role: 'con', content: '後攻の攻め' },
      ],
      sources: [{ id: 1, turn: 2, role: 'con', query: '週休3日 事例', text: '事例の要約', urls: ['https://example.com/a'] }],
      previousNotes: NOTES,
      turn: 5,
      stage: 'exchange',
      remaining: 5,
    });
    expect(m).toContain('[ターン1 あなた(週休3日制)・立論] 先攻の立論');
    expect(m).toContain('[ターン2 相手(週休2日制)・立論] 後攻の立論');
    expect(m).toContain('[ターン4 相手(週休2日制)・攻防] 後攻の攻め');
    expect(m).toContain('[1] 検索語「週休3日 事例」(ターン2 相手(週休2日制)が検索): 事例の要約 出典: https://example.com/a');
    expect(m).toContain('"id": "R1"');
    expect(m).toContain('"status": "pursuing"');
    expect(m).toContain('残り5回');
    expect(m).not.toContain('守りは要りません');
    expect(m).toContain('守り:');
    // 主張を足すように促す指示はしない(足すこと自体は作戦メモの更新としてできる)
    expect(m).not.toContain('新しい主張として主張一覧に加えてください');
    expect(m).toContain('相手の主張の弱さを突く論点は、反論一覧に加えてください');
    expect(m).toContain('相手の主張の弱さを突く論点は、反論一覧に加えてください');
    expect(m).not.toMatch(/anthropic|amazon|openai/);
  });
});

describe('visibleToDebater', () => {
  const history = [{ turn: 1, role: 'pro' as const, content: '先攻の立論' }];

  it('立論のターン(1・2)では、相手の発言も資料も渡さない', () => {
    expect(visibleToDebater(history, 1)).toEqual([]);
    expect(visibleToDebater(history, 2)).toEqual([]);
  });

  it('攻防のターン(3〜)では、すべて渡す', () => {
    expect(visibleToDebater(history, 3)).toEqual(history);
  });
});

describe('投了', () => {
  it('あなたと相手の区別を立場の名前で明示し、履歴も本人の視点で書く', () => {
    const p = buildConcessionSystemPrompt('con', SETTING);
    expect(p).toContain('あなたの立場:「週休2日制」');
    expect(p).toContain('あなた(週休2日制)の主張は');
    expect(p).toContain('相手(週休3日制)の主張は');
    const m = buildConcessionUserMessage({
      role: 'con',
      positions: POSITIONS,
      history: [{ turn: 1, role: 'pro', content: '先攻の立論' }],
      notes: NOTES,
      turn: 2,
    });
    expect(m).toContain('[ターン1 相手(週休3日制)・立論] 先攻の立論');
    expect(m).toContain('あなたの番です(ターン2、投了)');
  });
});

describe('評価の基準', () => {
  it('先攻・後攻と審判のシステムプロンプトに同じ基準が入る', () => {
    const criteria = EVALUATION_CRITERIA.join('\n');
    expect(buildDebaterSystemPrompt('pro', SETTING)).toContain(criteria);
    expect(buildDebaterSystemPrompt('con', SETTING)).toContain(criteria);
    expect(buildJudgeSystemPrompt(SETTING)).toContain(criteria);
  });

  it('先頭に用語の意味を置き、基準の名前は用語で書く(審判は作戦メモの説明を受け取らないため)', () => {
    const criteria = EVALUATION_CRITERIA.join('\n');
    expect(criteria.startsWith('用語(評価の基準で使う言葉の意味):')).toBe(true);
    for (const term of ['主張', '反論', '追及', '受けた反論', '崩された主張', '持ちこたえた主張', '資料', '引用']) {
      expect(criteria).toContain(`- ${term}: `);
    }
    expect(criteria.indexOf('用語(')).toBeLessThan(criteria.indexOf('評価の基準('));
    expect(criteria).toContain('- response(受けた反論への応答)');
    expect(criteria).not.toContain('追及への応答');
  });

  it('言い直しの追及とブログを主軸にすることを低い評価として挙げる', () => {
    const criteria = EVALUATION_CRITERIA.join('\n');
    expect(criteria).toContain('既存の根拠で同じ反論を言い直す');
    // 論点を選んで深く論じることを促す(Issue #27)
    expect(criteria).toContain('相手の主張の中から、崩す効果が最も大きいものを選んで、反論を深く追及する');
    expect(criteria).toContain('相手の主張の多くに毎回少しずつ反論し、1つずつの掘り下げが浅い');
    expect(criteria).toContain('受けた反論のうち、自分の主張にとって影響の大きいものに正面から答える');
    expect(criteria).toContain('1回の発言で扱う主張や反論が少ないこと自体は、評価を下げない');
    // 意味のあいまいな「論点」で基準を書かない(用語の「主張」の定義の中だけで使う)
    expect(criteria.replace(/- 主張: [^\n]*/, '')).not.toContain('論点');
    // 並べる形の言葉は基準に入れない(「3点以下」は主張の点数の区切りなので対象外)
    expect(criteria).not.toMatch(/三つ|3つ|第一に/);
    expect(criteria).toContain('個人のブログ');
    expect(criteria).toContain('新しい根拠か新しい角度を加える');
  });

  it('自分の主張との対比で相手の弱さを示す反論を高い評価として挙げる', () => {
    const criteria = EVALUATION_CRITERIA.join('\n');
    expect(criteria).toContain('自分の主張の良さを示したうえで、その対比で相手の主張の弱さを示す');
  });
});

describe('審判', () => {
  it('観点があれば、立場の次の行に観点の文を入れる。なければ入れない', () => {
    const p = buildJudgeSystemPrompt(SETTING, 'evidence');
    expect(p).toContain(
      [
        '後に話す側(後攻)は「週休2日制」',
        '観点: あなたは「根拠の審判」。発言の引用が資料の内容と合っているか、根拠の出どころが確かかを、特に注意して読む。4項目とも下の「評価の基準」どおりに採点し、理由は、この観点から見た評価を中心に書く。',
        '',
        '守ること:',
      ].join('\n'),
    );
    expect(buildJudgeSystemPrompt(SETTING, 'logic')).toContain('あなたは「論理の審判」');
    expect(buildJudgeSystemPrompt(SETTING, 'exchange')).toContain('あなたは「反論・応答の審判」');
    expect(buildJudgeSystemPrompt(SETTING)).not.toContain('観点:');
  });

  it('4つの基準と、立場と出力のキーの対応を含む。履歴は立場の名前のラベルで、作戦メモを含まない', () => {
    const p = buildJudgeSystemPrompt(SETTING);
    for (const k of ['logic', 'evidence', 'rebuttal', 'response']) expect(p).toContain(k);
    expect(p).toContain('立場: 先に話す側(先攻)は「週休3日制」、後に話す側(後攻)は「週休2日制」');
    expect(p).toContain('「先攻C1」「後攻R1」のように、先攻・後攻を頭に付けたIDで示す(Cは主張、Rは反論)。理由の文で項目に触れるときも、このIDで書く。');
    expect(p).toContain('{"claims":{"pro":[{"id":"先攻C1","score":0}],"con":[{"id":"後攻C1","score":0}]}');
    expect(p).toContain('出力の形式(pro は「週休3日制」側、con は「週休2日制」側の採点。claims には主張一覧の、rebuttals には反論一覧のすべての項目を書く)');
    expect(p).toContain('先に、下の「主張一覧」にある両者の主張を、1件ずつ0〜10の整数で採点する。');
    expect(p).toContain('次に、下の「反論一覧」にある両者の反論を、1件ずつ0〜10の整数で採点する。');
    expect(p).toContain('発言で一度も述べていない項目は0点にする。');
    expect(p).toContain('logic は、主張と反論を通した自分の発言の一貫性で採点し、崩された主張の扱いは主張ごとの点数を踏まえる。response は主張ごとの点数を、rebuttal は反論ごとの点数を踏まえて採点する。');
    expect(p).toContain('evidence は、発言の引用([3] など)を、下の「資料一覧」の要約と出典のURLに照らし合わせて採点する。');
    // 審判だけの手順なので、討論者には渡さない
    expect(buildDebaterSystemPrompt('pro', SETTING)).not.toContain('照らし合わせて採点する');
    expect(p.indexOf('"rebuttals"')).toBeLessThan(p.indexOf('"scores"'));
    expect(p.indexOf('"claims"')).toBeLessThan(p.indexOf('"scores"'));
    expect(p).toContain('どちらか一方の立場だけに立証の責任を負わせない');
    expect(p).toContain('出力はJSONのみ');
    expect(p).toContain('示していないこと自体は、評価を下げない');
    expect(p).toContain('引用が資料の内容と合っている');
    expect(p).not.toMatch(/賛成|反対|司会/);
    const m = buildJudgeUserMessage(
      [
        { turn: 1, role: 'pro', content: '先攻の立論' },
        { turn: 2, role: 'con', content: '後攻の立論' },
        { turn: 3, role: 'pro', content: '先攻の攻防' },
        { turn: 4, role: 'con', content: '後攻の投了', conceded: true },
      ],
      [{ id: 1, turn: 1, role: 'pro', query: 'q', text: '要約', urls: [] }],
      POSITIONS,
      { pro: [{ id: 'C1', text: '先攻の主張' }], con: [] },
      { pro: [], con: [{ id: 'R1', target: '先攻のC1', text: '後攻の反論' }] },
    );
    // 主張一覧はIDと内容だけ。主張がない側は「(なし)」
    expect(m).toContain(['主張一覧:', '週休3日制側:', '先攻C1: 先攻の主張', '週休2日制側:', '(なし)'].join('\n'));
    // 反論一覧はIDと対象と内容だけ
    expect(m).toContain(['反論一覧:', '週休3日制側:', '(なし)', '週休2日制側:', '後攻R1(対象: 先攻のC1): 後攻の反論'].join('\n'));
    expect(m).toContain('[1] 検索語「q」(ターン1 週休3日制側が検索): 要約 出典: (なし)');
    expect(m).toContain('[ターン1 週休3日制側・立論] 先攻の立論');
    expect(m).toContain('[ターン2 週休2日制側・立論] 後攻の立論');
    expect(m).toContain('[ターン3 週休3日制側・攻防] 先攻の攻防');
    expect(m).toContain('[ターン4 週休2日制側・投了] 後攻の投了');
    expect(m).not.toContain('あなた');
    // 答える機会のない反論がどれかを取り違えないよう、最後の発言を明示する
    expect(m).toContain('議論の最後の発言は、ターン4の週休2日制側の発言です。\n議論は最大ターン数で終わりました。');
    expect(buildJudgeUserMessage([], [], POSITIONS, { pro: [], con: [] }, { pro: [], con: [] })).not.toContain(
      '議論の最後の発言は',
    );
  });

  it('答える機会のない反論は、受けた側の減点にも、出した側の反論の評価にもしない(討論者と審判で同じ文)', () => {
    for (const p of [buildJudgeSystemPrompt(SETTING), buildDebaterSystemPrompt('pro', SETTING)]) {
      expect(p).toContain('- 答える機会のない反論: 議論の最後の発言で出た反論。相手にはもう発言の番がないため、答えられない。');
      expect(p).toContain('  - 答える機会のない反論は、この項目の評価に入れない。');
      expect(p).toContain('答える機会のない反論だけを理由に、相手の主張を崩された主張と見なさない。');
      expect(p).toContain('答えられていない反論(答える機会のない反論は除く)が残っていれば低');
    }
  });
});
