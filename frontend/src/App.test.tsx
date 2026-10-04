import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Balance, Expense } from './api'

const fetchMock = vi.fn<typeof fetch>()
const participants = [{ id: 7, name: 'Nina' }, { id: 11, name: 'Omar' }, { id: 21, name: 'Imani' }]
const expenses: Expense[] = [
  {
    id: 42,
    paid_by: participants[0],
    expense_for: participants[1],
    amount: '12.34',
    description: 'Shared lunch',
    created_at: '2026-10-04T10:00:00Z',
  },
  {
    id: 39,
    paid_by: participants[1],
    expense_for: participants[2],
    amount: '0.01',
    description: 'Bus fare',
    created_at: '2026-10-03T10:00:00Z',
  },
]
const balances: Balance[] = [
  { debtor: participants[1], creditor: participants[0], amount: '12.34' },
  { debtor: participants[2], creditor: participants[1], amount: '1999999.98' },
]
const json = (data: unknown) => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
})
const clients: QueryClient[] = []

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
}

function pendingResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

async function openView(view: 'expenses' | 'balances') {
  renderApp()
  if (view === 'balances') {
    await screen.findByRole('list', { name: 'Expenses' })
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
  }
}

function mockViewResponse(view: 'expenses' | 'balances', response: () => Promise<Response>) {
  fetchMock.mockImplementation((input) => {
    const path = new URL(String(input)).pathname
    if (path === `/api/${view}/`) return response()
    if (path === '/api/expenses/') return Promise.resolve(json(expenses))
    throw new Error(`Unexpected request: ${path}`)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => { client.clear() })
  vi.unstubAllGlobals()
})

describe('expense sharing views', () => {
  it('initially selects Expenses and renders all expense fields in API order', async () => {
    const pending = pendingResponse()
    fetchMock.mockReturnValue(pending.promise)
    renderApp()
    expect(screen.getByRole('tab', { name: 'Expenses', selected: true })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Loading expenses')
    const [url, options] = fetchMock.mock.calls[0]
    expect(new URL(String(url)).pathname).toBe('/api/expenses/')
    expect(options?.headers).toEqual({ Accept: 'application/json' })
    await act(async () => { pending.resolve(json(expenses)) })
    const list = await screen.findByRole('list', { name: 'Expenses' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByRole('heading', { name: 'Shared lunch' })).toBeTruthy()
    expect(within(items[1]).getByRole('heading', { name: 'Bus fare' })).toBeTruthy()
    for (const [index, expense] of expenses.entries()) {
      const item = within(items[index])
      expect(item.getByText('Paid by').nextElementSibling?.textContent).toBe(expense.paid_by.name)
      expect(item.getByText('For').nextElementSibling?.textContent).toBe(expense.expense_for.name)
      expect(item.getByText('Amount').nextElementSibling?.textContent).toBe(`$${expense.amount}`)
      const date = items[index].querySelector('time')!
      expect(date.dateTime).toBe(expense.created_at)
      expect(date.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(expense.created_at)))
      expect(date.textContent).toContain('2026')
    }
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('switches to Balances, loads directional pairs, and returns to cached Expenses', async () => {
    const pending = pendingResponse()
    fetchMock.mockResolvedValueOnce(json(expenses)).mockReturnValueOnce(pending.promise)
    renderApp()
    await screen.findByRole('list', { name: 'Expenses' })
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    expect(screen.getByRole('status').textContent).toContain('Loading balances')
    expect(screen.getByRole('tab', { name: 'Balances', selected: true })).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'Balances' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Expenses' })).toBeNull()
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/api/balances/')
    await act(async () => { pending.resolve(json(balances)) })
    const list = await screen.findByRole('list', { name: 'Balances' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Omar owes Nina $12.34',
      'Imani owes Omar $1999999.98',
    ])
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    expect(screen.getByRole('list', { name: 'Expenses' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Balances' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('supports arrow keys, Home, and End with tab focus and panel labels', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json([])))
    renderApp()
    await screen.findByText('No expenses yet.')
    const expensesTab = screen.getByRole('tab', { name: 'Expenses' })
    const balancesTab = screen.getByRole('tab', { name: 'Balances' })
    expensesTab.focus()
    expect(expensesTab.tabIndex).toBe(0)
    expect(balancesTab.tabIndex).toBe(-1)

    for (const [key, target] of [
      ['ArrowRight', balancesTab],
      ['ArrowRight', expensesTab],
      ['ArrowLeft', balancesTab],
      ['Home', expensesTab],
      ['End', balancesTab],
    ] as const) {
      fireEvent.keyDown(document.activeElement!, { key })
      expect(document.activeElement).toBe(target)
      expect(target.getAttribute('aria-selected')).toBe('true')
      expect(target.tabIndex).toBe(0)
      const panel = screen.getByRole('tabpanel', { name: target.textContent! })
      expect(target.getAttribute('aria-controls')).toBe(panel.id)
      expect(panel.getAttribute('aria-labelledby')).toBe(target.id)
      expect(panel.tabIndex).toBe(0)
    }
    await screen.findByText('No outstanding balances.')
  })

  describe.each(['expenses', 'balances'] as const)('%s', (view) => {
    it('shows a useful empty state for an empty API array', async () => {
      mockViewResponse(view, () => Promise.resolve(json([])))
      await openView(view)
      const message = view === 'expenses' ? 'No expenses yet.' : 'No outstanding balances.'
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByRole('status').textContent).toContain(message)
      expect(screen.queryByRole('list')).toBeNull()
    })

    it.each(['network', 'http', 'invalid JSON'])('shows a useful error after %s failure', async (failure) => {
      mockViewResponse(view, () => {
        if (failure === 'network') return Promise.reject(new TypeError('Failed to fetch'))
        if (failure === 'http') return Promise.resolve(new Response('Unavailable', { status: 503 }))
        return Promise.resolve(new Response('invalid json'))
      })
      await openView(view)
      expect((await screen.findByRole('alert')).textContent).toContain(`Could not load ${view}. Check your connection`)
      expect(screen.getByRole('button', { name: `Retry ${view}` })).toBeTruthy()
      expect(screen.queryByRole('list')).toBeNull()
    })

    it('retries the failed endpoint and replaces the error with fetched data', async () => {
      const pending = pendingResponse()
      const respond = vi.fn<() => Promise<Response>>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockReturnValueOnce(pending.promise)
      mockViewResponse(view, respond)
      await openView(view)
      await screen.findByRole('alert')
      fireEvent.click(screen.getByRole('button', { name: `Retry ${view}` }))
      expect((await screen.findByRole('status')).textContent).toContain(`Loading ${view}`)
      expect(screen.queryByRole('alert')).toBeNull()
      await act(async () => { pending.resolve(json(view === 'expenses' ? expenses : balances)) })
      expect(await screen.findByRole('list', { name: view === 'expenses' ? 'Expenses' : 'Balances' })).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === `/api/${view}/`)).toHaveLength(2)
    })
  })

  it('aborts a pending fetch on unmount', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { unmount } = renderApp()
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('aborts the previous view request when switching during loading', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(json(balances))
    renderApp()
    const signal = fetchMock.mock.calls[0][1]?.signal
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    expect(signal?.aborted).toBe(true)
    expect(await screen.findByRole('list', { name: 'Balances' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Expenses' })).toBeNull()
  })
})
