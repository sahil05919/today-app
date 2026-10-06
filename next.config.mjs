// Two builds from one codebase:
//   npm run build           -> normal Next.js build (Vercel / web / PWA)
//   npm run android:build   -> BUILD_TARGET=android: static export into ./out, wrapped by Capacitor
const isNative = process.env.BUILD_TARGET === "android";

/** @type {import('next').NextConfig} */
const nextConfig = isNative
  ? { reactStrictMode: true, output: "export", images: { unoptimized: true } }
  : {
      reactStrictMode: true,
      async headers() {
        return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
      },
    };

export default nextConfig;
