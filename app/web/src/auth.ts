// ログイン(Cognitoのマネージドログイン画面、認可コードと PKCE)。仕様: docs/04-app/README.md「認証」
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { AppConfig } from './config';

export interface Auth {
  /** ログインしていれば、ユーザー(期限切れなら null) */
  getUser(): Promise<User | null>;
  /** アクセストークン(HTTP APIとWebSocketで使う)。なければログイン画面へ移る */
  accessToken(): Promise<string>;
  /** Cognitoのログイン画面へ移る。戻ったら returnTo の画面を開く */
  signIn(returnTo: string): Promise<void>;
  /** ログイン画面から戻ったときの処理。戻る先の画面のパスを返す */
  handleCallback(): Promise<string>;
  signOut(): Promise<void>;
}

export function createAuth(config: AppConfig): Auth {
  const origin = window.location.origin;
  const manager = new UserManager({
    authority: config.cognito.authority,
    client_id: config.cognito.clientId,
    redirect_uri: `${origin}/`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: 'code',
    scope: 'openid email profile',
    // トークンはタブを閉じても残るようにする。期限が近づいたら、リフレッシュトークンで更新する
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });

  const signIn = async (returnTo: string) => {
    await manager.signinRedirect({ state: { returnTo } });
  };

  return {
    async getUser() {
      const user = await manager.getUser();
      return user && !user.expired ? user : null;
    },
    async accessToken() {
      let user = await manager.getUser();
      if (user?.expired) user = await manager.signinSilent().catch(() => null);
      if (!user || user.expired) {
        await signIn(window.location.pathname + window.location.search);
        throw new Error('ログインが必要です');
      }
      return user.access_token;
    },
    signIn,
    async handleCallback() {
      const user = await manager.signinRedirectCallback();
      const state = user.state as { returnTo?: string } | undefined;
      return state?.returnTo ?? '/';
    },
    async signOut() {
      await manager.removeUser();
      // Cognitoはログアウトの終わりのURLをOIDCの情報で公開しないため、ログアウトのURLへ直接移る
      const url = new URL(`${config.cognito.domain}/logout`);
      url.searchParams.set('client_id', config.cognito.clientId);
      url.searchParams.set('logout_uri', `${origin}/`);
      window.location.assign(url.toString());
    },
  };
}

/** ログイン画面から戻ってきたURLか(認可コードと state を持つ) */
export function isCallback(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has('code') && q.has('state');
}
