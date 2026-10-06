import { addDays, fromISO, toISO } from "../dates";
import type { ISODate } from "../types";

/**
 * Bundled "Don't miss this" list: recurring London events with their USUAL timing.
 * Dates move from year to year, so every event is shown with a "check the exact date" note.
 * Nothing here needs a network.
 */
type Rule =
  | { kind: "fixed"; month: number; day: number; days?: number }
  /** nth weekday of a month (n = -1 for the last one), optionally shifted by `offset` days. */
  | { kind: "nth"; month: number; weekday: number; n: number; days?: number; offset?: number }
  /** The `weekday` closest to a calendar date (e.g. the Sunday nearest 11 Nov). */
  | { kind: "nearest"; month: number; day: number; weekday: number; days?: number }
  /** A usual window, as [month, day] to [month, day]. May run into the next year. */
  | { kind: "range"; from: [number, number]; to: [number, number] };

export interface CuratedEvent {
  id: string;
  title: string;
  where: string;
  blurb: string;
  /** Plain-English "usually…" shown on the card. */
  usually: string;
  rule: Rule;
  url?: string;
}

export const CURATED_EVENTS: CuratedEvent[] = [
  {
    id: "diwali-trafalgar",
    title: "Diwali on the Square",
    where: "Trafalgar Square",
    blurb: "Free Diwali celebration with music, dance and food.",
    usually: "A Sunday in mid Oct–Nov, close to Diwali",
    rule: { kind: "range", from: [10, 15], to: [11, 15] },
    url: "https://www.london.gov.uk",
  },
  {
    id: "bonfire-night",
    title: "Bonfire Night fireworks",
    where: "Battersea Park, Alexandra Palace, Blackheath and more",
    blurb: "Big displays around 5 Nov, usually on the nearest weekend. Many need tickets.",
    usually: "Around 5 November, often the nearest weekend",
    rule: { kind: "range", from: [11, 1], to: [11, 9] },
  },
  {
    id: "lord-mayors-show",
    title: "Lord Mayor's Show",
    where: "Mansion House to the Royal Courts of Justice",
    blurb: "A parade of floats, bands and carriages through the City.",
    usually: "The second Saturday of November",
    rule: { kind: "nth", month: 11, weekday: 6, n: 2 },
    url: "https://lordmayorshow.london",
  },
  {
    id: "remembrance-sunday",
    title: "Remembrance Sunday",
    where: "The Cenotaph, Whitehall",
    blurb: "National service of remembrance with two minutes' silence at 11am.",
    usually: "The Sunday nearest 11 November",
    rule: { kind: "nearest", month: 11, day: 11, weekday: 0 },
  },
  {
    id: "winter-wonderland",
    title: "Winter Wonderland",
    where: "Hyde Park",
    blurb: "Christmas market, rides and an ice rink.",
    usually: "Mid November to early January",
    rule: { kind: "range", from: [11, 14], to: [1, 4] },
    url: "https://hydeparkwinterwonderland.com",
  },
  {
    id: "christmas-markets",
    title: "Christmas markets",
    where: "Southbank, Covent Garden, Greenwich and more",
    blurb: "Stalls, mulled wine and lights across the city.",
    usually: "Mid November to Christmas",
    rule: { kind: "range", from: [11, 14], to: [12, 24] },
    url: "https://www.southbankcentre.co.uk",
  },
  {
    id: "nye-fireworks",
    title: "New Year's Eve fireworks",
    where: "London Eye and the Thames",
    blurb: "Midnight fireworks over the river. Ticketed, so book early.",
    usually: "31 December",
    rule: { kind: "fixed", month: 12, day: 31 },
    url: "https://www.london.gov.uk",
  },
  {
    id: "canary-wharf-lights",
    title: "Winter Lights",
    where: "Canary Wharf",
    blurb: "Free light installations through the estate.",
    usually: "Most of January",
    rule: { kind: "range", from: [1, 10], to: [1, 30] },
    url: "https://www.canarywharf.com",
  },
  {
    id: "chinese-new-year",
    title: "Chinese New Year",
    where: "Chinatown and Trafalgar Square",
    blurb: "Parade, lion dances and street food.",
    usually: "A Sunday from late January to mid February",
    rule: { kind: "range", from: [1, 20], to: [2, 20] },
  },
  {
    id: "kew-orchids",
    title: "Orchid Festival",
    where: "Kew Gardens",
    blurb: "A warm, colourful escape in the depths of winter.",
    usually: "February to early March",
    rule: { kind: "range", from: [2, 1], to: [3, 15] },
    url: "https://www.kew.org",
  },
  {
    id: "st-patricks",
    title: "St Patrick's Day parade",
    where: "Central London",
    blurb: "Parade and festival around Trafalgar Square.",
    usually: "The Sunday nearest 17 March",
    rule: { kind: "nearest", month: 3, day: 17, weekday: 0 },
  },
  {
    id: "london-marathon",
    title: "London Marathon",
    where: "Greenwich to The Mall",
    blurb: "Great for cheering on. Pick a spot along the route.",
    usually: "A Sunday in late April",
    rule: { kind: "range", from: [4, 18], to: [4, 28] },
    url: "https://www.tcslondonmarathon.com",
  },
  {
    id: "chelsea-flower",
    title: "Chelsea Flower Show",
    where: "Royal Hospital Chelsea",
    blurb: "Show gardens and floral displays. Tickets sell out.",
    usually: "A week in the second half of May",
    rule: { kind: "range", from: [5, 18], to: [5, 28] },
    url: "https://www.rhs.org.uk",
  },
  {
    id: "trooping-colour",
    title: "Trooping the Colour",
    where: "The Mall and Horse Guards Parade",
    blurb: "Military parade for the King's official birthday.",
    usually: "A Saturday in mid June",
    rule: { kind: "range", from: [6, 8], to: [6, 16] },
  },
  {
    id: "pride-london",
    title: "Pride in London",
    where: "Central London",
    blurb: "Parade and celebration through the West End.",
    usually: "A Saturday from late June to early July",
    rule: { kind: "range", from: [6, 28], to: [7, 8] },
    url: "https://www.prideinlondon.org",
  },
  {
    id: "wimbledon",
    title: "Wimbledon",
    where: "SW19",
    blurb: "Queue for grounds tickets or watch on a big screen.",
    usually: "Late June to mid July",
    rule: { kind: "range", from: [6, 28], to: [7, 15] },
    url: "https://www.wimbledon.com",
  },
  {
    id: "bbc-proms",
    title: "BBC Proms",
    where: "Royal Albert Hall",
    blurb: "Eight weeks of concerts with cheap standing tickets.",
    usually: "Mid July to mid September",
    rule: { kind: "range", from: [7, 15], to: [9, 15] },
    url: "https://www.bbc.co.uk/proms",
  },
  {
    id: "notting-hill-carnival",
    title: "Notting Hill Carnival",
    where: "Notting Hill",
    blurb: "Europe's biggest street festival: sound systems, floats and food.",
    usually: "August bank holiday weekend (Sunday and Monday)",
    rule: { kind: "nth", month: 8, weekday: 1, n: -1, offset: -1, days: 2 },
    url: "https://nhcarnival.org",
  },
  {
    id: "open-house-london",
    title: "Open House London",
    where: "Across the city",
    blurb: "Free access to buildings you can't normally enter. Some need booking.",
    usually: "A weekend in mid to late September",
    rule: { kind: "nth", month: 9, weekday: 6, n: 3, days: 2 },
    url: "https://openhouse.org.uk",
  },
  {
    id: "frieze-london",
    title: "Frieze London",
    where: "Regent's Park",
    blurb: "Contemporary art fair, with a lively week of gallery openings around it.",
    usually: "A few days in the middle of October",
    rule: { kind: "range", from: [10, 8], to: [10, 20] },
    url: "https://www.frieze.com",
  },
  {
    id: "bfi-lff",
    title: "BFI London Film Festival",
    where: "Southbank and cinemas across London",
    blurb: "Premieres and talks. Tickets go on sale in stages.",
    usually: "About two weeks in October",
    rule: { kind: "range", from: [10, 7], to: [10, 20] },
  },
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;

/** Start and end dates of an event for a given year (ranges may end in the following year). */
export function resolveRule(rule: Rule, year: number): { start: ISODate; end: ISODate } {
  switch (rule.kind) {
    case "fixed": {
      const start = iso(year, rule.month, rule.day);
      return { start, end: addDays(start, (rule.days ?? 1) - 1) };
    }
    case "nth": {
      let day: Date;
      if (rule.n > 0) {
        const first = new Date(year, rule.month - 1, 1);
        day = new Date(year, rule.month - 1, 1 + ((rule.weekday - first.getDay() + 7) % 7) + (rule.n - 1) * 7);
      } else {
        const last = new Date(year, rule.month, 0);
        day = new Date(year, rule.month - 1, last.getDate() - ((last.getDay() - rule.weekday + 7) % 7));
      }
      const start = addDays(toISO(day), rule.offset ?? 0);
      return { start, end: addDays(start, (rule.days ?? 1) - 1) };
    }
    case "nearest": {
      const d = new Date(year, rule.month - 1, rule.day);
      let diff = (rule.weekday - d.getDay() + 7) % 7;
      if (diff > 3) diff -= 7;
      const start = addDays(toISO(d), diff);
      return { start, end: addDays(start, (rule.days ?? 1) - 1) };
    }
    case "range": {
      const start = iso(year, rule.from[0], rule.from[1]);
      const endYear = rule.to[0] < rule.from[0] ? year + 1 : year;
      return { start, end: iso(endYear, rule.to[0], rule.to[1]) };
    }
  }
}

export interface UpcomingEvent {
  event: CuratedEvent;
  start: ISODate;
  end: ISODate;
  year: number;
  /** "soon" = starts within the lead window, "now" = already on. */
  state: "soon" | "now";
}

/** Events that start within `leadDays` (default 14) or are on right now. Soonest first. */
export function upcomingEvents(today: ISODate, opts: { leadDays?: number; hidden?: string[] } = {}): UpcomingEvent[] {
  const lead = opts.leadDays ?? 14;
  const y = fromISO(today).getFullYear();
  const out: UpcomingEvent[] = [];
  for (const event of CURATED_EVENTS) {
    for (const year of [y - 1, y, y + 1]) {
      const { start, end } = resolveRule(event.rule, year);
      if (opts.hidden?.includes(`${event.id}:${year}`)) continue;
      if (today > end || today < addDays(start, -lead)) continue;
      out.push({ event, start, end, year, state: today >= start ? "now" : "soon" });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Next occurrence of every event (for the full list). */
export function allNextOccurrences(today: ISODate): UpcomingEvent[] {
  const y = fromISO(today).getFullYear();
  const out: UpcomingEvent[] = [];
  for (const event of CURATED_EVENTS) {
    for (const year of [y - 1, y, y + 1]) {
      const { start, end } = resolveRule(event.rule, year);
      if (end >= today) {
        out.push({ event, start, end, year, state: today >= start ? "now" : "soon" });
        break;
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
