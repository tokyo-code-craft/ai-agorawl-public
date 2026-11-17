// 討論者のアイコン(発言の横、議論の画面の見出し、一覧のカード)。仕様: docs/04-app/README.md「発言のアイコン」
import { characterIcon, modelStars } from '../logic';

/**
 * 立ち絵の頭から胸のあたりの丸いアイコン。立ち絵のないモデルは空の丸。色は role(先攻・後攻)で分ける。
 * 丸の上端に、モデルの性能を表す金色の星を重ねる(星のないモデルには出さない)
 */
export function Avatar({ modelId, role }: { modelId: string; role: string }) {
  const icon = characterIcon(modelId);
  const stars = modelStars(modelId);
  const title = [icon?.name, stars > 0 ? `星${stars}` : ''].filter(Boolean).join('・') || undefined;
  return (
    <div className="avatar-wrap" title={title}>
      <div className={`avatar ${role}`}>{icon && <img src={icon.src} alt={icon.name} width={56} height={56} loading="lazy" />}</div>
      {stars > 0 && (
        <span className="stars" role="img" aria-label={`星${stars}つ`}>
          {'★'.repeat(stars)}
        </span>
      )}
    </div>
  );
}
