// プロンプトの組み立て。仕様: docs/03-engine/prompts.md
import type { Claim, Debate, DebaterNotes, DebaterRole, JudgeViewpoint, Message, Positions, Rebuttal, Source } from '@agorawl/contract';
import { sideLabel, sourceLines } from './sources';
import { isFirstExchangeTurn, isOpeningTurn, STAGE_LABELS, type Stage } from './turn-plan';

export type HistoryItem = Pick<Message, 'turn' | 'role' | 'content' | 'conceded' | 'exhausted'>;

/** プロンプトに入れる議論の設定(テーマと立場の名前) */
export type DebateSetting = Pick<Debate, 'theme' | 'positions'>;

/**
 * 評価の基準。審判の採点と同じ文を先攻・後攻にも渡し、討論者が目指すものと審判が見るものをそろえる。
 * 仕様: docs/03-engine/README.md「採点の基準」
 */
export const EVALUATION_CRITERIA: string[] = [
  '用語(評価の基準で使う言葉の意味):',
  '- 主張: 各側が、自分の立場が良い理由として立てる論点。相手の主張がなくても成り立つもの。',
  '- 反論: 相手の主張の弱さを突く指摘。',
  '- 追及: 同じ反論を、ターンをまたいで続けて突くこと。',
  '- 受けた反論: 自分の主張に向けられた、相手の反論(相手の追及を含む)。',
  '- 崩された主張: 受けた反論に、根拠付きで答えられていない主張。審判が3点以下と見なす主張。',
  '- 持ちこたえた主張: 受けた反論に、根拠付きで答えられている主張。審判が8点以上と見なす主張。',
  '- 資料: 検索で集め、資料一覧に番号付きで載っている事実の要約。',
  '- 引用: 発言の中で、資料の番号([3] など)を付けて資料の内容を使うこと。',
  '- 答える機会のない反論: 議論の最後の発言で出た反論。相手にはもう発言の番がないため、答えられない。',
  '',
  '評価の基準(議論の後、審判がこの4項目で両者をそれぞれ0〜10点で採点し、合計点で勝敗を決める):',
  '- logic(論理の一貫性)',
  '  - 評価が高い: 主張と理由のつながりが明確で、自分の前の発言と矛盾しない。審判が3点以下と見なす主張(崩された主張)は、撤回を発言で明言し、残る主張で論じる。',
  '  - 評価が高くない: 推論に飛躍がある。自分の前の発言と矛盾する。審判が3点以下と見なす主張を、撤回を明言しないまま放置する。',
  '- evidence(根拠の確かさ)',
  '  - 評価が高い: 固有の事実に資料の番号を付けて引用し、引用が資料の内容と合っている。根拠の主軸を、公的機関・研究機関・報道機関の資料で裏付ける(見つからなければ検索語を変えて調べ直す)。資料のない根拠は、論理、一般的な知識、仮の例(仮の例であると明示する)で示す。',
  '  - 評価が高くない: 個人のブログや個人の記事(出典のURLで判断する)を根拠の主軸にする。資料の内容と食い違う引用をする。資料のない固有の事実を断定する。',
  '  - 統計やデータを示していないこと自体は、評価を下げない。',
  '- rebuttal(反論の的確さ)',
  '  - 評価が高い: 相手の発言を踏まえ、相手の主張や引用を具体的に崩す。自分の主張の良さを示したうえで、その対比で相手の主張の弱さを示す。同じ反論の追及を続けるときは、新しい根拠か新しい角度を加える。相手の主張の中から、崩す効果が最も大きいものを選んで、反論を深く追及する。',
  '  - 評価が高くない: 新しい根拠も新しい角度もないまま、既存の根拠で同じ反論を言い直す。相手の発言とかみ合わない。相手の主張の多くに毎回少しずつ反論し、1つずつの掘り下げが浅い。',
  '  - 1回の発言で扱う主張や反論が少ないこと自体は、評価を下げない。',
  '  - 答える機会のない反論は、この項目の評価に入れない。',
  '- response(受けた反論への応答)',
  '  - 評価が高い: 受けた反論のうち、自分の主張にとって影響の大きいものに正面から答える。審判が8点以上と見なす主張(相手の反論に持ちこたえた主張)を軸に論じる。',
  '  - 評価が高くない: はぐらかす。前と同じ説明を繰り返す。審判が3点以下と見なす主張(根拠付きの反論に答えられていない主張)を、補強せずに訴え続ける。影響の大きい受けた反論に答えず、小さな反論への答えだけで済ませる。',
  '  - 答える機会のない反論に答えていないことは、評価を下げない。答える機会のない反論だけを理由に、相手の主張を崩された主張と見なさない。',
];

export function buildDebaterSystemPrompt(role: DebaterRole, setting: DebateSetting): string {
  const position = setting.positions[role];
  return [
    'あなたはディベートの討論者です。',
    `テーマ:「${setting.theme}」`,
    `あなたの立場:「${position}」`,
    `相手の立場:「${setting.positions[opponentOf(role)]}」`,
    '',
    '目的:',
    '- 自分の主張を守り、相手の主張を崩して、点数を稼ぐ。',
    `- 立場(「${position}」)は最後まで変えない。ただし、守りきれない個々の主張は捨ててよい。`,
    '- 議論の後、審判が下の「評価の基準」で採点し、勝敗を決める。',
    '',
    '作戦メモ:',
    '- 主張一覧: 自分の主張ごとに、ID(C1、C2…)、内容、点数、状態を持つ。',
    `  - 主張は、自分の立場(「${position}」)が良い理由で、相手の主張がなくても成り立つもの。相手の主張の弱さを突く論点は、主張ではなく反論一覧に書く。自分の立場に反する内容は書かない。`,
    '  - 点数(0〜10の整数): 議論の後に審判が付けるであろう、その主張の点数の見込み。審判は、その主張が相手の反論を受けてもどれだけ持ちこたえたかで付ける(相手の反論に根拠付きで答えられていれば高く、答えられていない反論(答える機会のない反論は除く)が残っていれば低い)。審判は8点以上を持ちこたえた主張、3点以下を崩された主張とみなす。',
    '  - 状態: defending(守る)か abandoned(捨てる)。',
    '- 反論一覧: 相手の主張への反論ごとに、ID(R1、R2…)、対象(相手のどの主張への反論か)、内容、点数を持つ。',
    '  - 点数(0〜10の整数): その反論で相手をどれだけ崩せているか。相手がはぐらかした、または根拠を示せなかったら高く、相手が根拠付きで直接答えたら低くする。相手がまだ答えていない反論は見込みで付ける。',
    '  - 8点以上は獲得(追及を終えて次の反論を探す)、4〜7点は追及中(追及を続ける)、3点以下は断念(次の反論を探す)として扱われる。',
    '- 点数は甘くせず、相手の発言を踏まえて正直に付ける。',
    '- 点数は「評価の基準」も踏まえて付ける(例: 新しい根拠も新しい角度もない言い直しでは、反論の点数を上げない)。',
    '- 守っている主張(defending)が1件もなくなると、あなたの負け(投了)になる。',
    '- 両者とも追及中の反論がなくなると、引き分けで議論が終わる。',
    '- 毎ターン、相手の最新の発言を読んで一覧を更新する(主張・反論の追加、点数の更新、主張を捨てる)。同じ項目には同じIDを使い続ける。',
    '- 作戦メモには、新しい項目と、変えた項目(点数・状態・内容)だけを書く。変えない項目は書かなくてよく、前回のまま引き継がれる。新しい項目には、前回の作戦メモにないIDを付ける。',
    '- 変える項目は、IDと変える欄だけを書けばよい(例: {"id": "C1", "score": 4})。新しい項目は、すべての欄を書く。',
    '- 前回の作戦メモがないときは、主張を1件以上書く。',
    '- 項目は消せない。主張は捨てる(abandoned)、反論は点数を下げて断念にする。',
    '',
    '根拠のルール:',
    '- 固有の事実(調査名、統計の数字、人名、企業名など)は、資料一覧の番号を付けて引用するときだけ使ってよい(例:「[3]によれば…」)。資料にない固有の事実は出さない。',
    '- 資料のない根拠は、論理、一般的な知識、仮の例(仮の例であると明示する)で示す。',
    '- 根拠が必要なら search ツールでWebを検索できる(1ターン3回まで)。結果は資料一覧に番号付きで追加され、相手と審判も読む。',
    '- 相手の根拠が示されていない、不確かである、または引用が資料の内容と合っていなければ、それを指摘してよい。',
    '',
    '発言のルール:',
    '- 日本語で、400字程度で述べる。',
    '- 相手の発言があるときは、守り(相手の反論に答える)と攻め(相手の主張を追及する)の両方を行う。',
    '- 相手の主張に反論するときは、相手の発言を短く引用してから反論する(例:「相手は『…』と言うが、…」)。',
    '- 発言には、見出し、話者名、前置き、点数、主張・反論のID(C1、R1など)を書かない。資料の番号([3]など)は書いてよい。',
    '- 残りの発言回数、点数、作戦メモ、自分の作戦については、発言で触れない。ただし、主張の撤回は発言で述べてよい(主張の内容で示し、IDや点数は書かない)。',
    '',
    ...EVALUATION_CRITERIA,
    '',
    '出力の形式(これ以外は書かない):',
    '<notes>',
    '{"claims":[{"id":"C1","text":"…","score":7,"status":"defending"}],"rebuttals":[{"id":"R1","target":"…","text":"…","score":6}]}',
    '</notes>',
    '<speech>',
    '発言の本文',
    '</speech>',
  ].join('\n');
}

const INSTRUCTIONS = {
  opening:
    '自分の立場の主張を2〜3点立てて主張一覧を作り、述べてください。立論では相手の発言を見ずに述べるので、反論一覧は空にしてください。',
  firstExchange:
    '守り: 相手の最新の発言で反論を受けていれば、それに答えてください(まだ反論を受けていなければ、守りは要りません)。攻め: 相手の立論を読み、相手の主張への反論を反論一覧に加えて追及してください。相手の主張の弱さを突く論点は、主張ではなく反論一覧に加えてください。残りの発言回数を考えて、力を入れる反論を選んでください。',
  exchange:
    '守り: 相手の最新の発言で受けた反論に答えてください。攻め: 反論一覧から点数を稼げそうな反論を選んで追及し、必要なら新しい反論を加えてください。相手の主張の弱さを突く論点は、反論一覧に加えてください。残りの発言回数を考えて、力を入れる反論を選んでください。',
};

export function buildDebaterUserMessage(params: {
  role: DebaterRole;
  positions: Positions;
  history: HistoryItem[];
  sources: Source[];
  previousNotes: DebaterNotes | undefined;
  turn: number;
  stage: Stage;
  remaining: number;
}): string {
  const { role, positions, history, sources, previousNotes, turn, stage, remaining } = params;
  const instruction =
    stage === 'opening'
      ? INSTRUCTIONS.opening
      : isFirstExchangeTurn(turn)
        ? INSTRUCTIONS.firstExchange
        : INSTRUCTIONS.exchange;

  return [
    ...historyLines(history, positions, role),
    '',
    '資料一覧:',
    ...sourceLines(sources, positions, role),
    '',
    'あなたの前回の作戦メモ:',
    previousNotes ? JSON.stringify(previousNotes, null, 2) : '(まだありません)',
    '',
    `あなたの番です(ターン${turn}、${STAGE_LABELS[stage]})。このターンを含めて、あなたの発言は残り${remaining}回です。`,
    instruction,
  ].join('\n');
}

export function buildConcessionSystemPrompt(role: DebaterRole, setting: DebateSetting): string {
  const side = setting.positions[role];
  const opponent = setting.positions[opponentOf(role)];
  return [
    'あなたはディベートの討論者です。',
    `テーマ:「${setting.theme}」`,
    `あなたの立場:「${side}」`,
    'あなたは、この議論で負けを認めることになりました(守っている主張がなくなったため)。',
    '',
    'あなたと相手の区別:',
    `- あなた(${side})の主張は、作戦メモの主張一覧と、履歴で「あなた(${side})」と書かれた発言にあるもの。`,
    `- 相手(${opponent})の主張は、履歴で「相手(${opponent})」と書かれた発言にあるもの。`,
    '- 両者を取り違えない。',
    '',
    '守ること:',
    '- 負けを認める発言をする。相手の主張のうち、崩せなかった点や優れていた点を具体的に挙げる。',
    '- 日本語で、300字程度で述べる。',
    '- 発言の本文だけを出力する(見出し、話者名、前置き、点数、IDは書かない)。',
  ].join('\n');
}

export function buildConcessionUserMessage(params: {
  role: DebaterRole;
  positions: Positions;
  history: HistoryItem[];
  notes: DebaterNotes;
  turn: number;
}): string {
  return [
    ...historyLines(params.history, params.positions, params.role),
    '',
    'あなたの作戦メモ:',
    JSON.stringify(params.notes, null, 2),
    '',
    `あなたの番です(ターン${params.turn}、${STAGE_LABELS.concession})。`,
    '負けを認める発言をしてください。',
  ].join('\n');
}

/**
 * 立論のターンでは、相手の主張を見ずに立論させるため、履歴と資料を渡さない。
 * 仕様: docs/03-engine/README.md「ターンと段階・話者の対応」
 */
export function visibleToDebater<T extends { turn: number }>(items: T[], turn: number): T[] {
  return isOpeningTurn(turn) ? [] : items;
}

/**
 * 履歴は話者と段階のラベル付き。モデル名と作戦メモは入れない。
 * 話者は立場の名前で書く(viewer を渡すと本人の視点。→ sideLabel)。
 */
function historyLines(history: HistoryItem[], positions: Positions, viewer?: DebaterRole): string[] {
  const lines =
    history.length === 0
      ? ['(まだありません)']
      : history.map((m) => `[ターン${m.turn} ${sideLabel(m.role, positions, viewer)}・${STAGE_LABELS[stageOfMessage(m)]}] ${m.content}`);
  return ['これまでの発言:', ...lines];
}

function opponentOf(role: DebaterRole): DebaterRole {
  return role === 'pro' ? 'con' : 'pro';
}

function stageOfMessage(m: HistoryItem): Stage | 'concession' {
  if (m.conceded) return 'concession';
  return isOpeningTurn(m.turn) ? 'opening' : 'exchange';
}

/** 審判の観点の文(仕様: docs/03-engine/prompts.md「審判」の観点の文) */
const VIEWPOINT_FOCUS: Record<JudgeViewpoint, string> = {
  logic: 'あなたは「論理の審判」。主張と理由の筋道に飛躍がないか、発言が自分の前の発言と矛盾していないかを、特に注意して読む。',
  evidence: 'あなたは「根拠の審判」。発言の引用が資料の内容と合っているか、根拠の出どころが確かかを、特に注意して読む。',
  exchange: 'あなたは「反論・応答の審判」。反論が相手の主張を崩しているか、受けた反論に正面から答えているかを、特に注意して読む。',
};

export function buildJudgeSystemPrompt(setting: DebateSetting, viewpoint?: JudgeViewpoint): string {
  const { pro, con } = setting.positions;
  const focus = viewpoint
    ? [`観点: ${VIEWPOINT_FOCUS[viewpoint]}4項目とも下の「評価の基準」どおりに採点し、理由は、この観点から見た評価を中心に書く。`]
    : [];
  return [
    'あなたはディベートの中立な審判です。',
    `テーマ:「${setting.theme}」`,
    `立場: 先に話す側(先攻)は「${pro}」、後に話す側(後攻)は「${con}」`,
    ...focus,
    '',
    '守ること:',
    '- 先に、下の「主張一覧」にある両者の主張を、1件ずつ0〜10の整数で採点する。点数は、その主張が議論の流れの中で相手の反論を受けてもどれだけ持ちこたえたか。相手の反論に根拠付きで答えられていれば高く、答えられていない反論(答える機会のない反論は除く)が残っていれば低くする。8点以上は持ちこたえた主張、3点以下は崩された主張とみなす。',
    '- 次に、下の「反論一覧」にある両者の反論を、1件ずつ0〜10の整数で採点する。点数は、その反論が議論の流れの中で相手の主張をどれだけ崩したか。相手が根拠付きで答えられなかった、またははぐらかしたら高く、相手が根拠付きで答えていれば低くする。8点以上は効いた反論、3点以下は効かなかった反論とみなす。',
    '- 主張一覧・反論一覧にあっても、発言で一度も述べていない項目は0点にする。',
    '- そのうえで、両者の発言を、下の「評価の基準」の4項目で、それぞれ0〜10の整数で採点する。logic は、主張と反論を通した自分の発言の一貫性で採点し、崩された主張の扱いは主張ごとの点数を踏まえる。response は主張ごとの点数を、rebuttal は反論ごとの点数を踏まえて採点する。evidence は、発言の引用([3] など)を、下の「資料一覧」の要約と出典のURLに照らし合わせて採点する。',
    '- 発言の内容だけで採点する。テーマについてどちらの立場が正しいかでは採点しない。どちらか一方の立場だけに立証の責任を負わせない。',
    `- 発言の順番(「${pro}」側が先に話す)や発言の長さで、有利・不利をつけない。`,
    '- 理由は、側ごとに日本語で200字程度で書く。',
    '- 主張一覧・反論一覧の項目は、「先攻C1」「後攻R1」のように、先攻・後攻を頭に付けたIDで示す(Cは主張、Rは反論)。理由の文で項目に触れるときも、このIDで書く。',
    '- 出力はJSONのみとする(前置き、説明、コードブロックの記号は書かない)。',
    '',
    ...EVALUATION_CRITERIA,
    '',
    `出力の形式(pro は「${pro}」側、con は「${con}」側の採点。claims には主張一覧の、rebuttals には反論一覧のすべての項目を書く):`,
    '{"claims":{"pro":[{"id":"先攻C1","score":0}],"con":[{"id":"後攻C1","score":0}]},"rebuttals":{"pro":[{"id":"先攻R1","score":0}],"con":[{"id":"後攻R1","score":0}]},"pro":{"scores":{"logic":0,"evidence":0,"rebuttal":0,"response":0},"reason":"…"},"con":{"scores":{"logic":0,"evidence":0,"rebuttal":0,"response":0},"reason":"…"}}',
  ].join('\n');
}

/** 審判に渡す項目のIDの頭に付ける側の名前(両者とも C1・R1 から番号を振るため。仕様: docs/03-engine/prompts.md「審判」) */
export const SIDE_PREFIX: Record<DebaterRole, string> = { pro: '先攻', con: '後攻' };

/** 審判に渡す主張(IDと内容だけ。討論者が付けた点数と状態は渡さない) */
export type JudgeClaim = Pick<Claim, 'id' | 'text'>;

/** 審判に渡す反論(IDと対象と内容だけ。討論者が付けた点数と状態は渡さない) */
export type JudgeRebuttal = Pick<Rebuttal, 'id' | 'target' | 'text'>;

/**
 * 審判は第三者のため、話者は「週休3日制側」のように書く。
 * 主張一覧・反論一覧は、各側の最終の項目を、討論者の点数と状態を除いて並べる(仕様: docs/03-engine/prompts.md「審判」)
 */
export function buildJudgeUserMessage(
  history: HistoryItem[],
  sources: Source[],
  positions: Positions,
  claims: Record<DebaterRole, JudgeClaim[]>,
  rebuttals: Record<DebaterRole, JudgeRebuttal[]>,
): string {
  const last = history.at(-1);
  const claimLines = (role: DebaterRole) => [
    `${sideLabel(role, positions)}:`,
    ...(claims[role].length ? claims[role].map((c) => `${SIDE_PREFIX[role]}${c.id}: ${c.text}`) : ['(なし)']),
  ];
  const rebuttalLines = (role: DebaterRole) => [
    `${sideLabel(role, positions)}:`,
    ...(rebuttals[role].length ? rebuttals[role].map((r) => `${SIDE_PREFIX[role]}${r.id}(対象: ${r.target}): ${r.text}`) : ['(なし)']),
  ];
  return [
    ...historyLines(history, positions),
    '',
    '資料一覧:',
    ...sourceLines(sources, positions),
    '',
    '主張一覧:',
    ...claimLines('pro'),
    ...claimLines('con'),
    '',
    '反論一覧:',
    ...rebuttalLines('pro'),
    ...rebuttalLines('con'),
    '',
    // 答える機会のない反論(最後の発言の反論)を、審判が取り違えないようにする
    ...(last ? [`議論の最後の発言は、ターン${last.turn}の${sideLabel(last.role, positions)}の発言です。`] : []),
    '議論は最大ターン数で終わりました。採点してください。',
  ].join('\n');
}
