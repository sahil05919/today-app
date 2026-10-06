/**
 * "Don't miss this": London events. Phase 1 (built): a bundled, fully offline curated list in
 * `curated.ts`. Phase 2 (later): live sources behind the same `EventSource` interface.
 * Saving an event creates a normal Task, so it flows through Today / This week / calendar export.
 */
export { CURATED_EVENTS, allNextOccurrences, resolveRule, upcomingEvents } from "./curated";
export type { CuratedEvent, UpcomingEvent } from "./curated";

export interface LondonEvent {
  id: string;
  title: string;
  /** ISO date of the next occurrence. */
  date: string;
  venue?: string;
  url?: string;
  recurring?: string;
}

export interface EventSource {
  id: string;
  list(range: { from: string; to: string }): Promise<LondonEvent[]>;
}

export const eventSources: EventSource[] = [];
