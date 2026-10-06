import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Expense } from './api'

const participants = [{ id: 17, name: 'Maya' }, { id: 93, name: 'Theo' }, { id: 204, name: 'Zoe' }]
const occasions = [{ id: 55, name: 'Dinner' }, { id: 72, name: 'Trip' }]
const expense: Expense = {
  id: 81,
  paid_by: participants[0],
  expense_for: participants[1], occasion: occasions[0],
  amount: '12.30',
  description: 'Train tickets',
  created_at: '2026-10-04T14:00:00Z',
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
})
const fetchMock = vi.fn<typeof fetch>()
const participantsResponse = vi.fn<() => Promise<Response>>()
const occasionsResponse = vi.fn<() => Promise<Response>>()
const expensesResponse = vi.fn<() => Promise<Response>>()
const balancesResponse = vi.fn<() => Promise<Response>>()
const postResponse = vi.fn<() => Promise<Response>>()
const clients: QueryClient[] = []
const dialogMethods = ['showModal', 'close'] as const
const originalDialogMethods = dialogMethods.map((method) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method))

function pendingResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  clients.push(client)
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
  return client
}

function openModal() {
  const trigger = screen.getByRole('button', { name: 'Add Expense' })
  trigger.focus()
  fireEvent.click(trigger)
  return screen.getByRole('dialog', { name: 'Add Expense' })
}

async function openLoadedModal() {
  renderApp()
  const dialog = openModal()
  await within(dialog).findAllByRole('option', { name: 'Maya' })
  await within(dialog).findByRole('option', { name: 'Dinner' })
  return dialog
}

function fillForm({ paidBy = '17', expenseFor = '93', occasion = '55', amount = '12.3', description = 'Train tickets' } = {}) {
  fireEvent.change(screen.getByLabelText(/^Paid by/), { target: { value: paidBy } })
  fireEvent.change(screen.getByLabelText(/^Expense for/), { target: { value: expenseFor } })
  fireEvent.change(screen.getByLabelText(/^Occasion/), { target: { value: occasion } })
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: description } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Expense' }))
}

function expectRetainedValues() {
  expect((screen.getByLabelText(/^Paid by/) as HTMLSelectElement).value).toBe('17')
  expect((screen.getByLabelText(/^Expense for/) as HTMLSelectElement).value).toBe('93')
  expect((screen.getByLabelText(/^Occasion/) as HTMLSelectElement).value).toBe('55')
  expect((screen.getByLabelText(/^Amount/) as HTMLInputElement).value).toBe('12.3')
  expect((screen.getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe('Train tickets')
}

beforeEach(() => {
  participantsResponse.mockReset().mockImplementation(() => Promise.resolve(json(participants)))
  occasionsResponse.mockReset().mockImplementation(() => Promise.resolve(json(occasions)))
  expensesResponse.mockReset().mockImplementation(() => Promise.resolve(json([])))
  balancesResponse.mockReset().mockImplementation(() => Promise.resolve(json([])))
  postResponse.mockReset().mockImplementation(() => Promise.resolve(json(expense, 201)))
  fetchMock.mockReset().mockImplementation((input, options) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/expenses/' && options?.method === 'POST') return postResponse()
    if (path === '/api/participants/') return participantsResponse()
    if (path === '/api/occasions/') return occasionsResponse()
    if (path === '/api/expenses/') return expensesResponse()
    if (path === '/api/balances/') return balancesResponse()
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  // jsdom does not implement native dialog APIs. The browser provides the
  // top layer and inert background; tests exercise our focus and Escape
  // handling through the dialog's open state. Chromium verifies Tab wrapping.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = true }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = false }),
  })
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => { client.clear() })
  dialogMethods.forEach((method, index) => {
    const original = originalDialogMethods[index]
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method)
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Add Expense modal', () => {
  it.each(['close button', 'Escape', 'native cancel'])('opens with focus and restores focus after %s', async (action) => {
    renderApp()
    expect(screen.queryByRole('dialog')).toBeNull()
    const dialog = openModal()
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Add Expense' }))
    expect(dialog.getAttribute('aria-describedby')).toBe('expense-modal-description')
    if (action === 'close button') fireEvent.click(within(dialog).getByRole('button', { name: 'Close Add Expense' }))
    else if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
    else fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Expense' }))
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1)
    expect(postResponse).not.toHaveBeenCalled()
    await screen.findByText('No expenses yet.')
  })

  it('loads both selects from the participants API and uses a decimal text input', async () => {
    const pending = pendingResponse()
    participantsResponse.mockReturnValueOnce(pending.promise)
    renderApp()
    const dialog = openModal()
    expect(within(dialog).getByText('Loading participants…')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { pending.resolve(json(participants)) })
    await within(dialog).findAllByRole('option', { name: 'Maya' })
    for (const label of ['Paid by', 'Expense for']) {
      const options = within(screen.getByRole('combobox', { name: label })).getAllByRole('option') as HTMLOptionElement[]
      expect(options.map((option) => [option.value, option.textContent])).toEqual([
        ['', 'Choose a participant'], ['17', 'Maya'], ['93', 'Theo'], ['204', 'Zoe'],
      ])
    }
    const amount = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    expect(amount.type).toBe('text')
    expect(amount.inputMode).toBe('decimal')
    expect(participantsResponse).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows participant loading errors and allows retry without closing', async () => {
    participantsResponse.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderApp()
    const dialog = openModal()
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Could not load participants')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry participants' }))
    await within(dialog).findAllByRole('option', { name: 'Maya' })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(participantsResponse).toHaveBeenCalledTimes(2)
  })

  it('loads occasion options, keeps all existing participants, and marks four fields as required and leaves Occasion optional', async () => {
    const dialog = await openLoadedModal()
    expect(within(screen.getByRole('combobox', { name: 'Occasion' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['No occasion', 'Dinner', 'Trip'])
    for (const label of ['Paid by', 'Expense for', 'Amount', 'Description']) {
      const field = within(dialog).getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement
      expect(field.required).toBe(true)
      const marker = dialog.querySelector(`label[for="${field.id}"] .required-mark`)!
      expect(marker.textContent).toBe('*')
      expect(marker.getAttribute('aria-hidden')).toBe('true')
    }
    const occasion = screen.getByRole('combobox', { name: 'Occasion' }) as HTMLSelectElement
    expect(occasion.required).toBe(false)
    expect(dialog.querySelector(`label[for="${occasion.id}"] .required-mark`)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add Person' })).toBeNull()
    expect(within(screen.getByRole('combobox', { name: 'Paid by' })).getByRole('option', { name: 'Zoe' })).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url, options]) => new URL(String(url)).pathname === '/api/participants/' && options?.method === 'POST')).toHaveLength(0)
  })

  it.each(['loaded', 'empty', 'error', 'pending'])('saves without an occasion when the lookup is %s and omits its payload field', async (state) => {
    if (state === 'empty') occasionsResponse.mockResolvedValueOnce(json([]))
    if (state === 'error') occasionsResponse.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    if (state === 'pending') occasionsResponse.mockReturnValueOnce(new Promise(() => {}))
    postResponse.mockResolvedValueOnce(json({ ...expense, occasion: null }, 201))
    expensesResponse.mockImplementation(() => Promise.resolve(json([{ ...expense, occasion: null }])))
    renderApp()
    const dialog = openModal()
    await within(dialog).findAllByRole('option', { name: 'Maya' })
    if (state === 'error') expect((await within(dialog).findByRole('alert')).textContent).toContain('You can save with No occasion')
    if (state === 'empty') await within(dialog).findByText('No occasions yet. You can save with No occasion.')
    fillForm({ occasion: '' })
    expect((screen.getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(false)
    submit()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const options = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')![1]!
    expect(JSON.parse(options.body as string)).toEqual({ paid_by: 17, expense_for: 93, amount: '12.3', description: 'Train tickets' })
    expect(await screen.findByRole('heading', { name: 'Train tickets' })).toBeTruthy()
  })

  it('shows occasion loading and retry without dismissing the expense form', async () => {
    const pending = pendingResponse()
    occasionsResponse.mockReturnValueOnce(pending.promise).mockImplementation(() => Promise.resolve(json(occasions)))
    renderApp()
    const dialog = openModal()
    expect(within(dialog).getByText('Loading occasions…')).toBeTruthy()
    await within(dialog).findAllByRole('option', { name: 'Maya' })
    expect((within(dialog).getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { pending.resolve(new Response('Unavailable', { status: 503 })) })
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Could not load occasions')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry occasions' }))
    await within(dialog).findByRole('option', { name: 'Dinner' })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each([{ people: [] }, { people: [participants[0]] }])('prevents saving when fewer than two participants are available: $people', async ({ people }) => {
    participantsResponse.mockResolvedValueOnce(json(people))
    renderApp()
    const dialog = openModal()
    expect(await within(dialog).findByText('At least two participants are needed to record an expense.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(true)
    expect(postResponse).not.toHaveBeenCalled()
  })

  it('validates required fields, connects errors to inputs, and focuses the first invalid field', async () => {
    await openLoadedModal()
    submit()
    expect(screen.getByRole('alert').textContent).toBe('Check the highlighted fields.')
    for (const label of ['Paid by', 'Expense for', 'Amount', 'Description']) {
      const field = screen.getByLabelText(new RegExp(`^${label}`))
      expect(field.getAttribute('aria-invalid')).toBe('true')
      const ids = field.getAttribute('aria-describedby')!.split(' ')
      expect(ids.some((id) => document.getElementById(id)?.className === 'field-error')).toBe(true)
    }
    expect(document.activeElement).toBe(screen.getByLabelText(/^Paid by/))
    expect(postResponse).not.toHaveBeenCalled()
  })

  it('rejects identical participants without posting', async () => {
    await openLoadedModal()
    fillForm({ expenseFor: '17' })
    submit()
    expect(screen.getByText('Choose a different participant from the payer.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Expense for/))
    expect(postResponse).not.toHaveBeenCalled()
  })

  it.each(['0', '0.00', '-1', '0.001', '1000000', '1e2', '+1', '.50', '1.', '1,000.00', ' 1.00 ', '١.٠٠'])('rejects invalid amount %j without posting', async (amount) => {
    await openLoadedModal()
    fillForm({ amount })
    submit()
    expect(screen.getByLabelText(/^Amount/).getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText(/^Amount/))
    expect(postResponse).not.toHaveBeenCalled()
  })

  it.each([' \t\n ', 'x'.repeat(501)])('rejects an empty or oversized description (%#)', async (description) => {
    await openLoadedModal()
    fillForm({ description })
    submit()
    expect(screen.getByLabelText(/^Description/).getAttribute('aria-invalid')).toBe('true')
    expect(postResponse).not.toHaveBeenCalled()
  })

  it.each(['0.01', '0.29', '1', '999999.99', '0001.2'])('accepts valid decimal amount %j and preserves its string in the POST', async (amount) => {
    await openLoadedModal()
    fillForm({ amount })
    submit()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const options = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')![1]!
    expect(JSON.parse(options.body as string).amount).toBe(amount)
    expect(postResponse).toHaveBeenCalledTimes(1)
  })

  it('accepts 500 Unicode characters after trimming, matching backend description validation', async () => {
    await openLoadedModal()
    const description = '🍽'.repeat(500)
    fillForm({ description: `  ${description}  ` })
    submit()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const options = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')![1]!
    expect(JSON.parse(options.body as string).description).toBe(description)
  })

  it.each(['expenses', 'balances'] as const)('submits integer IDs and a decimal string, closes, and refreshes both cached views from %s', async (view) => {
    const client = renderApp()
    await screen.findByText('No expenses yet.')
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    await screen.findByText('No outstanding balances.')
    if (view === 'expenses') fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    openModal()
    await screen.findAllByRole('option', { name: 'Maya' })
    fillForm({ description: '  Train tickets  ' })
    expensesResponse.mockImplementation(() => Promise.resolve(json([expense])))
    balancesResponse.mockImplementation(() => Promise.resolve(json([{ debtor: participants[1], creditor: participants[0], amount: '12.30' }])))
    submit()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const [url, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(new URL(String(url)).pathname).toBe('/api/expenses/')
    expect(options?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' })
    expect(JSON.parse(options!.body as string)).toEqual({ paid_by: 17, expense_for: 93, occasion: 55, amount: '12.3', description: 'Train tickets' })
    await waitFor(() => {
      expect(client.getQueryData(['expenses'])).toEqual([expense])
      expect(client.getQueryData(['balances'])).toEqual([{ debtor: participants[1], creditor: participants[0], amount: '12.30' }])
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    expect(await screen.findByRole('heading', { name: 'Train tickets' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    const list = await screen.findByRole('list', { name: 'Balances' })
    expect(within(list).getByRole('listitem').textContent).toBe('Theo owes Maya $12.30')
    expect(expensesResponse).toHaveBeenCalledTimes(2)
    expect(balancesResponse).toHaveBeenCalledTimes(2)
    expect(postResponse).toHaveBeenCalledTimes(1)
  })

  it('refreshes Balances after saving even if that view was never opened', async () => {
    await openLoadedModal()
    fillForm()
    submit()
    await waitFor(() => { expect(balancesResponse).toHaveBeenCalledTimes(1) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refreshes the active expenses, global balances, and cached occasion balances after creation', async () => {
    const created = { ...expense, id: 82, description: 'Coffee' }
    let saved = false
    fetchMock.mockImplementation((input, options) => {
      const url = new URL(String(input))
      if (options?.method === 'POST') {
        saved = true
        return Promise.resolve(json(created, 201))
      }
      if (url.pathname === '/api/participants/') return Promise.resolve(json(participants))
      if (url.pathname === '/api/occasions/') return Promise.resolve(json(occasions))
      if (url.pathname === '/api/balances/') return Promise.resolve(json([]))
      return Promise.resolve(json(saved ? [created, expense] : [expense]))
    })
    const client = renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Show expenses for Dinner' }))
    await screen.findByRole('heading', { name: 'Train tickets' })
    fireEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    await screen.findByText('No outstanding balances.')
    const select = screen.getByRole('combobox', { name: 'Filter balances by occasion' })
    await within(select).findByRole('option', { name: 'Dinner' })
    fireEvent.change(select, { target: { value: '55' } })
    await screen.findByText('No outstanding balances for Dinner.')
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }))
    openModal()
    await screen.findByRole('option', { name: 'Dinner' })
    await screen.findAllByRole('option', { name: 'Maya' })
    fillForm({ description: 'Coffee' })
    submit()
    await screen.findByRole('heading', { name: 'Coffee' })
    await waitFor(() => {
      expect(client.getQueryData(['expenses'])).toEqual([created, expense])
      expect(client.getQueryData(['expenses', { occasion: 55 }])).toEqual([created, expense])
      expect(client.getQueryData(['balances'])).toEqual([])
      expect(client.getQueryData(['balances', { occasion: 55 }])).toEqual([])
    })
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/balances/').map(([input]) => new URL(String(input)).search)).toEqual(['', '?occasion=55', '', '?occasion=55'])
  })

  it('cancels a read started before the save and keeps fresh data if that old response arrives later', async () => {
    const staleRead = pendingResponse()
    expensesResponse.mockReturnValueOnce(staleRead.promise)
    const client = renderApp()
    expect(screen.getByRole('status').textContent).toContain('Loading expenses')
    const oldSignal = fetchMock.mock.calls[0][1]?.signal
    openModal()
    await screen.findAllByRole('option', { name: 'Maya' })
    fillForm()
    expensesResponse.mockImplementation(() => Promise.resolve(json([expense])))
    submit()
    expect(await screen.findByRole('heading', { name: 'Train tickets' })).toBeTruthy()
    expect(oldSignal?.aborted).toBe(true)
    expect(expensesResponse).toHaveBeenCalledTimes(2)
    await act(async () => { staleRead.resolve(json([])) })
    expect(client.getQueryData(['expenses'])).toEqual([expense])
    expect(screen.getByRole('heading', { name: 'Train tickets' })).toBeTruthy()
  })

  it('shows server field errors and non-field errors, retains values, and permits a corrected retry', async () => {
    postResponse.mockResolvedValueOnce(json({
      paid_by: ['This participant no longer exists.'],
      expense_for: ['Choose another beneficiary.'],
      occasion: ['This occasion no longer exists.'],
      amount: ['Amount was rejected.', 'Use a smaller amount.'],
      description: ['Please clarify the description.'],
      non_field_errors: ['Please review this expense.'],
    }, 400))
    const dialog = await openLoadedModal()
    fillForm()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Please review this expense.')
    expect(screen.getByRole('dialog', { name: 'Add Expense' })).toBe(dialog)
    expectRetainedValues()
    for (const label of ['Paid by', 'Expense for', 'Occasion', 'Amount', 'Description']) {
      expect(screen.getByLabelText(new RegExp(`^${label}`)).getAttribute('aria-invalid')).toBe('true')
    }
    expect(screen.getByText('Amount was rejected. Use a smaller amount.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Paid by/))
    expect(expensesResponse).toHaveBeenCalledTimes(1)
    expect(balancesResponse).not.toHaveBeenCalled()
    fillForm({ amount: '10.00' })
    submit()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(postResponse).toHaveBeenCalledTimes(2)
  })

  it.each(['network', 'server', 'invalid error JSON'])('keeps values and shows a retryable save error after %s failure', async (failure) => {
    if (failure === 'network') postResponse.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    else if (failure === 'server') postResponse.mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
    else postResponse.mockResolvedValueOnce(new Response('invalid json', { status: 400 }))
    await openLoadedModal()
    fillForm()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save expense. Please try again.')
    expect(screen.getByRole('dialog', { name: 'Add Expense' })).toBeTruthy()
    expectRetainedValues()
    expect((screen.getByRole('button', { name: 'Save Expense' }) as HTMLButtonElement).disabled).toBe(false)
    submit()
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(postResponse).toHaveBeenCalledTimes(2)
  })

  it('blocks duplicate submits and dismissing while the POST is pending', async () => {
    const pending = pendingResponse()
    postResponse.mockReturnValueOnce(pending.promise)
    const dialog = await openLoadedModal()
    fillForm()
    const save = screen.getByRole('button', { name: 'Save Expense' })
    const form = save.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => { expect(postResponse).toHaveBeenCalledTimes(1) })
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(within(dialog).getByRole('status').textContent).toBe('Saving expense…')
    expect((screen.getByRole('button', { name: 'Close Add Expense' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText(/^Amount/).closest('fieldset')!.disabled).toBe(true)
    fireEvent.submit(form)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
    expect(screen.getByRole('dialog', { name: 'Add Expense' })).toBe(dialog)
    expect(postResponse).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(json(expense, 201)) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Expense' }))
  })

  it('keeps the successful save closed when refreshing a view fails and lets that view retry', async () => {
    await openLoadedModal()
    fillForm()
    expensesResponse.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load expenses')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postResponse).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry expenses' }))
    expect(await screen.findByText('No expenses yet.')).toBeTruthy()
  })
})
