export const SHOP_EVENT_TYPES = [
  "new_listing",
  "title_change",
  "seo_change",
  "description_change",
  "alt_text_change",
  "price_change",
  "discount_start",
  "discount_rate_change",
  "discount_end",
  "manual_note",
] as const;

export type ShopEventType = (typeof SHOP_EVENT_TYPES)[number];

export const SHOP_EVENT_LABELS: Record<ShopEventType, string> = {
  new_listing: "Yeni listing",
  title_change: "Başlık değişikliği",
  seo_change: "SEO/tag değişikliği",
  description_change: "Description değişikliği",
  alt_text_change: "Alt text değişikliği",
  price_change: "Fiyat değişikliği",
  discount_start: "İndirim başlangıcı",
  discount_rate_change: "İndirim oranı değişikliği",
  discount_end: "İndirim bitişi",
  manual_note: "Manuel not",
};

export type ShopEventRecord = {
  id: number;
  eventDate: string;
  eventType: ShopEventType;
  listingId: string | null;
  oldValue: string | null;
  newValue: string | null;
  discountRate: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  note: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type ShopEventInput = {
  eventDate: string;
  eventType: ShopEventType;
  listingId: string | null;
  oldValue: string | null;
  newValue: string | null;
  discountRate: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  note: string | null;
};
