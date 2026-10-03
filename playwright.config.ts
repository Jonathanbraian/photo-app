import { defineConfig } from "@playwright/test";

// PW_CHROMIUM_PATH lets environments with a preinstalled Chromium skip the download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5179",
    launchOptions: {
      executablePath,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "npx vite --port 5179 --strictPort",
    url: "http://localhost:5179/tests/gl/harness.html",
    reuseExistingServer: !process.env.CI,
  },
});
