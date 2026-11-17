// SPAの入口。設定を読み、ログインを確かめてから画面を出す。仕様: docs/04-app/README.md「画面(SPA)」
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApi } from './api';
import { App } from './App';
import { createAuth, isCallback } from './auth';
import { Cover } from './components/Cover';
import { loadConfig } from './config';
import { ServicesContext } from './context';
import './styles.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const config = await loadConfig();
    const auth = createAuth(config);

    // ログイン画面から戻ってきたら、トークンを受け取り、ログインの前に開いていた画面へ戻る
    if (isCallback()) {
      const returnTo = await auth.handleCallback();
      window.history.replaceState(null, '', returnTo);
    }
    // ログインしていなければ、そのURLのまま表紙を出す。「ログイン」でCognitoのログイン画面へ移り、
    // ログインした後は、このURLの画面に戻る(自前のログイン画面は持たない)
    if (!(await auth.getUser())) {
      const returnTo = window.location.pathname + window.location.search;
      root.render(
        <StrictMode>
          <Cover onLogin={() => auth.signIn(returnTo)} />
        </StrictMode>,
      );
      return;
    }

    const api = createApi(config.apiUrl, auth);
    root.render(
      <StrictMode>
        <ServicesContext.Provider value={{ config, auth, api }}>
          <App />
        </ServicesContext.Provider>
      </StrictMode>,
    );
  } catch (err) {
    root.render(<main className="page error">画面を開けませんでした: {(err as Error).message}</main>);
  }
}

void start();
