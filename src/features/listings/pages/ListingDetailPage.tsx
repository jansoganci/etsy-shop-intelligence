import { useCallback, useEffect, useState } from "react";
import "../listings.css";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  fetchListing,
  fetchListingHistory,
  fetchListingPerformance,
} from "../../../data/api/listings.api";
import { fetchShopEvents } from "../../../data/api/shopEvents.api";
import type { ListingPerformance, ListingRecord, ListingVersionRecord } from "../../../data/types/listings";
import type { ShopEventRecord } from "../../../data/types/shopEvents";
import { SHOP_EVENT_LABELS } from "../../../data/types/shopEvents";
import {
  Badge,
  Button,
  DashboardCard,
  EmptyState,
  LoadingState,
} from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";
import { ListingFormModal } from "../components/ListingFormModal";

type TabKey = "performance" | "content" | "history" | "journal";

const TABS: { key: TabKey; label: string }[] = [
  { key: "performance", label: "Performance" },
  { key: "content", label: "Content" },
  { key: "history", label: "History" },
  { key: "journal", label: "Journal" },
];

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(date);
}

export function ListingDetailPage() {
  const { listingId = "" } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const [listing, setListing] = useState<ListingRecord | null>(null);
  const [history, setHistory] = useState<ListingVersionRecord[]>([]);
  const [performance, setPerformance] = useState<ListingPerformance | null>(null);
  const [journal, setJournal] = useState<ShopEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("performance");
  const [isFormOpen, setIsFormOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [listingResult, historyResult, performanceResult, journalResult] = await Promise.all([
        fetchListing(listingId),
        fetchListingHistory(listingId),
        fetchListingPerformance(listingId),
        fetchShopEvents({ listingId }),
      ]);
      setListing(listingResult);
      setHistory(historyResult);
      setPerformance(performanceResult);
      setJournal(journalResult);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Listing yüklenemedi.");
    } finally {
      setIsLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return <LoadingState title="Listing yükleniyor" description="Detaylar hazırlanıyor." />;
  }

  if (error || !listing) {
    return (
      <EmptyState
        eyebrow="Listing bulunamadı"
        title="Bu listing yüklenemedi"
        description={error ?? "Listing mevcut değil."}
        action={
          <Button type="button" onClick={() => navigate("/listings")}>
            Listings'e dön
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="listing-detail-header">
        <button type="button" className="listing-detail-back" onClick={() => navigate("/listings")}>
          <ArrowLeft size={16} aria-hidden="true" /> Listings
        </button>
        <div className="listing-detail-header__row">
          <h2>{listing.title}</h2>
          {listing.source === "manual" ? (
            <div className="listing-detail-header__actions">
            <Button type="button" onClick={() => setIsFormOpen(true)}>
              Düzenle
            </Button>
            </div>
          ) : null}
        </div>
        <div className="listing-detail-header__meta">
          <span>ID {listing.listingId}</span>
          <a href={listing.url} target="_blank" rel="noreferrer">
            Etsy link
          </a>
          <Badge variant={listing.status === "active" ? "success" : "neutral"} size="sm">
            {listing.status}
          </Badge>
          <Badge variant={listing.source === "etsy_api" ? "accent" : "neutral"} size="sm">
            {listing.source === "etsy_api" ? "Etsy API · salt okunur" : listing.source}
          </Badge>
          <span>{formatCurrency(listing.price, listing.currency)}</span>
          <span>Son değişiklik {formatDate(listing.effectiveAt)}</span>
        </div>
      </div>

      <div className="listing-detail-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`listing-detail-tab${activeTab === tab.key ? " listing-detail-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "performance" ? (
        <DashboardCard>
          {performance ? (
            <div className="listing-performance-grid">
              <div>
                <span>Toplam sipariş</span>
                <strong>{performance.totalOrders.toLocaleString("en-US")}</strong>
              </div>
              <div>
                <span>Toplam satılan adet</span>
                <strong>{performance.totalUnits.toLocaleString("en-US")}</strong>
              </div>
              <div>
                <span>Toplam Gross Sales</span>
                <strong>
                  {performance.currencyValid && performance.totalGrossSalesUsd !== null
                    ? formatCurrency(performance.totalGrossSalesUsd, "USD")
                    : "Para birimi bilgisi yetersiz"}
                </strong>
              </div>
              <div>
                <span>İlk / son sipariş</span>
                <strong>
                  {formatDate(performance.firstOrderDate)} – {formatDate(performance.lastOrderDate)}
                </strong>
              </div>
            </div>
          ) : (
            <p>Bu listing için sipariş verisi yok.</p>
          )}
        </DashboardCard>
      ) : null}

      {activeTab === "content" ? (
        <DashboardCard className="listing-content-card">
          <div>
            <span className="eyebrow">Başlık</span>
            <p>{listing.title}</p>
          </div>
          <div>
            <span className="eyebrow">Tags ({listing.tags.length})</span>
            <div className="listing-tag-list">
              {listing.tags.map((tag) => (
                <Badge key={tag} variant="neutral" size="sm">{tag}</Badge>
              ))}
            </div>
          </div>
          <div>
            <span className="eyebrow">Description</span>
            <p className="listing-description">{listing.description}</p>
          </div>
          <div>
            <span className="eyebrow">Alt text'ler ({listing.imageAltTexts.length})</span>
            <ul>
              {listing.imageAltTexts.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </div>
        </DashboardCard>
      ) : null}

      {activeTab === "history" ? (
        <DashboardCard>
          {history.length === 0 ? (
            <p>Versiyon geçmişi yok.</p>
          ) : (
            <ul className="listing-history-list">
              {history.map((version) => (
                <li key={version.id}>
                  <div className="listing-history-list__row">
                    <strong>{formatDate(version.effectiveAt)}</strong>
                    <span>{formatCurrency(version.price, "USD")}</span>
                    <Badge variant={version.status === "active" ? "success" : "neutral"} size="sm">
                      {version.status === "active" ? "Aktif" : "Pasif"}
                    </Badge>
                  </div>
                  <p title={version.title}>{version.title}</p>
                  {version.changeNote ? <small>{version.changeNote}</small> : null}
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      ) : null}

      {activeTab === "journal" ? (
        <DashboardCard>
          {journal.length === 0 ? (
            <p>Bu listing ile ilişkili olay yok.</p>
          ) : (
            <ul className="listing-history-list">
              {journal.map((event) => (
                <li key={event.id}>
                  <div className="listing-history-list__row">
                    <strong>{formatDate(event.eventDate)}</strong>
                    <span>{SHOP_EVENT_LABELS[event.eventType]}</span>
                  </div>
                  {event.note ? <small>{event.note}</small> : null}
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      ) : null}

      <ListingFormModal
        isOpen={isFormOpen}
        listing={listing}
        onClose={() => setIsFormOpen(false)}
        onSaved={load}
      />
    </>
  );
}
