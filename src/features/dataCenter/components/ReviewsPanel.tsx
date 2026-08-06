import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search, Star } from "lucide-react";
import { fetchEtsyReviews } from "../../../data/api/dataCenter.api";
import type {
  EtsyReviewsQuery,
  EtsyReviewsResponse,
  ReviewSort,
} from "../../../data/types/dataCenter";
import {
  Badge,
  Button,
  DashboardCard,
  EmptyState,
  Input,
  LoadingState,
  Select,
} from "../../../components/ui";

const PAGE_SIZE = 25;

type FilterState = {
  q: string;
  rating: string;
  dateFrom: string;
  dateTo: string;
  listingId: string;
  sort: ReviewSort;
};

const DEFAULT_FILTERS: FilterState = {
  q: "",
  rating: "",
  dateFrom: "",
  dateTo: "",
  listingId: "",
  sort: "newest",
};

function formatReviewDate(timestamp: number | null): string {
  if (timestamp == null) return "Tarih yok";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

function ratingStars(rating: number): string {
  return "★".repeat(Math.max(0, Math.min(5, rating)));
}

function toQuery(filters: FilterState, page: number): EtsyReviewsQuery {
  return {
    q: filters.q.trim() || undefined,
    rating: filters.rating ? Number(filters.rating) : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    listingId: filters.listingId || undefined,
    sort: filters.sort,
    page,
    pageSize: PAGE_SIZE,
  };
}

export function ReviewsPanel({
  connected,
  isSyncing,
  onSync,
}: {
  connected: boolean;
  isSyncing: boolean;
  onSync: () => void;
}) {
  const [draft, setDraft] = useState<FilterState>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EtsyReviewsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wasSyncing = useRef(isSyncing);

  const load = useCallback(async () => {
    if (!connected) {
      setIsLoading(false);
      setData(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchEtsyReviews(toQuery(filters, page)));
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "Review verileri yüklenemedi.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [connected, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (wasSyncing.current && !isSyncing) {
      void load();
    }
    wasSyncing.current = isSyncing;
  }, [isSyncing, load]);

  const listingOptions = useMemo(
    () => [
      { value: "", label: "Tüm listing'ler" },
      ...(data?.listings ?? []).map((listing) => ({
        value: listing.listingId,
        label: listing.listingTitle
          ? `${listing.listingTitle} · ${listing.listingId}`
          : `Listing ${listing.listingId}`,
      })),
    ],
    [data?.listings],
  );

  if (!connected) {
    return (
      <EmptyState
        eyebrow="Etsy bağlantısı gerekli"
        title="Review verileri henüz kullanılamıyor"
        description="Önce Sync bölümünden Etsy mağazanı bağla."
      />
    );
  }

  return (
    <div className="reviews-view">
      <div className="reviews-view__toolbar">
        <div>
          <h2>Etsy Reviews</h2>
          <p>Senkronize edilmiş gerçek Etsy review kayıtları.</p>
        </div>
        <Button
          type="button"
          variant="primary"
          icon={<RefreshCw size={16} />}
          disabled={isSyncing}
          onClick={onSync}
        >
          {isSyncing ? "Senkronize ediliyor..." : "Review'ları senkronize et"}
        </Button>
      </div>

      {data ? (
        <div className="reviews-summary">
          <DashboardCard>
            <span>Review sayısı</span>
            <strong>{data.summary.totalCount.toLocaleString("tr-TR")}</strong>
          </DashboardCard>
          <DashboardCard>
            <span>Ortalama puan</span>
            <strong>
              {data.summary.averageRating == null
                ? "—"
                : data.summary.averageRating.toLocaleString("tr-TR", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 2,
                  })}
            </strong>
          </DashboardCard>
          <DashboardCard className="reviews-distribution">
            <span>Puan dağılımı</span>
            <div>
              {[5, 4, 3, 2, 1].map((rating) => {
                const count = data.summary.distribution[rating] ?? 0;
                const percentage = data.summary.totalCount
                  ? (count / data.summary.totalCount) * 100
                  : 0;
                return (
                  <div key={rating} className="reviews-distribution__row">
                    <span>{rating}★</span>
                    <span className="reviews-distribution__track">
                      <span style={{ width: `${percentage}%` }} />
                    </span>
                    <strong>{count.toLocaleString("tr-TR")}</strong>
                  </div>
                );
              })}
            </div>
          </DashboardCard>
        </div>
      ) : null}

      <DashboardCard className="reviews-filters">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setFilters(draft);
          }}
        >
          <Input
            label="Ara"
            placeholder="Review, listing, transaction veya receipt"
            value={draft.q}
            onChange={(event) =>
              setDraft((current) => ({ ...current, q: event.target.value }))
            }
          />
          <Select
            label="Puan"
            value={draft.rating}
            onChange={(event) =>
              setDraft((current) => ({ ...current, rating: event.target.value }))
            }
            options={[
              { value: "", label: "Tüm puanlar" },
              ...[5, 4, 3, 2, 1].map((rating) => ({
                value: String(rating),
                label: `${rating} yıldız`,
              })),
            ]}
          />
          <Input
            label="Başlangıç"
            type="date"
            value={draft.dateFrom}
            onChange={(event) =>
              setDraft((current) => ({ ...current, dateFrom: event.target.value }))
            }
          />
          <Input
            label="Bitiş"
            type="date"
            value={draft.dateTo}
            onChange={(event) =>
              setDraft((current) => ({ ...current, dateTo: event.target.value }))
            }
          />
          <Select
            label="Listing"
            value={draft.listingId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, listingId: event.target.value }))
            }
            options={listingOptions}
          />
          <Select
            label="Sırala"
            value={draft.sort}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sort: event.target.value as ReviewSort,
              }))
            }
            options={[
              { value: "newest", label: "En yeni" },
              { value: "oldest", label: "En eski" },
              { value: "rating_high", label: "Puan: yüksekten düşüğe" },
              { value: "rating_low", label: "Puan: düşükten yükseğe" },
              { value: "updated", label: "Son güncellenen" },
            ]}
          />
          <div className="reviews-filters__actions">
            <Button type="submit" variant="primary" icon={<Search size={15} />}>
              Uygula
            </Button>
            <Button
              type="button"
              onClick={() => {
                setDraft(DEFAULT_FILTERS);
                setFilters(DEFAULT_FILTERS);
                setPage(1);
              }}
            >
              Temizle
            </Button>
          </div>
        </form>
      </DashboardCard>

      <div className="status-card reviews-capability-note">
        Etsy review verisi buyer adını ve satıcı cevabını sağlamıyor. Bu alanlar
        tahmin edilmez veya sahte veriyle doldurulmaz. Transaction ve receipt
        referansları yalnızca Etsy cevabında mevcutsa gösterilir.
      </div>

      {isLoading ? (
        <LoadingState
          title="Review'lar yükleniyor"
          description="Filtrelenmiş review kayıtları hazırlanıyor."
        />
      ) : null}

      {!isLoading && error ? (
        <div className="status-card status-card--error data-center-error">
          <span>{error}</span>
          <Button type="button" size="sm" onClick={() => void load()}>
            Tekrar dene
          </Button>
        </div>
      ) : null}

      {!isLoading && !error && data?.reviews.length === 0 ? (
        <EmptyState
          eyebrow={data.summary.totalCount === 0 ? "Henüz review yok" : "Sonuç yok"}
          title={
            data.summary.totalCount === 0
              ? "Senkronize edilmiş review bulunamadı"
              : "Bu filtrelerle eşleşen review yok"
          }
          description={
            data.summary.totalCount === 0
              ? "Review sync'i tamamlandıktan sonra kayıtlar burada görünür."
              : "Filtreleri temizleyip yeniden deneyebilirsin."
          }
        />
      ) : null}

      {!isLoading && !error && data && data.reviews.length > 0 ? (
        <>
          <DashboardCard className="reviews-table-card">
            <div className="reviews-table-wrap">
              <table className="reviews-table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Puan</th>
                    <th>Review</th>
                    <th>Buyer</th>
                    <th>Listing</th>
                    <th>İşlem</th>
                    <th>Dil</th>
                    <th>Yanıt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reviews.map((review) => (
                    <tr key={review.reviewKey}>
                      <td data-label="Tarih">{formatReviewDate(review.createTimestamp)}</td>
                      <td data-label="Puan">
                        <span className="reviews-rating" aria-label={`${review.rating} yıldız`}>
                          <Star size={15} aria-hidden="true" />
                          {review.rating}
                        </span>
                      </td>
                      <td data-label="Review" className="reviews-table__text">
                        <p>{review.reviewText || "Yazılı yorum yok"}</p>
                        {review.imageUrl ? (
                          <a href={review.imageUrl} target="_blank" rel="noreferrer">
                            Review görseli
                          </a>
                        ) : null}
                      </td>
                      <td data-label="Buyer">
                        <span className="reviews-table__unavailable">
                          Etsy API’de sağlanmıyor
                        </span>
                      </td>
                      <td data-label="Listing">
                        {review.listingId ? (
                          <Link to={`/listings/${encodeURIComponent(review.listingId)}`}>
                            {review.listingTitle || "Listing başlığı yok"}
                          </Link>
                        ) : (
                          <strong>Listing başlığı yok</strong>
                        )}
                        <span>{review.listingId ? `#${review.listingId}` : "ID yok"}</span>
                      </td>
                      <td data-label="İşlem">
                        <span>
                          {review.transactionId
                            ? `Transaction ${review.transactionId}`
                            : "Transaction yok"}
                        </span>
                        <span>
                          {review.receiptId
                            ? `Receipt ${review.receiptId}`
                            : "Receipt yok"}
                        </span>
                      </td>
                      <td data-label="Dil">
                        <Badge variant="neutral">
                          {review.language?.toUpperCase() || "—"}
                        </Badge>
                      </td>
                      <td data-label="Yanıt">
                        <Badge variant="neutral">API’de desteklenmiyor</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DashboardCard>

          <div className="reviews-pagination">
            <span>
              Sayfa {data.pagination.page} / {Math.max(data.pagination.totalPages, 1)}
              {" · "}
              {data.pagination.totalRows.toLocaleString("tr-TR")} kayıt
            </span>
            <div>
              <Button
                type="button"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Önceki
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Sonraki
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
