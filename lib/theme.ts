export type ThemePref = "system" | "light" | "dark";
const KEY = "today:theme";
const BG = { light: "#faf7f2", dark: "#1b1a18" };

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Saves the choice, sets <html data-theme> (CSS follows it) and keeps the browser bar colour in step. */
export function setTheme(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;

  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (m.dataset.media === undefined) m.dataset.media = m.getAttribute("media") ?? "";
    if (pref === "system") {
      if (m.dataset.media) m.setAttribute("media", m.dataset.media);
    } else {
      m.removeAttribute("media");
      m.content = BG[pref];
    }
  });
}
