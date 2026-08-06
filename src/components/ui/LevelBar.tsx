import "./level-bar.css";

type LevelBarProps = {
  level?: number;
  xp?: number;
  xpMax?: number;
  label?: string;
};

function clampRatio(xp: number, xpMax: number): number {
  if (!Number.isFinite(xp) || !Number.isFinite(xpMax) || xpMax <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, xp / xpMax));
}

export function LevelBar({
  level = 7,
  xp = 420,
  xpMax = 1000,
  label = "Shop level",
}: LevelBarProps) {
  const fillPercent = clampRatio(xp, xpMax) * 100;

  return (
    <div
      className="level-bar"
      role="group"
      aria-label={`${label} ${level}, ${xp} of ${xpMax} XP`}
    >
      <div className="level-bar__meta">
        <span className="level-bar__label">
          {label} {level}
        </span>
        <span className="level-bar__stats">
          {xp} / {xpMax} XP
        </span>
      </div>
      <div className="level-bar__track" aria-hidden="true">
        <div className="level-bar__fill" style={{ width: `${fillPercent}%` }} />
      </div>
    </div>
  );
}
