import { defineConfig } from "vitest/config";

// The app's clock is London time. Tests pin it, so "11:00 stays 11:00" across the 25 Oct 2026 clock change is real.
process.env.TZ = "Europe/London";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
