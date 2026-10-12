"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { formatErrors, getErrors, installGlobalErrorHandlers, logError } from "@/lib/debugLog";
import { flushNow } from "@/lib/store";

/**
 * If something in the app crashes while it is drawing, this shows "Something went wrong — Reload" instead of a frozen or blank
 * screen. Reload keeps your data: anything not yet saved is written first. The crash goes to Settings → Health → Recent errors.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean; copied: boolean }> {
  state = { crashed: false, copied: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidMount() {
    installGlobalErrorHandlers();
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(`react: ${(info.componentStack ?? "").trim().split("\n")[0] ?? "render"}`, error);
  }

  private reload = async () => {
    try {
      await Promise.race([flushNow(), new Promise((r) => setTimeout(r, 2000))]);
    } catch {
      /* reload anyway */
    }
    window.location.reload();
  };

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(formatErrors(getErrors()));
      this.setState({ copied: true });
    } catch {
      /* no clipboard: the same text is in Settings → Health */
    }
  };

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-4xl" aria-hidden="true">
          🛟
        </p>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted">Your tasks are safe. Reloading brings the app back with everything you saved.</p>
        <button onClick={this.reload} className="min-h-12 w-full rounded-xl bg-accent px-4 py-2.5 text-base font-semibold text-accent-ink">
          Reload
        </button>
        <button onClick={this.copy} className="min-h-11 text-sm font-medium text-muted underline-offset-2 hover:underline">
          {this.state.copied ? "Copied. Paste it to Claude" : "Copy the error details"}
        </button>
      </div>
    );
  }
}
