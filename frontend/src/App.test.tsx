import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Balance, Expense } from './api'

const fetchMock = vi.fn<typeof fetch>()
const participants = [{ id: 7, name: 'Nina' }, { id: 11, name: 'Omar' }, { id: 21, name: 'Imani' }]
const occasion = { id: 55, name: 'Dinner' }
const expenses: Expense[] = [
  {
    id: 42,
    paid_by: participants[0],
    expense_for: participants[1], occasion,
    amount: '12.34',
    description: 'Shared lunch',
    created_at: '2026-10-04T10:00:00Z',
  },
  {
    id: 39,
    paid_by: participants[1],
    expense_for: participants[2], occasion: null,
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
    const url = new URL(String(input))
    const path = url.pathname
    if (path === `/api/${view}/`) {
      return response()
    }
    if (path === '/api/expenses/') return Promise.resolve(json(expenses))
    throw new Error(`Unexpected request: ${path}`)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/occasions/') return json([occasion])
    const response = await fetchMock(input, options)
    return response
  })
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

  it('keeps each tab’s occasion selection independent when switching and clearing', async () => {
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/balances/') return Promise.resolve(json(url.search ? [balances[0]] : balances))
      return Promise.resolve(json(url.search ? [expenses[0]] : expenses))
    })
    renderApp()
    await screen.findByRole('heading', { name: 'Bus fare' })
    expect(screen.queryByRole('button', { name: 'Add Person' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Occasion' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show expenses for Dinner' }))
    await waitFor(() => { expect(screen.queryByRole('heading', { name: 'Bus fare' })).toBeNull() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear filter' }))
    expect((await screen.findByRole('button', { name: 'Show expenses for Dinner' })).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toContain('Imani owes Omar')
    let select = screen.getByRole('combobox', { name: 'Filter balances by occasion' }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/balances/').map(([input]) => new URL(String(input)).search)).toEqual([''])
    await within(select).findByRole('option', { name: 'Dinner' })
    fireEvent.change(select, { target: { value: '55' } })
    await waitFor(() => { expect(screen.getByRole('list', { name: 'Balances' }).textContent).toBe('Omar owes Nina $12.34') })
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    expect(screen.queryByRole('heading', { name: 'Bus fare' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(await screen.findByRole('heading', { name: 'Bus fare' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    select = screen.getByRole('combobox', { name: 'Filter balances by occasion' }) as HTMLSelectElement
    expect(select.value).toBe('55')
    expect(screen.getByRole('list', { name: 'Balances' }).textContent).toBe('Omar owes Nina $12.34')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(select.value).toBe('')
    expect(document.activeElement).toBe(select)
    expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toContain('Imani owes Omar')
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    expect(screen.getByRole('heading', { name: 'Bus fare' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull()
  })

  it('shows one settled global result when opposing expenses cancel, and the selected occasion’s own net', async () => {
    const opposing = { ...expenses[0], id: 43, paid_by: participants[1], expense_for: participants[0], occasion: null, description: 'Opposing payment' }
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/expenses/') return Promise.resolve(json([expenses[0], opposing]))
      return Promise.resolve(json(url.search ? [balances[0]] : []))
    })
    renderApp()
    await screen.findByRole('heading', { name: 'Opposing payment' })
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    await screen.findByText('No outstanding balances.')
    expect(screen.getByText('All participant pairs are settled across all occasions and ungrouped expenses.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Overall' })).toBeNull()
    const select = screen.getByRole('combobox', { name: 'Filter balances by occasion' })
    await within(select).findByRole('option', { name: 'Dinner' })
    fireEvent.change(select, { target: { value: '55' } })
    expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toBe('Omar owes Nina $12.34')
    expect(screen.getAllByRole('list')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    await screen.findByText('No outstanding balances.')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it.each(['empty', 'error'] as const)('keeps the filter clearable when the filtered request is %s', async (state) => {
    let attempts = 0
    fetchMock.mockImplementation((input) => {
      if (!new URL(String(input)).search) return Promise.resolve(json(expenses))
      attempts += 1
      if (state === 'error' && attempts === 1) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(json([]))
    })
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Show expenses for Dinner' }))
    if (state === 'error') {
      await screen.findByRole('alert')
      expect(screen.getByRole('button', { name: 'Clear filter' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Retry expenses' }))
    }
    await screen.findByText('No expenses for Dinner.')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(await screen.findByRole('heading', { name: 'Bus fare' })).toBeTruthy()
  })

  it('cancels a filtered read when cleared and ignores its late response', async () => {
    const pending = pendingResponse()
    fetchMock.mockImplementation((input) => new URL(String(input)).search ? pending.promise : Promise.resolve(json(expenses)))
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Show expenses for Dinner' }))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    const signal = fetchMock.mock.calls[1][1]?.signal
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(json([expenses[0]])) })
    expect(screen.getByRole('heading', { name: 'Bus fare' })).toBeTruthy()
  })

  it.each(['empty', 'error'] as const)('retains a balance-only %s filter across tabs without filtering Expenses', async (state) => {
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/expenses/') return Promise.resolve(json(url.search ? [expenses[0]] : expenses))
      if (url.searchParams.has('occasion') && state === 'error') return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(json(url.searchParams.has('occasion') ? [] : balances))
    })
    renderApp()
    await screen.findByRole('list', { name: 'Expenses' })
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    const select = await screen.findByRole('combobox', { name: 'Filter balances by occasion' })
    await within(select).findByRole('option', { name: 'Dinner' })
    select.focus()
    fireEvent.change(select, { target: { value: '55' } })
    expect(document.activeElement).toBe(select)
    if (state === 'error') await screen.findByRole('alert')
    else await screen.findByText('No outstanding balances for Dinner.')
    expect(screen.getByText('See what is owed between each pair of people for Dinner.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    await screen.findByRole('heading', { name: 'Shared lunch' })
    expect(screen.getByRole('heading', { name: 'Bus fare' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    expect((screen.getByRole('combobox', { name: 'Filter balances by occasion' }) as HTMLSelectElement).value).toBe('55')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toContain('Imani owes Omar')
  })

  it('cancels a filtered balance read on clearing and ignores the late result', async () => {
    const pending = pendingResponse()
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/expenses/') return Promise.resolve(json(expenses))
      return url.searchParams.has('occasion') ? pending.promise : Promise.resolve(json(balances))
    })
    renderApp()
    await screen.findByRole('list', { name: 'Expenses' })
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    const select = screen.getByRole('combobox', { name: 'Filter balances by occasion' })
    await within(select).findByRole('option', { name: 'Dinner' })
    fireEvent.change(select, { target: { value: '55' } })
    await waitFor(() => { expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).search === '?occasion=55')).toBe(true) })
    const signal = fetchMock.mock.calls.at(-1)![1]?.signal
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(json([])) })
    expect((await screen.findByRole('list', { name: 'Balances' })).textContent).toContain('Imani owes Omar')
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
