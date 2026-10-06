import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sahil.today",
  // No apostrophe here: it would break Android's strings.xml.
  appName: "Today by Sahil",
  // `npm run android:build` makes a static export into ./out
  webDir: "out",
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_today", iconColor: "#5b8a72" },
  },
};

export default config;
