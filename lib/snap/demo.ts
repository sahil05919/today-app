import { pageFromText } from "./clean";
import type { ReadResult, SnapDeps } from "./run";

/**
 * Development only (loaded by App.tsx when the page is opened with ?snapdemo=…, and never in a production build): canned
 * "pictures" so the review sheet can be looked at in a desktop browser, where there is no phone to read a real one.
 *   ?snapdemo=ticket | gem | shifts | bill | chat | multi | none | error | sensitive
 */
const TEXTS: Record<string, string> = {
  ticket: "Order confirmation for Neon Nights Halloween Rave\nDate and time\nSat, 31 Oct 2026 · 9:00 PM – 3:00 AM GMT\nLocation\nThe Warehouse, 12 Dock Road\nLondon E16 1AB\nOrder #4567890123\nTotal £22.50",
  gem: "Your tickets\nArctic Monkeys\nO2 Arena, London\nSat 14 Nov 2026\nDoors 18:30  Start 19:30\nTotal £87.50",
  shifts: "King's Talent Bank\nWarehouse assistant shift\nSat 14 Nov 2026 09:00-17:00\n£12.50 per hour\nSteward shift\nSun 15 Nov 2026 10:00-16:00\n£12.50 per hour",
  bill: "Barclaycard\nStatement date 05 Oct 2026\nPayment due date 29 Oct 2026\nMinimum payment £25.00\nNew balance £1,245.67",
  chat: "party sat 8pm at mine\nkal 5 baje call karna",
  none: "Lorem ipsum dolor sit amet",
  sensitive: "Barclaycard\nPayment due date 29 Oct 2026\nNew balance £312.40\nSort code 20-45-45  Account number 12345678",
};

export const demoUris = (q: string): string[] => (q === "multi" ? ["demo:shifts", "demo:bill", "demo:chat"] : [`demo:${q in TEXTS || q === "error" ? q : "ticket"}`]);

export function demoDeps(): SnapDeps {
  return {
    async readImage(uri): Promise<ReadResult> {
      await new Promise((r) => setTimeout(r, 900));
      const key = uri.replace("demo:", "");
      if (key === "error") throw new Error("That picture is no longer there");
      return { ...pageFromText(TEXTS[key] ?? TEXTS.ticket), handle: `h-${key}`, takenAt: Date.now() };
    },
    getJpeg: async () => null,
    release: async () => undefined,
    // "gem": Gemini disagrees about the day, so the card shows the "check date" flag.
    ask: async (i) => {
      await new Promise((r) => setTimeout(r, 1200));
      const first = i.offline[0];
      if (!first || !first.date) return null;
      return { items: [{ type: first.type, title: first.title, date: "2026-11-21", start: first.start, location: first.location, amount: first.amount, conf: { title: 0.9, date: 0.95 } }] };
    },
    online: () => true,
    aiOn: () => new URLSearchParams(window.location.search).get("snapdemo") === "gem",
    neverImage: () => false,
    now: () => new Date(),
  };
}
