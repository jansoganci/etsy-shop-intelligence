import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CommerceMoneyField, CommerceSummary, CommerceSummaryStatus } from "../../../data/types/etsyApi";
import { Badge, Button } from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";
import "./CommerceSummaryModal.css";

export type CommerceSummaryModalProps = {
  open: boolean;
  summary: CommerceSummary | null;
  onClose: () => void;
};

function summaryStatusLabel(status: CommerceSummaryStatus): string {
  switch (status) {
    case "complete":
      return "Tamamlandı";
    case "partial":
      return "Kısmi";
    case "failed":
      return "Başarısız";
    case "running":
      return "Devam ediyor";
  }
}

function summaryStatusVariant(
  status: CommerceSummaryStatus,
): "success" | "warning" | "error" | "neutral" {
  switch (status) {
    case "complete":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "error";
    case "running":
      return "neutral";
  }
}

function formatPeriod(fromDate: string, toDate: string): string {
  if (fromDate === toDate) {
    return `${fromDate} (UTC)`;
  }
  return `${fromDate} – ${toDate} (UTC)`;
}

function MoneyMetric({ label, field }: { label: string; field: CommerceMoneyField }) {
  return (
    <div className="commerce-summary-metric">
      <span>{label}</span>
      {field.available && field.value != null ? (
        <strong>{formatCurrency(field.value, field.currency)}</strong>
      ) : (
        <Badge variant="neutral" size="sm">
          Yetersiz veri
        </Badge>
      )}
    </div>
  );
}

export function CommerceSummaryModal({ open, summary, onClose }: CommerceSummaryModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !summary) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal commerce-summary-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commerce-summary-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="eyebrow">Commerce sync</span>
            <h3 id="commerce-summary-modal-title">Sync özeti</h3>
            <p>{formatPeriod(summary.period.fromDate, summary.period.toDate)}</p>
          </div>
          <button className="modal__close" type="button" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body commerce-summary-modal__body">
          <div className="commerce-summary-modal__status">
            <Badge variant={summaryStatusVariant(summary.status)} size="md">
              {summaryStatusLabel(summary.status)}
            </Badge>
            <span>
              {summary.recordsFetched.toLocaleString("tr-TR")} kayıt çekildi
            </span>
          </div>

          <div className="commerce-summary-modal__counts">
            <div className="commerce-summary-metric">
              <span>Sipariş</span>
              <strong>{summary.orderCount.toLocaleString("tr-TR")}</strong>
            </div>
            <div className="commerce-summary-metric">
              <span>Satılan birim</span>
              <strong>{summary.unitsSold.toLocaleString("tr-TR")}</strong>
            </div>
          </div>

          <section className="commerce-summary-modal__financials" aria-label="Finansal özet">
            <span className="eyebrow">Finansal (USD)</span>
            <div className="commerce-summary-modal__financial-grid">
              <MoneyMetric label="Gross Sales" field={summary.grossSales} />
              <MoneyMetric label="Discounts" field={summary.discounts} />
              <MoneyMetric label="Refunds" field={summary.refunds} />
              <MoneyMetric label="Etsy Fees" field={summary.etsyFees} />
              <MoneyMetric label="Net Sales" field={summary.netSales} />
            </div>
          </section>

          {summary.warnings.length > 0 ? (
            <div className="status-card status-card--warning">
              <strong>Uyarılar</strong>
              <ul className="commerce-summary-modal__warnings">
                {summary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="modal__footer">
          <Button type="button" variant="primary" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </div>
  );
}
