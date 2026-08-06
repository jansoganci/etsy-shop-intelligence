import { useEffect, useState } from "react";
import { fetchReconciliationIssues, reconciliationIssuesExportUrl } from "../../../data/api/dataCenter.api";
import {
  ISSUE_TYPES_BY_ENTITY,
  type IssueEntity,
  type IssueRecord,
  type IssueType,
} from "../../../data/types/dataCenter";
import { Badge, Button, DashboardCard, EmptyState, Input, Select } from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";

const ENTITY_OPTIONS: Array<{ value: IssueEntity; label: string }> = [
  { value: "orders", label: "Orders" },
  { value: "orderItems", label: "Order items" },
  { value: "payments", label: "Payments" },
];

const TYPE_LABELS: Record<IssueType, string> = {
  missing_in_api: "CSV'de var, API'de yok",
  missing_in_csv: "API'de var, CSV'de yok",
  orphan_api: "API — parent kaydı yok",
  orphan_csv: "CSV — parent kaydı yok",
  parent_mismatch: "Parent uyuşmazlığı",
  financial_difference: "Finansal alan farkı",
};

const PAGE_SIZE = 25;

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  return currency ? formatCurrency(amount, currency) : amount.toLocaleString("tr-TR");
}

export function IssueDrilldownPanel() {
  const [entity, setEntity] = useState<IssueEntity>("orders");
  const [type, setType] = useState<IssueType>("missing_in_api");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<IssueRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTypes = ISSUE_TYPES_BY_ENTITY[entity];

  useEffect(() => {
    if (!availableTypes.includes(type)) {
      setType(availableTypes[0]);
    }
  }, [entity, availableTypes, type]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setOffset(0);
    fetchReconciliationIssues(entity, type, {
      limit: PAGE_SIZE,
      offset: 0,
      from: from || undefined,
      to: to || undefined,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setHasMore(page.hasMore);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Mutabakat detayları yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entity, type, from, to]);

  const handleLoadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setIsLoading(true);
    try {
      const page = await fetchReconciliationIssues(entity, type, {
        limit: PAGE_SIZE,
        offset: nextOffset,
        from: from || undefined,
        to: to || undefined,
      });
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
      setOffset(nextOffset);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Mutabakat detayları yüklenemedi.");
    } finally {
      setIsLoading(false);
    }
  };

  // Export always reuses the exact same entity/type/from/to as the on-screen
  // list, so the downloaded file matches what's currently visible.
  const exportUrl = reconciliationIssuesExportUrl(entity, type, {
    from: from || undefined,
    to: to || undefined,
  });

  return (
    <DashboardCard className="issue-drilldown-card">
      <div className="issue-drilldown-card__header">
        <div>
          <span className="eyebrow">Detay inceleme</span>
          <h3>Sorunlu kayıtlara ulaş</h3>
          <p>Aggregate'teki farkın hangi kayıtlardan kaynaklandığını gör. Alıcı adı/e-posta/adresi hiçbir zaman gösterilmez.</p>
        </div>
        <a
          href={exportUrl}
          download
          className="ui-button ui-button--sm issue-drilldown-card__export"
        >
          CSV indir
        </a>
      </div>
      <div className="issue-drilldown-card__filters">
        <Select
          label="Kaynak"
          value={entity}
          onChange={(event) => setEntity(event.target.value as IssueEntity)}
          options={ENTITY_OPTIONS}
        />
        <Select
          label="Sorun tipi"
          value={type}
          onChange={(event) => setType(event.target.value as IssueType)}
          options={availableTypes.map((value) => ({ value, label: TYPE_LABELS[value] }))}
        />
        <Input label="Başlangıç (opsiyonel)" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input label="Bitiş (opsiyonel)" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>

      {error ? <div className="status-card status-card--error">{error}</div> : null}

      {!error && !isLoading && items.length === 0 ? (
        <EmptyState eyebrow="Temiz" title="Bu kategoride sorunlu kayıt yok" description="Seçilen kaynak, tip ve dönem için fark bulunamadı." />
      ) : (
        <div className="issue-drilldown-list">
          {items.map((item) => (
            <div key={item.id} className="issue-drilldown-row">
              <span className="issue-drilldown-row__id">{item.id}</span>
              <span>{item.date ?? "—"}</span>
              <span>{formatAmount(item.amount, item.currency)}</span>
              {item.fieldName ? <span>{item.fieldName}</span> : null}
              {item.apiValue !== undefined || item.csvValue !== undefined ? (
                <span>
                  API {formatAmount(item.apiValue ?? null, item.currency)} · CSV{" "}
                  {formatAmount(item.csvValue ?? null, item.currency)}
                </span>
              ) : null}
              {item.detail ? (
                <Badge variant="warning" size="sm">
                  {item.detail}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {hasMore ? (
        <Button type="button" size="sm" onClick={() => void handleLoadMore()} disabled={isLoading}>
          {isLoading ? "Yükleniyor..." : "Daha fazla göster"}
        </Button>
      ) : null}
    </DashboardCard>
  );
}
