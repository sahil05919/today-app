import fs from "node:fs";
let raw = fs.readFileSync("components/Capture.tsx", "utf8"); const crlf = raw.includes("\r\n"); let s = raw.replace(/\r\n/g, "\n");
const bad = "/^s*clear/i.test(text) && text.trim().split(/s+/).length <= 2)";
if (!s.includes(bad)) throw new Error("x");
s = s.replace(bad, "/^\s*clear\b/i.test(text) && text.trim().split(/\s+/).length <= 2)");
fs.writeFileSync("components/Capture.tsx", crlf ? s.replace(/\n/g, "\r\n") : s);
