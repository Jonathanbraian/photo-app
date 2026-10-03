import { defineConfig, devices } from "@playwright/test";

// PW_CHROMIUM_PATH lets environments with a preinstalled Chromium skip the download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

// Chromium matches WebView2 (Windows); WebKit is the engine of WKWebView (macOS).
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: "http://localhost:5179" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath,
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npx vite --port 5179 --strictPort",
    url: "http://localhost:5179/tests/gl/harness.html",
    reuseExistingServer: !process.env.CI,
  },
});
