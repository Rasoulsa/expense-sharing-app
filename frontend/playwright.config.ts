import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const frontendDirectory = fileURLToPath(new URL('.', import.meta.url))
const backendDirectory = fileURLToPath(new URL('../backend', import.meta.url))
const frontendUrl = 'http://localhost:5173'
const apiUrl = 'http://127.0.0.1:8001'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: frontendUrl,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run --locked --no-env-file python scripts/start_browser_backend.py',
      cwd: backendDirectory,
      url: `${apiUrl}/health/ready/`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'npm run dev -- --host localhost --port 5173 --strictPort',
      cwd: frontendDirectory,
      url: frontendUrl,
      env: { VITE_API_BASE_URL: apiUrl },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
})
