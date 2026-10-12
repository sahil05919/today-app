// Checks that an APK is signed with the debug keystore (so it installs over the app that is on the phone).
//   node scripts/verify-signature.mjs [path-to-apk]     (default: the release APK)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findJdk } from "./jdk.mjs";

const win = process.platform === "win32";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (win ? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk") : join(homedir(), "Android", "Sdk"));
const jbr = findJdk();

function apksigner() {
  const root = join(sdk, "build-tools");
  if (!existsSync(root)) return null;
  const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const f = join(root, v, win ? "apksigner.bat" : "apksigner");
    if (existsSync(f)) return f;
  }
  return null;
}

const sha256 = (text) => /SHA-256 digest:\s*([0-9a-f:]+)/i.exec(text)?.[1]?.replace(/:/g, "").toLowerCase() ?? /SHA256:\s*([0-9A-F:]+)/i.exec(text)?.[1]?.replace(/:/g, "").toLowerCase();

export function checkSignature(apk) {
  const signer = apksigner();
  if (!signer) return { ok: false, message: "apksigner was not found in the Android SDK build-tools." };
  const env = { ...process.env, JAVA_HOME: jbr };
  const a = spawnSync(`"${signer}"`, ["verify", "--print-certs", `"${apk}"`], { shell: true, encoding: "utf8", env });
  const apkSha = sha256(a.stdout + a.stderr);
  if (!apkSha) return { ok: false, message: `could not read the certificate of the APK:\n${a.stdout}${a.stderr}` };
  const keytool = join(jbr, "bin", win ? "keytool.exe" : "keytool");
  const ks = join(homedir(), ".android", "debug.keystore");
  const k = spawnSync(`"${keytool}"`, ["-list", "-v", "-keystore", `"${ks}"`, "-storepass", "android", "-alias", "androiddebugkey"], { shell: true, encoding: "utf8", env });
  const ksSha = sha256(k.stdout + k.stderr);
  if (!ksSha) return { ok: false, message: `could not read the debug keystore (${ks}):\n${k.stdout}${k.stderr}` };
  return apkSha === ksSha
    ? { ok: true, message: `SHA-256 ${apkSha} (the same as the debug keystore: it installs over your current app)` }
    : { ok: false, message: `DIFFERENT. APK ${apkSha} vs debug keystore ${ksSha}. Installing would fail with a signature mismatch.` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const apk = resolve(process.argv[2] ?? join("android", "app", "build", "outputs", "apk", "release", "app-release.apk"));
  const r = checkSignature(apk);
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
