// 画面の一部で処理が止まっても、画面全体を真っ白にせず、案内を出す。仕様: docs/04-app/README.md「画面の一覧」
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page">
        <p className="error">表示できませんでした: {this.state.error.message}</p>
        <a href="/">一覧へ戻る</a>
      </main>
    );
  }
}
