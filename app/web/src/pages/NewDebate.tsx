// 議論の作成。仕様: docs/04-app/README.md「画面の一覧」「AIを選ぶ」「設定を写して作る」
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { validateDebateText } from '@agorawl/contract';
import type { GetDebateResponse, ListModelsResponse, ModelRole } from '@agorawl/api/types';
import { ApiError } from '../api';
import { ModelPicker, ModelSlot } from '../components/ModelPicker';
import { useServices } from '../context';
import { copySettings, DEFAULT_TURNS, TURN_OPTIONS } from '../logic';

export function NewDebate() {
  const { api } = useServices();
  const navigate = useNavigate();
  const [theme, setTheme] = useState('');
  const [pro, setPro] = useState('');
  const [con, setCon] = useState('');
  const [maxTurns, setMaxTurns] = useState(DEFAULT_TURNS);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // 選べるAIの一覧。読み込めなければ models を送らず、既定のAIで作る
  const [catalog, setCatalog] = useState<ListModelsResponse | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [chosen, setChosen] = useState<Record<ModelRole, string> | null>(null);
  const [picking, setPicking] = useState<ModelRole | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  // 設定を写して作るときの元の議論(/new?from=<議論ID>)
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from');
  const [source, setSource] = useState<GetDebateResponse['debate'] | null>(null);
  const [copied, setCopied] = useState<{ theme: string; notes: string[] } | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  useEffect(() => {
    if (!from) return;
    let cancelled = false;
    api.getDebate(from).then(
      (res) => !cancelled && setSource(res.debate),
      (err: Error) => !cancelled && setSourceError(`元の議論を読み込めませんでした: ${err.message}`),
    );
    return () => {
      cancelled = true;
    };
  }, [api, from]);

  useEffect(() => {
    let cancelled = false;
    api.listModels().then(
      (res) => {
        if (cancelled) return;
        setCatalog(res);
        setChosen(res.defaults);
      },
      () => !cancelled && setCatalogFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  // 元の議論とAIの一覧がそろったら、1回だけ設定を入れる(AIの一覧を読み込めなかったときは、AIは写さない)
  useEffect(() => {
    if (!source || copied || (!catalog && !catalogFailed)) return;
    const s = copySettings(source, catalog);
    setTheme(s.theme);
    setPro(s.pro);
    setCon(s.con);
    setMaxTurns(s.maxTurns);
    setChosen((c) => (c ? { ...c, ...s.models } : c));
    setCopied({ theme: s.theme, notes: s.notes });
  }, [source, copied, catalog, catalogFailed]);

  // 審判は、討論者とは別の一覧から選ぶ
  const optionsOf = (role: ModelRole) => (role === 'judge' ? (catalog?.judgeModels ?? []) : (catalog?.models ?? []));
  const modelOf = (role: ModelRole) => optionsOf(role).find((m) => m.modelId === chosen?.[role]) ?? null;

  const open = (role: ModelRole) => (button: HTMLButtonElement) => {
    opener.current = button;
    setPicking(role);
  };
  // 閉じたら、押した「AIを選ぶ」に戻る
  const close = useCallback(() => {
    setPicking(null);
    opener.current?.focus();
  }, []);
  const select = (modelId: string) => {
    if (picking) setChosen((c) => (c ? { ...c, [picking]: modelId } : c));
    close();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // テーマと立場の文字は、送る前にも確かめる(サーバーと同じ検証)
    const textErrors = validateDebateText({ theme, positions: { pro, con } });
    if (textErrors.length > 0) {
      setErrors(textErrors);
      return;
    }
    setSending(true);
    setErrors([]);
    try {
      const { debateId } = await api.createDebate({
        theme,
        positions: { pro, con },
        maxTurns,
        ...(chosen ? { models: chosen } : {}),
      });
      navigate(`/debates/${debateId}`);
    } catch (err) {
      // 検証の違反は、APIの errors をそのまま見せる
      setErrors(err instanceof ApiError && err.errors.length ? err.errors : [(err as Error).message]);
      setSending(false);
    }
  };

  return (
    <main className="page narrow">
      <h1>議論を始める</h1>
      {copied && (
        <div className="copied-note">
          <p>「{copied.theme}」の設定を写しました。変えてから「議論を始める」を押してください</p>
          {copied.notes.length > 0 && (
            <ul className="muted small">
              {copied.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {from && !copied && !sourceError && <p className="muted">元の議論の設定を読み込んでいます…</p>}
      {sourceError && <p className="error">{sourceError}</p>}
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          テーマ
          <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: 虎と熊は戦ったらどちらが強いか" maxLength={200} required />
        </label>
        <div className="form-row">
          <label>
            先攻の立場
            <input value={pro} onChange={(e) => setPro(e.target.value)} placeholder="例: 虎派" maxLength={50} required />
          </label>
          <label>
            後攻の立場
            <input value={con} onChange={(e) => setCon(e.target.value)} placeholder="例: 熊派" maxLength={50} required />
          </label>
        </div>
        <fieldset className="model-slots">
          <legend>討論者と審判のAI</legend>
          {(['pro', 'con'] as const).map((role) => (
            <ModelSlot key={role} role={role} model={modelOf(role)} onOpen={open(role)} disabled={!catalog} />
          ))}
          <ModelSlot role="judge" model={modelOf('judge')} onOpen={open('judge')} disabled={!catalog} />
          {!catalog && !catalogFailed && <p className="muted model-slots-note">AIの一覧を読み込んでいます…</p>}
          {catalogFailed && <p className="muted model-slots-note">AIの一覧を読み込めませんでした。既定のAIで始めます</p>}
        </fieldset>
        <label>
          ターン数(先攻と後攻の発言の合計)
          <select value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))}>
            {TURN_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}ターン(各側{n / 2}回)
              </option>
            ))}
          </select>
        </label>
        {errors.length > 0 && (
          <ul className="error">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <button className="button primary" type="submit" disabled={sending}>
          {sending ? '作成中…' : '議論を始める'}
        </button>
      </form>
      {picking && catalog && chosen && (
        <ModelPicker role={picking} models={optionsOf(picking)} selected={chosen[picking]} onSelect={select} onClose={close} />
      )}
    </main>
  );
}
