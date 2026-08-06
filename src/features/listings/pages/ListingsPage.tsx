import { useCallback, useEffect, useMemo, useState } from "react";
import "../listings.css";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { fetchListings } from "../../../data/api/listings.api";
import type { ListingRecord, ListingsSummary } from "../../../data/types/listings";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from "../../../components/ui";
import { formatCurrency } from "../../../utils/money";
import { ListingFormModal } from "../components/ListingFormModal";

type StatusFilter = "all" | "active" | "inactive" | "sold_out" | "draft" | "expired";
type MetadataFilter = "all" | "missing_alt_text";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(date);
}

const STATUS_LABELS: Record<ListingRecord["status"], string> = {
  active: "Aktif",
  inactive: "Pasif",
  sold_out: "Tükendi",
  draft: "Taslak",
  expired: "Süresi doldu",
};

export function ListingsPage() {
  const navigate = useNavigate();
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [summary, setSummary] = useState<ListingsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [metadataFilter, setMetadataFilter] = useState<MetadataFilter>("all");
  const [editingListing, setEditingListing] = useState<ListingRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchListings();
      setListings(result.listings);
      setSummary(result.summary);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Listings yüklenemedi.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredListings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return listings.filter((listing) => {
      if (query && !listing.title.toLowerCase().includes(query)) {
        return false;
      }
      if (statusFilter !== "all" && listing.status !== statusFilter) {
        return false;
      }
      if (metadataFilter === "missing_alt_text" && listing.imageAltTexts.length > 0) {
        return false;
      }
      return true;
    });
  }, [listings, search, statusFilter, metadataFilter]);

  const openCreateForm = () => {
    setEditingListing(null);
    setIsFormOpen(true);
  };

  const openEditForm = (listing: ListingRecord) => {
    setEditingListing(listing);
    setIsFormOpen(true);
  };

  if (isLoading) {
    return <LoadingState title="Listings yükleniyor" description="Listing kataloğu hazırlanıyor." />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Listings"
        title="Listing kataloğu"
        subtitle={`${summary?.count ?? 0} listing • ${summary?.activeCount ?? 0} aktif • ${summary?.missingAltTextCount ?? 0} alt text eksik`}
        actions={
          !summary?.etsyConnected ? (
          <Button type="button" variant="primary" icon={<Plus size={16} />} onClick={openCreateForm}>
            Listing ekle
          </Button>
          ) : undefined
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
        <Input
          placeholder="Listing ara..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          options={[
            { value: "all", label: "Tümü" },
            { value: "active", label: "Aktif" },
            { value: "inactive", label: "Pasif" },
            { value: "sold_out", label: "Tükendi" },
            { value: "draft", label: "Taslak" },
            { value: "expired", label: "Süresi doldu" },
          ]}
        />
        <Select
          value={metadataFilter}
          onChange={(event) => setMetadataFilter(event.target.value as MetadataFilter)}
          options={[
            { value: "all", label: "Tüm metadata" },
            { value: "missing_alt_text", label: "Alt text eksik" },
          ]}
        />
      </div>

      {filteredListings.length === 0 ? (
        <EmptyState
          eyebrow={listings.length === 0 ? "Henüz listing yok" : "Sonuç yok"}
          title={listings.length === 0 ? "İlk listing'i ekle" : "Filtreye uyan listing bulunamadı"}
          description={
            listings.length === 0
              ? summary?.etsyConnected
                ? "Data Center'dan Listings sync başlatarak kataloğu Etsy'den doldur."
                : "Etsy bağlantısı kurulana kadar listing'leri manuel ekleyebilirsin."
              : "Arama veya filtreleri değiştirmeyi dene."
          }
          action={
            listings.length === 0 && !summary?.etsyConnected ? (
              <Button type="button" variant="primary" onClick={openCreateForm}>
                Listing ekle
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Listing</th>
                <th>Listing ID</th>
                <th>Durum</th>
                <th>Fiyat</th>
                <th>Son değişiklik</th>
                <th>Metadata</th>
                <th aria-label="Aksiyonlar" />
              </tr>
            </thead>
            <tbody>
              {filteredListings.map((listing) => (
                <tr key={listing.listingId}>
                  <td title={listing.title}>{listing.title}</td>
                  <td>{listing.listingId}</td>
                  <td>
                    <Badge variant={listing.status === "active" ? "success" : "neutral"} size="sm">
                      {STATUS_LABELS[listing.status]}
                    </Badge>
                  </td>
                  <td>{formatCurrency(listing.price, listing.currency)}</td>
                  <td>{formatDate(listing.effectiveAt)}</td>
                  <td>
                    {listing.imageAltTexts.length === 0 ? (
                      <Badge variant="warning" size="sm">Alt text eksik</Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">Tamam</Badge>
                    )}
                  </td>
                  <td className="listings-table__actions">
                    <Button type="button" size="sm" onClick={() => navigate(`/listings/${listing.listingId}`)}>
                      Detay
                    </Button>
                    {listing.source === "manual" ? (
                      <Button type="button" size="sm" onClick={() => openEditForm(listing)}>
                        Düzenle
                      </Button>
                    ) : (
                      <Badge variant={listing.source === "etsy_api" ? "accent" : "neutral"}>
                        {listing.source === "etsy_api" ? "Etsy API" : "Manual only"}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ListingFormModal
        isOpen={isFormOpen}
        listing={editingListing}
        onClose={() => setIsFormOpen(false)}
        onSaved={load}
      />
    </>
  );
}
