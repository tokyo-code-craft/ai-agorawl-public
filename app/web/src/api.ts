// HTTP APIの呼び出し。仕様: docs/04-app/README.md「HTTP API」
import type {
  CreateDebateRequest,
  CreateDebateResponse,
  ErrorResponse,
  GetDebateResponse,
  ListAccountsResponse,
  ListDebatesResponse,
  ListModelsResponse,
} from '@agorawl/api/types';
import type { Auth } from './auth';

/** APIのエラー。検証の違反(errors)をそのまま画面に出す */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Api {
  listDebates(cursor?: string): Promise<ListDebatesResponse>;
  getDebate(debateId: string): Promise<GetDebateResponse>;
  createDebate(req: CreateDebateRequest): Promise<CreateDebateResponse>;
  listModels(): Promise<ListModelsResponse>;
  /** 議論を消す(管理者だけ) */
  deleteDebate(debateId: string): Promise<void>;
  /** 管理者だけ。一般のユーザーに隠すか(docs/04-app/README.md「議論を隠す」) */
  setHidden(debateId: string, hidden: boolean): Promise<void>;
  /** 管理者だけ。アカウントの一覧(docs/04-app/README.md「アカウントの一覧」) */
  listAccounts(): Promise<ListAccountsResponse>;
}

export function createApi(apiUrl: string, auth: Auth): Api {
  const call = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> => {
    const token = await auth.accessToken();
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) {
      const e = json as Partial<ErrorResponse>;
      throw new ApiError(res.status, e.message ?? `エラーが起きました(${res.status})`, e.errors ?? []);
    }
    return json as T;
  };
  return {
    listDebates: (cursor) => call('GET', `/debates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    getDebate: (debateId) => call('GET', `/debates/${encodeURIComponent(debateId)}`),
    createDebate: (req) => call('POST', '/debates', req),
    listModels: () => call('GET', '/models'),
    deleteDebate: async (debateId) => {
      await call('DELETE', `/debates/${encodeURIComponent(debateId)}`);
    },
    setHidden: async (debateId, hidden) => {
      await call('PATCH', `/debates/${encodeURIComponent(debateId)}`, { hidden });
    },
    listAccounts: () => call('GET', '/accounts'),
  };
}
