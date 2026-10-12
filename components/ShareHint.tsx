"use client";

/** "Got a shift or booking by email? Share it to Today from Gmail." Shown from the evening check-in, and as an empty-state tip. */
export function ShareHint({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-accent-soft p-3.5" role="note">
      <span className="text-2xl" aria-hidden="true">
        📧
      </span>
      <p className="min-w-0 flex-1 text-[15px] leading-snug">
        <span className="font-semibold">Got a shift or booking by email?</span> Share it to Today from Gmail, and it becomes an event.
      </p>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="-mr-1 min-h-9 px-2 text-muted">
          ✕
        </button>
      )}
    </div>
  );
}
