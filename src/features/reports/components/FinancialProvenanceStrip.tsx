import { ProvenanceBadge, type DataProvenance } from "../../../components/ui";

type FinancialProvenanceStripProps = {
  orders?: DataProvenance | null;
  payments?: DataProvenance | null;
};

export function FinancialProvenanceStrip({ orders, payments }: FinancialProvenanceStripProps) {
  if (!orders && !payments) {
    return null;
  }

  return (
    <div className="report-provenance-strip" role="status">
      {orders ? (
        <span className="report-provenance-strip__item">
          <span>Orders</span>
          <ProvenanceBadge provenance={orders} />
        </span>
      ) : null}
      {payments ? (
        <span className="report-provenance-strip__item">
          <span>Payments</span>
          <ProvenanceBadge provenance={payments} />
        </span>
      ) : null}
    </div>
  );
}
