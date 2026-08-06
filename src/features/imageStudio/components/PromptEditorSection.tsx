import { SectionHeader, Textarea } from "../../../components/ui";

type PromptEditorSectionProps = {
  value: string;
  maxLength: number;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function PromptEditorSection({ value, maxLength, disabled, onChange }: PromptEditorSectionProps) {
  return (
    <div className="image-studio-section">
      <SectionHeader title="Prompt" subtitle="Describe exactly how you want this image edited." />
      <Textarea
        placeholder="e.g. Place this item on a marble kitchen countertop next to a cup of coffee, soft morning light, shallow depth of field..."
        maxLength={maxLength}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={10}
        help="Preservation rules for the item's shape, texture, and color are always applied automatically."
      />
    </div>
  );
}
