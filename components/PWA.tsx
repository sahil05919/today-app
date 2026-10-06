"use client";
import { useEffect } from "react";

/** Registers the service worker (production only) and asks the browser not to evict our data. */
export function PWA() {
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
