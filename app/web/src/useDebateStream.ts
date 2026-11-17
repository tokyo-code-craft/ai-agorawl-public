// 議論の画面の、発言と議論の状態の受け取り。「接続 → 購読 → 履歴取得」の順に行い、切断されたらつなぎ直す。
// 仕様: docs/04-app/README.md「時系列」「WebSocket API」「議論の画面」
import { useEffect, useState } from 'react';
import type { Debate, Message } from '@agorawl/contract';
import type { Api } from './api';
import type { Auth } from './auth';
import { mergeMessages, reconnectDelay } from './logic';

type DebateView = Omit<Debate, 'listKey'>;

export interface DebateStream {
  debate: DebateView | null;
  messages: Message[];
  /** WebSocketにつながり、購読できているか */
  live: boolean;
  error: string | null;
}

const PING_INTERVAL_MS = 5 * 60 * 1000;

export function useDebateStream(debateId: string, deps: { api: Api; auth: Auth; webSocketUrl: string }): DebateStream {
  const [debate, setDebate] = useState<DebateView | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    // 議論が終わったら、つなぎ直さない
    let finished = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    setDebate(null);
    setMessages([]);
    setError(null);

    // 履歴を取り直す(購読の後と、議論が終わったとき)。作戦メモは議論の終了後だけ返る
    const loadHistory = async () => {
      try {
        const res = await deps.api.getDebate(debateId);
        if (stopped) return;
        setDebate(res.debate);
        if (res.debate.status !== 'running') finished = true;
        setMessages((cur) => mergeMessages(cur, res.messages));
        return res.debate;
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      }
    };

    const connect = async () => {
      let token: string;
      try {
        token = await deps.auth.accessToken();
      } catch {
        return; // ログイン画面へ移る
      }
      if (stopped) return;
      ws = new WebSocket(`${deps.webSocketUrl}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        attempt = 0;
        ws?.send(JSON.stringify({ action: 'subscribe', debateId }));
        pingTimer = setInterval(() => ws?.send(JSON.stringify({ action: 'ping' })), PING_INTERVAL_MS);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as
          | { type: 'subscribed' }
          | { type: 'message'; message: Message }
          | { type: 'debate'; debate: DebateView }
          | { type: 'error'; message: string };
        if (m.type === 'subscribed') {
          setLive(true);
          // 購読より前に保存された発言は、履歴取得で補う
          void loadHistory().then((d) => {
            if (d && d.status !== 'running') ws?.close();
          });
        } else if (m.type === 'message') {
          setMessages((cur) => mergeMessages(cur, [m.message]));
        } else if (m.type === 'debate') {
          setDebate(m.debate);
          if (m.debate.status !== 'running') finished = true;
          // 終わったら、作戦メモを含む全発言と判定を取り直し、購読をやめる
          if (m.debate.status !== 'running') void loadHistory().then(() => ws?.close());
        } else if (m.type === 'error') {
          setError(m.message);
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        setLive(false);
        ws = null;
        if (stopped || finished) return;
        retryTimer = setTimeout(() => void connect(), reconnectDelay(attempt++));
      };
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
    };
  }, [debateId, deps.api, deps.auth, deps.webSocketUrl]);

  return { debate, messages, live, error };
}
