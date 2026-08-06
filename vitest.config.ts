import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["functions/**/*.test.ts", "workers/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
