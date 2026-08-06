import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "../types";

class TestStatement implements D1PreparedStatement {
  #values: unknown[] = [];

  constructor(readonly statement: StatementSync) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.#values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.#values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { results: this.statement.all(...this.#values) as T[] };
  }

  async run(): Promise<D1Result> {
    const result = this.statement.run(...this.#values);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

export class FullSchemaTestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly preparedQueries: string[] = [];

  constructor() {
    const migrationsUrl = new URL("../../../../migrations/", import.meta.url);
    for (const filename of readdirSync(migrationsUrl).filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(new URL(filename, migrationsUrl), "utf8"));
    }
  }

  prepare(query: string): D1PreparedStatement {
    this.preparedQueries.push(query);
    return new TestStatement(this.sqlite.prepare(query));
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
