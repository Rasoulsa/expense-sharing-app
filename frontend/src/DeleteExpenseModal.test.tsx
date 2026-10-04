import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import type { Expense } from './api'

const alice = { id: 17, name: 'Alice' }
const bob = { id: 93, name: 'Bob' }
const forward: Expense = {
  id: 81, paid_by: alice, expense_for: bob, amount: '50.00',
  description: 'Shared lunch', created_at: '2026-10-04T10:00:00Z',
}
const reverse: Expense = {
  id: 82, paid_by: bob, expense_for: alice, amount: '20.00',
  description: 'Return payment', created_at: '2026-10-04T11:00:00Z',
}
const initialExpenses = [reverse, forward]
const initialBalances = [{ debtor: bob, creditor: alice, amount: '30.00' }]
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const fetchMock = vi.fn<typeof fetch>()
const expensesResponse = vi.fn<() => Promise<Response>>()
const balancesResponse = vi.fn<() => Promise<Response>>()
const deleteResponse = vi.fn<() => Promise<Response>>()
const clients: QueryClient[] = []
const methods = ['showModal', 'close'] as const
const originals = methods.map((method) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method))

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  clients.push(client)
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
  return client
}

function openConfirmation() {
  const trigger = screen.getByRole('button', { name: 'Delete expense: Return payment ($20.00)' })
  trigger.focus()
  fireEvent.click(trigger)
  return screen.getByRole('dialog', { name: 'Delete Expense?' })
}

async function openLoadedConfirmation() {
  const client = renderApp()
  await screen.findByRole('heading', { name: 'Return payment' })
  return { client, dialog: openConfirmation() }
}

function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete Expense' }))
}

function pendingResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  expensesResponse.mockReset().mockImplementation(() => Promise.resolve(json(initialExpenses)))
  balancesResponse.mockReset().mockImplementation(() => Promise.resolve(json(initialBalances)))
  deleteResponse.mockReset().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
  fetchMock.mockReset().mockImplementation((input, options) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/expenses/82/' && options?.method === 'DELETE') return deleteResponse()
    if (path === '/api/expenses/' && !options?.method) return expensesResponse()
    if (path === '/api/balances/' && !options?.method) return balancesResponse()
    throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${path}`)
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
  methods.forEach((method, index) => {
    const original = originals[index]
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method)
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['Cancel', 'Escape', 'native cancel'])('names the expense and amount, and leaves both views unchanged after %s', async (action) => {
  const client = renderApp()
  await screen.findByRole('list', { name: 'Expenses' })
  fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
  await screen.findByRole('list', { name: 'Balances' })
  fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
  const trigger = screen.getByRole('button', { name: 'Delete expense: Return payment ($20.00)' })
  const dialog = openConfirmation()
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
  expect(document.activeElement).toBe(cancel)
  expect(dialog.getAttribute('aria-describedby')).toBe('delete-expense-description')
  expect(within(dialog).getByText('“Return payment”')).toBeTruthy()
  expect(within(dialog).getByText('$20.00')).toBeTruthy()
  expect(deleteResponse).not.toHaveBeenCalled()
  if (action === 'Cancel') fireEvent.click(cancel)
  else if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
  else fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(client.getQueryData(['expenses'])).toEqual(initialExpenses)
  expect(client.getQueryData(['balances'])).toEqual(initialBalances)
  expect(expensesResponse).toHaveBeenCalledTimes(1)
  expect(balancesResponse).toHaveBeenCalledTimes(1)
  expect(deleteResponse).not.toHaveBeenCalled()
})

it('keeps Tab and Shift+Tab inside the confirmation', async () => {
  const { dialog } = await openLoadedConfirmation()
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
  const remove = within(dialog).getByRole('button', { name: 'Delete Expense' })
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(remove)
  fireEvent.keyDown(remove, { key: 'Tab' })
  expect(document.activeElement).toBe(cancel)
})

it.each([true, false])('deletes only the selected expense and refreshes balances (previously opened: %s)', async (cachedBalances) => {
  const client = renderApp()
  await screen.findByRole('list', { name: 'Expenses' })
  if (cachedBalances) {
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    await screen.findByRole('list', { name: 'Balances' })
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
  }
  openConfirmation()
  expensesResponse.mockImplementation(() => Promise.resolve(json([forward])))
  balancesResponse.mockImplementation(() => Promise.resolve(json([{ debtor: bob, creditor: alice, amount: '50.00' }])))
  confirm()
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Expenses' }))
  await waitFor(() => {
    expect(client.getQueryData(['expenses'])).toEqual([forward])
    expect(client.getQueryData(['balances'])).toEqual([{ debtor: bob, creditor: alice, amount: '50.00' }])
  })
  expect(screen.queryByRole('heading', { name: 'Return payment' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Shared lunch' })).toBeTruthy()
  expect(screen.getByText('Deleted “Return payment” ($20.00).')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
  expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toBe('Bob owes Alice $50.00')
  expect(expensesResponse).toHaveBeenCalledTimes(2)
  expect(balancesResponse).toHaveBeenCalledTimes(cachedBalances ? 2 : 1)
  expect(deleteResponse).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE')?.[1]?.body).toBeUndefined()
})

it('shows an actionable 404 error and preserves the confirmation and cached data', async () => {
  deleteResponse.mockResolvedValueOnce(json({ detail: 'Not found.' }, 404))
  const { client, dialog } = await openLoadedConfirmation()
  confirm()
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toBe('This expense no longer exists. Reload the page to refresh your list.')
  expect(document.activeElement).toBe(alert)
  expect(within(dialog).getByText('“Return payment”')).toBeTruthy()
  expect(within(dialog).getByText('$20.00')).toBeTruthy()
  expect(client.getQueryData(['expenses'])).toEqual(initialExpenses)
  expect(expensesResponse).toHaveBeenCalledTimes(1)
  expect(balancesResponse).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete expense: Return payment ($20.00)' }))
})

it.each(['network', 'server'])('keeps the confirmation after a %s error and allows retry', async (failure) => {
  if (failure === 'network') deleteResponse.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  else deleteResponse.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
  const { dialog } = await openLoadedConfirmation()
  confirm()
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toBe('Could not delete expense. Check your connection and try again.')
  expect(document.activeElement).toBe(alert)
  expect((within(dialog).getByRole('button', { name: 'Delete Expense' }) as HTMLButtonElement).disabled).toBe(false)
  expect(expensesResponse).toHaveBeenCalledTimes(1)
  expensesResponse.mockImplementation(() => Promise.resolve(json([forward])))
  confirm()
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(deleteResponse).toHaveBeenCalledTimes(2)
})

it('prevents repeated requests and dismissal while deleting', async () => {
  let resolve!: (response: Response) => void
  deleteResponse.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { dialog } = await openLoadedConfirmation()
  const button = within(dialog).getByRole('button', { name: 'Delete Expense' })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => { expect(deleteResponse).toHaveBeenCalledTimes(1) })
  expect((within(dialog).getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement).disabled).toBe(true)
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
  expect((cancel as HTMLButtonElement).disabled).toBe(true)
  expect(within(dialog).getByRole('status').textContent).toBe('Deleting expense…')
  fireEvent.click(cancel)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Delete Expense?' }))
  expect(screen.getByRole('dialog', { name: 'Delete Expense?' })).toBe(dialog)
  expect(deleteResponse).toHaveBeenCalledTimes(1)
  expensesResponse.mockImplementation(() => Promise.resolve(json([forward])))
  await act(async () => { resolve(new Response(null, { status: 204 })) })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('shows empty expenses and balances after deleting the last expense', async () => {
  expensesResponse.mockImplementation(() => Promise.resolve(json([reverse])))
  await openLoadedConfirmation()
  expensesResponse.mockImplementation(() => Promise.resolve(json([])))
  balancesResponse.mockImplementation(() => Promise.resolve(json([])))
  confirm()
  expect(await screen.findByText('No expenses yet.')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Expenses' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
  expect(await screen.findByText('No outstanding balances.')).toBeTruthy()
})

it('keeps the deleted card absent after a slow refresh is canceled by switching views', async () => {
  const slow = pendingResponse()
  const replacement = pendingResponse()
  const { client } = await openLoadedConfirmation()
  expensesResponse.mockReturnValueOnce(slow.promise).mockReturnValueOnce(replacement.promise)
  balancesResponse.mockImplementation(() => Promise.resolve(json([{ debtor: bob, creditor: alice, amount: '50.00' }])))
  confirm()
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  await waitFor(() => { expect(expensesResponse).toHaveBeenCalledTimes(2) })
  const signal = fetchMock.mock.calls.filter(([url, options]) => new URL(String(url)).pathname === '/api/expenses/' && !options?.method).at(-1)![1]!.signal
  expect(signal?.aborted).toBe(false)
  fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
  expect(signal?.aborted).toBe(true)
  expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toBe('Bob owes Alice $50.00')
  await waitFor(() => { expect(client.isMutating()).toBe(0) })
  fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
  await waitFor(() => { expect(expensesResponse).toHaveBeenCalledTimes(3) })
  expect(client.getQueryData(['expenses'])).toEqual([forward])
  expect(screen.queryByRole('heading', { name: 'Return payment' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Delete expense: Return payment ($20.00)' })).toBeNull()
  const remaining = screen.getByRole('button', { name: 'Delete expense: Shared lunch ($50.00)' }) as HTMLButtonElement
  expect(remaining.disabled).toBe(false)
  expect(deleteResponse).toHaveBeenCalledTimes(1)
  // A late transport response from the canceled GET must also be ignored.
  await act(async () => { slow.resolve(json(initialExpenses)) })
  expect(client.getQueryData(['expenses'])).toEqual([forward])
  await act(async () => { replacement.resolve(json([forward])) })
  await waitFor(() => { expect(screen.queryByRole('button', { name: 'Delete expense: Return payment ($20.00)' })).toBeNull() })
  expect(deleteResponse).toHaveBeenCalledTimes(1)
})

it('cancels a pre-delete GET before removing the ID so cancellation cannot restore it', async () => {
  const beforeDelete = pendingResponse()
  const afterDelete = pendingResponse()
  const { client } = await openLoadedConfirmation()
  expensesResponse.mockReturnValueOnce(beforeDelete.promise).mockReturnValueOnce(afterDelete.promise)
  act(() => { void client.refetchQueries({ queryKey: ['expenses'] }) })
  await waitFor(() => { expect(expensesResponse).toHaveBeenCalledTimes(2) })
  const signal = fetchMock.mock.calls.filter(([url, options]) => new URL(String(url)).pathname === '/api/expenses/' && !options?.method).at(-1)![1]!.signal
  confirm()
  await waitFor(() => { expect(expensesResponse).toHaveBeenCalledTimes(3) })
  expect(signal?.aborted).toBe(true)
  expect(client.getQueryData(['expenses'])).toEqual([forward])
  expect(screen.queryByRole('heading', { name: 'Return payment' })).toBeNull()
  await act(async () => { beforeDelete.resolve(json(initialExpenses)) })
  expect(client.getQueryData(['expenses'])).toEqual([forward])
  await act(async () => { afterDelete.resolve(json([forward])) })
  expect(deleteResponse).toHaveBeenCalledTimes(1)
})

it('does not offer another DELETE when refreshing after success fails; the view can retry', async () => {
  await openLoadedConfirmation()
  expensesResponse.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load expenses')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(deleteResponse).toHaveBeenCalledTimes(1)
  expensesResponse.mockImplementation(() => Promise.resolve(json([forward])))
  fireEvent.click(screen.getByRole('button', { name: 'Retry expenses' }))
  expect(await screen.findByRole('heading', { name: 'Shared lunch' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Return payment' })).toBeNull()
})
