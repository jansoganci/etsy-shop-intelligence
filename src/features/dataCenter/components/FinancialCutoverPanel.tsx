import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  fetchFinancialCutoverStatus,
  updateFinancialCutover,
} from "../../../data/api/dataCenter.api";
import type {
  FinancialCutoverEntity,
  FinancialCutoverReadiness,
  FinancialCutoverStatus,
} from "../../../data/types/dataCenter";
import { Badge, Button, DashboardCard, InfoTooltip, LoadingState, SectionHeader } from "../../../components/ui";
import {
  entityLabel,
  entityStatusLabel,
  entityStatusVariant,
  financialStatusLabel,
  financialStatusVariant,
} from "./financialCutoverLabels";

const ENTITIES: FinancialCutoverEntity[] = ["orders", "payments"];

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Hiç değiştirilmedi (varsayılan: CSV)";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isEnabled(status: FinancialCutoverStatus, entity: FinancialCutoverEntity): boolean {
  return entity === "orders" ? status.settings.ordersApiFirst : status.settings.paymentsApiFirst;
}

function EntityRow({
  entity,
  enabled,
  readiness,
  isBusy,
  onEnable,
  onDisable,
}: {
  entity: FinancialCutoverEntity;
  enabled: boolean;
  readiness: FinancialCutoverReadiness;
  isBusy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <div className="financial-cutover-row">
      <div className="financial-cutover-row__header">
        <strong>{entityLabel(entity)}</strong>
        <Badge variant={enabled ? "success" : "neutral"} size="md">
          {enabled ? "API-first açık" : "CSV (varsayılan)"}
        </Badge>
      </div>

      <div className="financial-cutover-row__readiness">
        <span className="financial-cutover-row__readiness-item">
          <small>Kayıt mutabakatı</small>
          <Badge variant={entityStatusVariant(readiness.entityStatus)} size="sm">
            {entityStatusLabel(readiness.entityStatus)}
          </Badge>
        </span>
        <span className="financial-cutover-row__readiness-item">
          <small>Finansal mutabakat</small>
          <Badge variant={financialStatusVariant(readiness.financialStatus)} size="sm">
            {financialStatusLabel(readiness.financialStatus)}
          </Badge>
        </span>
      </div>

      {readiness.blockingReasons.length > 0 ? (
        <ul className="financial-cutover-row__reasons financial-cutover-row__reasons--blocking">
          {readiness.blockingReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {readiness.warnings.length > 0 ? (
        <ul className="financial-cutover-row__reasons financial-cutover-row__reasons--warning">
          {readiness.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="financial-cutover-row__actions">
        {enabled ? (
          <Button type="button" size="sm" disabled={isBusy} onClick={onDisable}>
            CSV'ye dön
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isBusy || !readiness.allowed}
            onClick={onEnable}
          >
            API-first'ü etkinleştir
          </Button>
        )}
      </div>
    </div>
  );
}

export function FinancialCutoverPanel() {
  const [status, setStatus] = useState<FinancialCutoverStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningEntity, setActioningEntity] = useState<FinancialCutoverEntity | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setIsLoading(true);
    else setIsRefreshing(true);
    setLoadError(null);
    try {
      const result = await fetchFinancialCutoverStatus();
      setStatus(result);
    } catch (reason: unknown) {
      setLoadError(reason instanceof Error ? reason.message : "Financial cutover durumu yüklenemedi.");
    } finally {
      if (mode === "initial") setIsLoading(false);
      else setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const handleToggle = async (entity: FinancialCutoverEntity, enabled: boolean) => {
    setActioningEntity(entity);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await updateFinancialCutover(entity, enabled);
      if (!result.ok) {
        // Defensive: the UI already prevents reaching here without either
        // readiness.allowed or an explicit force acknowledgement, but if the
        // server disagrees, its verdict wins -- refresh to show why.
        await load("refresh");
        return;
      }
      setStatus(result.status);
      setSuccessMessage(
        enabled
          ? `${entityLabel(entity)} artık API-first (Etsy API kaynağı) kullanıyor.`
          : `${entityLabel(entity)} CSV kaynağına döndürüldü.`,
      );
    } catch (reason: unknown) {
      setActionError(reason instanceof Error ? reason.message : "Financial cutover ayarı güncellenemedi.");
    } finally {
      setActioningEntity(null);
    }
  };

  const handleEnable = (entity: FinancialCutoverEntity) => {
    if (!window.confirm(`${entityLabel(entity)} için API-first etkinleştirilsin mi? Dashboard bu kaynaktan Etsy API verisini gösterecek.`)) {
      return;
    }
    void handleToggle(entity, true);
  };

  const handleDisable = (entity: FinancialCutoverEntity) => {
    void handleToggle(entity, false);
  };

  if (isLoading) {
    return (
      <DashboardCard className="financial-cutover-card">
        <LoadingState title="Financial cutover durumu yükleniyor" description="Reconciliation verisiyle birlikte hazırlanıyor." />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard className="financial-cutover-card">
      <SectionHeader
        title="Finansal kaynak önceliği (API-first)"
        subtitle="Sync tamamlanması dashboard'un otomatik olarak API'ye geçmesine neden olmaz -- her kaynak için ayrı ayrı, açıkça etkinleştirilmelidir."
        actions={
          <>
            <InfoTooltip label="Bu ayar ne işe yarar">
              Kapalıyken (varsayılan) dashboard finansal verileri her zaman CSV'den gösterir, Etsy sync tamamlanmış
              olsa bile. Açıldığında ilgili kaynak (Orders veya Payments) için API verisi CSV'nin yerini alır.
              Etkinleştirme, reconciliation sonuçları temiz olmadan yapılamaz.
              Devre dışı bırakmak (CSV'ye dönmek) her zaman serbesttir.
            </InfoTooltip>
            <Button
              type="button"
              size="sm"
              icon={<RefreshCw size={15} />}
              disabled={isRefreshing}
              onClick={() => void load("refresh")}
            >
              {isRefreshing ? "Yenileniyor..." : "Yenile"}
            </Button>
          </>
        }
      />

      {loadError ? (
        <div className="status-card status-card--error data-center-error">
          <span>{loadError}</span>
          <Button type="button" size="sm" onClick={() => void load("refresh")}>Tekrar dene</Button>
        </div>
      ) : null}

      {actionError ? (
        <div className="status-card status-card--error data-center-error">
          <span>{actionError}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div className="status-card status-card--success">
          <span>{successMessage}</span>
        </div>
      ) : null}

      {status ? (
        <>
          <p className="financial-cutover-card__updated">
            Son değişiklik: {formatUpdatedAt(status.settings.updatedAt)}
          </p>
          <div className="financial-cutover-list">
            {ENTITIES.map((entity) => (
              <EntityRow
                key={entity}
                entity={entity}
                enabled={isEnabled(status, entity)}
                readiness={status.readiness[entity]}
                isBusy={actioningEntity === entity}
                onEnable={() => handleEnable(entity)}
                onDisable={() => handleDisable(entity)}
              />
            ))}
          </div>
        </>
      ) : null}
    </DashboardCard>
  );
}
