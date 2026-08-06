-- Migration number: 0001 	 2026-06-23T19:52:12.334Z

-- Migration number: 0001
-- Initial D1 schema for Knit Bliss Stats / Etsy Dashboard
-- Creates import tracking plus the three main CSV-backed tables:
-- payments, orders, and order_items.

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type TEXT NOT NULL CHECK (import_type IN ('payments', 'orders', 'order_items')),
  file_name TEXT,
  file_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'partial')),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  buyer_username TEXT,
  buyer_name TEXT,
  order_id TEXT NOT NULL,

  gross_amount REAL,
  fees REAL,
  net_amount REAL,

  posted_gross REAL,
  posted_fees REAL,
  posted_net REAL,

  adjusted_gross REAL,
  adjusted_fees REAL,
  adjusted_net REAL,

  currency TEXT,
  listing_amount REAL,
  listing_currency TEXT,
  exchange_rate REAL,
  vat_amount REAL,
  gift_card_applied TEXT,

  status TEXT,
  funds_available TEXT,
  order_date TEXT,
  buyer TEXT,
  order_type TEXT,
  payment_type TEXT,
  refund_amount REAL,

  import_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (import_id) REFERENCES imports(id)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  sale_date TEXT,

  buyer_user_id TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  buyer TEXT,

  number_of_items INTEGER,
  payment_method TEXT,
  date_shipped TEXT,

  street_1 TEXT,
  street_2 TEXT,
  ship_city TEXT,
  ship_state TEXT,
  ship_zipcode TEXT,
  ship_country TEXT,

  currency TEXT,
  order_value REAL,
  coupon_code TEXT,
  coupon_details TEXT,
  discount_amount REAL,
  shipping_discount REAL,
  shipping REAL,
  sales_tax REAL,
  order_total REAL,

  status TEXT,
  card_processing_fees REAL,
  order_net REAL,
  adjusted_order_total REAL,
  adjusted_card_processing_fees REAL,
  adjusted_net_order_amount REAL,

  order_type TEXT,
  payment_type TEXT,
  inperson_discount REAL,
  inperson_location TEXT,
  sku TEXT,

  import_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (import_id) REFERENCES imports(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  transaction_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  listing_id TEXT,

  sale_date TEXT,
  item_name TEXT,
  buyer TEXT,
  quantity INTEGER,
  price REAL,

  coupon_code TEXT,
  coupon_details TEXT,
  discount_amount REAL,
  shipping_discount REAL,
  order_shipping REAL,
  order_sales_tax REAL,
  item_total REAL,
  currency TEXT,

  date_paid TEXT,
  date_shipped TEXT,

  ship_name TEXT,
  ship_address1 TEXT,
  ship_address2 TEXT,
  ship_city TEXT,
  ship_state TEXT,
  ship_zipcode TEXT,
  ship_country TEXT,

  variations TEXT,
  order_type TEXT,
  listings_type TEXT,
  payment_type TEXT,
  inperson_discount REAL,
  inperson_location TEXT,
  vat_paid_by_buyer REAL,
  sku TEXT,

  import_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(order_id),
  FOREIGN KEY (import_id) REFERENCES imports(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_date ON payments(order_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE INDEX IF NOT EXISTS idx_orders_sale_date ON orders(sale_date);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_user_id ON orders(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_ship_country ON orders(ship_country);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_listing_id ON order_items(listing_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sale_date ON order_items(sale_date);
CREATE INDEX IF NOT EXISTS idx_order_items_item_name ON order_items(item_name);

CREATE INDEX IF NOT EXISTS idx_imports_import_type ON imports(import_type);
CREATE INDEX IF NOT EXISTS idx_imports_imported_at ON imports(imported_at);