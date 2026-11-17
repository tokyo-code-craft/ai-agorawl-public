// 起動時に /config.json を読んで、つなぎ先を知る。仕様: docs/04-app/README.md「設定(config.json)」
export interface AppConfig {
  apiUrl: string;
  webSocketUrl: string;
  cognito: {
    /** OIDCの発行者(https://cognito-idp.<リージョン>.amazonaws.com/<ユーザープールID>) */
    authority: string;
    /** マネージドログイン画面のドメイン(https://….amazoncognito.com) */
    domain: string;
    clientId: string;
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config.json を読めません(${res.status})`);
  return (await res.json()) as AppConfig;
}
