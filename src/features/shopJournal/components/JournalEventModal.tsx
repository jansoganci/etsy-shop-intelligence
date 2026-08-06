import { useEffect, useRef, useState } from "react";
import "../shop-journal.css";
import { X } from "lucide-react";
import { createShopEvent } from "../../../data/api/shopEvents.api";
import { SHOP_EVENT_LABELS, SHOP_EVENT_TYPES, type ShopEventType } from "../../../data/types/shopEvents";
import type { ListingRecord } from "../../../data/types/listings";
import { Button, Input, Select, Textarea } from "../../../components/ui";

type JournalEventModalProps = {
  isOpen: boolean;
  listings: ListingRecord[];
  defaultListingId?: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

const DISCOUNT_EVENT_TYPES: ShopEventType[] = ["discount_start", "discount_rate_change"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(defaultListingId?: string | null) {
  return {
    eventDate: todayIso(),
    eventType: "manual_note" as ShopEventType,
    listingId: defaultListingId ?? "",
    oldValue: "",
    newValue: "",
    discountRate: "",
    dateFrom: "",
    dateTo: "",
    note: "",
  };
}

export function JournalEventModal({
  isOpen,
  listings,
  defaultListingId,
  onClose,
  onSaved,
}: JournalEventModalProps) {
  const [form, setForm] = useState(() => emptyState(defaultListingId));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isDiscountEvent = DISCOUNT_EVENT_TYPES.includes(form.eventType);

  useEffect(() => {
    if (isOpen) {
      setForm(emptyState(defaultListingId));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultListingId]);

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
    setError(null);

    try {
      await createShopEvent({
        eventDate: form.eventDate,
        eventType: form.eventType,
        listingId: form.listingId || null,
        oldValue: form.oldValue.trim() || null,
        newValue: form.newValue.trim() || null,
        discountRate: form.discountRate === "" ? null : Number(form.discountRate),
        dateFrom: form.dateFrom || null,
        dateTo: form.dateTo || null,
        note: form.note.trim() || null,
      });
      await onSaved();
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Olay kaydedilemedi.");
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
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-event-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="eyebrow">Shop Journal</span>
            <h3 id="journal-event-modal-title">Olay ekle</h3>
          </div>
          <button className="modal__close" type="button" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body">
          <Input
            label="Tarih"
            type="date"
            max={todayIso()}
            value={form.eventDate}
            onChange={(event) => setForm((prev) => ({ ...prev, eventDate: event.target.value }))}
          />

          <Select
            label="Olay türü"
            value={form.eventType}
            options={SHOP_EVENT_TYPES.map((type) => ({ value: type, label: SHOP_EVENT_LABELS[type] }))}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, eventType: event.target.value as ShopEventType }))
            }
          />

          <Select
            label="İlgili listing"
            value={form.listingId}
            options={[
              { value: "", label: "Tüm mağaza" },
              ...listings.map((listing) => ({ value: listing.listingId, label: listing.title })),
            ]}
            onChange={(event) => setForm((prev) => ({ ...prev, listingId: event.target.value }))}
          />

          {isDiscountEvent ? (
            <div className="listing-form-grid">
              <Input
                label="Oran (%)"
                type="number"
                min="0"
                max="100"
                value={form.discountRate}
                onChange={(event) => setForm((prev) => ({ ...prev, discountRate: event.target.value }))}
              />
              <Input
                label="Başlangıç tarihi"
                type="date"
                value={form.dateFrom}
                onChange={(event) => setForm((prev) => ({ ...prev, dateFrom: event.target.value }))}
              />
              <Input
                label="Bitiş tarihi"
                type="date"
                value={form.dateTo}
                onChange={(event) => setForm((prev) => ({ ...prev, dateTo: event.target.value }))}
              />
            </div>
          ) : (
            <div className="listing-form-grid">
              <Input
                label="Eski değer"
                value={form.oldValue}
                onChange={(event) => setForm((prev) => ({ ...prev, oldValue: event.target.value }))}
              />
              <Input
                label="Yeni değer"
                value={form.newValue}
                onChange={(event) => setForm((prev) => ({ ...prev, newValue: event.target.value }))}
              />
            </div>
          )}

          <Textarea
            label="Not (opsiyonel)"
            value={form.note}
            rows={2}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          />

          {error ? <p className="status-card status-card--error">{error}</p> : null}
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
