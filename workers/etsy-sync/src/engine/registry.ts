import type { EtsyResourceAdapter } from "./types";

export class AdapterRegistry {
  readonly #adapters = new Map<string, EtsyResourceAdapter>();

  register(adapter: EtsyResourceAdapter): this {
    if (this.#adapters.has(adapter.resource)) {
      throw new Error(`duplicate_adapter:${adapter.resource}`);
    }
    this.#adapters.set(adapter.resource, adapter);
    return this;
  }

  get(resource: string): EtsyResourceAdapter {
    const adapter = this.#adapters.get(resource);
    if (!adapter) throw new Error(`adapter_not_registered:${resource}`);
    return adapter;
  }

  has(resource: string): boolean {
    return this.#adapters.has(resource);
  }

  resources(): string[] {
    return [...this.#adapters.keys()];
  }
}
