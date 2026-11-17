// アカウントの一覧(管理者だけ。今は見るだけ)。仕様: docs/04-app/README.md「アカウントの一覧」
import { useEffect, useState } from 'react';
import type { AccountSummary } from '@agorawl/api/types';
import { useServices } from '../context';
import { accountTypeLabel, formatDate } from '../logic';

export function AccountList() {
  const { api } = useServices();
  const [items, setItems] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAccounts()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, [api]);

  return (
    <main className="page">
      <h1>アカウントの一覧</h1>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted">読み込み中…</p>}
      {items && (
        <div className="table-wrap">
          <table className="account-table">
            <thead>
              <tr>
                <th>メールアドレス</th>
                <th>種類</th>
                <th>状態</th>
                <th>作った日</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.email}>
                  <td className="account-email">{a.email}</td>
                  <td>{accountTypeLabel(a.type)}</td>
                  <td className={a.enabled ? undefined : 'account-locked'}>{a.enabled ? '使える' : '止めている'}</td>
                  <td>{formatDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
