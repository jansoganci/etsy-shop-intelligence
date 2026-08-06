import { Check, X } from "lucide-react";
import type { CommerceCoverage, CommerceCoveragePeriod } from "../../../data/types/etsyApi";
import { Badge, DashboardCard, SectionHeader } from "../../../components/ui";
import { formatDateTime } from "../../../utils/dates";
import "./CommerceCoverageList.css";

export type CommerceCoverageListProps = {
  coverage: CommerceCoverage;
};

function watermarkUtcDate(coverage: CommerceCoverage): string {
  const { cursorValue, lastSuccessAt } = coverage.watermark;
  if (cursorValue != null) {
    return new Date(cursorValue * 1000).toISOString().slice(0, 10);
  }
  if (lastSuccessAt) {
    const parsed = new Date(lastSuccessAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return lastSuccessAt.slice(0, 10);
  }
  return "—";
}

function coverageStatusLabel(status: string): string {
  switch (status) {
    case "complete":
      return "Tamamlandı";
    case "partial":
      return "Kısmi";
    case "failed":
      return "Başarısız";
    case "running":
      return "Devam ediyor";
    default:
      return status;
  }
}

function coverageStatusVariant(
  status: string,
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
    default:
      return "neutral";
  }
}

function formatPeriodRange(period: CommerceCoveragePeriod): string {
  if (period.fromDate === period.toDate) {
    return period.fromDate;
  }
  return `${period.fromDate} – ${period.toDate}`;
}

function formatCount(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("tr-TR");
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }
  return formatDateTime(value);
}

function CsvPresenceIcon({ present }: { present: boolean }) {
  return present ? (
    <Check size={14} aria-hidden="true" className="commerce-coverage-csv__icon commerce-coverage-csv__icon--yes" />
  ) : (
    <X size={14} aria-hidden="true" className="commerce-coverage-csv__icon commerce-coverage-csv__icon--no" />
  );
}

export function CommerceCoverageList({ coverage }: CommerceCoverageListProps) {
  const watermarkDate = watermarkUtcDate(coverage);

  return (
    <div className="commerce-coverage">
      <div className="commerce-coverage__watermark" role="status">
        <span className="eyebrow">Watermark</span>
        <p>
          Otomatik kontrol tamamlanma tarihi: <strong>{watermarkDate}</strong> (UTC)
        </p>
      </div>

      <DashboardCard className="commerce-coverage-card">
        <SectionHeader
          title="Commerce coverage"
          subtitle="Senkronize edilmiş UTC dönemleri, receipt sayıları ve payment ebeveyn eşleşmeleri."
        />

        {coverage.periods.length === 0 ? (
          <p className="commerce-coverage-empty">Henüz kayıtlı commerce dönemi yok.</p>
        ) : (
          <div className="commerce-coverage-list">
            {coverage.periods.map((period) => (
              <article
                key={`${period.fromTs}-${period.toExclusiveTs}`}
                className="commerce-coverage-row"
              >
                <div className="commerce-coverage-row__header">
                  <strong>{formatPeriodRange(period)} (UTC)</strong>
                  <Badge variant={coverageStatusVariant(period.status)} size="sm">
                    {coverageStatusLabel(period.status)}
                  </Badge>
                </div>

                <dl className="commerce-coverage-row__meta">
                  <div>
                    <dt>Etsy receipt</dt>
                    <dd>{formatCount(period.etsyReceiptCount)}</dd>
                  </div>
                  <div>
                    <dt>Kaydedilen receipt</dt>
                    <dd>{formatCount(period.persistedReceiptCount)}</dd>
                  </div>
                  <div>
                    <dt>Payment ebeveyn</dt>
                    <dd>
                      {formatCount(period.paymentParentsChecked)} /{" "}
                      {formatCount(period.paymentParentsSelected)}
                    </dd>
                  </div>
                  <div>
                    <dt>Ledger</dt>
                    <dd>
                      <Badge variant={period.ledgerComplete ? "success" : "neutral"} size="sm">
                        {period.ledgerComplete ? "Tamam" : "Eksik"}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>İlk sync</dt>
                    <dd>{formatTimestamp(period.firstSyncedAt)}</dd>
                  </div>
                  <div>
                    <dt>Son yenileme</dt>
                    <dd>{formatTimestamp(period.lastRefreshedAt)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </DashboardCard>

      <DashboardCard className="commerce-coverage-csv">
        <SectionHeader
          title="CSV varlığı"
          subtitle="Aynı aylar için yüklenmiş CSV dosyaları (Orders, Order Items, Payments)."
        />

        {coverage.csvPresence.length === 0 ? (
          <p className="commerce-coverage-empty">CSV ay kaydı bulunamadı.</p>
        ) : (
          <div className="commerce-coverage-csv__table-wrap">
            <table className="commerce-coverage-csv__table">
              <thead>
                <tr>
                  <th>Ay</th>
                  <th>Orders</th>
                  <th>Order Items</th>
                  <th>Payments</th>
                </tr>
              </thead>
              <tbody>
                {coverage.csvPresence.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>
                      <CsvPresenceIcon present={row.orders} />
                      <span className="sr-only">{row.orders ? "Var" : "Yok"}</span>
                    </td>
                    <td>
                      <CsvPresenceIcon present={row.orderItems} />
                      <span className="sr-only">{row.orderItems ? "Var" : "Yok"}</span>
                    </td>
                    <td>
                      <CsvPresenceIcon present={row.payments} />
                      <span className="sr-only">{row.payments ? "Var" : "Yok"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>
    </div>
  );
}
