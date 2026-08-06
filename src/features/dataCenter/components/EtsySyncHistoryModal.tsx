import type { EtsySyncRun } from "../../../data/types/etsyApi";
import { formatDateTime } from "../../../utils/dates";
import { Badge, Button } from "../../../components/ui";

type EtsySyncHistoryModalProps = {
  runs: EtsySyncRun[];
  filter: "all" | "errors";
  isLoading?: boolean;
  error?: string | null;
  retryingRunId?: string | null;
  onFilterChange: (filter: "all" | "errors") => void;
  onRetry: (runId: string) => void;
  onClose: () => void;
};

const RESOURCE_LABELS: Record<string, string> = {
  all: "Sync All",
  shop: "Shop",
  listings: "Listings",
  sales: "Sales",
  finance: "Finance",
  reviews: "Reviews",
  snapshots: "Snapshots",
};

function syncBadgeVariant(status: string): "neutral" | "success" | "warning" | "error" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "partial") return "error";
  if (status === "quota_paused") return "warning";
  return "neutral";
}

function isRetryable(status: string): boolean {
  return ["partial", "failed", "quota_paused"].includes(status);
}

function runErrorText(run: EtsySyncRun): string | null {
  if (run.errorMessage?.trim()) return run.errorMessage.trim();
  const fromResource = run.resources.find((resource) => resource.errorMessage?.trim());
  return fromResource?.errorMessage?.trim() ?? null;
}

function runErrorCode(run: EtsySyncRun): string | null {
  if (run.errorCode?.trim()) return run.errorCode.trim();
  const fromResource = run.resources.find((resource) => resource.errorCode?.trim());
  return fromResource?.errorCode?.trim() ?? null;
}

function summarizeCounts(run: EtsySyncRun): string {
  const fetched = run.resources.reduce((sum, resource) => sum + resource.fetched, 0);
  const updated = run.resources.reduce((sum, resource) => sum + resource.updated, 0);
  return `${fetched.toLocaleString("tr-TR")} çekildi · ${updated.toLocaleString("tr-TR")} güncellendi`;
}

export function EtsySyncHistoryModal({
  runs,
  filter,
  isLoading = false,
  error = null,
  retryingRunId = null,
  onFilterChange,
  onRetry,
  onClose,
}: EtsySyncHistoryModalProps) {
  return (
    <div className="modal-backdrop modal-backdrop--scrollable" role="presentation" onClick={onClose}>
      <div
        className="modal modal--scrollable modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="etsy-sync-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <Badge variant="neutral" size="sm">
              Etsy API
            </Badge>
            <h3 id="etsy-sync-history-title">Sync geçmişi</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onClose}
            aria-label="Sync geçmişini kapat"
          >
            Kapat
          </Button>
        </div>

        <div className="modal__body">
          <div className="etsy-sync-history-filters" role="group" aria-label="Geçmiş filtresi">
            <Button
              type="button"
              size="sm"
              variant={filter === "all" ? "primary" : "secondary"}
              onClick={() => onFilterChange("all")}
            >
              Tümü
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filter === "errors" ? "primary" : "secondary"}
              onClick={() => onFilterChange("errors")}
            >
              Hatalı
            </Button>
          </div>

          <section className="import-history-table-section" aria-label="Etsy sync geçmişi">
            <h4 className="import-history-table-section__title">
              {filter === "errors" ? "Hatalı çalışmalar" : "Tüm çalışmalar"}
              {!isLoading && !error ? (
                <span className="import-history-table-section__meta">{runs.length} kayıt</span>
              ) : null}
            </h4>

            {isLoading ? (
              <p>Sync geçmişi yükleniyor...</p>
            ) : error ? (
              <p className="status-card status-card--error">{error}</p>
            ) : runs.length === 0 ? (
              <p>
                {filter === "errors"
                  ? "Henüz hatalı sync kaydı yok."
                  : "Henüz sync çalışması yok."}
              </p>
            ) : (
              <div className="table-wrap import-history-table-wrap">
                <table className="data-table import-history-table etsy-sync-history-table">
                  <thead>
                    <tr>
                      <th>Zaman</th>
                      <th>Kaynak</th>
                      <th>Durum</th>
                      <th>Özet</th>
                      <th>Hata</th>
                      <th>Aksiyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const errorText = runErrorText(run);
                      const errorCode = runErrorCode(run);
                      const errorTitle = [errorCode, errorText].filter(Boolean).join(": ");

                      return (
                        <tr key={run.id}>
                          <td>{formatDateTime(run.startedAt ?? run.createdAt)}</td>
                          <td>
                            {RESOURCE_LABELS[run.requestedResource] ?? run.requestedResource}
                          </td>
                          <td>
                            <Badge variant={syncBadgeVariant(run.status)} size="sm">
                              {run.status}
                            </Badge>
                          </td>
                          <td>{summarizeCounts(run)}</td>
                          <td>
                            {errorText || errorCode ? (
                              <span
                                className="import-history-table__error"
                                title={errorTitle || undefined}
                              >
                                {errorCode ? `${errorCode}: ` : null}
                                {errorText ?? "—"}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {isRetryable(run.status) ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(retryingRunId)}
                                onClick={() => onRetry(run.id)}
                              >
                                {retryingRunId === run.id ? "Devam..." : "Retry"}
                              </Button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
