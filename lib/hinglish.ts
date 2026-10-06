/**
 * Offline Hinglish → English normaliser. Runs BEFORE chrono-node and the token parser.
 * Handles Roman Hinglish and Devanagari, and leaves plain English alone.
 *
 *   "kal shaam 6 baje gym jana hai"  →  "tomorrow at 6pm gym jana"
 *
 * Notes / decisions:
 * - "kal" always means tomorrow (it can mean yesterday in Hindi, but a task app only looks forward).
 * - A bare "N baje" (no subah/shaam/raat) is guessed: 1–6 → pm, 7–11 → am, 12 → pm, 13–23 → 24h clock.
 * - Time-of-day words with no number (subah, shaam, raat…) are dropped, so the task stays date-only.
 * - Postpositions right after a date ("somvar ko", "kal tak", "weekend pe") are dropped.
 */

const LET = "\\p{L}\\p{M}\\p{N}_";
/** Word boundaries that also work for Devanagari (plain \b does not). */
const bound = (src: string) => new RegExp(`(?<![${LET}])(?:${src})(?![${LET}])`, "giu");

const WEEKDAYS: [string, string][] = [
  ["monday", "somvar|somwar|somvaar|sombar|सोमवार"],
  ["tuesday", "mangalvar|mangalwar|mangalvaar|मंगलवार"],
  ["wednesday", "budhvar|budhwar|budhvaar|बुधवार"],
  ["thursday", "guruvar|guruwar|guruvaar|brihaspativar|brihaspatvar|veervar|virvar|वीरवार|गुरुवार|गुरूवार|बृहस्पतिवार"],
  ["friday", "shukravar|shukrawar|shukravaar|शुक्रवार"],
  ["saturday", "shanivar|shaniwar|shanivaar|शनिवार"],
  ["sunday", "ravivar|raviwar|ravivaar|itwar|itvar|इतवार|रविवार"],
];
const WD_ANY = WEEKDAYS.map(([, w]) => w).join("|");

function enWeekday(word: string): string {
  for (const [en, words] of WEEKDAYS) if (new RegExp(`^(?:${words})$`, "iu").test(word)) return en;
  return word;
}

const PERIOD = "subah|subha|savere|sawere|सुबह|सवेरे|dopahar|dophar|दोपहर|shaam|शाम|raat|रात";
const KO = "(?:ko|को)";
const POST = "ko|pe|par|tak|se|को|पर|तक|से|में";
const DATE_EN =
  "today|tomorrow|in \\d+ (?:days|weeks|hours)|next week|end of this week|end of this month|this weekend|" +
  "(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\\d+(?:st|nd|rd|th)|" +
  "at \\d{1,2}(?::\\d{2})?(?:am|pm)";

const ord = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** Hour (+ optional period word) → "5pm" / "5:30am". */
function clock(h: number, min: string | undefined, period?: string): string {
  const p = period?.toLowerCase() ?? "";
  const isMorning = /^(subah|subha|savere|sawere|सुबह|सवेरे)$/.test(p);
  const isNoon = /^(dopahar|dophar|दोपहर)$/.test(p);
  const isEvening = /^(shaam|शाम)$/.test(p);
  const isNight = /^(raat|रात)$/.test(p);
  let pm: boolean;
  if (h > 12) {
    pm = true;
    h -= 12;
  } else if (h === 0) {
    pm = false;
    h = 12;
  } else if (isMorning) pm = false;
  else if (isNoon) pm = h === 12 || h <= 6;
  else if (isEvening) pm = true;
  else if (isNight) pm = h >= 6 && h < 12;
  else pm = h <= 6 || h === 12;
  return `${h}${min && min !== "00" ? `:${min}` : ""}${pm ? "pm" : "am"}`;
}

export function normalizeHinglish(input: string): string {
  // Devanagari digits → ASCII
  let t = input.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966));

  // --- Recurrence words -------------------------------------------------
  t = t.replace(bound("har|हर"), "every");
  t = t.replace(/(\d{1,2})\s*(?:tarikh|tareekh|tarik|तारीख|तारिख)(?:\s+ko)?/giu, (_, n) => ord(+n));
  t = t.replace(/every\s+(?:mahine|mahina|महीने|महीना)\s+(?:ki\s+|ke\s+|की\s+)?(\d{1,2}(?:st|nd|rd|th))/giu, "every $1");
  t = t.replace(new RegExp(`every\\s+(?:din|दिन)(?![${LET}])`, "giu"), "daily");
  t = t.replace(bound("roz|rozana|रोज़|रोज|रोजाना|रोज़ाना"), "daily");
  t = t.replace(new RegExp(`every\\s+(?:hafte|hafta|हफ्ते|हफ़्ते|हफ्ता|सप्ताह)(?![${LET}])`, "giu"), "weekly");
  t = t.replace(new RegExp(`every\\s+(?:mahine|mahina|महीने|महीना)(?![${LET}])`, "giu"), "monthly");

  // --- Dates ------------------------------------------------------------
  t = t.replace(
    new RegExp(`(?<![${LET}])(?:mahine|mahina|महीने|माह)\\s+(?:ke|ki|के|की)\\s+(?:end|ant|aakhir|akhir|अंत|आखिर|एंड)(?![${LET}])`, "giu"),
    "end of this month",
  );
  t = t.replace(bound("weekend|वीकेंड|विकेंड"), "this weekend");
  t = t.replace(
    new RegExp(`(?<![${LET}])(?:agle|agla|अगले|अगला)\\s+(?:hafte|hafta|हफ्ते|हफ्ता|सप्ताह)\\s+(${WD_ANY})(?![${LET}])`, "giu"),
    (_, w) => `next ${enWeekday(w)}`,
  );
  t = t.replace(
    new RegExp(`(?<![${LET}])(?:agle|agla|अगले|अगला)\\s+(?:hafte|hafta|हफ्ते|हफ्ता|सप्ताह)(?![${LET}])`, "giu"),
    "next week",
  );
  t = t.replace(
    new RegExp(`(?<![${LET}])(?:is|iss|इस)\\s+(?:hafte|hafta|हफ्ते|हफ्ता|सप्ताह)(?![${LET}])`, "giu"),
    "end of this week",
  );
  t = t.replace(bound("parso|parson|parsoon|परसों|परसो"), "in 2 days");
  t = t.replace(new RegExp(`(\\d+)\\s*(?:din|दिन)\\s+(?:mein|me|baad|बाद|में)(?![${LET}])`, "giu"), "in $1 days");
  t = t.replace(new RegExp(`(\\d+)\\s*(?:hafte|hafta|हफ्ते)\\s+(?:mein|me|baad|बाद|में)(?![${LET}])`, "giu"), "in $1 weeks");
  t = t.replace(new RegExp(`(\\d+)\\s*(?:ghante|ghanta|घंटे)\\s+(?:mein|me|baad|बाद|में)(?![${LET}])`, "giu"), "in $1 hours");
  t = t.replace(
    new RegExp(`(?<![${LET}])(?:agle|agla|अगले|अगला)\\s+(${WD_ANY})(?![${LET}])`, "giu"),
    (_, w) => `next ${enWeekday(w)}`,
  );
  t = t.replace(
    new RegExp(`(?<![${LET}])(?:is|iss|इस)\\s+(${WD_ANY})(?![${LET}])`, "giu"),
    (_, w) => `this ${enWeekday(w)}`,
  );
  t = t.replace(bound(WD_ANY), (w) => enWeekday(w));
  t = t.replace(bound("aaj|aj|आज|abhi|अभी"), "today");
  t = t.replace(bound("kal|कल"), "tomorrow");

  // --- Clock times ------------------------------------------------------
  t = t.replace(new RegExp(`(?<![${LET}])(?:dhai|ढाई)\\s+(?=baje|बजे)`, "giu"), "2:30 ");
  t = t.replace(new RegExp(`(?<![${LET}])(?:dedh|डेढ़|डेढ)\\s+(?=baje|बजे)`, "giu"), "1:30 ");
  t = t.replace(new RegExp(`(?<![${LET}])(?:saade|saadhe|साढ़े|साढे|साड़े)\\s+(\\d{1,2})`, "giu"), "$1:30");
  t = t.replace(new RegExp(`(?<![${LET}])(?:sawa|सवा)\\s+(\\d{1,2})`, "giu"), "$1:15");
  t = t.replace(new RegExp(`(?<![${LET}])(?:paune|पौने)\\s+(\\d{1,2})`, "giu"), (_, n) => `${+n - 1 || 12}:45`);
  // [period] H[:MM] baje [period]
  t = t.replace(
    new RegExp(
      `(?<![${LET}])(?:(${PERIOD})\\s+(?:${KO}\\s+)?)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:baje|bje|bajey|बजे)(?:\\s+(${PERIOD})(?:\\s+${KO})?)?(?![${LET}])`,
      "giu",
    ),
    (_, p1, h, min, p2) => `at ${clock(+h, min, p1 ?? p2)}`,
  );
  // Remaining time-of-day words carry no date info; drop them (and a trailing "ko").
  t = t.replace(bound(`(?:${PERIOD})(?:\\s+${KO})?`), "");

  // --- Postpositions glued to a date: "monday ko", "tomorrow tak" -------
  t = t.replace(new RegExp(`\\b(${DATE_EN})(?:\\s+(?:${POST}))+(?![${LET}])`, "giu"), "$1");
  t = t.replace(bound("tak|तक"), "");

  // --- Filler in the title ----------------------------------------------
  t = t.replace(
    bound("(?:karna|karni|karne|krna|करना|करनी|करने)(?:\\s+(?:hai|he|h|hain|hoga|padega|padegi|है|हैं|होगा|पड़ेगा|पड़ेगी))?"),
    "",
  );
  t = t.replace(
    bound("(?:yaad|yad|याद)\\s+(?:dilana|dilaana|dilao|dila\\s+dena|dila\\s+do|dilado|dilaye|rakhna|दिलाना|दिलाओ|दिला\\s*देना|दिला\\s*दो|रखना)"),
    "",
  );
  t = t.replace(bound("(?:bhoolna|bhulna|bhoolo|भूलना)\\s+(?:mat|मत)"), "");
  t = t.replace(/^\s*(?:mujhe|मुझे)\s+/iu, "");
  t = t.replace(/^\s*remind me(?: to| about)?\s+/i, "");
  t = t.replace(/\s+(?:hai|hain|है|हैं)\s*[.!]*\s*$/iu, "");

  return t.replace(/\s+/g, " ").trim();
}
