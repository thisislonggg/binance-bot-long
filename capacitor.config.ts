import type { CapacitorConfig } from "@capacitor/cli";
import configJson from "./app.config.json";

const config: CapacitorConfig = {
  appId: configJson.appId || "com.radarp2p.binance",
  appName: configJson.appName || "Radar P2P Binance",
  webDir: ".output/public",
  server: {
    // Membuka URL Vercel produksi secara langsung dengan semua fitur server / real-time
    url: configJson.server?.productionUrl || "https://binance-bot-long.vercel.app",
    cleartext: true,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: true,
    backgroundColor: configJson.window?.backgroundColor || "#0b0e14",
  },
};

export default config;
