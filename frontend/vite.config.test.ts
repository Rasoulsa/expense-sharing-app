import { afterEach, expect, it, vi } from 'vitest'
import config from './vite.config'

afterEach(() => vi.unstubAllEnvs())

it.each([
  '', 'not-a-url', '/api', 'ftp://api.example.test', 'https:api.example.test', 'https://*.example.test',
  'https://user:pretend-secret@api.example.test', 'https://api.example.test/api',
  'https://api.example.test?token=pretend-secret', 'https://api.example.test/#fragment',
])('rejects an unusable public API URL at build time (%s)', async (url) => {
  vi.stubEnv('VITE_API_BASE_URL', url)
  expect(() => config({ command: 'build', mode: 'production' })).toThrow(
    'VITE_API_BASE_URL is required for builds',
  )
})

it.each(['https://api.example.test', 'http://localhost:8000/'])('accepts a public API origin (%s)', (url) => {
  vi.stubEnv('VITE_API_BASE_URL', url)
  expect(() => config({ command: 'build', mode: 'production' })).not.toThrow()
})

it('keeps the development server usable without an API URL', () => {
  vi.stubEnv('VITE_API_BASE_URL', '')
  expect(() => config({ command: 'serve', mode: 'development' })).not.toThrow()
})
