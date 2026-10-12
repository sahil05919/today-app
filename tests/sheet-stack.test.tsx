// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bodyScrollLocked, closeAllSheets, closeTopSheet, registerSheet, resetSheetStackForTests, sheetCount, sheetZ, unregisterSheet } from "../lib/sheetStack";
import { Sheet } from "../components/ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetSheetStackForTests();
  document.body.style.overflow = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[role=dialog]").forEach((e) => e.remove());
});

const dialogs = () => [...document.querySelectorAll<HTMLElement>("[role=dialog]")];
const dialog = (title: string) => dialogs().find((d) => d.getAttribute("aria-label") === title)!;
const z = (title: string) => Number(dialog(title).style.zIndex);
const backdrops = () => [...document.querySelectorAll("[data-backdrop]")];
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.includes(text) || b.getAttribute("aria-label") === text);
const escape = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

/**
 * The real shape of the app: the task sheet is rendered by App BEFORE the Calendar sheet in the markup (so it used to paint behind it),
 * and the Calendar's rows open it. A second path opens a sheet from INSIDE the Calendar (a child of it), like Reschedule.
 */
function Harness() {
  const [openTask, setOpenTask] = useState(false);
  const [panel, setPanel] = useState<"calendar" | null>(null);
  return (
    <div>
      <button onClick={() => setPanel("calendar")}>open calendar</button>
      {openTask && (
        <Sheet title="Task" onClose={() => setOpenTask(false)}>
          <p>Walking session</p>
        </Sheet>
      )}
      {panel === "calendar" && <CalendarLike onClose={() => setPanel(null)} openTask={() => setOpenTask(true)} />}
    </div>
  );
}

function CalendarLike({ onClose, openTask }: { onClose: () => void; openTask: () => void }) {
  const [day, setDay] = useState("12 Oct");
  const [child, setChild] = useState(false);
  return (
    <Sheet title="Calendar" onClose={onClose}>
      <p data-testid="day">{day}</p>
      <button onClick={() => setDay("13 Oct")}>pick 13 Oct</button>
      <button onClick={openTask}>Walking session</button>
      <button onClick={() => setChild(true)}>reschedule</button>
      {child && (
        <Sheet title="Reschedule" onClose={() => setChild(false)}>
          <p>when?</p>
        </Sheet>
      )}
    </Sheet>
  );
}

describe("the sheet stack", () => {
  it("BUG: Calendar → tap an item → the item sheet is ON TOP of the Calendar (not behind it)", () => {
    act(() => root.render(<Harness />));
    click(button(host, "open calendar"));
    click(button(dialog("Calendar"), "pick 13 Oct"));
    click(button(dialog("Calendar"), "Walking session"));
    expect(dialogs().map((d) => d.getAttribute("aria-label"))).toContain("Task");
    expect(z("Task")).toBeGreaterThan(z("Calendar"));
  });

  it("closing the top sheet returns to the Calendar on the same day", () => {
    act(() => root.render(<Harness />));
    click(button(host, "open calendar"));
    click(button(dialog("Calendar"), "pick 13 Oct"));
    click(button(dialog("Calendar"), "Walking session"));
    click(button(dialog("Task"), "Close"));
    expect(dialogs().map((d) => d.getAttribute("aria-label"))).toEqual(["Calendar"]);
    expect(dialog("Calendar").querySelector("[data-testid=day]")!.textContent).toBe("13 Oct");
    // …and the Calendar owns the only backdrop again.
    expect(backdrops()).toHaveLength(1);
    expect(dialog("Calendar").contains(backdrops()[0])).toBe(true);
  });

  it("a sheet opened from inside another sheet is always on top; z-index comes from stack order", () => {
    act(() => root.render(<Harness />));
    click(button(host, "open calendar"));
    click(button(dialog("Calendar"), "reschedule"));
    expect(z("Reschedule")).toBeGreaterThan(z("Calendar"));
    click(button(dialog("Calendar"), "Walking session"));
    expect(z("Task")).toBeGreaterThan(z("Reschedule"));
    // three sheets, three different levels
    expect(new Set(dialogs().map((d) => d.style.zIndex)).size).toBe(3);
  });

  it("only the top sheet has a backdrop", () => {
    act(() => root.render(<Harness />));
    click(button(host, "open calendar"));
    expect(backdrops()).toHaveLength(1);
    click(button(dialog("Calendar"), "reschedule"));
    click(button(dialog("Calendar"), "Walking session"));
    expect(dialogs()).toHaveLength(3);
    expect(backdrops()).toHaveLength(1);
    expect(dialog("Task").contains(backdrops()[0])).toBe(true);
  });

  it("Escape and the Back button close ONLY the top sheet, in order", () => {
    act(() => root.render(<Harness />));
    click(button(host, "open calendar"));
    click(button(dialog("Calendar"), "reschedule"));
    click(button(dialog("Calendar"), "Walking session"));
    expect(dialogs()).toHaveLength(3);
    escape(); // Task
    expect(dialogs().map((d) => d.getAttribute("aria-label")).sort()).toEqual(["Calendar", "Reschedule"]);
    act(() => void closeTopSheet()); // Back button: Reschedule
    expect(dialogs().map((d) => d.getAttribute("aria-label"))).toEqual(["Calendar"]);
    act(() => void closeTopSheet()); // Calendar
    expect(dialogs()).toHaveLength(0);
    expect(closeTopSheet()).toBe(false); // nothing open: Back would minimise the app
  });

  it("after everything is closed there is no backdrop, no dialog and no scroll lock", () => {
    act(() => root.render(<Harness />));
    click(button(host, "open calendar"));
    expect(document.body.style.overflow).toBe("hidden");
    click(button(dialog("Calendar"), "reschedule"));
    click(button(dialog("Calendar"), "Walking session"));
    act(() => void closeAllSheets());
    expect(dialogs()).toHaveLength(0);
    expect(backdrops()).toHaveLength(0);
    expect(document.body.style.overflow).toBe("");
    expect(bodyScrollLocked()).toBe(false);
    expect(sheetCount()).toBe(0);
  });

  it("a notification tap closes ALL sheets, then the target opens on a clean screen", () => {
    function Tap() {
      const [target, setTarget] = useState(false);
      const [panel, setPanel] = useState(true);
      return (
        <div>
          <button
            onClick={() => {
              closeAllSheets();
              setTarget(true);
            }}
          >
            tap notification
          </button>
          {panel && (
            <Sheet title="Calendar" onClose={() => setPanel(false)}>
              <p>cal</p>
            </Sheet>
          )}
          {target && (
            <Sheet title="Target" onClose={() => setTarget(false)}>
              <p>the card</p>
            </Sheet>
          )}
        </div>
      );
    }
    act(() => root.render(<Tap />));
    click(button(host, "tap notification"));
    expect(dialogs().map((d) => d.getAttribute("aria-label"))).toEqual(["Target"]);
    expect(backdrops()).toHaveLength(1);
  });

  it("REGRESSION: the scroll lock is released even when the sheets close in the 'wrong' order (the old code kept the lock forever)", () => {
    function Order() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <div>
          <button onClick={() => setA(false)}>close first</button>
          <button onClick={() => setB(false)}>close second</button>
          {a && <Sheet title="A" onClose={() => setA(false)}><p>a</p></Sheet>}
          {b && <Sheet title="B" onClose={() => setB(false)}><p>b</p></Sheet>}
        </div>
      );
    }
    act(() => root.render(<Order />));
    expect(document.body.style.overflow).toBe("hidden");
    click(button(host, "close first")); // the OLDER sheet goes first
    click(button(host, "close second"));
    expect(dialogs()).toHaveLength(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("sheets that re-render a lot (a fresh onClose every time) do not disturb the stack or the lock", () => {
    function Busy() {
      const [n, setN] = useState(0);
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button onClick={() => setN(n + 1)}>tick</button>
          {open && <Sheet title="Busy" onClose={() => setOpen(false)}><p>{n}</p></Sheet>}
        </div>
      );
    }
    act(() => root.render(<Busy />));
    for (let i = 0; i < 25; i++) click(button(host, "tick"));
    expect(sheetCount()).toBe(1);
    expect(backdrops()).toHaveLength(1);
    escape();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("the stack manager on its own", () => {
  it("a stale entry (its element is gone) is dropped and the lock released", () => {
    registerSheet({ id: 1, close: () => undefined, el: { isConnected: true } });
    const el = { isConnected: true };
    registerSheet({ id: 2, close: () => undefined, el });
    expect(sheetZ(2)).toBeGreaterThan(sheetZ(1));
    el.isConnected = false;
    expect(closeTopSheet()).toBe(true); // reconciles first: #2 is gone, so #1 is the top one and it is the one closed
    unregisterSheet(1);
    expect(sheetCount()).toBe(0);
    expect(bodyScrollLocked()).toBe(false);
  });

  it("a close handler that throws does not trap the user", () => {
    registerSheet({
      id: 1,
      close: () => {
        throw new Error("bad handler");
      },
    });
    expect(() => closeTopSheet()).not.toThrow();
    expect(sheetCount()).toBe(0);
  });
});
