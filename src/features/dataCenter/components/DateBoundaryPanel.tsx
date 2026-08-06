import type { DateBoundaryResult, DateBoundarySummary } from "../../../data/types/dataCenter";
import { Badge, DashboardCard, InfoTooltip, SectionHeader } from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";

function SummaryRow({ label, summary }: { label: string; summary: DateBoundarySummary }) {
  if (!summary.available) {
    return (
      <div className="date-boundary-row">
        <strong>{label}</strong>
        <Badge variant="neutral" size="sm">
          Yetersiz veri
        </Badge>
      </div>
    );
  }

  if (summary.shiftedRecordCount === 0) {
    return (
      <div className="date-boundary-row">
        <strong>{label}</strong>
        <Badge variant="success" size="sm">
          Sınır kayması yok
        </Badge>
      </div>
    );
  }

  return (
    <div className="date-boundary-row">
      <div className="date-boundary-row__header">
        <strong>{label}</strong>
        <Badge variant="warning" size="sm">
          {summary.shiftedRecordCount.toLocaleString("tr-TR")} kayıt kaydı
        </Badge>
      </div>
      <div className="date-boundary-row__pairs">
        {summary.monthPairs.map((pair) => (
          <span key={`${pair.sourceMonth}-${pair.reportingMonth}`} className="date-boundary-pair">
            {pair.sourceMonth} (UTC) → {pair.reportingMonth} (İstanbul) · {pair.count} kayıt
          </span>
        ))}
      </div>
      {summary.shiftedAmount !== null ? (
        <small className="date-boundary-row__amount">
          Kaydırılan tutar: {formatCurrency(summary.shiftedAmount, "USD")}
        </small>
      ) : null}
    </div>
  );
}

export function DateBoundaryPanel({ data }: { data: DateBoundaryResult }) {
  return (
    <DashboardCard className="date-boundary-card">
      <SectionHeader
        title="Zaman dilimi sınır kontrolü"
        subtitle={`UTC ve ${data.orders.timezone} raporlama günü arasında ay değiştiren kayıtlar — bunlar
          eksik değildir, sadece hangi ayda sayılacakları farklı olabilir.`}
        actions={
          <InfoTooltip label="Neden bu kontrol var">
            Etsy API zaman damgaları UTC'dir. Ayın son saatlerinde oluşan bir kayıt, İstanbul takvimine göre
            bir sonraki ayda sayılabilir. Bu kayıtlar exact ID ile zaten eşleşiyor — sadece aylık toplamlarda
            hangi tarafın hangi ayına düştüğü farklı olabilir.
          </InfoTooltip>
        }
      />
      <div className="date-boundary-list">
        <SummaryRow label="Orders" summary={data.orders} />
        <SummaryRow label="Payments" summary={data.payments} />
      </div>
    </DashboardCard>
  );
}
