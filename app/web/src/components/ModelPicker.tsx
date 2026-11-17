// 討論者と審判のAIを選ぶ。作成の画面の欄と、カットインのような覆いの上に出す選ぶ画面。仕様: docs/04-app/README.md「AIを選ぶ」
import { useEffect, useRef } from 'react';
import type { ModelOption, ModelRole } from '@agorawl/api/types';
import { characterPose, groupByCharacter, JUDGE_CHARACTER, modelStars, MODEL_ROLE_LABELS } from '../logic';
import { JUDGE_FIGURE } from '../verdict';
import { ViewpointMark } from './ViewpointMark';
import { JUDGE_VIEWPOINTS } from '@agorawl/contract';

function Stars({ modelId }: { modelId: string }) {
  const n = modelStars(modelId);
  if (n === 0) return null;
  return (
    <span className="picker-stars" role="img" aria-label={`星${n}つ`}>
      {'★'.repeat(n)}
    </span>
  );
}

/** 立ち姿。審判はモデルによらず審判の絵。絵のないモデルは場所だけ空ける */
function Figure({ role, modelId, className }: { role: ModelRole; modelId: string; className: string }) {
  const src = role === 'judge' ? JUDGE_FIGURE : characterPose(modelId, 'front')?.src;
  return <div className={className}>{src && <img src={src} alt="" />}</div>;
}

/** 作成の画面の、1つの役割の欄。選んでいるAIの立ち姿・名前・星と「AIを選ぶ」ボタン */
export function ModelSlot({
  role,
  model,
  onOpen,
  disabled,
}: {
  role: ModelRole;
  model: ModelOption | null;
  onOpen: (opener: HTMLButtonElement) => void;
  disabled: boolean;
}) {
  return (
    <div className={`model-slot ${role}`}>
      <span className="model-slot-role">{MODEL_ROLE_LABELS[role]}</span>
      {model ? (
        <>
          {/* 審判は、3人の観点の印を立ち姿の上に並べる(飾り。読み上げない) */}
          {role === 'judge' && (
            <span className="model-slot-marks" aria-hidden="true">
              {JUDGE_VIEWPOINTS.map((vp) => (
                <ViewpointMark key={vp} viewpoint={vp} />
              ))}
            </span>
          )}
          <Figure role={role} modelId={model.modelId} className="model-slot-figure" />
          <span className="model-slot-name">
            {model.name}
            <Stars modelId={model.modelId} />
          </span>
        </>
      ) : (
        <span className="model-slot-name muted">既定のAI</span>
      )}
      {role === 'judge' && <span className="model-slot-note">3人(論理、根拠、反論・応答)で判定</span>}
      <button
        type="button"
        className="button small"
        onClick={(e) => onOpen(e.currentTarget)}
        disabled={disabled}
        aria-label={`${MODEL_ROLE_LABELS[role]}のAIを選ぶ`}
      >
        AIを選ぶ
      </button>
    </div>
  );
}

/** 選ぶ画面。カードを押して選ぶか、閉じる・覆いを押す・Escキーで選ばずに閉じる */
export function ModelPicker({
  role,
  models,
  selected,
  onSelect,
  onClose,
}: {
  role: ModelRole;
  models: ModelOption[];
  selected: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}) {
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // 後ろの画面がスクロールしないようにする
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // 審判は、モデルによらず1つのキャラクター(審判)にまとめる
  const groups = role === 'judge' ? [{ character: JUDGE_CHARACTER, models }] : groupByCharacter(models);
  const titleId = `picker-title-${role}`;
  return (
    <div className={`picker ${role}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={onClose}>
      <div className="picker-head" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className={`picker-title ${role}`}>
          {MODEL_ROLE_LABELS[role]}のAIを選ぶ
        </h2>
        <button type="button" className="button small picker-close" onClick={onClose}>
          閉じる
        </button>
      </div>
      {/* グループ(キャラクター)ごとに、カードの列と、そのすぐ下にキャラクターの説明を出す */}
      {groups.map(({ character, models: items }) => (
        <div key={character?.id ?? 'others'} className="picker-group">
          <ul className="picker-cards">
            {items.map((m) => {
              const i = models.indexOf(m);
              const current = m.modelId === selected;
              return (
                <li
                  key={m.modelId}
                  className={`picker-card ${role}${current ? ' current' : ''}`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {current && <span className="picker-current">選択中</span>}
                  <Figure role={role} modelId={m.modelId} className="picker-figure" />
                  <h3 className="picker-name">
                    {m.name}
                    <Stars modelId={m.modelId} />
                  </h3>
                  <p className="picker-feature">{m.feature}</p>
                  <button
                    ref={i === 0 ? firstButton : undefined}
                    type="button"
                    className="button primary"
                    onClick={() => onSelect(m.modelId)}
                  >
                    このAIにする
                  </button>
                </li>
              );
            })}
          </ul>
          {character && (
            <section className="picker-profile" onClick={(e) => e.stopPropagation()}>
              <h3>{character.name}のキャラクター</h3>
              <p>
                <strong>{character.profile.motif}</strong>({character.profile.personality.join('・')})
              </p>
              <p>「{character.profile.reason}」</p>
            </section>
          )}
        </div>
      ))}
    </div>
  );
}
