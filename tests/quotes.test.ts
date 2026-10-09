import { describe, expect, it } from "vitest";
import { QUOTES_EN } from "../lib/quotes/en";
import { QUOTES_HI } from "../lib/quotes/hi";
import { MOODS } from "../lib/quotes/types";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

describe("quote library", () => {
  for (const [name, list] of [["English", QUOTES_EN], ["Hinglish", QUOTES_HI]] as const) {
    it(`${name}: counts`, () => {
      console.log(name, list.length, Object.fromEntries(MOODS.map((m) => [m, list.filter((q) => q.mood === m).length])));
      expect(list.length).toBeGreaterThanOrEqual(1000);
    });
    it(`${name}: no duplicates`, () => {
      const seen = new Map<string, string>();
      const dupes: string[] = [];
      for (const q of list) {
        const k = norm(q.text);
        if (seen.has(k)) dupes.push(`${q.id} = ${seen.get(k)}: ${q.text}`);
        seen.set(k, q.id);
      }
      expect(dupes).toEqual([]);
    });
    it(`${name}: ids unique, text length <= 220, every mood present`, () => {
      expect(new Set(list.map((q) => q.id)).size).toBe(list.length);
      const long = list.filter((q) => q.text.length > 220 || q.text.length < 8).map((q) => q.id);
      expect(long).toEqual([]);
      for (const m of MOODS) expect(list.filter((q) => q.mood === m).length).toBeGreaterThan(20);
    });
  }
});
