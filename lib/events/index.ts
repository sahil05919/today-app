/**
 * "Don't miss this": London events (NOT built yet).
 *
 * Plan: start with a hand-curated list of recurring events (`curated.ts`), then add live
 * sources behind the same `EventSource` interface. Saving an event creates a normal Task,
 * so it flows through Today / This week / calendar export unchanged.
 */
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
