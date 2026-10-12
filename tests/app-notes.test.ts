import { beforeEach, describe, expect, it } from "vitest";
import { appNoteText, isAppNote, makeNote, notesAsBullets } from "../lib/appNotes";
import { emptyData, migrate } from "../lib/backup";
import { cleanupData } from "../lib/cleanup";
import { intentOf, isCommandTitle } from "../lib/intentPhrases";
import { seedIfNeeded } from "../lib/seed";
import { actions, getData } from "../lib/store";
import { understand } from "../lib/understand";

describe("app: notes", () => {
  beforeEach(() => actions.replaceAll(seedIfNeeded(emptyData(), new Date(2026, 9, 12))));

  it("anything starting with app: is a note, never a task", () => {
    expect(isAppNote("app: walk reminder feels too early")).toBe(true);
    expect(isAppNote("  APP :  the widget is slow")).toBe(true);
    expect(isAppNote("app:")).toBe(false); // nothing after the colon
    expect(isAppNote("apply for passport")).toBe(false);
    expect(isAppNote("app review with Sam tomorrow")).toBe(false);
    expect(appNoteText("app:   walk reminder\n feels too early ")).toBe("walk reminder feels too early");
  });

  it("the intent detector shows the 'request, not a task' hint for it", () => {
    expect(intentOf("app: x")).toBe("app");
    expect(intentOf("lighten my week")).toBe("lighten");
    expect(intentOf("buy milk")).toBeNull();
    expect(isCommandTitle("app: x")).toBe(true);
  });

  it("is saved with its date and text, listed, and deleted", () => {
    const n = actions.addAppNote("app: walk reminder feels too early", new Date(2026, 9, 12, 20, 0));
    expect(getData().notes).toEqual([{ id: n.id, at: new Date(2026, 9, 12, 20, 0).getTime(), date: "2026-10-12", text: "walk reminder feels too early" }]);
    expect(getData().tasks).toHaveLength(0);
    actions.removeAppNote(n.id);
    expect(getData().notes).toEqual([]);
  });

  it("copies as a bullet list to paste to Claude", () => {
    const notes = [makeNote("app: walk reminder feels too early", new Date(2026, 9, 12)), makeNote("app: Done button is small", new Date(2026, 9, 13))];
    expect(notesAsBullets(notes)).toBe("Notes about my Today app:\n- 12 Oct 2026: walk reminder feels too early\n- 13 Oct 2026: Done button is small");
    expect(notesAsBullets([])).toBe("No notes about the app yet.");
  });

  it("survives a save and reload, and a stray 'app:' task from before is cleaned away", () => {
    const n = actions.addAppNote("app: keep me");
    const back = migrate(JSON.parse(JSON.stringify(getData())));
    expect(back.notes?.[0].text).toBe("keep me");
    expect(back.notes?.[0].id).toBe(n.id);
    const stray = { ...getData(), tasks: [{ id: "s", title: "app: oops", important: false, tags: [], steps: [], focus: false, status: "open" as const, createdAt: 1 }] };
    expect(cleanupData(stray).tasks).toHaveLength(0);
    // …and the task parser itself never sees it as something to plan.
    expect(understand("app: x", getData(), new Date()).title).toBeTruthy();
  });
});
