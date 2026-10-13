import { callGemini } from "./ai";
import { withDefaults } from "./profile";
import type { AppData, Learning, SessionLog } from "./types";

/**
 * The learning log. After a session of a chosen area is done (Power BI by default), the app asks, in the app and never as a
 * notification, "What did you learn?" (one line). With 5 or more learnings not yet used, the Sunday review offers to turn a few of
 * them into a LinkedIn post: an offline template draft, optionally polished by Gemini (only the chosen lines are sent, nothing is kept).
 */
export const DEFAULT_LEARN_AREAS = ["powerbi"];
export const MIN_FOR_POST = 5;
export const POST_PICK = 3;
/** A session counts as "just done" for this long (the prompt is for right after, not for backfilled days). */
const JUST_DONE_MS = 5 * 60_000;

/** The areas that ask "What did you learn?" (Settings → Learning log). */
export const learnAreas = (data: AppData): string[] => data.profile?.learnAreas ?? DEFAULT_LEARN_AREAS;

/** The session that was just finished in an area that asks, if the change from `prev` to `next` added one. */
export function learnPromptFor(prev: SessionLog[] | undefined, next: SessionLog[] | undefined, data: AppData, now: Date): SessionLog | null {
  if (!next || next === prev) return null;
  const had = new Set((prev ?? []).map((l) => l.id));
  const asking = new Set(learnAreas(data));
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fresh = next.filter((l) => !had.has(l.id) && asking.has(l.areaId) && l.date === today && l.via !== "backdated" && now.getTime() - l.at <= JUST_DONE_MS && now.getTime() - l.at >= -60_000);
  return fresh.length ? fresh[fresh.length - 1] : null;
}

export const unusedLearnings = (data: AppData): Learning[] => (data.learnings ?? []).filter((l) => !l.usedAt);

/** The Sunday card: "You have 8 learnings — turn 3 into a LinkedIn post?" Only with 5 or more unused. */
export function postCard(data: AppData): { count: number; pick: number; text: string } | null {
  const count = unusedLearnings(data).length;
  if (count < MIN_FOR_POST) return null;
  const pick = Math.min(POST_PICK, count);
  return { count, pick, text: `You have ${count} learnings — turn ${pick} into a LinkedIn post?` };
}

/** The newest few unused learnings: what the draft starts with. */
export const defaultPick = (data: AppData, n = POST_PICK): Learning[] => unusedLearnings(data).sort((a, b) => b.at - a.at).slice(0, n);

const sentence = (t: string) => {
  const s = t.replace(/\s+/g, " ").trim();
  if (!s) return s;
  const cap = s[0].toUpperCase() + s.slice(1);
  return /[.!?]$/.test(cap) ? cap : cap + ".";
};
const WORDS = ["", "One", "Two", "Three", "Four", "Five"];
const TAGS: Record<string, string> = { powerbi: "#PowerBI", job: "#CareerDevelopment", english: "#Learning" };

const joinNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The offline draft: a hook, the learnings as bullets, a short close, at most two hashtags. First person, plain and professional. */
export function draftPost(picked: Learning[], areaName: (id: string) => string): string {
  const list = picked.slice(0, 5);
  if (!list.length) return "";
  const topics = [...new Set(list.map((l) => areaName(l.areaId)).filter(Boolean))];
  const topic = topics.length ? joinNames(topics) : "a few things";
  const n = list.length;
  const hook = n === 1 ? `Something I learned about ${topic} recently:` : `${WORDS[n] ?? n} things I learned about ${topic} recently:`;
  const bullets = list.map((l) => `• ${sentence(l.text)}`);
  const close = "Still learning, one small session at a time. What is something new you picked up lately?";
  const tags = [...new Set([...list.map((l) => TAGS[l.areaId]).filter(Boolean), "#Learning"])].slice(0, 2);
  return [hook, "", ...bullets, "", close, "", tags.join(" ")].join("\n").trim();
}

/** "12 Oct 2026 · Power BI: text", one per line, newest last: for Copy all / Share. */
export function learningsAsText(list: Learning[], areaName: (id: string) => string): string {
  if (!list.length) return "No learnings yet.";
  const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return ["What I have been learning:", ...[...list].sort((a, b) => a.at - b.at).map((l) => `- ${pretty(l.date)} · ${areaName(l.areaId)}: ${l.text}`)].join("\n");
}

const POST_SCHEMA = { type: "OBJECT", properties: { post: { type: "STRING" } }, required: ["post"] };

/**
 * "Polish with Gemini": sends ONLY the chosen learnings (their text and area name), asks for a LinkedIn post, and returns it. Nothing is
 * stored anywhere. Needs the Gemini key from Settings.
 */
export async function polishPost(picked: Learning[], areaName: (id: string) => string, call: typeof callGemini = callGemini): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (!picked.length) return { ok: false, reason: "Nothing chosen." };
  const r = await call(
    {
      system:
        "You write a short LinkedIn post in the first person for a data analyst who is learning. Use ONLY the learnings given; never invent facts, tools, numbers or results. " +
        "Professional but warm and plain; no emojis; at most two hashtags; about 80 words; start with a one-line hook, then three or fewer short bullet points with '•', then a one-line closing question. Reply as JSON {post}.",
      user: picked.map((l, i) => `${i + 1}. [${areaName(l.areaId)}] ${l.text}`).join("\n"),
      schema: POST_SCHEMA,
      temperature: 0.6,
    },
    { timeoutMs: 20_000 },
  );
  if (!r.ok) return { ok: false, reason: r.message ?? r.reason };
  const post = (r.result as unknown as { post?: unknown }).post;
  return typeof post === "string" && post.trim() ? { ok: true, text: post.trim() } : { ok: false, reason: "Gemini's reply was empty." };
}

export const areaNameOf = (data: AppData) => (id: string) => withDefaults(data.profile).areas.find((a) => a.id === id)?.name ?? id;
