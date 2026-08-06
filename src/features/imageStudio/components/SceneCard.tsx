import { Check } from "lucide-react";

type SceneCardProps = {
  label: string;
  description: string;
  isActive: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function SceneCard({ label, description, isActive, disabled, onSelect }: SceneCardProps) {
  const className = [
    "image-studio-scene-card",
    isActive ? "image-studio-scene-card--active" : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-pressed={isActive}
      onClick={onSelect}
    >
      <span className="image-studio-scene-card__label">
        {label}
        {isActive ? <Check size={16} className="image-studio-scene-card__check" aria-hidden="true" /> : null}
      </span>
      <span className="image-studio-scene-card__description">{description}</span>
    </button>
  );
}
