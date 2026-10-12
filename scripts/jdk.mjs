// Which JDK Gradle should use. Gradle 8.14 cannot run on Java 25 (it fails with "Unsupported class file major version 69"),
// and Android Studio's own bundled JDK may be 25 after an update. So: TODAY_JAVA_HOME if set, else a JDK 17-21 from
// ~/.jdks (Android Studio downloads one there), else Android Studio's bundled one.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function findJdk() {
  const win = process.platform === "win32";
  const java = (home) => existsSync(join(home, "bin", win ? "java.exe" : "java"));
  if (process.env.TODAY_JAVA_HOME && java(process.env.TODAY_JAVA_HOME)) return process.env.TODAY_JAVA_HOME;
  const jdks = join(homedir(), ".jdks");
  if (existsSync(jdks)) {
    const ok = readdirSync(jdks)
      .filter((n) => /(^|[^\d])(17|21)(\.|$)/.test(n.replace(/^[^\d]*/, "")))
      .sort()
      .reverse()
      .map((n) => join(jdks, n))
      .filter(java);
    if (ok.length) return ok[0];
  }
  const studio = win ? "C:\Program Files\Android\Android Studio\jbr" : "";
  if (studio && java(studio)) return studio;
  return process.env.JAVA_HOME ?? "";
}
