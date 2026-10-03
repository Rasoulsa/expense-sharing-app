import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('uses VITE_API_BASE_URL and returns parsed JSON', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.example.test:8123')
  vi.resetModules()
  const people = [{ id: 3, name: 'Nina' }]
  const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(people)))
  vi.stubGlobal('fetch', mock)
  const { getJson } = await import('./api')
  expect(await getJson('/api/participants/')).toEqual(people)
  expect(String(mock.mock.calls[0][0])).toBe('http://api.example.test:8123/api/participants/')
})

it('rejects a successful response that contains invalid JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json')))
  const { getJson } = await import('./api')
  await expect(getJson('/api/participants/')).rejects.toThrow()
})
