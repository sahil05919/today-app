import type { MetadataRoute } from "next";

// Required for the static Android export; harmless on Vercel.
export const dynamic = "force-static";

const icon = [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }];

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Today",
    short_name: "Today",
    description: "A calm, local-first task app.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the app icon on Android.
    shortcuts: [
      { name: "New task", short_name: "New task", description: "Capture a task", url: "/?new=1", icons: icon },
      { name: "Voice task", short_name: "Voice", description: "Speak a task", url: "/?voice=1", icons: icon },
    ],
    // "Share to Today" from other apps. Opens capture prefilled; nothing is saved until you press Enter.
    share_target: {
      action: "/",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
