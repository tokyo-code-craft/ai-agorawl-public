// 議論の進行(Step Functionsの定義、JSONPath)。仕様: docs/03-engine/README.md「Step Functionsの状態遷移」
// ${DebatesTable}、${GenerateTurnFunction}、${JudgeFunction} は definitionSubstitutions で置き換える。

const RETRYABLE_ERRORS = [
  'TransientError',
  'OutputFormatError',
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
  'Lambda.TooManyRequestsException',
];

function updateDebate(set: Record<string, Record<string, string>>) {
  const names = Object.keys(set);
  return {
    TableName: '${DebatesTable}',
    Key: { debateId: { 'S.$': '$.debateId' } },
    UpdateExpression: `SET ${names.map((n) => `#${n} = :${n}`).join(', ')}`,
    ConditionExpression: 'attribute_exists(debateId)',
    ExpressionAttributeNames: Object.fromEntries(names.map((n) => [`#${n}`, n])),
    ExpressionAttributeValues: Object.fromEntries(names.map((n) => [`:${n}`, set[n]])),
  };
}

const setStatus = (status: string) => updateDebate({ status: { S: status } });

const catchToFailed = [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' }];

export function buildDebateDefinition() {
  return {
    Comment: 'Agorawl: 1ターンずつ発言を生成し、最大ターン・投了・引き分けの発言で終了する',
    StartAt: 'Initialize',
    States: {
      Initialize: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: setStatus('running'),
        ResultPath: null,
        Catch: catchToFailed,
        Next: 'PrepareFirstTurn',
      },
      PrepareFirstTurn: {
        Type: 'Pass',
        Parameters: { 'debateId.$': '$.debateId', turn: 1 },
        Next: 'GenerateTurn',
      },
      GenerateTurn: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: '${GenerateTurnFunction}',
          Payload: { 'debateId.$': '$.debateId', 'turn.$': '$.turn' },
        },
        ResultSelector: {
          'finished.$': '$.Payload.finished',
          'endReason.$': '$.Payload.endReason',
          'concededBy.$': '$.Payload.concededBy',
        },
        ResultPath: '$.result',
        Retry: [{ ErrorEquals: RETRYABLE_ERRORS, IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }],
        Catch: catchToFailed,
        Next: 'IsFinished',
      },
      IsFinished: {
        Type: 'Choice',
        Choices: [
          { Variable: '$.result.finished', BooleanEquals: true, Next: 'IsConceded' },
        ],
        Default: 'NextTurn',
      },
      NextTurn: {
        Type: 'Pass',
        Parameters: { 'debateId.$': '$.debateId', 'turn.$': 'States.MathAdd($.turn, 1)' },
        Next: 'GenerateTurn',
      },
      IsConceded: {
        Type: 'Choice',
        Choices: [
          { Variable: '$.result.endReason', StringEquals: 'conceded', Next: 'MarkConceded' },
          // 最大ターン数で終わった議論だけ審判が判定する
          { Variable: '$.result.endReason', StringEquals: 'maxTurns', Next: 'Judge' },
        ],
        Default: 'MarkDone',
      },
      Judge: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: '${JudgeFunction}',
          Payload: { 'debateId.$': '$.debateId' },
        },
        ResultPath: null,
        Retry: [{ ErrorEquals: RETRYABLE_ERRORS, IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }],
        Catch: catchToFailed,
        Next: 'MarkDone',
      },
      MarkDone: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: updateDebate({ status: { S: 'done' }, endReason: { 'S.$': '$.result.endReason' } }),
        ResultPath: null,
        Catch: catchToFailed,
        End: true,
      },
      MarkConceded: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: updateDebate({
          status: { S: 'done' },
          endReason: { S: 'conceded' },
          concededBy: { 'S.$': '$.result.concededBy' },
        }),
        ResultPath: null,
        Catch: catchToFailed,
        End: true,
      },
      MarkFailed: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: setStatus('failed'),
        ResultPath: null,
        // 議論IDが存在しない場合などは更新できないが、そのまま失敗で終える
        Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: null, Next: 'Failed' }],
        Next: 'Failed',
      },
      Failed: {
        Type: 'Fail',
        Error: 'DebateFailed',
        Cause: '議論の進行に失敗しました。実行履歴の error を確認してください',
      },
    },
  };
}
