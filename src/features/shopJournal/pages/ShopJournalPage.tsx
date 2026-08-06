import { useCallback, useEffect, useMemo, useState } from "react";
import "../shop-journal.css";
import { Plus } from "lucide-react";
import { fetchShopEvents } from "../../../data/api/shopEvents.api";
import { fetchListings } from "../../../data/api/listings.api";
import type { ShopEventRecord } from "../../../data/types/shopEvents";
import { SHOP_EVENT_LABELS, SHOP_EVENT_TYPES } from "../../../data/types/shopEvents";
import type { ListingRecord } from "../../../data/types/listings";
import { Button, DashboardCard, EmptyState, LoadingState, PageHeader, Select } from "../../../components/ui";
import { JournalEventModal } from "../components/JournalEventModal";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(date);
}

export function ShopJournalPage() {
  const [events, setEvents] = useState<ShopEventRecord[]>([]);
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listingFilter, setListingFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [eventsResult, listingsResult] = await Promise.all([
        fetchShopEvents(),
        fetchListings(),
      ]);
      setEvents(eventsResult);
      setListings(listingsResult.listings);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Shop Journal yüklenemedi.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const listingTitleById = useMemo(
    () => new Map(listings.map((listing) => [listing.listingId, listing.title])),
    [listings],
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (listingFilter && event.listingId !== listingFilter) {
          return false;
        }
        if (eventTypeFilter && event.eventType !== eventTypeFilter) {
          return false;
        }
        return true;
      }),
    [events, listingFilter, eventTypeFilter],
  );

  if (isLoading) {
    return <LoadingState title="Shop Journal yükleniyor" description="Olaylar hazırlanıyor." />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Shop Journal"
        title="Mağaza değişiklik günlüğü"
        subtitle="Satışları etkileyebilecek listing ve mağaza olaylarının zaman çizgisi."
        actions={
          <Button type="button" variant="primary" icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
            Olay ekle
          </Button>
        }
      />

      {error ? (
        <div className="status-card status-card--error">
          <span>{error}</span>
          <Button type="button" size="sm" onClick={() => void load()}>
            Tekrar dene
          </Button>
        </div>
      ) : null}

      <div className="listings-filters">
        <Select
          value={listingFilter}
          onChange={(event) => setListingFilter(event.target.value)}
          options={[
            { value: "", label: "Tüm listing'ler" },
            ...listings.map((listing) => ({ value: listing.listingId, label: listing.title })),
          ]}
        />
        <Select
          value={eventTypeFilter}
          onChange={(event) => setEventTypeFilter(event.target.value)}
          options={[
            { value: "", label: "Tüm olay türleri" },
            ...SHOP_EVENT_TYPES.map((type) => ({ value: type, label: SHOP_EVENT_LABELS[type] })),
          ]}
        />
      </div>

      {filteredEvents.length === 0 ? (
        <EmptyState
          eyebrow={events.length === 0 ? "Henüz olay yok" : "Sonuç yok"}
          title={events.length === 0 ? "İlk olayı ekle" : "Filtreye uyan olay yok"}
          description="Listing veya mağaza genelindeki değişiklikleri kaydet."
          action={
            events.length === 0 ? (
              <Button type="button" variant="primary" onClick={() => setIsModalOpen(true)}>
                Olay ekle
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DashboardCard>
          <ul className="shop-journal-timeline">
            {filteredEvents.map((event) => (
              <li key={event.id}>
                <div className="shop-journal-timeline__date">{formatDate(event.eventDate)}</div>
                <div className="shop-journal-timeline__body">
                  <strong>{SHOP_EVENT_LABELS[event.eventType]}</strong>
                  <span>
                    {event.listingId
                      ? listingTitleById.get(event.listingId) ?? `Listing ${event.listingId}`
                      : "Tüm mağaza"}
                  </span>
                  {event.discountRate !== null ? (
                    <span>
                      %{event.discountRate}
                      {event.dateFrom ? ` · ${formatDate(event.dateFrom)}` : ""}
                      {event.dateTo ? ` – ${formatDate(event.dateTo)}` : ""}
                    </span>
                  ) : null}
                  {event.oldValue || event.newValue ? (
                    <span>
                      {event.oldValue ?? "—"} → {event.newValue ?? "—"}
                    </span>
                  ) : null}
                  {event.note ? <p>{event.note}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </DashboardCard>
      )}

      <JournalEventModal
        isOpen={isModalOpen}
        listings={listings}
        onClose={() => setIsModalOpen(false)}
        onSaved={load}
      />
    </>
  );
}
