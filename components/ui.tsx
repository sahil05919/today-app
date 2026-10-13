"use client";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isTopSheet, nextSheetId, registerSheet, sheetDepth, sheetStackVersion, sheetZ, subscribeSheetStack, unregisterSheet } from "@/lib/sheetStack";
import type { ISODate, Profile, Task } from "@/lib/types";
import { CloseIcon } from "./icons";

export type Panel = "menu" | "calendar" | "shopping" | "bills" | "goals" | "me" | "adjust" | "ideas" | "review" | "sofar" | "reviews" | "evening" | "feeling" | "quote" | "quotes" | "lighten" | "backups" | "learning" | "winjar" | "search" | "appdid";

/** Shared context passed down to every view. */
export interface ViewCtx {
  today: ISODate;
  /** "Me": routines, life areas and personal shortcuts (defaults filled in). */
  profile: Profile;
  open: (id: string) => void;
  /** Shows a toast. Pass `undo` to add an Undo button. */
  notify: (msg: string, undo?: () => void) => void;
  /** Opens the Reschedule sheet (or the "when?" sheet for an undated task) for a task. */
  when: (id: string, mode: "reschedule" | "schedule") => void;
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      Number(b.important) - Number(a.important) ||
      b.createdAt - a.createdAt,
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {right && <div className="text-xs text-muted">{right}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm leading-relaxed text-muted">
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "accent" | "warn";
}) {
  const tones = {
    plain: "bg-bg text-muted border border-line",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export const btn = {
  primary:
    "rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition active:scale-[0.98] disabled:opacity-40",
  soft: "rounded-xl bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-40",
  ghost:
    "rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition active:scale-[0.98] disabled:opacity-40",
  link: "text-sm font-medium text-muted underline-offset-2 hover:underline",
};

export const field =
  "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

/**
 * Registers an overlay in the sheet stack (lib/sheetStack.ts) for as long as it is mounted. Returns what it needs to draw itself:
 * its z-index (from stack order), whether it is on top (only the top one draws a backdrop), and a ref for its root element.
 */
export function useSheetLayer(onClose: () => void) {
  const idRef = useRef(0);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const elRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    registerSheet({ id, close: () => closeRef.current(), el: elRef.current });
    return () => unregisterSheet(id);
  }, [id]);

  useSyncExternalStore(subscribeSheetStack, sheetStackVersion, () => 0);
  const depth = sheetDepth(id);
  return { id, ref: elRef, z: sheetZ(id), top: depth < 0 ? true : isTopSheet(id), first: depth <= 0 };
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const layer = useSheetLayer(onClose);
  if (typeof document === "undefined") return null;

  // Portalled to the body: every sheet is a direct child of it, so the stack order alone decides which is in front.
  return createPortal(
    <>
      <div ref={layer.ref} style={{ zIndex: layer.z }} className="fixed inset-0 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title} data-sheet={layer.id}>
        {/* One backdrop, and it belongs to the top sheet. */}
        {layer.top && <div data-backdrop className={`${layer.first ? "anim-fade " : ""}absolute inset-0 bg-black/35`} onClick={onClose} />}
        <div className={`${layer.first ? "anim-sheet " : ""}relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-surface shadow-xl sm:rounded-3xl`}>
          <div className="flex items-center justify-between px-5 pb-1 pt-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-bg">
              <CloseIcon />
            </button>
          </div>
          <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">{children}</div>
        </div>
      </div>
    </>,
    document.body,
  );
}
