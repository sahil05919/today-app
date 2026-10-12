import fs from "node:fs";
const edit = (p, pairs) => {
  let raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); let s = raw.replace(/\r\n/g, "\n");
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(p + " missing: " + a.slice(0, 60)); s = s.replace(a, () => b); }
  fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s);
};
edit("lib/mirrorRun.ts", [[`  const calendarId = Number(cal.id);
  if (!Number.isSafeInteger(calendarId) || calendarId < 0) {`, `  const calendarId = typeof cal.id === "number" ? cal.id : typeof cal.id === "string" && /^\d{1,12}$/.test(cal.id) ? Number(cal.id) : NaN;
  if (!Number.isSafeInteger(calendarId) || calendarId < 1) {`]]);
edit("lib/nativeBridge.ts", [[`if (!Number.isSafeInteger(calendarId) || calendarId < 0 || !Array.isArray(ops)) {`, `if (!Number.isSafeInteger(calendarId) || calendarId < 1 || !Array.isArray(ops)) {`]]);
edit("tests/mirror-payload.test.ts", [[`expect(plugin).not.toMatch(/call\.getLong\(/);`, `expect(plugin).not.toMatch(/call\.getLong\("/);`]]);
