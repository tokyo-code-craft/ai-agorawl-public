// リアルタイム配信のうち、AWSに触れない部分(本文の読み取り、配信するメッセージの組み立て、ttl)。
// 仕様: docs/04-app/README.md「WebSocket API」、docs/02-data-model/README.md「Connectionsの ttl」
import type { Debate, Message } from '@agorawl/contract';

/** サーバーからブラウザへのメッセージ */
export type ServerMessage =
  | { type: 'subscribed'; debateId: string }
  | { type: 'message'; message: Message }
  | { type: 'debate'; debate: Omit<Debate, 'listKey'> }
  | { type: 'error'; message: string };

/** ブラウザからのメッセージ(ルートごとに読む) */
export type ClientAction = { action: 'subscribe'; debateId: string } | { action: 'ping' };

/** 接続の期限: 接続時刻 + 2時間(WebSocket接続の最大寿命) */
export const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

export function connectionTtl(nowMs: number): number {
  return Math.floor(nowMs / 1000) + CONNECTION_TTL_SECONDS;
}

/** 本文の誤り(error を返す) */
export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

/** subscribe の本文を読む。議論IDがなければ ClientError */
export function parseSubscribe(body: string | undefined): string {
  let raw: unknown;
  try {
    raw = JSON.parse(body ?? '');
  } catch {
    throw new ClientError('本文をJSONとして読めません');
  }
  const debateId = (raw as { debateId?: unknown } | null)?.debateId;
  if (typeof debateId !== 'string' || debateId.trim() === '') {
    throw new ClientError('debateId を指定してください');
  }
  return debateId.trim();
}

/**
 * Streamsの新しい項目(NEW_IMAGE を戻したもの)から、配信先の議論IDと送るメッセージを作る。
 * Messagesの項目(turn を持つ)は発言として、作戦メモを除いて送る。Debatesの項目は議論として、listKey を除いて送る
 */
export function toBroadcast(item: Record<string, unknown>): { debateId: string; payload: ServerMessage } {
  if (typeof item.debateId !== 'string') throw new Error('項目に debateId がありません');
  if (typeof item.turn === 'number') {
    const { notes: _notes, ...message } = item as unknown as Message;
    return { debateId: item.debateId, payload: { type: 'message', message } };
  }
  const { listKey: _listKey, ...debate } = item as unknown as Debate;
  return { debateId: item.debateId, payload: { type: 'debate', debate } };
}

/** 管理者のグループ(Cognito)。docs/04-app/README.md「認証」の「管理者」 */
export const ADMIN_GROUP = 'admin';

/** アクセストークンの cognito:groups から、オーソライザーの context に入れる値(文字列しか入れられない)を作る */
export function adminContext(groups: unknown): 'true' | 'false' {
  return Array.isArray(groups) && groups.map(String).includes(ADMIN_GROUP) ? 'true' : 'false';
}
