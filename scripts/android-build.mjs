// Builds the static site for the Android app and copies it into the native project.
//   node scripts/android-build.mjs            -> web build + `cap sync android`
//   node scripts/android-build.mjs --apk      -> ...and then a debug APK
//   node scripts/android-build.mjs --release  -> ...and then the optimised RELEASE APK (npm run android:release)
//
// The release APK is signed with the same debug keystore as the debug build, so `adb install -r` installs it over the
// current app and keeps your data. It then checks that the two certificates really are the same.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findJdk } from "./jdk.mjs";
import { checkSignature } from "./verify-signature.mjs";

const win = process.platform === "win32";
const release = process.argv.includes("--release");
const apkWanted = release || process.argv.includes("--apk");

// Gradle needs a JDK it supports: Java 25 (Android Studio's bundled one after an update) makes it fail with
// "Unsupported class file major version 69". See scripts/jdk.mjs.
const env = { ...process.env };
const jdk = findJdk();
if (jdk) env.JAVA_HOME = jdk;

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: win, env, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log("1/3  Building the web app (static export)...");
run("npx", ["next", "build"], { env: { ...env, BUILD_TARGET: "android" } });

if (!existsSync("android")) {
  console.log("Adding the Android project (first time only)...");
  run("npx", ["cap", "add", "android"]);
}

console.log("2/3  Copying into the Android project...");
run("npx", ["cap", "sync", "android"]);

if (apkWanted) {
  const task = release ? "assembleRelease" : "assembleDebug";
  console.log(`3/3  Building the ${release ? "release" : "debug"} APK...`);
  run(win ? ".\\gradlew.bat" : "./gradlew", [task], { cwd: "android" });
  const apk = resolve(join("android", "app", "build", "outputs", "apk", release ? "release" : "debug", release ? "app-release.apk" : "app-debug.apk"));
  if (!existsSync(apk)) {
    console.log("\nBuild finished, but I couldn't find the APK.");
    process.exit(1);
  }
  if (release) {
    const sig = checkSignature(apk);
    console.log(`\nSigning certificate: ${sig.message}`);
    if (!sig.ok) process.exit(1);
  }
  console.log(`\nDone! Your ${release ? "release " : ""}APK: ${apk}`);
  console.log(`\nInstall it over the current app (keeps your data):\n  & "$env:LOCALAPPDATA\\Android\\Sdk\\platform-tools\\adb.exe" install -r "${apk}"`);
} else {
  console.log("3/3  Skipped the APK. Open it in Android Studio with:  npx cap open android");
}
