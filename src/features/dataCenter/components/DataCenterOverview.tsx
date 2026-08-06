import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  RefreshCw,
  Star,
} from "lucide-react";
import { fetchEtsyReviews } from "../../../data/api/dataCenter.api";
import type { EtsySyncRun, EtsyConnection } from "../../../data/types/etsyApi";
import type {
  DataCenterCoverage,
  EtsyReconciliation,
  EtsyReviewsResponse,
} from "../../../data/types/dataCenter";
import type { EtsyStatsSummary } from "../../../data/types/etsyStats";
import { Badge, DashboardCard } from "../../../components/ui";

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Henüz yok";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function isActive(run: EtsySyncRun | null): boolean {
  return Boolean(
    run &&
      ["queued", "running", "retry_wait", "rate_limited", "quota_paused"].includes(
        run.status,
      ),
  );
}

export function DataCenterOverview({
  connection,
  latestRun,
  reconciliation,
  coverage,
  statsSummary,
}: {
  connection: EtsyConnection | null;
  latestRun: EtsySyncRun | null;
  reconciliation: EtsyReconciliation | null;
  coverage: DataCenterCoverage | null;
  statsSummary: EtsyStatsSummary | null;
}) {
  const [reviewSummary, setReviewSummary] =
    useState<EtsyReviewsResponse["summary"] | null>(null);

  useEffect(() => {
    if (!connection) {
      setReviewSummary(null);
      return;
    }
    let cancelled = false;
    fetchEtsyReviews({ page: 1, pageSize: 1 })
      .then((result) => {
        if (!cancelled) setReviewSummary(result.summary);
      })
      .catch(() => {
        if (!cancelled) setReviewSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.shopId]);

  const missingCsvMonths = coverage
    ? Object.values(coverage.sources).reduce(
        (total, source) => total + source.missingMonths.length,
        0,
      )
    : 0;
  const runActive = isActive(latestRun);

  return (
    <div className="data-center-overview">
      {!connection ? (
        <DashboardCard className="data-center-overview__callout">
          <CircleAlert size={21} aria-hidden="true" />
          <div>
            <h2>Etsy mağazası bağlı değil</h2>
            <p>API verilerini kullanmak için Sync bölümünden Etsy bağlantısını kur.</p>
          </div>
          <Link className="ui-button ui-button--primary" to="/data-center/sync">
            Sync bölümüne git
          </Link>
        </DashboardCard>
      ) : null}

      <div className="data-center-overview__grid">
        <Link to="/data-center/sync" className="data-center-overview__link-card">
          <DashboardCard>
            <div className="data-center-overview__card-heading">
              <RefreshCw size={18} aria-hidden="true" />
              <span>Sync</span>
              <Badge variant={runActive ? "warning" : connection ? "success" : "neutral"}>
                {runActive ? "Devam ediyor" : connection ? "Bağlı" : "Bağlı değil"}
              </Badge>
            </div>
            <strong>{connection?.shopName ?? "Etsy bağlantısı yok"}</strong>
            <small>
              Son çalışma: {dateLabel(latestRun?.completedAt ?? latestRun?.createdAt)}
            </small>
          </DashboardCard>
        </Link>

        <Link
          to="/data-center/reconciliation"
          className="data-center-overview__link-card"
        >
          <DashboardCard>
            <div className="data-center-overview__card-heading">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>Reconciliation</span>
              <Badge
                variant={
                  reconciliation?.overallStatus === "MATCHED"
                    ? "success"
                    : reconciliation
                      ? "warning"
                      : "neutral"
                }
              >
                {reconciliation?.overallStatus === "MATCHED"
                  ? "Eşleşiyor"
                  : reconciliation
                    ? "Kontrol gerekli"
                    : "Hazır değil"}
              </Badge>
            </div>
            <strong>API ve CSV kontrolü</strong>
            <small>
              {reconciliation
                ? `Son hesaplama: ${dateLabel(reconciliation.calculatedAt)}`
                : "Tamamlanmış sync generation bekleniyor."}
            </small>
          </DashboardCard>
        </Link>

        <Link to="/data-center/imports" className="data-center-overview__link-card">
          <DashboardCard>
            <div className="data-center-overview__card-heading">
              <FileSpreadsheet size={18} aria-hidden="true" />
              <span>Imports & Stats</span>
              <Badge variant={missingCsvMonths > 0 ? "warning" : "success"}>
                {missingCsvMonths > 0 ? `${missingCsvMonths} eksik ay` : "Güncel"}
              </Badge>
            </div>
            <strong>{statsSummary?.count ?? 0} aylık Stats kaydı</strong>
            <small>Son tamamlanan ay: {statsSummary?.latestMonth ?? "Henüz yok"}</small>
          </DashboardCard>
        </Link>

        <Link to="/data-center/reviews" className="data-center-overview__link-card">
          <DashboardCard>
            <div className="data-center-overview__card-heading">
              <Star size={18} aria-hidden="true" />
              <span>Reviews</span>
            </div>
            <strong>
              {reviewSummary
                ? `${reviewSummary.totalCount.toLocaleString("tr-TR")} review`
                : "Review özeti hazır değil"}
            </strong>
            <small>
              Ortalama:{" "}
              {reviewSummary?.averageRating == null
                ? "—"
                : `${reviewSummary.averageRating.toFixed(2)} / 5`}
            </small>
          </DashboardCard>
        </Link>
      </div>

      <DashboardCard className="data-center-overview__next-step">
        <span className="eyebrow">Önerilen sonraki adım</span>
        <h2>
          {!connection
            ? "Etsy mağazanı bağla"
            : runActive
              ? "Aktif senkronizasyonun tamamlanmasını bekle"
              : reconciliation?.overallStatus === "MISMATCH"
                ? "Reconciliation farklarını incele"
                : missingCsvMonths > 0
                  ? "Eksik CSV dönemlerini tamamla"
                  : "Veri kaynakları kullanıma hazır"}
        </h2>
      </DashboardCard>
    </div>
  );
}
