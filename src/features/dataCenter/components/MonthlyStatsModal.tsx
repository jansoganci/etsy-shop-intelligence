import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, X } from "lucide-react";
import { saveEtsyStats, validateEtsyStats } from "../../../data/api/etsyStats.api";
import type {
  EtsyMonthlyStatsInput,
  EtsyStatsValidation,
} from "../../../data/types/etsyStats";
import { Button, Textarea } from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";

type MonthlyStatsModalProps = {
  isOpen: boolean;
  existingMonths: string[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function previousMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

function exampleJson(): string {
  return JSON.stringify(
    {
      month: previousMonth(),
      currency: "USD",
      visits: 0,
      orders: 0,
      conversionRate: 0,
      revenue: 0,
      itemFavorites: 0,
      shopFollows: 0,
      reviews: 0,
      repeatBuyers: 0,
      citiesReached: 0,
      abandonedCarts: 0,
      trafficSources: {
        etsy_app_and_other_pages: { visits: 0, sharePercent: null },
        etsy_search: { visits: 0, sharePercent: null },
        etsy_marketing_and_seo: { visits: 0, sharePercent: null },
        direct_and_other_traffic: { visits: 0, sharePercent: null },
        social_media: { visits: 0, sharePercent: null },
        etsy_ads: { visits: 0, sharePercent: null },
      },
      notes: null,
    },
    null,
    2,
  );
}

const LLM_PROMPT = `Aşağıdaki Etsy aylık istatistiklerini verilen JSON şemasına dönüştür.
Sadece geçerli JSON döndür; açıklama veya markdown ekleme.
Para birimi USD olmalı. Eksik sayısal değerleri tahmin etme.
Ay YYYY-MM formatında ve tamamlanmış bir ay olmalı.

JSON şeması:
`;

function Preview({ stats }: { stats: EtsyMonthlyStatsInput }) {
  const metrics = [
    ["Ay", stats.month],
    ["Visits", stats.visits.toLocaleString("tr-TR")],
    ["Orders", stats.orders.toLocaleString("tr-TR")],
    ["Conversion", `%${stats.conversionRate.toLocaleString("tr-TR")}`],
    ["Gross Sales", formatCurrency(stats.revenue, "USD")],
    ["Favorites", stats.itemFavorites.toLocaleString("tr-TR")],
    ["Shop follows", stats.shopFollows.toLocaleString("tr-TR")],
    ["Reviews", stats.reviews.toLocaleString("tr-TR")],
    ["Repeat buyers", stats.repeatBuyers.toLocaleString("tr-TR")],
    ["Abandoned carts", stats.abandonedCarts.toLocaleString("tr-TR")],
  ];

  return (
    <div className="monthly-stats-preview">
      {metrics.map(([label, value]) => (
        <div className="monthly-stats-preview__item" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function MonthlyStatsModal({
  isOpen,
  existingMonths,
  onClose,
  onSaved,
}: MonthlyStatsModalProps) {
  const [jsonText, setJsonText] = useState(exampleJson);
  const [validation, setValidation] = useState<EtsyStatsValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const normalized = validation?.normalized ?? null;
  const isOverwrite = useMemo(
    () => Boolean(normalized && existingMonths.includes(normalized.month)),
    [existingMonths, normalized],
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const resetValidation = () => {
    setValidation(null);
    setOverwriteConfirmed(false);
    setError(null);
  };

  const handleValidate = async () => {
    setIsValidating(true);
    resetValidation();

    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const result = await validateEtsyStats(parsed);
      setValidation(result);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "JSON doğrulanamadı.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!normalized || (isOverwrite && !overwriteConfirmed)) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await saveEtsyStats(normalized);
      await onSaved();
      setJsonText(exampleJson());
      setValidation(null);
      setOverwriteConfirmed(false);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Etsy Stats kaydedilemedi.");
    } finally {
      setIsSaving(false);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(`${LLM_PROMPT}${exampleJson()}`);
      setCopied(true);
    } catch {
      setError("Prompt panoya kopyalanamadı.");
    }
  };

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
        if (normalized) {
          if (!isOverwrite || overwriteConfirmed) {
            void handleSave();
          }
        } else if (!isValidating) {
          void handleValidate();
        }
        return;
      }

      if (event.key === "Tab") {
        const container = dialogRef.current;
        if (!container) {
          return;
        }

        const focusable = container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input, textarea, [tabindex]:not([tabindex="-1"])',
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
  }, [isOpen, normalized, isOverwrite, overwriteConfirmed, isValidating, jsonText]);

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
        aria-labelledby="monthly-stats-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="eyebrow">Data Center</span>
            <h3 id="monthly-stats-modal-title">Aylık Etsy Stats ekle</h3>
            <p>Tamamlanmış bir aya ait Etsy verisini JSON olarak doğrula ve kaydet.</p>
          </div>
          <button className="modal__close" type="button" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body monthly-stats-modal__body">
          <section className="monthly-stats-instructions">
            <div>
              <span className="eyebrow">1 · Hazırla</span>
              <h4>Etsy metnini standart JSON'a çevir</h4>
              <p>
                Promptu kullandığın LLM'e ve altına Etsy'den kopyaladığın aylık
                değerleri yapıştır. Çıkan JSON'u buraya getir.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              icon={copied ? <Check size={16} /> : <Clipboard size={16} />}
              onClick={copyPrompt}
            >
              {copied ? "Kopyalandı" : "LLM promptunu kopyala"}
            </Button>
          </section>

          <section>
            <span className="eyebrow">2 · Yapıştır ve doğrula</span>
            <Textarea
              aria-label="Aylık Etsy Stats JSON"
              className="monthly-stats-json"
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                resetValidation();
              }}
              spellCheck={false}
            />
          </section>

          {error ? <p className="status-card status-card--error">{error}</p> : null}

          {validation ? (
            <section className="monthly-stats-validation" aria-live="polite">
              <span className="eyebrow">3 · Önizleme</span>
              {validation.errors.length > 0 ? (
                <div className="status-card status-card--error">
                  <strong>Kaydetmeden önce düzelt:</strong>
                  <ul>
                    {validation.errors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </div>
              ) : null}
              {validation.warnings.length > 0 ? (
                <div className="status-card">
                  <strong>Kontrol et:</strong>
                  <ul>
                    {validation.warnings.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </div>
              ) : null}
              {normalized ? <Preview stats={normalized} /> : null}
              {isOverwrite ? (
                <label className="monthly-stats-overwrite">
                  <input
                    type="checkbox"
                    checked={overwriteConfirmed}
                    onChange={(event) => setOverwriteConfirmed(event.target.checked)}
                  />
                  <span>
                    {normalized?.month} kaydı zaten var. Mevcut kaydın üzerine
                    yazılacağını onaylıyorum.
                  </span>
                </label>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="modal__footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            İptal
          </Button>
          {!normalized ? (
            <Button type="button" variant="primary" onClick={handleValidate} disabled={isValidating}>
              {isValidating ? "Doğrulanıyor..." : "Doğrula ve önizle"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={isSaving || (isOverwrite && !overwriteConfirmed)}
            >
              {isSaving ? "Kaydediliyor..." : isOverwrite ? "Kaydın üzerine yaz" : "Ayı kaydet"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
