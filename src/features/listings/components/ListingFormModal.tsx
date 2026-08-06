import { useEffect, useRef, useState } from "react";
import "../listings.css";
import { X } from "lucide-react";
import { saveListing } from "../../../data/api/listings.api";
import type { ListingRecord } from "../../../data/types/listings";
import { Button, Input, Select, Textarea } from "../../../components/ui";

type ListingFormModalProps = {
  isOpen: boolean;
  listing: ListingRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitTags(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

type ListingFormState = {
  listingId: string;
  url: string;
  title: string;
  tagsText: string;
  description: string;
  altTextsText: string;
  price: string;
  status: "active" | "inactive";
  effectiveAt: string;
  changeNote: string;
};

function emptyFormState(listing: ListingRecord | null): ListingFormState {
  return {
    listingId: listing?.listingId ?? "",
    url: listing?.url ?? "",
    title: listing?.title ?? "",
    tagsText: listing?.tags.join(", ") ?? "",
    description: listing?.description ?? "",
    altTextsText: listing?.imageAltTexts.join("\n") ?? "",
    price: listing ? String(listing.price) : "",
    status:
      listing?.status === "active" || listing?.status === "inactive"
        ? listing.status
        : "inactive",
    effectiveAt: todayIso(),
    changeNote: "",
  };
}

export function ListingFormModal({ isOpen, listing, onClose, onSaved }: ListingFormModalProps) {
  const isEditing = Boolean(listing);
  const [form, setForm] = useState(() => emptyFormState(listing));
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(emptyFormState(listing));
      setErrors([]);
      setWarnings([]);
    }
    // Reset the form each time the modal opens for a (possibly different) listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, listing?.listingId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  const handleSubmit = async () => {
    setIsSaving(true);
    setErrors([]);
    setWarnings([]);

    try {
      const result = await saveListing({
        listingId: form.listingId.trim(),
        url: form.url.trim(),
        title: form.title.trim(),
        tags: splitTags(form.tagsText),
        description: form.description.trim(),
        imageAltTexts: splitLines(form.altTextsText),
        price: Number(form.price),
        currency: "USD",
        status: form.status as "active" | "inactive",
        effectiveAt: form.effectiveAt,
        changeNote: form.changeNote.trim() || null,
      });
      setWarnings(result.versionCreated ? [] : ["No content changed; no new version was created."]);
      await onSaved();
      onClose();
    } catch (reason: unknown) {
      setErrors([reason instanceof Error ? reason.message : "Listing could not be saved."]);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!isSaving) {
          void handleSubmit();
        }
        return;
      }

      if (event.key === "Tab") {
        const container = dialogRef.current;
        if (!container) {
          return;
        }
        const focusable = container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) {
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, form, isSaving]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal modal--wide modal--scrollable"
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-form-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="eyebrow">Listings</span>
            <h3 id="listing-form-modal-title">
              {isEditing ? "Listing'i düzenle" : "Listing ekle"}
            </h3>
            <p>Etsy'deki güncel listing içeriğini gir; değişiklik yeni bir versiyon olarak kaydedilir.</p>
          </div>
          <button className="modal__close" type="button" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body listing-form-modal__body">
          <div className="listing-form-grid">
            <Input
              label="Listing ID"
              value={form.listingId}
              readOnly={isEditing}
              disabled={isEditing}
              onChange={(event) => setForm((prev) => ({ ...prev, listingId: event.target.value }))}
              placeholder="1905388695"
            />
            <Input
              label="Listing URL (herkese açık)"
              value={form.url}
              onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
              placeholder="https://www.etsy.com/listing/1905388695/..."
            />
          </div>

          <Textarea
            label="Başlık"
            value={form.title}
            maxLength={140}
            showCount
            rows={2}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />

          <Textarea
            label="Tags (virgül veya yeni satırla ayır, en fazla 13)"
            value={form.tagsText}
            rows={3}
            onChange={(event) => setForm((prev) => ({ ...prev, tagsText: event.target.value }))}
          />

          <Textarea
            label="Description"
            value={form.description}
            rows={8}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />

          <Textarea
            label="Görsel alt text'leri (her satıra bir tane)"
            value={form.altTextsText}
            rows={4}
            onChange={(event) => setForm((prev) => ({ ...prev, altTextsText: event.target.value }))}
          />

          <div className="listing-form-grid">
            <Input
              label="Fiyat (USD)"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
            />
            <Select
              label="Durum"
              value={form.status}
              options={[
                { value: "active", label: "Aktif" },
                { value: "inactive", label: "Pasif" },
              ]}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  status: event.target.value as "active" | "inactive",
                }))
              }
            />
            <Input
              label="Değişiklik tarihi"
              type="date"
              max={todayIso()}
              value={form.effectiveAt}
              onChange={(event) => setForm((prev) => ({ ...prev, effectiveAt: event.target.value }))}
            />
          </div>

          <Textarea
            label="Not (opsiyonel)"
            value={form.changeNote}
            rows={2}
            onChange={(event) => setForm((prev) => ({ ...prev, changeNote: event.target.value }))}
          />

          {errors.length > 0 ? (
            <div className="status-card status-card--error">
              <strong>Kaydetmeden önce düzelt:</strong>
              <ul>
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="status-card">
              <ul>
                {warnings.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="modal__footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            İptal
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSubmit()} disabled={isSaving}>
            {isSaving ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </div>
    </div>
  );
}
