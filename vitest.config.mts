import { defineConfig } from "vitest/config";

// The app's clock is London time. Tests pin it, so "11:00 stays 11:00" across the 25 Oct 2026 clock change is real.
process.env.TZ = "Europe/London";

export default defineConfig({
  // The phrase-dictionary test is heavy (about 6 s when 30+ test files run at once), so the default 5 s is too tight.
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000 },
});
