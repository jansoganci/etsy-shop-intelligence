import { SectionHeader } from "../../../components/ui";
import type { ImageStudioScene } from "../../../data/types/imageStudio";
import { SceneCard } from "./SceneCard";

type ScenePickerProps = {
  scenes: ImageStudioScene[];
  activeSceneIds: ReadonlySet<string>;
  disabled?: boolean;
  onToggle: (scene: ImageStudioScene) => void;
};

export function ScenePicker({ scenes, activeSceneIds, disabled, onToggle }: ScenePickerProps) {
  return (
    <div className="image-studio-section">
      <SectionHeader
        title="Scene ideas"
        subtitle="Optional. Click a scene to add its description to your prompt — click again to remove it."
      />

      <div className="image-studio-scene-grid">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            label={scene.label}
            description={scene.description}
            isActive={activeSceneIds.has(scene.id)}
            disabled={disabled}
            onSelect={() => onToggle(scene)}
          />
        ))}
      </div>
    </div>
  );
}
