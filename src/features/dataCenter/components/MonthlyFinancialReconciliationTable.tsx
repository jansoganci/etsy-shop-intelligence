import { useState } from "react";
import type {
  FinancialConversionMethod,
  FinancialMetric,
  FinancialMetricStatus,
  MonthlyFinancialEntry,
  MonthlyFinancialsResult,
} from "../../../data/types/dataCenter";
import { Badge, Button, DashboardCard, InfoTooltip, SectionHeader } from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";
import { filterMonthsForProblemsOnly } from "./reconciliationFilters";

function conversionMethodLabel(method: FinancialConversionMethod): string {
  if (method === "identity") return "aynı para birimi";
  if (method === "csv_row_rate") return "CSV kur satırı ile çevrildi";
  if (method === "mixed") return "kısmen çevrildi";
  return "çevrilemedi";
}

function statusVariant(status: FinancialMetricStatus): "neutral" | "success" | "warning" | "error" {
  if (status === "MATCHED") return "success";
  if (status === "MISMATCH") return "error";
  if (status === "WARNING") return "warning";
  return "neutral";
}

function statusLabel(status: FinancialMetricStatus): string {
  if (status === "MATCHED") return "Eşleşiyor";
  if (status === "WARNING") return "Toleransta";
  if (status === "MISMATCH") return "Fark var";
  return "Yetersiz veri";
}

function formatMetricValue(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return currency ? formatCurrency(value, currency) : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function MetricRow({ metric }: { metric: FinancialMetric }) {
  return (
    <div className="monthly-financial-metric">
      <div className="monthly-financial-metric__label">
        <span>{metric.label}</span>
        <InfoTooltip label={`${metric.label} hesap yöntemi`}>{metric.businessBasis}</InfoTooltip>
      </div>
      <span>API {formatMetricValue(metric.apiValue, metric.currency)}</span>
      <span>CSV {formatMetricValue(metric.csvValue, metric.currency)}</span>
      <span>
        Fark {formatMetricValue(metric.difference, metric.currency)}
        {metric.differencePercentage !== null ? ` (${metric.differencePercentage.toFixed(2)}%)` : ""}
      </span>
      <Badge variant={statusVariant(metric.status)} size="sm">
        {statusLabel(metric.status)}
      </Badge>
      {metric.conversion ? (
        <small className="monthly-financial-metric__conversion">
          Dönüşüm — API: {conversionMethodLabel(metric.conversion.apiMethod)} · CSV:{" "}
          {conversionMethodLabel(metric.conversion.csvMethod)}
        </small>
      ) : null}
      {metric.reason ? <small className="monthly-financial-metric__reason">{metric.reason}</small> : null}
    </div>
  );
}

function MonthSection({ entry }: { entry: MonthlyFinancialEntry }) {
  return (
    <div className="monthly-financial-month">
      <div className="monthly-financial-month__header">
        <strong>{entry.month}</strong>
        <span className="monthly-financial-month__counts">
          {entry.orderCount ? `Sipariş API ${entry.orderCount.api} · CSV ${entry.orderCount.csv}` : null}
          {entry.orderCount && entry.paymentCount ? " · " : ""}
          {entry.paymentCount ? `Ödeme API ${entry.paymentCount.api} · CSV ${entry.paymentCount.csv}` : null}
        </span>
        <Badge variant={statusVariant(entry.status)} size="sm">
          {statusLabel(entry.status)}
        </Badge>
      </div>
      <div className="monthly-financial-metrics">
        {entry.metrics.map((metric) => (
          <MetricRow key={metric.key} metric={metric} />
        ))}
      </div>
    </div>
  );
}

export function MonthlyFinancialReconciliationTable({ data }: { data: MonthlyFinancialsResult }) {
  if (!data.ordersAvailable && !data.paymentsAvailable) {
    return (
      <DashboardCard className="monthly-financial-card">
        <SectionHeader
          title="Aylık finansal mutabakat"
          subtitle="Sipariş ve ödeme kaynaklarından en az biri hazır olmadığı veya ortak bir tarih aralığı
            bulunmadığı için henüz üretilemiyor."
        />
      </DashboardCard>
    );
  }

  if (data.months.length === 0) {
    return (
      <DashboardCard className="monthly-financial-card">
        <SectionHeader title="Aylık finansal mutabakat" subtitle="Ortak kapsamda henüz karşılaştırılabilir ay yok." />
      </DashboardCard>
    );
  }

  return <MonthlyFinancialTableBody data={data} />;
}

function MonthlyFinancialTableBody({ data }: { data: MonthlyFinancialsResult }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const months = problemsOnly ? filterMonthsForProblemsOnly(data.months) : data.months;

  return (
    <DashboardCard className="monthly-financial-card">
      <SectionHeader
        title="Aylık finansal mutabakat"
        subtitle="Gross sales, indirim, kargo, vergi ve ödeme alanlarının API/CSV karşılaştırması."
        actions={
          <>
            <Button type="button" size="sm" variant={problemsOnly ? "primary" : "secondary"} onClick={() => setProblemsOnly((value) => !value)}>
              {problemsOnly ? "Tümünü göster" : "Yalnızca problemli"}
            </Button>
            <Badge variant={statusVariant(data.status)} size="md">
              {statusLabel(data.status)}
            </Badge>
          </>
        }
      />
      {months.length === 0 ? (
        <p className="monthly-financial-card__empty">Bu görünümde gösterilecek problemli ay yok.</p>
      ) : (
        <div className="monthly-financial-list">
          {months.map((entry) => (
            <MonthSection key={entry.month} entry={entry} />
          ))}
        </div>
      )}
    </DashboardCard>
  );
}
