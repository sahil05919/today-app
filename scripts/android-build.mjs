// Builds the static site for the Android app and copies it into the native project.
//   node scripts/android-build.mjs          -> web build + `cap sync android`
//   node scripts/android-build.mjs --apk    -> ...and then a debug APK (needs Android Studio's SDK installed)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const win = process.platform === "win32";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: win, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log("1/3  Building the web app (static export)…");
run("npx", ["next", "build"], { env: { ...process.env, BUILD_TARGET: "android" } });

if (!existsSync("android")) {
  console.log("Adding the Android project (first time only)…");
  run("npx", ["cap", "add", "android"]);
}

console.log("2/3  Copying into the Android project…");
run("npx", ["cap", "sync", "android"]);

if (process.argv.includes("--apk")) {
  console.log("3/3  Building the debug APK…");
  run(win ? ".\gradlew.bat" : "./gradlew", ["assembleDebug"], { cwd: "android" });
  const apk = join("android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  console.log(existsSync(apk) ? `\nDone! Your APK: ${apk}` : "\nBuild finished, but I couldn't find the APK.");
} else {
  console.log("3/3  Skipped the APK. Open it in Android Studio with:  npx cap open android");
}
