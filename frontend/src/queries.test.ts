import { waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { Expense } from './api'
import { balanceListQuery, expensesQuery, occasionExpensesQuery, refreshExpenseViews } from './queries'

afterEach(() => { vi.unstubAllGlobals() })

it.each(['create', 'delete'] as const)('refreshes inactive occasion caches after expense %s within staleTime', async (mutation) => {
  const alice = { id: 17, name: 'Alice' }
  const bob = { id: 93, name: 'Bob' }
  const birthday = { id: 55, name: 'Birthday' }
  const trip = { id: 77, name: 'Trip' }
  const existing: Expense = {
    id: 81, paid_by: alice, expense_for: bob, occasion: birthday, amount: '50.00',
    description: 'Lunch', created_at: '2026-10-04T10:00:00Z',
  }
  const created: Expense = { ...existing, id: 82, occasion: trip, amount: '20.00', description: 'Tickets' }
  let rows = [existing]
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = new URL(String(input))
    const occasionId = url.searchParams.get('occasion')
    const scopedRows = occasionId ? rows.filter((row) => row.occasion?.id === Number(occasionId)) : rows
    const amount = occasionId === '55' ? '50.00' : occasionId === '77' ? '20.00' : rows.length === 2 ? '70.00' : '50.00'
    const data = url.pathname === '/api/expenses/' ? scopedRows
      : scopedRows.length ? [{ debtor: bob, creditor: alice, amount }] : []
    return Promise.resolve(new Response(JSON.stringify(data)))
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient()
  try {
    await Promise.all([
      client.fetchQuery(expensesQuery),
      client.fetchQuery(occasionExpensesQuery(55)),
      client.fetchQuery(occasionExpensesQuery(77)),
      client.fetchQuery(balanceListQuery()),
      client.fetchQuery(balanceListQuery(55)),
      client.fetchQuery(balanceListQuery(77)),
    ])
    // None of these queries has an active observer; both tabs may have moved on.
    rows = mutation === 'create' ? [created, existing] : []
    await refreshExpenseViews(client, mutation === 'delete' ? existing.id : undefined)
    await waitFor(() => {
      expect(client.getQueryData(['expenses'])).toEqual(rows)
      expect(client.getQueryData(['expenses', { occasion: 55 }])).toEqual(mutation === 'create' ? [existing] : [])
      expect(client.getQueryData(['expenses', { occasion: 77 }])).toEqual(mutation === 'create' ? [created] : [])
      expect(client.getQueryData(['balances', { occasion: 55 }])).toEqual(mutation === 'create' ? [{ debtor: bob, creditor: alice, amount: '50.00' }] : [])
      expect(client.getQueryData(['balances', { occasion: 77 }])).toEqual(mutation === 'create' ? [{ debtor: bob, creditor: alice, amount: '20.00' }] : [])
      expect(client.getQueryData(['balances'])).toEqual(mutation === 'create' ? [{ debtor: bob, creditor: alice, amount: '70.00' }] : [])
    })
    // Returning before 30 seconds have elapsed must see the completed mutation.
    const requests = fetchMock.mock.calls.length
    expect(await client.fetchQuery(occasionExpensesQuery(77))).toEqual(mutation === 'create' ? [created] : [])
    expect(fetchMock).toHaveBeenCalledTimes(requests)
  } finally {
    client.clear()
  }
})
