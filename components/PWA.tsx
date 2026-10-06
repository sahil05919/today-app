"use client";
import { useEffect } from "react";
import { isNative } from "@/lib/platform";

/** Registers the service worker (production only) and asks the browser not to evict our data. */
export function PWA() {
  useEffect(() => {
    // Inside the Android app, files are bundled and storage is native: no service worker needed.
    if (isNative()) return;
    navigator.storage?.persist?.().catch(() => {});
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
