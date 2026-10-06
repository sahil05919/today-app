import type { ParsedCapture } from "./parse";
import type { LearnedRule } from "./types";

/**
 * Learning from your fixes. When you change a task's category or time, the app remembers it:
 * the meaningful words of that title (say "starred" and "email") are linked to the area and/or time you chose.
 * Next time a title contains all those words it gets the same treatment, offline or online, and it beats
 * both the built-in rules and Gemini's guess. Something you type yourself (@area, "6pm") always wins.
 */
const STOP = new Set(
  (
    "a an the to for of and or in on at by with from my me i we you it is are was be do does did please pls " +
    "need needs want remind reminder today tomorrow tonight later now this that these those some any " +
    "ko ka ki ke se me mein hai hain tha thi hona karna kar karo kro lena lana dena aur ya bhi ek " +
    "ko को का की के से में है हैं और या भी"
  ).split(" "),
);

const MAX_RULES = 200;

/** The meaningful words of a title: lowercase, no filler, at most five. */
export function significantWords(title: string): string[] {
  const words = (title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((x) => x.length >= 2 && !STOP.has(x) && !/^\d+$/.test(x));
  return [...new Set(words)].slice(0, 5);
}

/** "emails" and "email" are the same word for matching. */
const stem = (w: string) => w.slice(0, 5);

const sameWords = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.some((x) => stem(x) === stem(w)));

export function learnFix(
  rules: LearnedRule[] | undefined,
  title: string,
  fix: { areaId?: string; time?: string },
  now = Date.now(),
): LearnedRule[] {
  const words = significantWords(title);
  if (!words.length || (!fix.areaId && !fix.time)) return rules ?? [];
  const list = [...(rules ?? [])];
  const i = list.findIndex((r) => sameWords(r.words, words));
  if (i >= 0) {
    list[i] = { ...list[i], ...(fix.areaId ? { areaId: fix.areaId } : {}), ...(fix.time ? { time: fix.time } : {}), hits: list[i].hits + 1, at: now };
  } else {
    list.push({ id: `l-${now.toString(36)}-${list.length}`, words, ...fix, hits: 1, at: now });
  }
  return list.sort((a, b) => b.at - a.at).slice(0, MAX_RULES);
}

/**
 * The most specific remembered fix that fits this title, or null.
 * A rule fits when most of its words are in the title (two of three, four of five…), so a fix you made for
 * "reply starred email" also catches "check starred emails", but a rule for "email landlord" doesn't catch "email Sam".
 */
export function matchLearned(rules: LearnedRule[] | undefined, title: string): LearnedRule | null {
  if (!rules?.length) return null;
  const have = significantWords(title).map(stem);
  let best: { rule: LearnedRule; hit: number; ratio: number } | null = null;
  for (const r of rules) {
    if (!r.words.length) continue;
    const hit = r.words.filter((w) => have.includes(stem(w))).length;
    const ratio = hit / r.words.length;
    if (hit === 0 || ratio < 0.66) continue;
    if (!best || hit > best.hit || (hit === best.hit && (ratio > best.ratio || (ratio === best.ratio && r.at > best.rule.at)))) best = { rule: r, hit, ratio };
  }
  return best?.rule ?? null;
}

export function applyLearned(p: ParsedCapture, rules: LearnedRule[] | undefined): ParsedCapture {
  if (p.kind && p.kind !== "task" && p.kind !== "event") return p;
  const r = matchLearned(rules, p.title);
  if (!r) return p;
  const out = { ...p };
  if (r.areaId && p.areaSource !== "explicit") {
    out.area = r.areaId;
    out.areaSource = "learned";
  }
  // A time you typed always wins; a learned time beats a guessed one.
  if (r.time && p.kind !== "event" && p.timeSource !== "typed") {
    out.dueTime = r.time;
    out.timeSource = "learned";
  }
  return out;
}

export const forget = (rules: LearnedRule[] | undefined, id: string) => (rules ?? []).filter((r) => r.id !== id);
