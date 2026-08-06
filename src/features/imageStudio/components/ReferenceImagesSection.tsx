import { useRef, useState } from "react";
import { ImagePlus, ImageUp } from "lucide-react";
import { SectionHeader } from "../../../components/ui";
import type { ImageStudioLimits, ImageStudioReferenceImage } from "../../../data/types/imageStudio";
import { validateReferenceImage } from "../validation";

type ReferenceImagesSectionProps = {
  mainImage: ImageStudioReferenceImage | null;
  supportingImages: ImageStudioReferenceImage[];
  limits: ImageStudioLimits;
  disabled?: boolean;
  onMainImageChange: (image: ImageStudioReferenceImage | null) => void;
  onSupportingImagesChange: (images: ImageStudioReferenceImage[]) => void;
};

function toReferenceImage(file: File): ImageStudioReferenceImage {
  return { file, previewUrl: URL.createObjectURL(file) };
}

export function ReferenceImagesSection({
  mainImage,
  supportingImages,
  limits,
  disabled,
  onMainImageChange,
  onSupportingImagesChange,
}: ReferenceImagesSectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [isMainDragActive, setIsMainDragActive] = useState(false);
  const [isSupportingDragActive, setIsSupportingDragActive] = useState(false);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const supportingInputRef = useRef<HTMLInputElement>(null);

  const handleMainFile = (file: File | undefined) => {
    if (!file) {
      return;
    }

    const existing = supportingImages.map((image) => image.file);
    const result = validateReferenceImage(file, existing, limits);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setError(null);

    if (mainImage) {
      URL.revokeObjectURL(mainImage.previewUrl);
    }

    onMainImageChange(toReferenceImage(file));
  };

  const handleAddSupporting = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const remainingSlots = limits.maxSupportingImages - supportingImages.length;

    if (remainingSlots <= 0) {
      return;
    }

    const incoming = Array.from(files).slice(0, remainingSlots);
    const next = [...supportingImages];
    let validationMessage: string | null = null;

    for (const file of incoming) {
      const existing = [...(mainImage ? [mainImage.file] : []), ...next.map((image) => image.file)];
      const result = validateReferenceImage(file, existing, limits);

      if (!result.ok) {
        validationMessage = result.message;
        break;
      }

      next.push(toReferenceImage(file));
    }

    setError(validationMessage);
    onSupportingImagesChange(next);
  };

  const removeSupporting = (index: number) => {
    const target = supportingImages[index];

    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }

    onSupportingImagesChange(supportingImages.filter((_, i) => i !== index));
  };

  const removeMain = () => {
    if (mainImage) {
      URL.revokeObjectURL(mainImage.previewUrl);
    }

    onMainImageChange(null);
  };

  const canAddSupporting = supportingImages.length < limits.maxSupportingImages;

  return (
    <div className="image-studio-section">
      <SectionHeader
        title="Reference images"
        subtitle="One required main image, plus up to three supporting views of the same item."
      />

      {error ? <p className="status-card status-card--error">{error}</p> : null}

      <div
        className={[
          "image-studio-dropzone",
          isMainDragActive ? "image-studio-dropzone--active" : "",
        ].filter(Boolean).join(" ")}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setIsMainDragActive(true);
          }
        }}
        onDragLeave={() => setIsMainDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsMainDragActive(false);
          if (!disabled) {
            handleMainFile(event.dataTransfer.files?.[0]);
          }
        }}
      >
        {mainImage ? (
          <div className="image-studio-thumb">
            <img className="image-studio-thumb__image" src={mainImage.previewUrl} alt="Main reference" />
            <div className="image-studio-thumb__actions">
              <button type="button" disabled={disabled} onClick={() => mainInputRef.current?.click()}>
                Replace
              </button>
              <button type="button" disabled={disabled} onClick={removeMain}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="image-studio-dropzone__prompt"
            disabled={disabled}
            onClick={() => mainInputRef.current?.click()}
          >
            <ImageUp size={28} className="image-studio-dropzone__icon" aria-hidden="true" />
            <span>Drag &amp; drop the main image here, or click to choose a file</span>
            <small>Required · JPG, PNG, or WebP</small>
          </button>
        )}
        <input
          ref={mainInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            handleMainFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="image-studio-supporting">
        <span className="field__label">
          Supporting images ({supportingImages.length}/{limits.maxSupportingImages})
        </span>
        <div className="image-studio-supporting__grid">
          {supportingImages.map((image, index) => (
            <div className="image-studio-thumb image-studio-thumb--sm" key={image.previewUrl}>
              <img
                className="image-studio-thumb__image"
                src={image.previewUrl}
                alt={`Supporting reference ${index + 1}`}
              />
              <div className="image-studio-thumb__actions">
                <button type="button" disabled={disabled} onClick={() => removeSupporting(index)}>
                  Remove
                </button>
              </div>
            </div>
          ))}

          {canAddSupporting ? (
            <div
              className={[
                "image-studio-dropzone",
                "image-studio-dropzone--sm",
                isSupportingDragActive ? "image-studio-dropzone--active" : "",
              ].filter(Boolean).join(" ")}
              onDragOver={(event) => {
                event.preventDefault();
                if (!disabled) {
                  setIsSupportingDragActive(true);
                }
              }}
              onDragLeave={() => setIsSupportingDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsSupportingDragActive(false);
                if (!disabled) {
                  handleAddSupporting(event.dataTransfer.files);
                }
              }}
            >
              <button
                type="button"
                className="image-studio-dropzone__prompt image-studio-dropzone__prompt--sm"
                disabled={disabled}
                onClick={() => supportingInputRef.current?.click()}
              >
                <ImagePlus size={20} className="image-studio-dropzone__icon" aria-hidden="true" />
                <span>Add</span>
              </button>
              <input
                ref={supportingInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  handleAddSupporting(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <small className="field__help">
        Reference images are sent to fal.ai for processing and are not stored by Shop Intelligence.
      </small>
    </div>
  );
}
