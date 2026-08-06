// In-memory D1 test harness for functions/api/imports tests. Runs the real
// migrations against node:sqlite so tests exercise actual SQL (CHECK
// constraints, partial unique indexes, FK columns) rather than a mocked
// query surface. Mirrors workers/etsy-sync/src/test/testD1.ts.
import { readFileSync, readdirSync } from "node:fs";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";

export type D1RunResult = { meta?: { last_row_id?: number; changes?: number } };
export type D1AllResult<T> = { results?: T[] };

export interface TestD1PreparedStatement {
  bind(...values: unknown[]): TestD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  run(): Promise<D1RunResult>;
}

class TestStatement implements TestD1PreparedStatement {
  #values: SQLInputValue[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]): TestD1PreparedStatement {
    this.#values = values as SQLInputValue[];
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.#values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<D1AllResult<T>> {
    return { results: this.statement.all(...this.#values) as T[] };
  }

  async run(): Promise<D1RunResult> {
    const result = this.statement.run(...this.#values);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    const migrationsUrl = new URL("../../../migrations/", import.meta.url);
    for (const filename of readdirSync(migrationsUrl).filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(new URL(filename, migrationsUrl), "utf8"));
    }
  }

  prepare(query: string): TestD1PreparedStatement {
    return new TestStatement(this.sqlite.prepare(query));
  }

  async batch(statements: TestD1PreparedStatement[]): Promise<D1RunResult[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1RunResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

// Lets tests deterministically simulate a slow/delayed background write
// instead of relying on incidental microtask timing.
export class DeferredGate {
  #resolve: (() => void) | null = null;
  #promise: Promise<void> = Promise.resolve();

  hold(): void {
    this.#promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  release(): void {
    this.#resolve?.();
    this.#resolve = null;
  }

  wait(): Promise<void> {
    return this.#promise;
  }
}

export class GatedTestD1 {
  constructor(
    private readonly inner: TestD1,
    private readonly gate: DeferredGate,
  ) {}

  prepare(query: string): TestD1PreparedStatement {
    return this.inner.prepare(query);
  }

  async batch(statements: TestD1PreparedStatement[]): Promise<D1RunResult[]> {
    await this.gate.wait();
    return this.inner.batch(statements);
  }
}

export function collectWaitUntil() {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task);
    },
    flush: () => Promise.all(tasks),
  };
}
