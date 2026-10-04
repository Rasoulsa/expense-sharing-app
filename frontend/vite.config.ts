import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5173, strictPort: true },
  test: { environment: 'jsdom', exclude: [...configDefaults.exclude, 'e2e/**'] },
})
