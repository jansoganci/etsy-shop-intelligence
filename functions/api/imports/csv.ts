type CsvType = "payments" | "orders" | "order_items";

type DeclaredCsvType =
  | CsvType
  | "direct_checkout_payments"
  | "sold_orders"
  | "sold_order_items";

type ColumnKind = "text" | "number" | "integer";

type ColumnMapping = {
  db: string;
  csv: string;
  kind: ColumnKind;
};

// Import count semantics (Phase 2):
// - insertedCount: new rows written to source tables
// - skippedCount: duplicate natural key, duplicate file, missing required key, or missing parent order
// - replacedCount: reserved for a future explicit overwrite mode; always 0 today
// - errorCount: unexpected processing failures only (not expected skips)
type ImportStats = {
  insertedCount: number;
  replacedCount: number;
  skippedCount: number;
  errorCount: number;
  missingParentOrderCount?: number;
};

type DuplicateImportRow = {
  id: number;
};

type LastInsertRow = {
  id: number | null;
};

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
};

interface D1Database {
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
}

const SIGNATURES: Record<CsvType, string[]> = {
  payments: ["Payment ID", "Gross Amount", "Fees", "Net Amount", "Order Date"],
  orders: [
    "Order ID",
    "Sale Date",
    "Order Value",
    "Card Processing Fees",
    "Order Net",
  ],
  order_items: [
    "Transaction ID",
    "Item Name",
    "Listing ID",
    "Item Total",
    "Date Paid",
  ],
};

const PAYMENT_COLUMNS: ColumnMapping[] = [
  { db: "payment_id", csv: "Payment ID", kind: "text" },
  { db: "buyer_username", csv: "Buyer Username", kind: "text" },
  { db: "buyer_name", csv: "Buyer Name", kind: "text" },
  { db: "order_id", csv: "Order ID", kind: "text" },
  { db: "gross_amount", csv: "Gross Amount", kind: "number" },
  { db: "fees", csv: "Fees", kind: "number" },
  { db: "net_amount", csv: "Net Amount", kind: "number" },
  { db: "posted_gross", csv: "Posted Gross", kind: "number" },
  { db: "posted_fees", csv: "Posted Fees", kind: "number" },
  { db: "posted_net", csv: "Posted Net", kind: "number" },
  { db: "adjusted_gross", csv: "Adjusted Gross", kind: "number" },
  { db: "adjusted_fees", csv: "Adjusted Fees", kind: "number" },
  { db: "adjusted_net", csv: "Adjusted Net", kind: "number" },
  { db: "currency", csv: "Currency", kind: "text" },
  { db: "listing_amount", csv: "Listing Amount", kind: "number" },
  { db: "listing_currency", csv: "Listing Currency", kind: "text" },
  { db: "exchange_rate", csv: "Exchange Rate", kind: "number" },
  { db: "vat_amount", csv: "VAT Amount", kind: "number" },
  { db: "gift_card_applied", csv: "Gift Card Applied?", kind: "text" },
  { db: "status", csv: "Status", kind: "text" },
  { db: "funds_available", csv: "Funds Available", kind: "text" },
  { db: "order_date", csv: "Order Date", kind: "text" },
  { db: "buyer", csv: "Buyer", kind: "text" },
  { db: "order_type", csv: "Order Type", kind: "text" },
  { db: "payment_type", csv: "Payment Type", kind: "text" },
  { db: "refund_amount", csv: "Refund Amount", kind: "number" },
];

const ORDER_COLUMNS: ColumnMapping[] = [
  { db: "order_id", csv: "Order ID", kind: "text" },
  { db: "sale_date", csv: "Sale Date", kind: "text" },
  { db: "buyer_user_id", csv: "Buyer User ID", kind: "text" },
  { db: "full_name", csv: "Full Name", kind: "text" },
  { db: "first_name", csv: "First Name", kind: "text" },
  { db: "last_name", csv: "Last Name", kind: "text" },
  { db: "buyer", csv: "Buyer", kind: "text" },
  { db: "number_of_items", csv: "Number of Items", kind: "integer" },
  { db: "payment_method", csv: "Payment Method", kind: "text" },
  { db: "date_shipped", csv: "Date Shipped", kind: "text" },
  { db: "street_1", csv: "Street 1", kind: "text" },
  { db: "street_2", csv: "Street 2", kind: "text" },
  { db: "ship_city", csv: "Ship City", kind: "text" },
  { db: "ship_state", csv: "Ship State", kind: "text" },
  { db: "ship_zipcode", csv: "Ship Zipcode", kind: "text" },
  { db: "ship_country", csv: "Ship Country", kind: "text" },
  { db: "currency", csv: "Currency", kind: "text" },
  { db: "order_value", csv: "Order Value", kind: "number" },
  { db: "coupon_code", csv: "Coupon Code", kind: "text" },
  { db: "coupon_details", csv: "Coupon Details", kind: "text" },
  { db: "discount_amount", csv: "Discount Amount", kind: "number" },
  { db: "shipping_discount", csv: "Shipping Discount", kind: "number" },
  { db: "shipping", csv: "Shipping", kind: "number" },
  { db: "sales_tax", csv: "Sales Tax", kind: "number" },
  { db: "order_total", csv: "Order Total", kind: "number" },
  { db: "status", csv: "Status", kind: "text" },
  { db: "card_processing_fees", csv: "Card Processing Fees", kind: "number" },
  { db: "order_net", csv: "Order Net", kind: "number" },
  { db: "adjusted_order_total", csv: "Adjusted Order Total", kind: "number" },
  {
    db: "adjusted_card_processing_fees",
    csv: "Adjusted Card Processing Fees",
    kind: "number",
  },
  {
    db: "adjusted_net_order_amount",
    csv: "Adjusted Net Order Amount",
    kind: "number",
  },
  { db: "order_type", csv: "Order Type", kind: "text" },
  { db: "payment_type", csv: "Payment Type", kind: "text" },
  { db: "inperson_discount", csv: "InPerson Discount", kind: "number" },
  { db: "inperson_location", csv: "InPerson Location", kind: "text" },
  { db: "sku", csv: "SKU", kind: "text" },
];

const ORDER_ITEM_COLUMNS: ColumnMapping[] = [
  { db: "transaction_id", csv: "Transaction ID", kind: "text" },
  { db: "order_id", csv: "Order ID", kind: "text" },
  { db: "listing_id", csv: "Listing ID", kind: "text" },
  { db: "sale_date", csv: "Sale Date", kind: "text" },
  { db: "item_name", csv: "Item Name", kind: "text" },
  { db: "buyer", csv: "Buyer", kind: "text" },
  { db: "quantity", csv: "Quantity", kind: "integer" },
  { db: "price", csv: "Price", kind: "number" },
  { db: "coupon_code", csv: "Coupon Code", kind: "text" },
  { db: "coupon_details", csv: "Coupon Details", kind: "text" },
  { db: "discount_amount", csv: "Discount Amount", kind: "number" },
  { db: "shipping_discount", csv: "Shipping Discount", kind: "number" },
  { db: "order_shipping", csv: "Order Shipping", kind: "number" },
  { db: "order_sales_tax", csv: "Order Sales Tax", kind: "number" },
  { db: "item_total", csv: "Item Total", kind: "number" },
  { db: "currency", csv: "Currency", kind: "text" },
  { db: "date_paid", csv: "Date Paid", kind: "text" },
  { db: "date_shipped", csv: "Date Shipped", kind: "text" },
  { db: "ship_name", csv: "Ship Name", kind: "text" },
  { db: "ship_address1", csv: "Ship Address1", kind: "text" },
  { db: "ship_address2", csv: "Ship Address2", kind: "text" },
  { db: "ship_city", csv: "Ship City", kind: "text" },
  { db: "ship_state", csv: "Ship State", kind: "text" },
  { db: "ship_zipcode", csv: "Ship Zipcode", kind: "text" },
  { db: "ship_country", csv: "Ship Country", kind: "text" },
  { db: "variations", csv: "Variations", kind: "text" },
  { db: "order_type", csv: "Order Type", kind: "text" },
  { db: "listings_type", csv: "Listings Type", kind: "text" },
  { db: "payment_type", csv: "Payment Type", kind: "text" },
  { db: "inperson_discount", csv: "InPerson Discount", kind: "number" },
  { db: "inperson_location", csv: "InPerson Location", kind: "text" },
  { db: "vat_paid_by_buyer", csv: "VAT Paid by Buyer", kind: "number" },
  { db: "sku", csv: "SKU", kind: "text" },
];

const TABLE_CONFIG: Record<
  CsvType,
  { table: string; columns: ColumnMapping[]; keyColumn: string; keyHeader: string }
> = {
  payments: {
    table: "payments",
    columns: PAYMENT_COLUMNS,
    keyColumn: "payment_id",
    keyHeader: "Payment ID",
  },
  orders: {
    table: "orders",
    columns: ORDER_COLUMNS,
    keyColumn: "order_id",
    keyHeader: "Order ID",
  },
  order_items: {
    table: "order_items",
    columns: ORDER_ITEM_COLUMNS,
    keyColumn: "transaction_id",
    keyHeader: "Transaction ID",
  },
};

function normalizeHeader(header: string): string {
  return header.trim().replace(/^"|"$/g, "").trim().toLowerCase();
}

function normalizeTypeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/-]+/g, "_");
}

function normalizeDeclaredType(value: FormDataEntryValue | null): CsvType | null {
  if (typeof value !== "string") {
    return null;
  }

  switch (normalizeTypeName(value)) {
    case "payments":
    case "direct_checkout_payments":
      return "payments";
    case "orders":
    case "sold_orders":
      return "orders";
    case "order_items":
    case "sold_order_items":
      return "order_items";
    default:
      return null;
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && next === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      i += 1;
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function cleanHeader(header: string): string {
  return header.trim().replace(/^"|"$/g, "").trim();
}

function parseCsvData(text: string): {
  headers: string[];
  dataRows: string[][];
  rowCount: number;
} {
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return { headers: [], dataRows: [], rowCount: 0 };
  }

  const headers = rows[0].map(cleanHeader);
  const dataRows = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""));

  return { headers, dataRows, rowCount: dataRows.length };
}

function buildHeaderIndex(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((header, i) => {
    index.set(normalizeHeader(header), i);
  });
  return index;
}

function getCell(
  row: string[],
  headerIndex: Map<string, number>,
  csvHeader: string,
): string {
  const idx = headerIndex.get(normalizeHeader(csvHeader));
  if (idx === undefined) {
    return "";
  }
  return row[idx] ?? "";
}

type CsvDateRange = { start: string | null; end: string | null };

// Display-only: which already-mapped column represents "when this row happened"
// for each report type. Does not affect column mapping or financial values.
const DATE_RANGE_HEADER: Record<CsvType, string> = {
  payments: "Order Date",
  orders: "Sale Date",
  order_items: "Sale Date",
};

function normalizeDateForRange(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }

  const mdyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyyyy) {
    const [, month, day, year] = mdyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const mdyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyy) {
    const [, month, day, year] = mdyy;
    return `20${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

function computeDateRange(
  detectedType: CsvType,
  dataRows: string[][],
  headerIndex: Map<string, number>,
): CsvDateRange {
  const header = DATE_RANGE_HEADER[detectedType];
  let start: string | null = null;
  let end: string | null = null;

  for (const row of dataRows) {
    const normalized = normalizeDateForRange(getCell(row, headerIndex, header));
    if (!normalized) {
      continue;
    }
    if (start === null || normalized < start) {
      start = normalized;
    }
    if (end === null || normalized > end) {
      end = normalized;
    }
  }

  return { start, end };
}

function coerceValue(raw: string, kind: ColumnKind): string | number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }

  if (kind === "text") {
    return trimmed;
  }

  if (kind === "integer") {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(trimmed.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAllSignatures(headers: string[], required: string[]): boolean {
  const normalized = new Set(headers.map(normalizeHeader));
  return required.every((sig) => normalized.has(normalizeHeader(sig)));
}

function detectCsvType(headers: string[]): CsvType | null {
  for (const type of Object.keys(SIGNATURES) as CsvType[]) {
    if (hasAllSignatures(headers, SIGNATURES[type])) {
      return type;
    }
  }
  return null;
}

const LOOKUP_CHUNK_SIZE = 100;
const WRITE_BATCH_SIZE = 50;

const MISSING_PARENT_ORDERS_MESSAGE =
  "Sold Order Items require matching Sold Orders. Import Sold Orders first.";

function buildInsertSql(table: string, columns: ColumnMapping[]): string {
  // INSERT only. Existing natural keys are skipped before write — never INSERT OR REPLACE.
  const dbColumns = [...columns.map((col) => col.db), "import_id", "updated_at"];
  const placeholders = [...columns.map(() => "?"), "?", "CURRENT_TIMESTAMP"];
  return `INSERT INTO ${table} (${dbColumns.join(", ")}) VALUES (${placeholders.join(", ")})`;
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function formatD1ErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/^D1_ERROR:\s*/i, "").trim();

  if (/FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/i.test(normalized)) {
    return MISSING_PARENT_ORDERS_MESSAGE;
  }

  if (/too many SQL variables/i.test(normalized)) {
    return "Database import failed due to query size limits.";
  }

  if (/UNIQUE constraint failed.*file_hash/i.test(normalized)) {
    return "This file is already being imported. Wait for it to finish before retrying.";
  }

  if (/Failed to parse body as JSON|internal error/i.test(normalized)) {
    return "Database import failed. Check that required parent data exists and retry.";
  }

  return normalized || "Unknown import error";
}

async function loadExistingKeys(
  db: D1Database,
  table: string,
  keyColumn: string,
  keys: string[],
): Promise<Set<string>> {
  const uniqueKeys = [...new Set(keys.filter((key) => key.trim() !== ""))];
  const found = new Set<string>();

  for (const chunk of chunkValues(uniqueKeys, LOOKUP_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT ${keyColumn} AS keyValue FROM ${table} WHERE ${keyColumn} IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ keyValue: string }>();

    for (const row of result.results ?? []) {
      found.add(row.keyValue);
    }
  }

  return found;
}

async function executeBatchedInserts(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  for (const chunk of chunkValues(statements, WRITE_BATCH_SIZE)) {
    await db.batch(chunk);
  }
}

type ImportRowCandidate = {
  row: string[];
  keyValue: string;
  orderId?: string;
};

async function hashCsvContent(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createImport(
  db: D1Database,
  params: {
    importType: CsvType;
    declaredType: CsvType | null;
    detectedType: CsvType;
    fileName: string | null;
    fileHash: string;
    rowCount: number;
  },
): Promise<number> {
  await db
    .prepare(
      `
        INSERT INTO imports (
          import_type,
          file_name,
          file_hash,
          row_count,
          declared_type,
          detected_type,
          inserted_count,
          replaced_count,
          skipped_count,
          error_count,
          status,
          started_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'pending', CURRENT_TIMESTAMP)
      `,
    )
    .bind(
      params.importType,
      params.fileName,
      params.fileHash,
      params.rowCount,
      params.declaredType,
      params.detectedType,
    )
    .run();

  const insertedRow = await db
    .prepare("SELECT last_insert_rowid() AS id")
    .first<LastInsertRow>();

  const importId = insertedRow?.id ?? null;
  if (!importId) {
    throw new Error("Failed to create import record");
  }

  return importId;
}

async function markImportCompleted(
  db: D1Database,
  importId: number,
  stats: ImportStats,
  dateRange: CsvDateRange,
) {
  await db.batch([
    db
      .prepare(
        `
          UPDATE imports
          SET
            inserted_count = ?,
            replaced_count = ?,
            skipped_count = ?,
            error_count = ?,
            status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            failed_at = NULL,
            failure_reason = NULL,
            error_message = NULL,
            date_range_start = ?,
            date_range_end = ?
          WHERE id = ?
        `,
      )
      .bind(
        stats.insertedCount,
        stats.replacedCount,
        stats.skippedCount,
        stats.errorCount,
        dateRange.start,
        dateRange.end,
        importId,
      ),
    // Reuse the latest completed Etsy generation, but recalculate its cached
    // comparison because the CSV side of reconciliation just changed.
    db.prepare(
      `
        UPDATE etsy_reconciliation_generations SET
          status='queued', result_json=NULL, calculated_at=NULL,
          error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=(
          SELECT id FROM etsy_reconciliation_generations
          WHERE status='completed' ORDER BY calculated_at DESC LIMIT 1
        )
      `,
    ),
  ]);
}

async function markImportDuplicateSkipped(
  db: D1Database,
  importId: number,
  rowCount: number,
  message: string,
) {
  await db
    .prepare(
      `
        UPDATE imports
        SET
          inserted_count = 0,
          replaced_count = 0,
          skipped_count = ?,
          error_count = 0,
          status = 'partial',
          completed_at = CURRENT_TIMESTAMP,
          failed_at = NULL,
          failure_reason = ?,
          error_message = ?
        WHERE id = ?
      `,
    )
    .bind(rowCount, message, message, importId)
    .run();
}

async function markImportFailed(
  db: D1Database,
  importId: number,
  stats: ImportStats,
  errorMessage: string,
) {
  await db
    .prepare(
      `
        UPDATE imports
        SET
          inserted_count = ?,
          replaced_count = ?,
          skipped_count = ?,
          error_count = ?,
          status = 'failed',
          failed_at = CURRENT_TIMESTAMP,
          failure_reason = ?,
          error_message = ?
        WHERE id = ?
      `,
    )
    .bind(
      stats.insertedCount,
      stats.replacedCount,
      stats.skippedCount,
      stats.errorCount,
      errorMessage,
      errorMessage,
      importId,
    )
    .run();
}

async function markImportStage(
  db: D1Database,
  importId: number,
  stage: "importing" | "processing",
): Promise<void> {
  await db.prepare(`UPDATE imports SET status = ? WHERE id = ?`).bind(stage, importId).run();
}

async function findInProgressDuplicateImport(
  db: D1Database,
  importType: CsvType,
  fileHash: string,
): Promise<number | null> {
  const existing = await db
    .prepare(
      `
        SELECT id
        FROM imports
        WHERE import_type = ?
          AND file_hash = ?
          AND status IN ('pending', 'importing', 'processing')
        ORDER BY id DESC
        LIMIT 1
      `,
    )
    .bind(importType, fileHash)
    .first<DuplicateImportRow>();

  return existing?.id ?? null;
}

async function findCompletedDuplicateImport(
  db: D1Database,
  importType: CsvType,
  fileHash: string,
): Promise<number | null> {
  const existing = await db
    .prepare(
      `
        SELECT id
        FROM imports
        WHERE import_type = ?
          AND file_hash = ?
          AND status = 'completed'
        ORDER BY id DESC
        LIMIT 1
      `,
    )
    .bind(importType, fileHash)
    .first<DuplicateImportRow>();

  return existing?.id ?? null;
}

async function insertCsvRows(
  db: D1Database,
  detectedType: CsvType,
  dataRows: string[][],
  headerIndex: Map<string, number>,
  importId: number,
): Promise<ImportStats> {
  const { table, columns, keyColumn, keyHeader } = TABLE_CONFIG[detectedType];
  const sql = buildInsertSql(table, columns);
  const stats: ImportStats = {
    insertedCount: 0,
    replacedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    missingParentOrderCount: 0,
  };

  const candidates: ImportRowCandidate[] = [];

  for (const row of dataRows) {
    const keyValue = getCell(row, headerIndex, keyHeader).trim();

    if (keyValue === "") {
      stats.skippedCount += 1;
      continue;
    }

    if (detectedType === "order_items") {
      const orderId = getCell(row, headerIndex, "Order ID").trim();
      if (orderId === "") {
        stats.skippedCount += 1;
        continue;
      }
      candidates.push({ row, keyValue, orderId });
      continue;
    }

    candidates.push({ row, keyValue });
  }

  const existingKeys = await loadExistingKeys(
    db,
    table,
    keyColumn,
    candidates.map((candidate) => candidate.keyValue),
  );

  let existingParentOrderIds: Set<string> | null = null;
  if (detectedType === "order_items") {
    existingParentOrderIds = await loadExistingKeys(
      db,
      "orders",
      "order_id",
      candidates.map((candidate) => candidate.orderId ?? ""),
    );
  }

  const statements: D1PreparedStatement[] = [];

  for (const candidate of candidates) {
    if (
      detectedType === "order_items" &&
      candidate.orderId &&
      existingParentOrderIds &&
      !existingParentOrderIds.has(candidate.orderId)
    ) {
      stats.skippedCount += 1;
      stats.missingParentOrderCount = (stats.missingParentOrderCount ?? 0) + 1;
      continue;
    }

    if (existingKeys.has(candidate.keyValue)) {
      stats.skippedCount += 1;
      continue;
    }

    const values = columns.map((col) =>
      coerceValue(getCell(candidate.row, headerIndex, col.csv), col.kind),
    );
    statements.push(db.prepare(sql).bind(...values, importId));
    stats.insertedCount += 1;
  }

  if (statements.length > 0) {
    await executeBatchedInserts(db, statements);
  }

  return stats;
}

// Runs after the client already has a response (importId + status "pending").
// Performs the actual dedupe lookups, batched inserts, and cache invalidation,
// advancing imports.status through 'importing' -> 'processing' -> a terminal
// state. The GET /api/imports/:id endpoint is the only way the client learns
// the outcome from here on.
async function runImportInBackground(
  db: D1Database,
  params: {
    importId: number;
    detectedType: CsvType;
    dataRows: string[][];
    headerIndex: Map<string, number>;
  },
): Promise<void> {
  const { importId, detectedType, dataRows, headerIndex } = params;
  const emptyStats: ImportStats = {
    insertedCount: 0,
    replacedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  try {
    await markImportStage(db, importId, "importing");

    const stats = await insertCsvRows(db, detectedType, dataRows, headerIndex, importId);

    if (
      detectedType === "order_items" &&
      stats.insertedCount === 0 &&
      stats.replacedCount === 0 &&
      (stats.missingParentOrderCount ?? 0) > 0 &&
      (stats.missingParentOrderCount ?? 0) === stats.skippedCount
    ) {
      await markImportFailed(db, importId, stats, MISSING_PARENT_ORDERS_MESSAGE);
      return;
    }

    await markImportStage(db, importId, "processing");
    const dateRange = computeDateRange(detectedType, dataRows, headerIndex);
    await markImportCompleted(db, importId, stats, dateRange);
  } catch (error) {
    const errorMessage = formatD1ErrorMessage(error);
    try {
      await markImportFailed(db, importId, emptyStats, errorMessage);
    } catch {
      // Best effort: if even the failure write fails, the row is left in its
      // last known non-terminal stage rather than throwing from a background
      // task with no caller left to observe it.
    }
  }
}

export async function onRequestPost({
  request,
  env,
  waitUntil,
}: {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file");
  const declaredType = normalizeDeclaredType(formData.get("declaredType"));

  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "missing_file" }, { status: 400 });
  }

  const text = await file.text();
  const { headers, dataRows, rowCount } = parseCsvData(text);
  const detectedType = detectCsvType(headers);

  if (!detectedType) {
    return Response.json(
      { ok: false, error: "unknown_csv_type", headers },
      { status: 400 },
    );
  }

  if (declaredType && declaredType !== detectedType) {
    return Response.json(
      {
        ok: false,
        error: "declared_type_mismatch",
        message: `Selected report type does not match the uploaded CSV. Declared ${declaredType}, detected ${detectedType}.`,
        declaredType,
        detectedType,
        headers,
      },
      { status: 400 },
    );
  }

  const fileHash = await hashCsvContent(text);
  const headerIndex = buildHeaderIndex(headers);
  const fileName = file.name || null;
  const emptyStats: ImportStats = {
    insertedCount: 0,
    replacedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  const inProgressDuplicateId = await findInProgressDuplicateImport(env.DB, detectedType, fileHash);
  if (inProgressDuplicateId) {
    return Response.json(
      {
        ok: false,
        error: "import_in_progress",
        message: `This file is already being imported (import #${inProgressDuplicateId}). Wait for it to finish before retrying.`,
        importId: inProgressDuplicateId,
      },
      { status: 409 },
    );
  }

  const duplicateImportId = await findCompletedDuplicateImport(env.DB, detectedType, fileHash);
  let importId = 0;

  try {
    importId = await createImport(env.DB, {
      importType: detectedType,
      declaredType,
      detectedType,
      fileName,
      fileHash,
      rowCount,
    });

    if (duplicateImportId) {
      const message = `This CSV file was already imported successfully as import #${duplicateImportId}.`;
      await markImportDuplicateSkipped(env.DB, importId, rowCount, message);

      return Response.json({
        ok: true,
        detectedType,
        declaredType,
        rowCount,
        insertedCount: 0,
        replacedCount: 0,
        skippedCount: rowCount,
        errorCount: 0,
        importId,
        duplicateFile: true,
        status: "duplicate_skipped",
        message,
        headers,
      });
    }

    await env.DB.prepare(
      `
        UPDATE etsy_financial_cutover_settings SET
          orders_api_first=CASE WHEN ? IN ('orders','order_items') THEN 0 ELSE orders_api_first END,
          payments_api_first=CASE WHEN ?='payments' THEN 0 ELSE payments_api_first END,
          updated_at=CURRENT_TIMESTAMP
      `,
    ).bind(detectedType, detectedType).run();

    // The response is returned before rows are actually written. The client
    // learns the outcome by polling GET /api/imports/:id.
    waitUntil(runImportInBackground(env.DB, { importId, detectedType, dataRows, headerIndex }));

    return Response.json(
      {
        ok: true,
        detectedType,
        declaredType,
        rowCount,
        importId,
        duplicateFile: false,
        status: "pending",
        headers,
      },
      { status: 202 },
    );
  } catch (error) {
    const errorMessage = formatD1ErrorMessage(error);

    if (importId > 0) {
      try {
        await markImportFailed(env.DB, importId, emptyStats, errorMessage);
      } catch {
        return Response.json(
          {
            ok: false,
            error: "import_failed",
            message: errorMessage,
            importId,
          },
          { status: 500 },
        );
      }
    }

    return Response.json(
      {
        ok: false,
        error: "import_failed",
        message: errorMessage,
        importId: importId > 0 ? importId : undefined,
      },
      { status: 500 },
    );
  }
}
