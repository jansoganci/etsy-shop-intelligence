import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  History,
  Link2,
  Plus,
  RefreshCw,
  Unplug,
  Upload,
} from "lucide-react";
import type { ImportRecord } from "../../../data/models/records";
import { fetchEtsyStats } from "../../../data/api/etsyStats.api";
import {
  cancelReconciliationRun,
  fetchDataCenterCoverage,
  fetchEtsyReconciliation,
  fetchReconciliationRunStatus,
  startReconciliationRun,
} from "../../../data/api/dataCenter.api";
import {
  cancelEtsySync,
  disconnectEtsy,
  fetchCommerceCoverage,
  fetchCommerceSummary,
  fetchEtsyConnection,
  fetchEtsySyncRuns,
  fetchEtsySyncStatus,
  killAllEtsySync,
  pauseEtsySync,
  resumeEtsySync,
  retryEtsySync,
  startEtsySync,
} from "../../../data/api/etsyApi.api";
import type {
  CommerceCoverage,
  CommerceSummary,
  EtsyConnection,
  EtsySyncResource,
  EtsySyncRun,
} from "../../../data/types/etsyApi";
import type {
  EtsyMonthlyStatsRecord,
  EtsyStatsSummary,
} from "../../../data/types/etsyStats";
import type {
  DataCenterCoverage,
  DataCenterSourceCoverage,
  EtsyReconciliation,
  ReconciliationRun,
} from "../../../data/types/dataCenter";
import {
  Badge,
  Button,
  DashboardCard,
  EmptyState,
  LoadingState,
  PageHeader,
  SectionHeader,
} from "../../../components/ui";
import "../data-center.css";
import { formatCurrency } from "../../../utils/money";
import { DateBoundaryPanel } from "../components/DateBoundaryPanel";
import { IssueDrilldownPanel } from "../components/IssueDrilldownPanel";
import { MonthlyFinancialReconciliationTable } from "../components/MonthlyFinancialReconciliationTable";
import { MonthlyStatsModal } from "../components/MonthlyStatsModal";
import { EtsySyncHistoryModal } from "../components/EtsySyncHistoryModal";
import { CommerceSyncPanel } from "../components/CommerceSyncPanel";
import { CommerceSummaryModal } from "../components/CommerceSummaryModal";
import { CommerceCoverageList } from "../components/CommerceCoverageList";
import { shouldOpenCommerceSummaryModal } from "../utils/commerceModal";
import {
  commerceStageLabel,
  computeSyncProgress,
  formatUtcDate,
  thisUtcMonth,
} from "../utils/commercePeriod";
import { DataCenterNavigation } from "../components/DataCenterNavigation";
import { DataCenterOverview } from "../components/DataCenterOverview";
import { ReviewsPanel } from "../components/ReviewsPanel";

type DataCenterPageProps = {
  imports: ImportRecord[];
  isImporting: boolean;
  onOpenCsvImport: () => void;
};

type SourceDefinition = {
  key: ImportRecord["reportType"];
  label: string;
  description: string;
};

type DataCenterView =
  | "overview"
  | "sync"
  | "imports"
  | "reconciliation"
  | "reviews"
  | "financial-controls";

const VIEW_META: Record<
  DataCenterView,
  { title: string; subtitle: string }
> = {
  overview: {
    title: "Veri kaynakları",
    subtitle: "Etsy, CSV ve aylık Stats verilerinin genel sağlık durumu.",
  },
  sync: {
    title: "Etsy Sync",
    subtitle: "Bağlantıyı, senkronizasyonları ve çalışma geçmişini yönet.",
  },
  imports: {
    title: "Imports & Stats",
    subtitle: "CSV kaynaklarını ve aylık Etsy Stats kayıtlarını yönet.",
  },
  reconciliation: {
    title: "Reconciliation",
    subtitle: "API ve CSV kaynakları arasındaki kayıt ve finans farklarını incele.",
  },
  reviews: {
    title: "Reviews",
    subtitle: "Senkronize Etsy review verilerini ara, filtrele ve incele.",
  },
  "financial-controls": {
    title: "Financial Controls",
    subtitle: "Dashboard finansal kaynak önceliğini kontrollü biçimde yönet.",
  },
};

export function viewFromPath(pathname: string): DataCenterView {
  const segment = pathname.replace(/^\/data-center\/?/, "").split("/")[0];
  if (
    segment === "sync" ||
    segment === "imports" ||
    segment === "reconciliation" ||
    segment === "reviews" ||
    segment === "financial-controls"
  ) {
    return segment;
  }
  return "overview";
}

const CSV_SOURCES: SourceDefinition[] = [
  {
    key: "sold_orders",
    label: "Sold Orders",
    description: "Sipariş, satış değeri, indirim ve müşteri bilgileri.",
  },
  {
    key: "sold_order_items",
    label: "Sold Order Items",
    description: "Listing ve sipariş kalemi seviyesindeki performans.",
  },
  {
    key: "direct_checkout_payments",
    label: "Checkout / Payments",
    description: "Settlement, Etsy ücretleri ve kur kayıtları.",
  },
];

const ETSY_SYNC_ACTIONS: Array<{ resource: EtsySyncResource; label: string }> = [
  { resource: "shop", label: "Shop profilini güncelle" },
  { resource: "listings", label: "Listing'leri güncelle" },
  { resource: "reviews", label: "Review'ları güncelle" },
];

const SYNC_RESOURCE_LABELS: Record<string, string> = {
  shop: "Shop",
  shop_sections: "Shop Sections",
  listings: "Listings",
  listing_files: "Listing Files",
  listing_inventory: "Listing Inventory",
  sales: "Sales",
  receipts: "Sales / Receipts",
  finance: "Finance",
  payments: "Payments / Adjustments",
  ledger_entries: "Ledger Entries",
  reviews: "Reviews",
  snapshots: "Snapshots",
};

export function isActiveRun(run: EtsySyncRun | null): boolean {
  if (!run) return false;
  if (run.controlState === "paused" || run.controlState === "cancelling") {
    return true;
  }
  return ["queued", "running", "retry_wait", "rate_limited", "quota_paused"].includes(
    run.status,
  );
}

type SyncBanner = { variant: "warning" | "error"; message: string };

const SOFT_BUDGET_PAUSE_REASONS = new Set([
  "daily_budget",
  "daily_budget_queue",
  "daily_budget_d1",
]);

const TRANSIENT_WARNING_STATUSES = new Set(["rate_limited", "retry_wait", "quota_paused"]);

// Single source of truth for which status/control-state message wins. A run
// only ever shows one banner: an authoritative cancel always beats an older
// rate-limit or pause warning still sitting on the row, and paused always
// beats a stale transient error, because we derive the banner fresh from the
// current run on every render instead of combining several independent
// conditions that can each be true at once.
export function resolveSyncBanner(run: EtsySyncRun | null): SyncBanner | null {
  if (!run) return null;
  if (run.controlState === "cancelling" || run.status === "cancelled") {
    return {
      variant: "error",
      message:
        run.errorMessage ??
        "Sync cancelled by user. Stored data and cursors were kept.",
    };
  }
  if (run.controlState === "paused") {
    if (run.pauseReason && SOFT_BUDGET_PAUSE_REASONS.has(run.pauseReason)) {
      return {
        variant: "warning",
        message:
          "Günlük soft limit nedeniyle duraklatıldı. Kalan iş korunur; yarın veya kota toparlanınca Devam Et ile sürdürebilirsin.",
      };
    }
    return {
      variant: "warning",
      message: run.errorMessage ?? "Sync paused by user.",
    };
  }
  if (run.errorMessage) {
    return {
      variant: TRANSIENT_WARNING_STATUSES.has(run.status) ? "warning" : "error",
      message: run.errorMessage,
    };
  }
  return null;
}

function isStale(value: string | null, hours: number): boolean {
  if (!value) return true;
  const date = Date.parse(value);
  return !Number.isFinite(date) || Date.now() - date > hours * 60 * 60 * 1000;
}

function syncBadgeVariant(
  status: string,
  controlState?: string | null,
): "neutral" | "success" | "warning" | "error" {
  if (controlState === "paused") return "warning";
  if (status === "completed") return "success";
  if (status === "failed" || status === "partial" || status === "cancelled") {
    return "error";
  }
  if (status === "quota_paused" || status === "rate_limited" || status === "retry_wait") {
    return "warning";
  }
  return "neutral";
}

function syncStatusLabel(status: string, controlState?: string | null): string {
  if (controlState === "paused") return "Duraklatıldı";
  if (controlState === "cancelling") return "İptal ediliyor";
  const labels: Record<string, string> = {
    queued: "Sırada",
    running: "Çalışıyor",
    retry_wait: "Otomatik retry bekliyor",
    rate_limited: "Etsy limiti bekleniyor",
    quota_paused: "Günlük kota bekleniyor",
    completed: "Tamamlandı",
    partial: "Kısmi tamamlandı",
    failed: "Başarısız",
    cancelled: "İptal edildi",
  };
  return labels[status] ?? status;
}

function reconciliationStatusVariant(status: string): "neutral" | "success" | "warning" | "error" {
  if (status === "MATCHED") return "success";
  if (status === "MISMATCH") return "error";
  return "warning";
}

function reconciliationStatusLabel(status: string): string {
  if (status === "MATCHED") return "Eşleşiyor";
  if (status === "MISMATCH") return "Fark var";
  return "Yetersiz veri";
}

function reconciliationRunStatusLabel(status: ReconciliationRun["status"]): string {
  return {
    queued: "Sırada",
    running: "Hesaplanıyor",
    completed: "Tamamlandı",
    failed: "Başarısız",
    cancelled: "İptal edildi",
  }[status];
}

export function isActiveReconciliationRun(run: ReconciliationRun | null): boolean {
  return run?.status === "queued" || run?.status === "running";
}

function formatDateRange(range: { min: string | null; max: string | null }): string {
  if (!range.min || !range.max) return "—";
  return range.min === range.max ? range.min : `${range.min} – ${range.max}`;
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "Henüz yok";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function CsvSourceCard({
  source,
  latest,
  coverage,
}: {
  source: SourceDefinition;
  latest: ImportRecord | null;
  coverage: DataCenterSourceCoverage | null;
}) {
  const isSuccessful = latest?.status === "completed";
  const missingMonths = coverage?.missingMonths ?? [];

  return (
    <DashboardCard className="data-source-card">
      <div className="data-source-card__topline">
        <span className="data-source-card__icon"><FileSpreadsheet size={18} /></span>
        <Badge variant={isSuccessful ? "success" : latest ? "warning" : "neutral"}>
          {isSuccessful ? "Hazır" : latest ? latest.status : "Veri yok"}
        </Badge>
      </div>
      <div>
        <h3>{source.label}</h3>
        <p>{source.description}</p>
      </div>
      <dl className="data-source-card__meta">
        <div><dt>Son import</dt><dd>{formatDate(latest?.importedAt)}</dd></div>
        <div><dt>Satır</dt><dd>{latest?.rowCount.toLocaleString("tr-TR") ?? "—"}</dd></div>
        <div><dt>Kapsadığı son ay</dt><dd>{coverage?.lastMonth ?? "—"}</dd></div>
      </dl>
      {missingMonths.length > 0 ? (
        <div className="data-source-card__missing">
          <span>Eksik ay</span>
          <div>
            {missingMonths.map((month) => (
              <Badge key={month} variant="warning" size="sm">{month}</Badge>
            ))}
          </div>
        </div>
      ) : null}
    </DashboardCard>
  );
}

export function DataCenterPage({
  imports,
  isImporting,
  onOpenCsvImport,
}: DataCenterPageProps) {
  const location = useLocation();
  const view = viewFromPath(location.pathname);
  const viewMeta = VIEW_META[view];
  const [stats, setStats] = useState<EtsyMonthlyStatsRecord[]>([]);
  const [summary, setSummary] = useState<EtsyStatsSummary | null>(null);
  const [coverage, setCoverage] = useState<DataCenterCoverage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [etsyConnection, setEtsyConnection] = useState<EtsyConnection | null>(null);
  const [etsyRuns, setEtsyRuns] = useState<EtsySyncRun[]>([]);
  const [etsyError, setEtsyError] = useState<string | null>(null);
  const [startingResource, setStartingResource] = useState<EtsySyncResource | null>(null);
  const [reconciliation, setReconciliation] = useState<EtsyReconciliation | null>(null);
  const [isReconciliationLoading, setIsReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [reconciliationRun, setReconciliationRun] = useState<ReconciliationRun | null>(null);
  const [reconciliationSourceBusy, setReconciliationSourceBusy] = useState({
    etsySync: false,
    csvImport: false,
  });
  const [reconciliationRunError, setReconciliationRunError] = useState<string | null>(null);
  const [isStartingReconciliationRun, setIsStartingReconciliationRun] = useState(false);
  const [isSyncHistoryOpen, setIsSyncHistoryOpen] = useState(false);
  const [syncHistoryFilter, setSyncHistoryFilter] = useState<"all" | "errors">("all");
  const [syncHistoryRuns, setSyncHistoryRuns] = useState<EtsySyncRun[]>([]);
  const [syncHistoryLoading, setSyncHistoryLoading] = useState(false);
  const [syncHistoryError, setSyncHistoryError] = useState<string | null>(null);
  const [retryingHistoryRunId, setRetryingHistoryRunId] = useState<string | null>(null);
  const initialCommercePeriod = thisUtcMonth();
  const [commerceFrom, setCommerceFrom] = useState(initialCommercePeriod.from);
  const [commerceTo, setCommerceTo] = useState(initialCommercePeriod.to);
  const [commerceCoverage, setCommerceCoverage] = useState<CommerceCoverage | null>(null);
  const [commerceSummary, setCommerceSummary] = useState<CommerceSummary | null>(null);
  const [isCommerceSummaryOpen, setIsCommerceSummaryOpen] = useState(false);
  const commerceSummaryHandledRunIdRef = useRef<string | null>(null);
  const wasEtsyRunActiveRef = useRef(false);


  const loadStats = useCallback(async () => {
    setError(null);
    try {
      const [statsResult, coverageResult] = await Promise.all([
        fetchEtsyStats(),
        fetchDataCenterCoverage(),
      ]);
      setStats(statsResult.stats);
      setSummary(statsResult.summary);
      setCoverage(coverageResult);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Etsy Stats yüklenemedi.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // A background poll started before a mutation (pause/resume/cancel) can
  // resolve after the explicit refresh that follows the mutation, and its
  // response reflects the pre-mutation backend state. Without ordering,
  // whichever request happens to resolve last wins the render, so a stale
  // poll can silently revert the UI back to an old status. This sequence
  // number lets every setter check "am I still the latest request" before
  // writing state, so only the most recently issued call's response is ever
  // applied. Explicit refreshes (loadEtsy) always run — they must never be
  // skipped just because a background poll happens to be in flight.
  const etsySyncSeqRef = useRef(0);
  const pollEtsyInFlight = useRef(false);

  const loadEtsy = useCallback(async () => {
    const seq = ++etsySyncSeqRef.current;
    setEtsyError(null);
    try {
      const [connectionResult, runsResult, coverageResult] = await Promise.all([
        fetchEtsyConnection(),
        fetchEtsySyncRuns(),
        fetchCommerceCoverage().catch(() => null),
      ]);
      if (seq !== etsySyncSeqRef.current) return;
      setEtsyConnection(connectionResult.connection);
      setEtsyRuns(runsResult);
      if (coverageResult) setCommerceCoverage(coverageResult);
    } catch (reason: unknown) {
      if (seq !== etsySyncSeqRef.current) return;
      setEtsyError(
        reason instanceof Error ? reason.message : "Etsy API durumu yüklenemedi.",
      );
    }
  }, []);

  const loadReconciliation = useCallback(async () => {
    setIsReconciliationLoading(true);
    setReconciliationError(null);
    try {
      setReconciliation(await fetchEtsyReconciliation());
    } catch (reason: unknown) {
      setReconciliation(null);
      setReconciliationError(
        reason instanceof Error
          ? reason.message
          : "API / CSV mutabakatı yüklenemedi.",
      );
    } finally {
      setIsReconciliationLoading(false);
    }
  }, []);

  const loadReconciliationRun = useCallback(async () => {
    try {
      const status = await fetchReconciliationRunStatus();
      setReconciliationRun(status.latestAttempt);
      setReconciliationSourceBusy(status.sourceBusy);
      setReconciliationRunError(null);
    } catch (reason: unknown) {
      setReconciliationRunError(
        reason instanceof Error ? reason.message : "Reconciliation çalışma durumu yüklenemedi.",
      );
    }
  }, []);

  const handleStartReconciliationRun = async () => {
    setIsStartingReconciliationRun(true);
    setReconciliationRunError(null);
    try {
      setReconciliationRun(await startReconciliationRun());
    } catch (reason: unknown) {
      setReconciliationRunError(
        reason instanceof Error ? reason.message : "Reconciliation başlatılamadı.",
      );
    } finally {
      setIsStartingReconciliationRun(false);
    }
  };

  const handleCancelReconciliationRun = async () => {
    if (!reconciliationRun) return;
    if (!window.confirm("Bu reconciliation çalışması iptal edilsin mi? Son başarılı sonuç korunur.")) {
      return;
    }
    setReconciliationRunError(null);
    try {
      await cancelReconciliationRun(reconciliationRun.id);
      await loadReconciliationRun();
    } catch (reason: unknown) {
      setReconciliationRunError(
        reason instanceof Error ? reason.message : "Reconciliation çalışması iptal edilemedi.",
      );
    }
  };

  const pollEtsyStatus = useCallback(async () => {
    // Poll ticks self-coalesce (skip instead of queuing) since they're purely
    // periodic background refreshes; an explicit loadEtsy() must never be
    // skipped this way, so it does not share this flag.
    if (pollEtsyInFlight.current) return;
    pollEtsyInFlight.current = true;
    const seq = ++etsySyncSeqRef.current;
    try {
      const run = await fetchEtsySyncStatus();
      if (seq !== etsySyncSeqRef.current) return;
      setEtsyRuns((current) => {
        if (!run) return current;
        const withoutLatest = current.filter((item) => item.id !== run.id);
        return [run, ...withoutLatest].slice(0, 20);
      });
      // Reconciliation is intentionally absent from active polling. Refresh
      // the full Data Center once, after the completed generation has queued
      // its reconciliation calculation.
      if (run && !isActiveRun(run)) {
        window.setTimeout(() => void loadEtsy(), 0);
        if (view === "overview" || view === "reconciliation") {
          window.setTimeout(() => void loadReconciliation(), 0);
        }
      }
    } catch (reason: unknown) {
      if (seq !== etsySyncSeqRef.current) return;
      setEtsyError(
        reason instanceof Error ? reason.message : "Etsy API durumu yüklenemedi.",
      );
    } finally {
      pollEtsyInFlight.current = false;
    }
  }, [loadEtsy, loadReconciliation, view]);

  useEffect(() => {
    void loadEtsy();
  }, [loadEtsy]);

  useEffect(() => {
    if (view === "overview" || view === "imports") {
      void loadStats();
    }
  }, [loadStats, view]);

  useEffect(() => {
    if (view === "overview" || view === "reconciliation") {
      void loadReconciliation();
      void loadReconciliationRun();
    }
  }, [loadReconciliation, loadReconciliationRun, view]);

  useEffect(() => {
    if (!isActiveReconciliationRun(reconciliationRun)) return;
    const timer = window.setInterval(() => void loadReconciliationRun(), 3_000);
    return () => window.clearInterval(timer);
  }, [reconciliationRun?.id, reconciliationRun?.status, loadReconciliationRun]);

  const latestEtsyRun = etsyRuns[0] ?? null;
  const syncBanner = resolveSyncBanner(latestEtsyRun);

  useEffect(() => {
    const active = isActiveRun(latestEtsyRun);
    const runId = latestEtsyRun?.id ?? null;
    if (
      shouldOpenCommerceSummaryModal({
        wasActive: wasEtsyRunActiveRef.current,
        isActive: active,
        isPeriodRun: Boolean(latestEtsyRun?.isPeriodRun),
        runId,
        lastHandledRunId: commerceSummaryHandledRunIdRef.current,
      })
    ) {
      commerceSummaryHandledRunIdRef.current = runId;
      void fetchCommerceSummary(runId!)
        .then((summary) => {
          setCommerceSummary(summary);
          setIsCommerceSummaryOpen(true);
        })
        .catch((reason: unknown) => {
          setEtsyError(
            reason instanceof Error ? reason.message : "Commerce özeti yüklenemedi.",
          );
        });
    }
    wasEtsyRunActiveRef.current = active;
  }, [latestEtsyRun]);


  useEffect(() => {
    if (!isActiveRun(latestEtsyRun)) return;
    const timer = window.setInterval(() => void pollEtsyStatus(), 10_000);
    return () => window.clearInterval(timer);
  }, [latestEtsyRun?.id, latestEtsyRun?.status, latestEtsyRun?.controlState, pollEtsyStatus]);

  const handleSync = async (
    resource: EtsySyncResource,
    period?: { from: string; to: string },
  ) => {
    setStartingResource(resource);
    setEtsyError(null);
    try {
      await startEtsySync(resource, period);
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Sync başlatılamadı.");
    } finally {
      setStartingResource(null);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Etsy bağlantısı kaldırılsın mı? Senkronize geçmiş veriler silinmez.")) {
      return;
    }
    try {
      await disconnectEtsy();
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Bağlantı kaldırılamadı.");
    }
  };

  const handleRetry = async (runId: string) => {
    setEtsyError(null);
    try {
      await retryEtsySync(runId);
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Sync devam ettirilemedi.");
    }
  };

  const handlePause = async (runId: string) => {
    setEtsyError(null);
    try {
      await pauseEtsySync(runId);
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Sync duraklatılamadı.");
    }
  };

  const handleResume = async (runId: string) => {
    setEtsyError(null);
    try {
      await resumeEtsySync(runId);
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Sync devam ettirilemedi.");
    }
  };

  const handleCancel = async (runId: string) => {
    if (!window.confirm("Bu senkronizasyon iptal edilsin mi? Kaydedilmiş veri ve cursor silinmez.")) {
      return;
    }
    setEtsyError(null);
    try {
      await cancelEtsySync(runId);
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Sync iptal edilemedi.");
    }
  };

  const handleKillAll = async () => {
    if (!window.confirm("Tüm aktif Etsy senkronizasyonları durdurulsun mu?")) {
      return;
    }
    setEtsyError(null);
    try {
      await killAllEtsySync();
      await loadEtsy();
    } catch (reason: unknown) {
      setEtsyError(reason instanceof Error ? reason.message : "Aktif sync'ler durdurulamadı.");
    }
  };

  const loadSyncHistory = useCallback(async (filter: "all" | "errors") => {
    setSyncHistoryLoading(true);
    setSyncHistoryError(null);
    try {
      const runs = await fetchEtsySyncRuns({
        limit: 50,
        errorsOnly: filter === "errors",
      });
      setSyncHistoryRuns(runs);
    } catch (reason: unknown) {
      setSyncHistoryError(
        reason instanceof Error ? reason.message : "Sync geçmişi yüklenemedi.",
      );
    } finally {
      setSyncHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSyncHistoryOpen) return;
    void loadSyncHistory(syncHistoryFilter);
  }, [isSyncHistoryOpen, syncHistoryFilter, loadSyncHistory]);

  const handleHistoryFilterChange = (filter: "all" | "errors") => {
    setSyncHistoryFilter(filter);
  };

  const handleHistoryRetry = async (runId: string) => {
    setRetryingHistoryRunId(runId);
    setSyncHistoryError(null);
    try {
      await retryEtsySync(runId);
      await Promise.all([loadEtsy(), loadSyncHistory(syncHistoryFilter)]);
      setIsSyncHistoryOpen(false);
    } catch (reason: unknown) {
      setSyncHistoryError(
        reason instanceof Error ? reason.message : "Sync devam ettirilemedi.",
      );
    } finally {
      setRetryingHistoryRunId(null);
    }
  };

  const latestImports = useMemo(() => {
    const map = new Map<ImportRecord["reportType"], ImportRecord>();
    for (const item of imports) {
      if (!map.has(item.reportType)) {
        map.set(item.reportType, item);
      }
    }
    return map;
  }, [imports]);

  // Keep the sticky tab strip under a stable page header. Route changes inside
  // Data Center reuse the same scroll container; leftover scrollTop makes the
  // sticky nav look "minimized" at the top of the viewport.
  useEffect(() => {
    const scroller = document.querySelector(".ui-sidebar-inset");
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = 0;
    }
  }, [view]);

  return (
    <>
      <PageHeader
        eyebrow="Data Center"
        title={viewMeta.title}
        subtitle={viewMeta.subtitle}
      />

      <DataCenterNavigation />

      {view === "imports" && error ? (
        <div className="status-card status-card--error data-center-error">
          <span>{error}</span>
          <Button type="button" size="sm" onClick={() => void loadStats()}>Tekrar dene</Button>
        </div>
      ) : null}

      {view === "imports" && isLoading ? (
        <LoadingState
          title="Imports & Stats hazırlanıyor"
          description="CSV kaynakları ve aylık Etsy Stats kontrol ediliyor."
        />
      ) : null}

      {view === "overview" ? (
        <DataCenterOverview
          connection={etsyConnection}
          latestRun={latestEtsyRun}
          reconciliation={reconciliation}
          coverage={coverage}
          statsSummary={summary}
        />
      ) : null}

      <section>
        {view === "sync" ? <SectionHeader
          title="Etsy API"
          subtitle="Ana veri kaynağı · read-only senkronizasyon."
          actions={
            etsyConnection ? (
              <Button type="button" size="sm" icon={<Unplug size={15} />} onClick={() => void handleDisconnect()}>
                Bağlantıyı kaldır
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                icon={<Link2 size={16} />}
                onClick={() => window.location.assign("/api/etsy/oauth/start")}
              >
                Etsy'yi bağla
              </Button>
            )
          }
        /> : null}

        {view === "sync" && etsyError ? (
          <div className="status-card status-card--error data-center-error">
            <span>{etsyError}</span>
            <Button type="button" size="sm" onClick={() => void loadEtsy()}>Tekrar dene</Button>
          </div>
        ) : null}

        {view === "sync" ? <DashboardCard className="etsy-connection-card">
          <div className="etsy-connection-card__header">
            <div>
              <span className="eyebrow">Connection</span>
              <h3>{etsyConnection?.shopName ?? "Etsy bağlı değil"}</h3>
              <p>
                {etsyConnection
                  ? "Etsy API bağlantısı hazır."
                  : "Listing, satış ve finans verilerini çekmek için OAuth bağlantısı kur."}
              </p>
            </div>
            <Badge variant={etsyConnection ? "success" : "neutral"} size="md">
              {etsyConnection ? "Bağlı" : "Bağlı değil"}
            </Badge>
          </div>

          {etsyConnection ? (
            <>
              <dl className="etsy-connection-card__meta">
                <div>
                  <dt>Son API başarısı</dt>
                  <dd>{formatDate(etsyConnection.lastApiSuccessAt ?? undefined)}</dd>
                </div>
                <div>
                  <dt>Son sync</dt>
                  <dd>{formatDate(latestEtsyRun?.completedAt ?? latestEtsyRun?.createdAt)}</dd>
                </div>
              </dl>

              {isStale(etsyConnection.lastApiSuccessAt, 6) ? (
                <div className="status-card status-card--warning">
                  Etsy verileri güncel olmayabilir. Güncel durum için ilgili sync'i manuel başlat.
                </div>
              ) : null}

              <CommerceSyncPanel
                from={commerceFrom}
                to={commerceTo}
                onFromChange={setCommerceFrom}
                onToChange={setCommerceTo}
                onSync={() => void handleSync("commerce", { from: commerceFrom, to: commerceTo })}
                onUpdateShop={() => void handleSync("shop")}
                onUpdateListings={() => void handleSync("listings")}
                onUpdateReviews={() => void handleSync("reviews")}
                busy={Boolean(startingResource) || isActiveRun(latestEtsyRun)}
                error={etsyError}
                maxDate={formatUtcDate(new Date())}
              />
              <div className="etsy-sync-actions" style={{ marginTop: "0.75rem" }}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<History size={15} />}
                  onClick={() => setIsSyncHistoryOpen(true)}
                >
                  Geçmiş / Hatalar
                </Button>
              </div>

              <details className="etsy-sync-advanced">
                <summary>Teknik bağlantı ayrıntıları</summary>
                <dl className="etsy-connection-card__meta">
                  <div>
                    <dt>Shop ID</dt>
                    <dd>{etsyConnection.shopId}</dd>
                  </div>
                  <div>
                    <dt>OAuth scopes</dt>
                    <dd>{etsyConnection.scopes.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>24 saatlik kota</dt>
                    <dd>
                      {latestEtsyRun?.qpdRemaining?.toLocaleString("tr-TR") ?? "—"}
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          ) : null}
        </DashboardCard> : null}

        {view === "sync" && latestEtsyRun ? (
          <DashboardCard className="etsy-sync-run-card">
            <div className="etsy-sync-run-card__header">
              <div>
                <span className="eyebrow">Son çalışma</span>
                <h3>{latestEtsyRun.requestedResource === "commerce" ? "Commerce Sync" : latestEtsyRun.requestedResource}</h3>
              </div>
              <div className="etsy-sync-run-card__actions">
                <Badge
                  variant={syncBadgeVariant(latestEtsyRun.status, latestEtsyRun.controlState)}
                  size="md"
                >
                  {syncStatusLabel(latestEtsyRun.status, latestEtsyRun.controlState)}
                </Badge>
              </div>
            </div>
            <dl className="etsy-connection-card__meta">
              <div>
                <dt>İlerleme</dt>
                <dd>
                  {(latestEtsyRun.completedTasks ?? 0).toLocaleString("tr-TR")} /{" "}
                  {(latestEtsyRun.totalTasks ?? 0).toLocaleString("tr-TR")} görev
                  {latestEtsyRun.remainingParents != null
                    ? ` · ${latestEtsyRun.remainingParents.toLocaleString("tr-TR")} kalan`
                    : ""}
                </dd>
              </div>
              {isActiveRun(latestEtsyRun) ? (
                <div>
                  <dt>Aşama</dt>
                  <dd>
                    {latestEtsyRun.stage
                      ? commerceStageLabel(latestEtsyRun.stage)
                      : (latestEtsyRun.currentResource ?? "—")}
                    <div
                      className="commerce-progress-bar"
                      style={{
                        marginTop: "0.4rem",
                        height: "0.45rem",
                        borderRadius: "999px",
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(
                            computeSyncProgress(
                              latestEtsyRun.completedTasks ?? 0,
                              latestEtsyRun.totalTasks ?? 0,
                            ) * 100,
                          )}%`,
                          height: "100%",
                          background: "var(--accent, #7dd3fc)",
                        }}
                      />
                    </div>
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>Aktif kaynak</dt>
                  <dd>{latestEtsyRun.currentResource ?? "—"}</dd>
                </div>
              )}
              <div>
                <dt>Son heartbeat</dt>
                <dd>
                  {latestEtsyRun.lastHeartbeatAt
                    ? new Date(latestEtsyRun.lastHeartbeatAt).toLocaleString("tr-TR")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Etsy QPD kalan</dt>
                <dd>
                  {latestEtsyRun.qpdRemaining?.toLocaleString("tr-TR") ?? "—"}
                  <span className="muted"> (rolling ~24 saat; gece yarısı reset değil)</span>
                </dd>
              </div>
              {latestEtsyRun.nextResumeAt ? (
                <div>
                  <dt>Sonraki devam</dt>
                  <dd>{new Date(latestEtsyRun.nextResumeAt).toLocaleString("tr-TR")}</dd>
                </div>
              ) : null}
            </dl>
            {syncBanner ? (
              <div className={`status-card status-card--${syncBanner.variant}`}>
                {syncBanner.message}
              </div>
            ) : null}
            <div className="etsy-sync-run-card__actions" style={{ gap: "0.5rem", display: "flex", flexWrap: "wrap" }}>
              {isActiveRun(latestEtsyRun) && latestEtsyRun.controlState !== "paused" ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void handlePause(latestEtsyRun.id)}>
                  Duraklat
                </Button>
              ) : null}
              {latestEtsyRun.controlState === "paused" ? (
                <Button
                  type="button"
                  size="sm"
                  icon={<RefreshCw size={15} />}
                  onClick={() => void handleResume(latestEtsyRun.id)}
                >
                  Devam et
                </Button>
              ) : null}
              {isActiveRun(latestEtsyRun) ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleCancel(latestEtsyRun.id)}>
                  İptal
                </Button>
              ) : null}
              {isActiveRun(latestEtsyRun) ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleKillAll()}>
                  Tümünü durdur
                </Button>
              ) : null}
              {["partial", "failed", "quota_paused"].includes(latestEtsyRun.status) &&
              latestEtsyRun.controlState !== "paused" ? (
                <Button
                  type="button"
                  size="sm"
                  icon={<RefreshCw size={15} />}
                  onClick={() => void handleRetry(latestEtsyRun.id)}
                >
                  Kaldığı yerden devam et
                </Button>
              ) : null}
            </div>
            {!isActiveRun(latestEtsyRun) ? (
            <details className="etsy-sync-advanced">
              <summary>
                Kaynak ayrıntıları · {latestEtsyRun.resources.length} kaynak
              </summary>
              <div className="etsy-sync-resource-list">
                {latestEtsyRun.resources.map((resource) => (
                  <div key={resource.resource} className="etsy-sync-resource-row">
                    <div>
                      <strong>{SYNC_RESOURCE_LABELS[resource.resource] ?? resource.resource}</strong>
                      <span>
                        {resource.fetched.toLocaleString("tr-TR")} çekildi ·{" "}
                        {resource.updated.toLocaleString("tr-TR")} güncellendi
                      </span>
                    </div>
                    <Badge variant={syncBadgeVariant(resource.status)}>
                      {syncStatusLabel(resource.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            </details>
            ) : null}
          </DashboardCard>
        ) : null}

        {view === "reconciliation" && !etsyConnection ? (
          <DashboardCard>
            <EmptyState
              eyebrow="Etsy bağlantısı gerekli"
              title="Reconciliation kullanılamıyor"
              description="API ve CSV verisini karşılaştırmak için önce Sync bölümünden Etsy mağazanı bağla."
            />
          </DashboardCard>
        ) : null}

        {view === "reconciliation" && etsyConnection && isReconciliationLoading ? (
          <LoadingState
            title="Reconciliation yükleniyor"
            description="Son tamamlanan sync generation sonucu hazırlanıyor."
          />
        ) : null}

        {view === "reconciliation" && etsyConnection && reconciliationError ? (
          <div className="status-card status-card--error data-center-error">
            <span>{reconciliationError}</span>
            <Button type="button" size="sm" onClick={() => void loadReconciliation()}>
              Tekrar dene
            </Button>
          </div>
        ) : null}

        {view === "reconciliation" && etsyConnection && !isReconciliationLoading && !reconciliationError && !reconciliation ? (
          <DashboardCard>
            <EmptyState
              eyebrow="Henüz hazır değil"
              title="Reconciliation sonucu bulunamadı"
              description="Reconciliation, tamamlanmış bir sync generation sonrasında hesaplanır. Aktif sync varsa tamamlanmasını bekle."
            />
          </DashboardCard>
        ) : null}

        {view === "reconciliation" && etsyConnection ? (
          <DashboardCard className="etsy-reconciliation-card">
            <div className="etsy-reconciliation-card__header">
              <div>
                <span className="eyebrow">Kalıcı run · shadow mod</span>
                <h3>Reconciliation hesaplama</h3>
              </div>
              {reconciliationRun ? (
                <Badge
                  variant={
                    reconciliationRun.status === "completed"
                      ? "success"
                      : reconciliationRun.status === "failed" || reconciliationRun.status === "cancelled"
                        ? "error"
                        : "warning"
                  }
                  size="md"
                >
                  {reconciliationRunStatusLabel(reconciliationRun.status)}
                </Badge>
              ) : null}
            </div>
            <p className="etsy-reconciliation-card__meta">
              Kalıcı sonuçlar shadow olarak kaydedilir; mevcut ekran sonucu henüz değiştirilmez.
            </p>
            {reconciliationRun ? (
              <dl className="etsy-connection-card__meta">
                <div>
                  <dt>İlerleme</dt>
                  <dd>
                    {reconciliationRun.progress.completed} / {reconciliationRun.progress.total} adım
                    {reconciliationRun.progress.currentStep ? ` · ${reconciliationRun.progress.currentStep}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Son çalışma</dt>
                  <dd>{formatDate(reconciliationRun.completedAt ?? reconciliationRun.createdAt)}</dd>
                </div>
                <div>
                  <dt>Shadow</dt>
                  <dd>
                    {reconciliationRun.shadow?.status === "match"
                      ? "Mevcut sonuçla eşleşiyor"
                      : reconciliationRun.shadow?.status === "different"
                        ? "Fark bulundu"
                        : "Karşılaştırma bekliyor"}
                  </dd>
                </div>
              </dl>
            ) : null}
            {reconciliationRunError ? (
              <div className="status-card status-card--error data-center-error">
                <span>{reconciliationRunError}</span>
              </div>
            ) : null}
            <div className="etsy-sync-run-card__actions" style={{ gap: "0.5rem", display: "flex", flexWrap: "wrap" }}>
              <Button
                type="button"
                size="sm"
                icon={<RefreshCw size={15} />}
                onClick={() => void handleStartReconciliationRun()}
                disabled={
                  isStartingReconciliationRun
                  || isActiveReconciliationRun(reconciliationRun)
                  || reconciliationSourceBusy.etsySync
                  || reconciliationSourceBusy.csvImport
                }
              >
                {isStartingReconciliationRun ? "Başlatılıyor…" : "Yeniden hesapla"}
              </Button>
              {reconciliationSourceBusy.etsySync || reconciliationSourceBusy.csvImport ? (
                <small>Aktif sync/import tamamlandıktan sonra yeniden hesaplanabilir.</small>
              ) : null}
              {isActiveReconciliationRun(reconciliationRun) ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleCancelReconciliationRun()}>
                  İptal
                </Button>
              ) : null}
            </div>
          </DashboardCard>
        ) : null}

        {view === "reconciliation" && etsyConnection && reconciliation ? (
          <DashboardCard className="etsy-reconciliation-card">
            <div className="etsy-reconciliation-card__header">
              <div>
                <span className="eyebrow">API / CSV mutabakatı</span>
                <h3>Kaynak kapsamı</h3>
              </div>
              <Badge variant={reconciliationStatusVariant(reconciliation.overallStatus)} size="md">
                {reconciliationStatusLabel(reconciliation.overallStatus)}
              </Badge>
            </div>
            <p className="etsy-reconciliation-card__meta">
              Son hesaplama {formatDate(reconciliation.calculatedAt)}
              {reconciliation.syncInProgress
                ? " · senkronizasyon devam ederken hesaplandı, ara sonuç olabilir"
                : ""}
            </p>
            <div className="etsy-reconciliation-grid">
              {[
                ["Orders", reconciliation.orders],
                ["Order items", reconciliation.orderItems],
                ["Payments", reconciliation.payments],
              ].map(([label, value]) => {
                const item = value as EtsyReconciliation["orders"];
                const outOfCoverage = item.outOfCoverageCount.api + item.outOfCoverageCount.csv;
                return (
                  <div key={label as string}>
                    <div className="etsy-reconciliation-grid__topline">
                      <strong>{label as string}</strong>
                      <Badge variant={reconciliationStatusVariant(item.status)} size="sm">
                        {reconciliationStatusLabel(item.status)}
                      </Badge>
                    </div>
                    {item.status === "NOT_ENOUGH_DATA" && item.reason ? (
                      <small className="etsy-reconciliation-grid__reason">{item.reason}</small>
                    ) : (
                      <>
                        <span>API {item.apiCount.toLocaleString("tr-TR")}</span>
                        <span>CSV {item.csvCount.toLocaleString("tr-TR")}</span>
                        <small>
                          Eşleşen {item.matchedCount.toLocaleString("tr-TR")} · API-only{" "}
                          {item.apiOnlyCount.toLocaleString("tr-TR")} · CSV-only{" "}
                          {item.csvOnlyCount.toLocaleString("tr-TR")}
                        </small>
                        <small>Ortak kapsam: {formatDateRange(item.coverage.common)}</small>
                      </>
                    )}
                    {outOfCoverage > 0 ? (
                      <small className="etsy-reconciliation-grid__note">
                        Ortak kapsam dışı (karşılaştırılmadı): API {item.outOfCoverageCount.api} · CSV{" "}
                        {item.outOfCoverageCount.csv}
                      </small>
                    ) : null}
                    {item.orphanCount ? (
                      <small className="etsy-reconciliation-grid__note">
                        Orphan — API {item.orphanCount.api ?? "hesaplanamadı"} · CSV{" "}
                        {item.orphanCount.csv ?? "hesaplanamadı"}
                      </small>
                    ) : null}
                    {item.cardinalityWarning ? (
                      <small className="etsy-reconciliation-grid__warning">
                        Eşleşme sayısı iki tarafta tutarsız, kontrol edilmeli.
                      </small>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </DashboardCard>
        ) : null}

        {view === "financial-controls" ? (
          <EmptyState
            eyebrow="Commerce Sync"
            title="Financial cutover artık gerekli değil"
            description="Canonical view'ler API satırı varsa onu kullanır; CSV yalnızca API'de olmayan siparişler için yedek kalır. Manuel cutover anahtarı kaldırıldı."
          />
        ) : null}

        {view === "reconciliation" && etsyConnection && reconciliation ? (
          <MonthlyFinancialReconciliationTable data={reconciliation.monthlyFinancials} />
        ) : null}

        {view === "reconciliation" && etsyConnection && reconciliation ? <DateBoundaryPanel data={reconciliation.dateBoundary} /> : null}

        {view === "reconciliation" && etsyConnection && reconciliation ? <IssueDrilldownPanel /> : null}
      </section>

      {view === "reviews" ? (
        <>
          {etsyError ? (
            <div className="status-card status-card--error data-center-error">
              <span>{etsyError}</span>
              <Button type="button" size="sm" onClick={() => void loadEtsy()}>
                Tekrar dene
              </Button>
            </div>
          ) : null}
          <ReviewsPanel
            connected={Boolean(etsyConnection)}
            isSyncing={startingResource === "reviews" || isActiveRun(latestEtsyRun)}
            onSync={() => void handleSync("reviews")}
          />
        </>
      ) : null}

      {view === "imports" && !isLoading ? <section className="data-center-health" aria-label="Data health">
        <div>
          <Database size={18} aria-hidden="true" />
          <span>Stats kayıtları</span>
          <strong>{summary?.count ?? 0}</strong>
        </div>
        <div>
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Son tamamlanan ay</span>
          <strong>{summary?.latestMonth ?? "Henüz yok"}</strong>
        </div>
        <div>
          <Clock3 size={18} aria-hidden="true" />
          <span>Eksik ay</span>
          <strong>{summary?.missingMonths.length ?? 0}</strong>
        </div>
      </section> : null}

      {view === "imports" && !isLoading ? <section>
        <SectionHeader
          title="Etsy CSV kaynakları"
          subtitle="Aylık yükleme sırası: Sold Orders → Sold Order Items → Payments."
          actions={
            <Button
              type="button"
              size="sm"
              icon={<Upload size={15} />}
              onClick={onOpenCsvImport}
              disabled={isImporting}
            >
              {isImporting ? "Yükleniyor..." : "CSV yükle"}
            </Button>
          }
        />
        <div className="data-source-grid">
          {CSV_SOURCES.map((source) => (
            <CsvSourceCard
              key={source.key}
              source={source}
              latest={latestImports.get(source.key) ?? null}
              coverage={coverage?.sources[source.key] ?? null}
            />
          ))}
        </div>
      </section> : null}

      {view === "imports" && !isLoading ? <DashboardCard className="monthly-stats-card">
        <SectionHeader
          title="Aylık Etsy Stats"
          subtitle="Tamamlanmış aylar · USD · manuel JSON girişi"
          actions={
            <Button
              type="button"
              size="sm"
              variant="primary"
              icon={<Plus size={15} />}
              onClick={() => setIsStatsModalOpen(true)}
            >
              Aylık Stats ekle
            </Button>
          }
        />

        {summary && summary.missingMonths.length > 0 ? (
          <div className="missing-months">
            <span>Eksik aylar</span>
            <div>
              {summary.missingMonths.map((month) => (
                <Badge key={month} variant="warning">{month}</Badge>
              ))}
            </div>
          </div>
        ) : null}

        {stats.length === 0 ? (
          <EmptyState
            eyebrow="Henüz kayıt yok"
            title="İlk tamamlanmış ayı ekle"
            description="Etsy Stats verisini örnek prompt ile JSON'a çevirip doğrulayabilirsin."
            action={
              <Button type="button" variant="primary" onClick={() => setIsStatsModalOpen(true)}>
                Aylık Stats ekle
              </Button>
            }
          />
        ) : (
          <div className="monthly-stats-table-wrap">
            <table className="monthly-stats-table">
              <thead>
                <tr>
                  <th>Ay</th>
                  <th>Visits</th>
                  <th>Orders</th>
                  <th>Conversion</th>
                  <th>Gross Sales</th>
                  <th>Favorites</th>
                  <th>Follows</th>
                  <th>Güncellendi</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((record) => (
                  <tr key={record.month}>
                    <td><strong>{record.month}</strong></td>
                    <td>{record.visits.toLocaleString("tr-TR")}</td>
                    <td>{record.orders.toLocaleString("tr-TR")}</td>
                    <td>%{record.conversionRate.toLocaleString("tr-TR")}</td>
                    <td>{formatCurrency(record.revenue, "USD")}</td>
                    <td>{record.itemFavorites.toLocaleString("tr-TR")}</td>
                    <td>{record.shopFollows.toLocaleString("tr-TR")}</td>
                    <td>{formatDate(record.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard> : null}

      <MonthlyStatsModal
        isOpen={isStatsModalOpen}
        existingMonths={stats.map((record) => record.month)}
        onClose={() => setIsStatsModalOpen(false)}
        onSaved={loadStats}
      />

      {view === "sync" && commerceCoverage ? (
        <CommerceCoverageList coverage={commerceCoverage} />
      ) : null}

      <CommerceSummaryModal
        open={isCommerceSummaryOpen}
        summary={commerceSummary}
        onClose={() => setIsCommerceSummaryOpen(false)}
      />

      {isSyncHistoryOpen ? (
        <EtsySyncHistoryModal
          runs={syncHistoryRuns}
          filter={syncHistoryFilter}
          isLoading={syncHistoryLoading}
          error={syncHistoryError}
          retryingRunId={retryingHistoryRunId}
          onFilterChange={handleHistoryFilterChange}
          onRetry={(runId) => void handleHistoryRetry(runId)}
          onClose={() => setIsSyncHistoryOpen(false)}
        />
      ) : null}
    </>
  );
}
