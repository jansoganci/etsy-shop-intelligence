import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { D1Database, D1PreparedStatement } from "./_summary";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations", import.meta.url));

class TestStatement implements D1PreparedStatement {
  #values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.#values = values;
    return this;
  }

  first<T>(): Promise<T | null> {
    // node:sqlite's SQLInputValue type doesn't cover the generic `unknown[]`
    // the D1PreparedStatement interface allows; the values passed through
    // bind() are always plain SQL-compatible scalars at runtime.
    return Promise.resolve(
      (this.statement.get(...(this.#values as never[])) as T | undefined) ?? null,
    );
  }

  all<T>(): Promise<{ results?: T[] }> {
    return Promise.resolve({ results: this.statement.all(...(this.#values as never[])) as T[] });
  }
}

/**
 * A real SQLite database (node:sqlite) with every migration applied, so
 * tests run the actual canonical views (v_orders_canonical, v_payments_canonical,
 * etc.) instead of a hand-rolled stand-in that could drift from production.
 */
export class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");
      this.sqlite.exec(sql);
    }
  }

  prepare(query: string): D1PreparedStatement {
    return new TestStatement(this.sqlite.prepare(query));
  }

  exec(sql: string): void {
    this.sqlite.exec(sql);
  }
}

export type TestOrderRow = {
  order_id: string;
  sale_date: string;
  ship_country?: string | null;
  ship_city?: string | null;
  currency?: string | null;
  order_value?: number | null;
  discount_amount?: number | null;
  coupon_code?: string | null;
  status?: string | null;
  number_of_items?: number | null;
};

export type TestPaymentRow = {
  payment_id: string;
  order_id: string;
  order_date: string;
  gross_amount?: number | null;
  fees?: number | null;
  net_amount?: number | null;
  currency?: string | null;
  listing_currency?: string | null;
  exchange_rate?: number | null;
  status?: string | null;
};

export function insertOrder(db: TestD1, row: TestOrderRow): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO orders (
          order_id, sale_date, ship_country, ship_city, currency,
          order_value, discount_amount, coupon_code, status, number_of_items
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      row.order_id,
      row.sale_date,
      row.ship_country ?? null,
      row.ship_city ?? null,
      row.currency === undefined ? "USD" : row.currency,
      row.order_value === undefined ? null : row.order_value,
      row.discount_amount === undefined ? null : row.discount_amount,
      row.coupon_code ?? null,
      row.status ?? "Completed",
      row.number_of_items ?? 1,
    );
}

export type TestOrderItemRow = {
  transaction_id: string;
  order_id: string;
  listing_id?: string | null;
  listing_title?: string | null;
  sale_date: string;
  quantity?: number | null;
  item_total?: number | null;
  discount_amount?: number | null;
  currency?: string | null;
  ship_country?: string | null;
  ship_city?: string | null;
  coupon_code?: string | null;
};

export function insertOrderItem(db: TestD1, row: TestOrderItemRow): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO order_items (
          transaction_id, order_id, listing_id, item_name, sale_date, quantity,
          item_total, discount_amount, currency, ship_country, ship_city, coupon_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      row.transaction_id,
      row.order_id,
      row.listing_id ?? null,
      row.listing_title ?? null,
      row.sale_date,
      row.quantity ?? 1,
      row.item_total === undefined ? null : row.item_total,
      row.discount_amount === undefined ? null : row.discount_amount,
      row.currency === undefined ? "USD" : row.currency,
      row.ship_country ?? null,
      row.ship_city ?? null,
      row.coupon_code ?? null,
    );
}

export function insertPayment(db: TestD1, row: TestPaymentRow): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO payments (
          payment_id, order_id, order_date, gross_amount, fees, net_amount,
          currency, listing_currency, exchange_rate, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      row.payment_id,
      row.order_id,
      row.order_date,
      row.gross_amount ?? null,
      row.fees ?? null,
      row.net_amount ?? null,
      row.currency ?? "USD",
      row.listing_currency ?? "USD",
      row.exchange_rate ?? null,
      row.status ?? "completed",
    );
}
