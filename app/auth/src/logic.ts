// ログインのロックの処理のうち、AWSに触れない部分。仕様: docs/04-app/README.md「ログインのロック」

/** ロックの対象のグループ(管理者)。ほかのアカウントは止めない */
export const LOCK_GROUP = 'admin';

/** 続けて間違えてよい回数。これを超えてログインしようとしたら止める */
export const MAX_FAILURES = 3;

/** 断ったときにログイン画面に出す文言 */
export const LOCKED_MESSAGE = 'ログインできません。管理者に連絡してください';

/**
 * ログインしようとした回数(今回の分を足した後)から、どうするかを決める。
 * 成功すると事後認証のLambdaが0に戻すので、足す前の値が続けて間違えた回数になる
 */
export function decide(attemptsAfter: number): { lock: boolean; notify: boolean } {
  const lock = attemptsAfter > MAX_FAILURES;
  // 通知は、止めた最初の1回だけ
  return { lock, notify: attemptsAfter === MAX_FAILURES + 1 };
}

/** 止めたときの、管理者へのメールの件名と本文 */
export function buildLockNotice(email: string, now: string): { subject: string; message: string } {
  return {
    subject: `[Agorawl] ログインを止めました: ${email}`.slice(0, 100),
    message: [
      `パスワードを${MAX_FAILURES}回続けて間違えたため、次のユーザーのログインを止めました。`,
      '',
      `ユーザー: ${email}`,
      `止めた時刻: ${now}`,
      '',
      '解除するには、リポジトリのルートで次を実行してください。',
      `npm run unlock-user -- ${email}`,
      '',
      '身に覚えがなければ、誰かがログインを試みているおそれがあります。',
    ].join('\n'),
  };
}
