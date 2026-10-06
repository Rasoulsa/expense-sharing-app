import { afterEach, expect, it, vi } from 'vitest'

const participants = [{ id: 7, name: 'Nina' }, { id: 11, name: 'Omar' }]
const occasions = [{ id: 55, name: 'Dinner' }]
const expenses = [{
  id: 42,
  paid_by: participants[0],
  expense_for: participants[1], occasion: null,
  amount: '12.34',
  description: 'Lunch',
  created_at: '2026-10-04T10:00:00Z',
}]
const balances = [{ debtor: participants[1], creditor: participants[0], amount: '1999999.98' }]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it.each([
  ['getParticipants', '/api/participants/', participants],
  ['getOccasions', '/api/occasions/', occasions],
  ['getExpenses', '/api/expenses/', expenses],
  ['getBalances', '/api/balances/', balances],
] as const)('%s uses the configured API URL and preserves the response shape', async (method, path, data) => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test:8123/')
  vi.resetModules()
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(data)))
  vi.stubGlobal('fetch', mock)
  const api = await import('./api')
  const controller = new AbortController()
  expect(await api[method](controller.signal)).toEqual(data)
  expect(String(mock.mock.calls[0][0])).toBe(`https://api.example.test:8123${path}`)
  expect(mock.mock.calls[0][1]).toEqual({
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  })
  expect(mock).toHaveBeenCalledTimes(1)
})

it('uses the local backend when VITE_API_BASE_URL is unset', async () => {
  vi.stubEnv('VITE_API_BASE_URL', undefined)
  vi.resetModules()
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response('[]'))
  vi.stubGlobal('fetch', mock)
  const { getExpenses } = await import('./api')
  expect(await getExpenses()).toEqual([])
  expect(String(mock.mock.calls[0][0])).toBe('http://localhost:8000/api/expenses/')
})

it('rejects an unsuccessful HTTP response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })))
  const { getBalances } = await import('./api')
  await expect(getBalances()).rejects.toThrow('Request failed (503)')
})

it('rejects a successful response that contains invalid JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json')))
  const { getExpenses } = await import('./api')
  await expect(getExpenses()).rejects.toThrow()
})

it('POSTs numeric participant and occasion IDs and decimal strings to the configured URL', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test:8123')
  vi.resetModules()
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(expenses[0]), { status: 201 }))
  vi.stubGlobal('fetch', mock)
  const { createExpense } = await import('./api')
  const input = { paid_by: 7, expense_for: 11, occasion: 55, amount: '12.34', description: 'Lunch' }
  expect(await createExpense(input)).toEqual(expenses[0])
  expect(String(mock.mock.calls[0][0])).toBe('https://api.example.test:8123/api/expenses/')
  expect(mock.mock.calls[0][1]).toEqual({
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
})

it('preserves DRF validation messages in a typed API error', async () => {
  const errors = { amount: ['Enter a decimal string.'], expense_for: ['Choose a different participant.'], occasion: ['Choose an existing occasion.'], non_field_errors: ['Review this expense.'] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(errors), { status: 400 })))
  const { createExpense, ApiError } = await import('./api')
  const result = createExpense({ paid_by: 7, expense_for: 11, amount: '0', description: 'Lunch' })
  await expect(result).rejects.toBeInstanceOf(ApiError)
  await expect(result).rejects.toMatchObject({ status: 400, fieldErrors: errors })
})

it.each([400, 500])('reports non-JSON POST errors with status %i', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status })))
  const { createExpense } = await import('./api')
  await expect(createExpense({ paid_by: 7, expense_for: 11, amount: '12.34', description: 'Lunch' }))
    .rejects.toMatchObject({ status, fieldErrors: {} })
})

it('creates an occasion through the configured API and keeps the returned ID numeric', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test:8123')
  vi.resetModules()
  const occasion = { id: 315, name: 'Trip' }
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(occasion), { status: 201 }))
  vi.stubGlobal('fetch', mock)
  const { createOccasion } = await import('./api')
  expect(await createOccasion({ name: 'Trip' })).toEqual(occasion)
  expect(String(mock.mock.calls[0][0])).toBe('https://api.example.test:8123/api/occasions/')
  expect(mock.mock.calls[0][1]).toEqual({
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Trip' }),
  })
})

it('preserves occasion field errors from the backend', async () => {
  const errors = { name: ['An occasion with this name already exists.'] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(errors), { status: 400 })))
  const { createOccasion } = await import('./api')
  await expect(createOccasion({ name: 'Dinner' })).rejects.toMatchObject({ status: 400, fieldErrors: errors })
})

it('filters expenses with the occasion ID while preserving the nested response and abort signal', async () => {
  const assigned = { ...expenses[0], occasion: occasions[0] }
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([assigned])))
  vi.stubGlobal('fetch', mock)
  const { getExpenses } = await import('./api')
  const controller = new AbortController()
  expect(await getExpenses(controller.signal, 55)).toEqual([assigned])
  expect(new URL(String(mock.mock.calls[0][0])).search).toBe('?occasion=55')
  expect(mock.mock.calls[0][1]?.signal).toBe(controller.signal)
})

it('deletes one expense at the configured URL and accepts an empty 204 body', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test:8123')
  vi.resetModules()
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', mock)
  const { deleteExpense } = await import('./api')
  await expect(deleteExpense(42)).resolves.toBeUndefined()
  expect(String(mock.mock.calls[0][0])).toBe('https://api.example.test:8123/api/expenses/42/')
  expect(mock.mock.calls[0][1]).toEqual({ method: 'DELETE', headers: { Accept: 'application/json' } })
  expect(mock).toHaveBeenCalledTimes(1)
})

it.each([404, 503])('reports DELETE status %i without requiring a JSON error body', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status })))
  const { deleteExpense, ApiError } = await import('./api')
  const result = deleteExpense(42)
  await expect(result).rejects.toBeInstanceOf(ApiError)
  await expect(result).rejects.toMatchObject({ status })
})


it('filters balances with the occasion ID and preserves the response and abort signal', async () => {
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(balances)))
  vi.stubGlobal('fetch', mock)
  const { getBalances } = await import('./api')
  const controller = new AbortController()
  expect(await getBalances(controller.signal, 55)).toEqual(balances)
  expect(new URL(String(mock.mock.calls[0][0])).search).toBe('?occasion=55')
  expect(mock.mock.calls[0][1]?.signal).toBe(controller.signal)
})

it('omits the optional occasion field on an ungrouped expense POST', async () => {
  const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(expenses[0]), { status: 201 }))
  vi.stubGlobal('fetch', mock)
  const { createExpense } = await import('./api')
  const input = { paid_by: 7, expense_for: 11, amount: '12.34', description: 'Lunch' }
  expect(await createExpense(input)).toEqual(expenses[0])
  expect(JSON.parse(mock.mock.calls[0][1]!.body as string)).toEqual(input)
})
