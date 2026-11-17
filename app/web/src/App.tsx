// 画面の枠(見出しとサインアウト)と、画面の切り替え。仕様: docs/04-app/README.md「画面の一覧」
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useServices } from './context';
import { isAdminProfile } from './logic';
import { AccountList } from './pages/AccountList';
import { DebateList } from './pages/DebateList';
import { DebateView } from './pages/DebateView';
import { NewDebate } from './pages/NewDebate';

export function App() {
  const { auth } = useServices();
  const [email, setEmail] = useState<string | null>(null);
  // 管理者には「アカウント」を出す(docs/04-app/README.md「アカウントの一覧」)
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    void auth.getUser().then((u) => {
      setEmail((u?.profile.email as string | undefined) ?? null);
      setAdmin(isAdminProfile(u?.profile));
    });
  }, [auth]);

  return (
    <BrowserRouter>
      {/* 背景の模様(docs/04-app/README.md「背景」) */}
      <div className="backdrop" aria-hidden="true" />
      <header className="app-header">
        <Link to="/" className="brand">
          AI言い合いバトル <span>Agorawl</span>
        </Link>
        <div className="account">
          {admin && (
            <Link to="/accounts" className="button small">
              アカウント
            </Link>
          )}
          {email && <span className="email">{email}</span>}
          <button className="button small" onClick={() => void auth.signOut()}>
            サインアウト
          </button>
        </div>
      </header>
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<DebateList />} />
        <Route path="/new" element={<NewDebate />} />
        <Route path="/debates/:debateId" element={<DebateView />} />
        <Route path="/accounts" element={<AccountList />} />
        <Route path="*" element={<main className="page">ページが見つかりません。<Link to="/">一覧へ</Link></main>} />
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}