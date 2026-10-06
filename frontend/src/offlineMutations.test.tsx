import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import type { Expense } from './api'
import { balancesQuery, occasionsQuery, participantsQuery } from './queries'

const people = [{ id: 17, name: 'Maya' }, { id: 93, name: 'Theo' }]
const occasions = [{ id: 55, name: 'Dinner' }]
const expense: Expense = {
  id: 81, paid_by: people[0], expense_for: people[1], occasion: null, amount: '12.30',
  description: 'Train tickets', created_at: '2026-10-04T10:00:00Z',
}
const fetchMock = vi.fn<typeof fetch>()
const clients: QueryClient[] = []
const methods = ['showModal', 'close'] as const
const originals = methods.map((method) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
type Write = 'expense' | 'occasion' | 'delete'
let pendingWrite: Promise<Response> | undefined

async function renderCachedApp() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  clients.push(client)
  await Promise.all([client.fetchQuery(participantsQuery), client.fetchQuery(balancesQuery), client.fetchQuery(occasionsQuery)])
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'Train tickets' })
  return client
}

function openWrite(write: Write) {
  const triggerName = write === 'expense' ? 'Add Expense' : write === 'occasion' ? 'Add Occasion' : 'Delete expense: Train tickets ($12.30)'
  const trigger = screen.getByRole('button', { name: triggerName })
  trigger.focus()
  fireEvent.click(trigger)
  const title = write === 'expense' ? 'Add Expense' : write === 'occasion' ? 'Add Occasion' : 'Delete Expense?'
  const dialog = screen.getByRole('dialog', { name: title })
  if (write === 'expense') {
    fireEvent.change(within(dialog).getByLabelText(/^Paid by/), { target: { value: '17' } })
    fireEvent.change(within(dialog).getByLabelText(/^Expense for/), { target: { value: '93' } })
    fireEvent.change(within(dialog).getByLabelText(/^Occasion/), { target: { value: '55' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: '12.30' } })
    fireEvent.change(within(dialog).getByLabelText(/^Description/), { target: { value: 'Train tickets' } })
  } else if (write === 'occasion') {
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Leila' } })
  }
  const saveName = write === 'expense' ? 'Save Expense' : write === 'occasion' ? 'Save Occasion' : 'Delete Expense'
  const closeName = write === 'expense' ? 'Close Add Expense' : 'Cancel'
  return { dialog, trigger, saveName, closeName }
}

function writes() {
  return fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST' || options?.method === 'DELETE')
}

function successResponse(write: Write) {
  return write === 'delete' ? new Response(null, { status: 204 })
    : write === 'occasion' ? json({ id: 315, name: 'Leila' }, 201) : json({ ...expense, id: 82 }, 201)
}

beforeEach(() => {
  onlineManager.setOnline(true)
  pendingWrite = undefined
  fetchMock.mockReset().mockImplementation((input, options) => {
    if (!onlineManager.isOnline()) return Promise.reject(new TypeError('Failed to fetch'))
    const path = new URL(String(input)).pathname
    if (options?.method === 'POST' || options?.method === 'DELETE') {
      if (pendingWrite) return pendingWrite
      if (options.method === 'DELETE') return Promise.resolve(successResponse('delete'))
      return Promise.resolve(successResponse(path === '/api/occasions/' ? 'occasion' : 'expense'))
    }
    if (path === '/api/occasions/') return Promise.resolve(json(occasions))
    if (path === '/api/participants/') return Promise.resolve(json(people))
    if (path === '/api/expenses/') return Promise.resolve(json([expense]))
    if (path === '/api/balances/') return Promise.resolve(json([{ debtor: people[1], creditor: people[0], amount: '12.30' }]))
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value: function (this: HTMLDialogElement) { this.open = true },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value: function (this: HTMLDialogElement) { this.open = false },
  })
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => { client.clear() })
  onlineManager.setOnline(true)
  methods.forEach((method, index) => {
    const original = originals[index]
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method)
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  ['expense', 'button'], ['expense', 'Escape'],
  ['occasion', 'button'], ['occasion', 'Escape'],
  ['delete', 'button'], ['delete', 'Escape'],
] as const)('%s fails offline, allows %s, and never writes on reconnect', async (write, dismiss) => {
  const client = await renderCachedApp()
  const { dialog, trigger, saveName, closeName } = openWrite(write)
  act(() => { onlineManager.setOnline(false) })
  fireEvent.click(within(dialog).getByRole('button', { name: saveName }))
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toContain('You are offline. Reconnect, then try')
  await waitFor(() => { expect(client.isMutating()).toBe(0) })
  expect(writes()).toHaveLength(1)
  expect((within(dialog).getByRole('button', { name: saveName }) as HTMLButtonElement).disabled).toBe(false)
  const close = within(dialog).getByRole('button', { name: closeName }) as HTMLButtonElement
  expect(close.disabled).toBe(false)
  if (write === 'expense') {
    expect((within(dialog).getByLabelText(/^Amount/) as HTMLInputElement).value).toBe('12.30')
    expect((within(dialog).getByLabelText(/^Amount/).closest('fieldset')!).disabled).toBe(false)
  } else if (write === 'occasion') {
    const input = within(dialog).getByLabelText('Name') as HTMLInputElement
    expect(input.value).toBe('Leila')
    expect(input.disabled).toBe(false)
  }
  if (dismiss === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
  else fireEvent.click(close)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await act(async () => {
    onlineManager.setOnline(true)
    await client.resumePausedMutations()
  })
  expect(writes()).toHaveLength(1)
  expect(client.getQueryData(['expenses'])).toEqual([expense])
  expect(client.getQueryData(['participants'])).toEqual(people)
  expect(client.getMutationCache().getAll().every((mutation) => mutation.state.status === 'error' && !mutation.state.isPaused)).toBe(true)
})

it.each(['expense', 'occasion', 'delete'] as const)('%s settles when its successful response is followed by offline-paused reads', async (write) => {
  const client = await renderCachedApp()
  const { dialog, saveName } = openWrite(write)
  let resolve!: (response: Response) => void
  pendingWrite = new Promise((done) => { resolve = done })
  fireEvent.click(within(dialog).getByRole('button', { name: saveName }))
  await waitFor(() => { expect(writes()).toHaveLength(1) })
  await act(async () => {
    onlineManager.setOnline(false)
    resolve(successResponse(write))
  })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  await waitFor(() => { expect(client.isMutating()).toBe(0) })
  const key = write === 'occasion' ? ['occasions'] : ['expenses']
  // Reads retain their normal online-only behavior while the write has settled.
  expect(client.getQueryState(key)?.fetchStatus).toBe('paused')
  expect(writes()).toHaveLength(1)
  expect(client.getMutationCache().getAll().every((mutation) => mutation.state.status === 'success')).toBe(true)
  if (write === 'delete') {
    expect(client.getQueryData(['expenses'])).toEqual([])
    expect(screen.queryByRole('button', { name: 'Delete expense: Train tickets ($12.30)' })).toBeNull()
  }
})
