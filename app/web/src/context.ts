// 画面全体で使う設定・ログイン・APIの呼び出し
import { createContext, useContext } from 'react';
import type { Api } from './api';
import type { Auth } from './auth';
import type { AppConfig } from './config';

export interface AppServices {
  config: AppConfig;
  auth: Auth;
  api: Api;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext がありません');
  return s;
}
