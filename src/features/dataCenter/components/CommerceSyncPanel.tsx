import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, DashboardCard, Input, SectionHeader } from "../../../components/ui";
import {
  previousUtcMonths,
  thisUtcMonth,
  validateCommercePeriodInput,
  type CommercePeriodValidationError,
} from "../utils/commercePeriod";
import "./CommerceSyncPanel.css";

export type CommerceSyncPanelProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSync: () => void;
  onUpdateShop: () => void;
  onUpdateListings: () => void;
  onUpdateReviews: () => void;
  busy: boolean;
  error: string | null;
  maxDate: string;
};

type MonthShortcut = {
  key: string;
  label: string;
  from: string;
  to: string;
};

function parseMaxDate(maxDate: string): Date {
  const [year, month, day] = maxDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatMonthShortcutLabel(from: string): string {
  const [year, month] = from.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function periodValidationMessage(error: CommercePeriodValidationError): string {
  switch (error) {
    case "invalid_format":
      return "Tarih formatı geçersiz (YYYY-MM-DD, UTC).";
    case "future_date":
      return "Gelecek UTC tarihleri seçilemez.";
    case "reversed_range":
      return "Başlangıç, bitişten sonra olamaz.";
  }
}

function buildMonthShortcuts(now: Date): MonthShortcut[] {
  const current = thisUtcMonth(now);
  return [
    {
      key: "this-month",
      label: "Bu ay",
      from: current.from,
      to: current.to,
    },
    ...previousUtcMonths(3, now).map((period) => ({
      key: period.from,
      label: formatMonthShortcutLabel(period.from),
      from: period.from,
      to: period.to,
    })),
  ];
}

function isShortcutActive(shortcut: MonthShortcut, from: string, to: string): boolean {
  return shortcut.from === from && shortcut.to === to;
}

export function CommerceSyncPanel({
  from,
  to,
  onFromChange,
  onToChange,
  onSync,
  onUpdateShop,
  onUpdateListings,
  onUpdateReviews,
  busy,
  error,
  maxDate,
}: CommerceSyncPanelProps) {
  const now = useMemo(() => parseMaxDate(maxDate), [maxDate]);
  const shortcuts = useMemo(() => buildMonthShortcuts(now), [now]);
  const validation = useMemo(
    () => validateCommercePeriodInput(from, to, now),
    [from, to, now],
  );
  const canSync = validation.ok && !busy;

  const applyShortcut = (shortcut: MonthShortcut) => {
    onFromChange(shortcut.from);
    onToChange(shortcut.to);
  };

  return (
    <DashboardCard className="commerce-sync-panel">
      <SectionHeader
        title="Commerce sync"
        subtitle="UTC tarih aralığı seç, sipariş ve finans verilerini tek seferde senkronize et."
      />

      <div className="commerce-sync-panel__shortcuts" role="group" aria-label="Ay kısayolları">
        {shortcuts.map((shortcut) => (
          <Button
            key={shortcut.key}
            type="button"
            size="sm"
            variant={isShortcutActive(shortcut, from, to) ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => applyShortcut(shortcut)}
          >
            {shortcut.label}
          </Button>
        ))}
      </div>

      <div className="commerce-sync-panel__dates">
        <Input
          label="Başlangıç (UTC)"
          type="date"
          value={from}
          max={maxDate}
          disabled={busy}
          onChange={(event) => onFromChange(event.target.value)}
        />
        <Input
          label="Bitiş (UTC)"
          type="date"
          value={to}
          max={maxDate}
          disabled={busy}
          onChange={(event) => onToChange(event.target.value)}
        />
      </div>

      {!validation.ok ? (
        <div className="status-card status-card--warning commerce-sync-panel__validation">
          <span>{periodValidationMessage(validation.error)}</span>
        </div>
      ) : null}

      {error ? (
        <div className="status-card status-card--error data-center-error">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="etsy-sync-actions commerce-sync-panel__primary-actions">
        <Button
          type="button"
          variant="primary"
          icon={<RefreshCw size={15} />}
          disabled={!canSync}
          onClick={onSync}
        >
          {busy ? "Senkronize ediliyor..." : "Sync Commerce"}
        </Button>
      </div>

      <div className="commerce-sync-panel__secondary">
        <span className="eyebrow">Diğer güncellemeler</span>
        <div className="etsy-sync-actions">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onUpdateShop}>
            Update Shop
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onUpdateListings}
          >
            Update Listings
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onUpdateReviews}
          >
            Update Reviews
          </Button>
        </div>
      </div>

      <p className="commerce-sync-panel__hint">
        Tüm tarihler UTC takvim günüdür. <Badge variant="neutral" size="sm">UTC</Badge>
      </p>
    </DashboardCard>
  );
}
