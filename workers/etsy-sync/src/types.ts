export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export type SyncResource =
  | "shop"
  | "listings"
  | "sales"
  | "finance"
  | "reviews"
  | "snapshots";

export type RequestedResource =
  | "commerce"
  | "shop"
  | "listings"
  | "reviews";

export type WorkflowPayload = {
  runId: string;
  shopId: string;
  resource: SyncResource;
  chunk: number;
  cursor: ResourceCursor;
};

export type ResourceCursor = {
  phase?: string;
  offset?: number;
  stateIndex?: number;
  maxSeenTimestamp?: number;
  windowStart?: number;
  windowEnd?: number;
};

export interface Env {
  DB: D1Database;
  ETSY_API_KEY: string;
  ETSY_SHARED_SECRET: string;
  ETSY_TOKEN_ENCRYPTION_KEY: string;
  ETSY_BUYER_HMAC_SECRET: string;
  ETSY_REDIRECT_URI: string;
  APP_ORIGIN?: string;
  ETSY_SYNC_QUEUE: Queue<
    | import("./engine/types").QueueTaskMessage
    | import("./reconciliation/run").ReconciliationQueueMessage
  >;
}

export type Money = {
  amount?: number;
  divisor?: number;
  currency_code?: string;
};

export type EtsyListResponse<T> = {
  count?: number;
  results?: T[];
};

export type EtsyShop = {
  shop_id: number;
  user_id: number;
  shop_name?: string;
  title?: string;
  announcement?: string;
  currency_code?: string;
  create_date?: number;
  created_timestamp?: number;
  update_date?: number;
  updated_timestamp?: number;
  listing_active_count?: number;
  digital_listing_count?: number;
  review_count?: number;
  review_average?: number;
  url?: string;
};

export type EtsyImage = {
  listing_image_id: number;
  listing_id?: number;
  rank?: number;
  alt_text?: string;
  width?: number;
  height?: number;
  url_75x75?: string;
  url_170x135?: string;
  url_570xN?: string;
  url_fullxfull?: string;
  hex_code?: string;
};

export type EtsyShopSection = {
  shop_section_id: number;
  title?: string;
  rank?: number;
  active_listing_count?: number;
};

export type EtsyListingFile = {
  listing_file_id: number;
  rank?: number;
  filename?: string;
  filesize?: string;
  size_bytes?: number;
  filetype?: string;
  create_timestamp?: number;
  created_timestamp?: number;
};

export type EtsyListing = {
  listing_id: number;
  shop_id: number;
  title?: string;
  description?: string;
  state?: string;
  url?: string;
  quantity?: number;
  price?: Money;
  taxonomy_id?: number;
  shop_section_id?: number;
  listing_type?: string;
  tags?: string[];
  materials?: string[];
  num_favorers?: number;
  is_customizable?: boolean;
  is_personalizable?: boolean;
  personalization?: unknown;
  creation_timestamp?: number;
  created_timestamp?: number;
  original_creation_timestamp?: number;
  ending_timestamp?: number;
  last_modified_timestamp?: number;
  updated_timestamp?: number;
  state_timestamp?: number;
  images?: EtsyImage[];
  Images?: EtsyImage[];
  inventory?: unknown;
  Inventory?: unknown;
  videos?: Array<Record<string, unknown>>;
  Videos?: Array<Record<string, unknown>>;
};

export type EtsyListingInventory = {
  listing_id: number;
  inventory?: {
    products?: unknown[];
    price_on_property?: number[];
    quantity_on_property?: number[];
    sku_on_property?: number[];
  } | null;
};

export type EtsyTransaction = {
  transaction_id: number;
  receipt_id?: number;
  listing_id?: number;
  title?: string;
  quantity?: number;
  sku?: string;
  variations?: unknown[];
  product_data?: unknown[];
  price?: Money;
  shipping_cost?: Money;
  create_timestamp?: number;
  created_timestamp?: number;
  paid_timestamp?: number;
  shipped_timestamp?: number;
};

export type ShopRefund = {
  amount?: Money;
  created_timestamp?: number;
  reason?: string;
  note_from_issuer?: string;
  status?: string;
};

export type EtsyReceipt = {
  receipt_id: number;
  buyer_user_id?: number;
  city?: string;
  country_iso?: string;
  status?: string;
  payment_method?: string;
  is_paid?: boolean;
  is_shipped?: boolean;
  was_paid?: boolean;
  was_shipped?: boolean;
  was_canceled?: boolean;
  create_timestamp?: number;
  created_timestamp?: number;
  update_timestamp?: number;
  updated_timestamp?: number;
  paid_timestamp?: number;
  shipped_timestamp?: number;
  grandtotal?: Money;
  subtotal?: Money;
  total_price?: Money;
  total_shipping_cost?: Money;
  total_tax_cost?: Money;
  total_vat_cost?: Money;
  discount_amt?: Money;
  transactions?: EtsyTransaction[];
  refunds?: ShopRefund[];
};

export type PaymentAdjustmentItem = {
  payment_adjustment_id: number;
  payment_adjustment_item_id: number;
  adjustment_type?: string;
  amount?: number;
  shop_amount?: number;
  transaction_id?: number;
  bill_payment_id?: number;
  created_timestamp?: number;
  updated_timestamp?: number;
};

export type PaymentAdjustment = {
  payment_adjustment_id: number;
  payment_id: number;
  status?: string;
  is_success?: boolean;
  user_id?: number;
  reason_code?: string;
  total_adjustment_amount?: number | null;
  shop_total_adjustment_amount?: number | null;
  buyer_total_adjustment_amount?: number | null;
  total_fee_adjustment_amount?: number | null;
  create_timestamp?: number;
  created_timestamp?: number;
  update_timestamp?: number;
  updated_timestamp?: number;
  payment_adjustment_items?: PaymentAdjustmentItem[];
};

export type EtsyPayment = {
  payment_id: number;
  receipt_id: number;
  shop_id?: number;
  status?: string;
  payment_method?: string;
  currency?: string;
  shop_currency?: string;
  buyer_currency?: string;
  amount_gross?: Money;
  amount_fees?: Money;
  amount_net?: Money;
  posted_gross?: Money;
  posted_fees?: Money;
  posted_net?: Money;
  adjusted_gross?: Money;
  adjusted_fees?: Money;
  adjusted_net?: Money;
  create_timestamp?: number;
  created_timestamp?: number;
  update_timestamp?: number;
  updated_timestamp?: number;
  payment_adjustments?: PaymentAdjustment[];
};

export type EtsyLedgerEntry = {
  entry_id: number;
  ledger_id?: number;
  sequence_number?: number;
  amount?: number;
  currency?: string;
  description?: string;
  balance?: number;
  create_date?: number;
  created_timestamp?: number;
  ledger_type?: string;
  reference_type?: string;
  reference_id?: number;
  parent_entry_id?: number;
  payment_adjustments?: unknown[];
};

export type EtsyReview = {
  buyer_user_id?: number;
  transaction_id?: number;
  listing_id?: number;
  rating?: number;
  review?: string;
  language?: string;
  image_url_fullxfull?: string;
  create_timestamp?: number;
  created_timestamp?: number;
  update_timestamp?: number;
  updated_timestamp?: number;
};
