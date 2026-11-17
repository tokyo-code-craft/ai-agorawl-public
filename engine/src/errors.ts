// Step Functionsが再試行するエラー。エラー名 `TransientError` で判定される(docs/03-engine/README.md)
export class TransientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientError';
  }
}

// 出力が決められた形式でない、または応答が最大トークン数で切れた。Step Functionsが再試行し、生成し直す
export class OutputFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputFormatError';
  }
}

// 一時的な失敗とみなすAWS SDKのエラー名
const TRANSIENT_ERROR_NAMES = new Set([
  // Bedrock
  'ThrottlingException',
  'ServiceUnavailableException',
  'InternalServerException',
  'ModelNotReadyException',
  'ModelTimeoutException',
  // DynamoDB
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'InternalServerError',
]);

/** 一時的なエラーなら TransientError に包み直す。それ以外はそのまま返す */
export function classifyError(err: unknown): unknown {
  if (err instanceof Error && TRANSIENT_ERROR_NAMES.has(err.name)) {
    return new TransientError(`${err.name}: ${err.message}`, { cause: err });
  }
  return err;
}
