import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.delrio.app",
  appName: "Del Rio",
  webDir: "out",
  server: {
    androidScheme: "https",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0f0f1b",
  },
  android: {
    backgroundColor: "#0f0f1b",
    captureInput: true,
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#0f0f1b",
      androidSplashResourceName: "splash",
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0f0f1b",
    },
  },
};

export default config;
