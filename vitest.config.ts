// Dedicated Vitest config — deliberately NOT reusing vite.config.ts, which wraps
// @lovable.dev/vite-tanstack-config (TanStack Start + nitro SSR). Those plugins assume a server
// build and break under the jsdom unit-test runner, so the test harness gets a minimal, isolated
// pipeline: React JSX transform + the project's tsconfig `@/*` path alias.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
