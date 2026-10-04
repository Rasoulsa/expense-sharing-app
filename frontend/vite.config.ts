import { configDefaults, defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const { VITE_API_BASE_URL: apiUrl = '' } = loadEnv(mode, process.cwd(), 'VITE_')
    let valid = false
    try {
      const url = new URL(apiUrl)
      valid = /^https?:\/\//.test(apiUrl) && ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
        && !url.hostname.includes('*') && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash && !/\s/.test(apiUrl)
    } catch { /* Report a sanitized error; never print a supplied credential. */ }
    if (!valid) {
      throw new Error('VITE_API_BASE_URL is required for builds: use a public HTTP(S) API origin without credentials, path, query, or fragment.')
    }
  }
  return {
    plugins: [react()],
    server: { host: 'localhost', port: 5173, strictPort: true },
    test: { environment: 'jsdom', exclude: [...configDefaults.exclude, 'e2e/**'] },
  }
})
