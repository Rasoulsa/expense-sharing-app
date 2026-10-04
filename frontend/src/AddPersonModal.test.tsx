import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

const people = [{ id: 17, name: 'Maya' }, { id: 93, name: 'Theo' }]
const added = { id: 315, name: 'Leila' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const fetchMock = vi.fn<typeof fetch>()
const getPeople = vi.fn<() => Promise<Response>>()
const postPerson = vi.fn<() => Promise<Response>>()
const postExpense = vi.fn<() => Promise<Response>>()
const clients: QueryClient[] = []
const methods = ['showModal', 'close'] as const
const originals = methods.map((method) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method))

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  clients.push(client)
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
  return client
}

function openPerson() {
  const button = screen.getByRole('button', { name: 'Add Person' })
  button.focus()
  fireEvent.click(button)
  return screen.getByRole('dialog', { name: 'Add Person' })
}

function saveName(name: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Person' }))
}

beforeEach(() => {
  getPeople.mockReset().mockImplementation(() => Promise.resolve(json(people)))
  postPerson.mockReset().mockImplementation(() => Promise.resolve(json(added, 201)))
  postExpense.mockReset().mockImplementation(() => Promise.resolve(json({
    id: 21, paid_by: people[0], expense_for: added, amount: '5.00',
    description: 'Coffee', created_at: '2026-10-04T10:00:00Z',
  }, 201)))
  fetchMock.mockReset().mockImplementation((input, options) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/participants/') return options?.method === 'POST' ? postPerson() : getPeople()
    if (path === '/api/expenses/' && options?.method === 'POST') return postExpense()
    if (path === '/api/expenses/' || path === '/api/balances/') return Promise.resolve(json([]))
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
  methods.forEach((method, index) => {
    const original = originals[index]
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method)
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['Close', 'Escape', 'cancel'])('focuses the name and restores Add Person focus after %s', async (action) => {
  renderApp()
  const dialog = openPerson()
  expect(dialog.getAttribute('aria-describedby')).toBe('person-modal-description')
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
  if (action === 'Close') fireEvent.click(within(dialog).getByRole('button', { name: 'Close Add Person' }))
  else if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
  else fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Person' }))
  expect(postPerson).not.toHaveBeenCalled()
  await screen.findByText('No expenses yet.')
})

it('wraps Tab and Shift+Tab between enabled dialog controls', async () => {
  renderApp()
  const dialog = openPerson()
  const close = within(dialog).getByRole('button', { name: 'Close Add Person' })
  const save = within(dialog).getByRole('button', { name: 'Save Person' })
  save.focus()
  fireEvent.keyDown(save, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(save)
  await screen.findByText('No expenses yet.')
})

it.each(['', ' \t\n ', 'x'.repeat(101)])('rejects invalid name (%#), associates the error, and makes no POST', async (name) => {
  renderApp()
  openPerson()
  saveName(name)
  const input = screen.getByRole('textbox', { name: 'Name' })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toContain('person-name-error')
  expect(document.getElementById('person-name-error')?.textContent).toBeTruthy()
  expect(document.activeElement).toBe(input)
  expect(postPerson).not.toHaveBeenCalled()
  await screen.findByText('No expenses yet.')
})

it('accepts 100 Unicode characters after trimming', async () => {
  renderApp()
  openPerson()
  const name = '🍽'.repeat(100)
  postPerson.mockResolvedValueOnce(json({ id: 316, name }, 201))
  saveName(`  ${name}  `)
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(options!.body as string)).toEqual({ name })
})

it('refreshes cached participants, announces success, and uses the new ID in both expense selects', async () => {
  const client = renderApp()
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
  await screen.findAllByRole('option', { name: 'Maya' })
  fireEvent.click(screen.getByRole('button', { name: 'Close Add Expense' }))
  openPerson()
  getPeople.mockImplementation(() => Promise.resolve(json([added, ...people])))
  saveName('  Leila  ')
  expect(await screen.findByText('Leila added. You can now select them in Add Expense.')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Person' }))
  await waitFor(() => { expect(client.getQueryData(['participants'])).toEqual([added, ...people]) })
  expect(getPeople).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
  for (const label of ['Paid by', 'Expense for']) {
    const option = within(screen.getByRole('combobox', { name: label })).getByRole('option', { name: 'Leila' }) as HTMLOptionElement
    expect(option.value).toBe('315')
  }
  fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: '17' } })
  fireEvent.change(screen.getByLabelText('Expense for'), { target: { value: '315' } })
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5.00' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Coffee' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Expense' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  const post = fetchMock.mock.calls.find(([url, options]) => new URL(String(url)).pathname === '/api/expenses/' && options?.method === 'POST')!
  expect(JSON.parse(post[1]!.body as string)).toEqual({ paid_by: 17, expense_for: 315, amount: '5.00', description: 'Coffee' })
})

it('shows backend name errors, retains the name, and allows a corrected retry', async () => {
  postPerson.mockResolvedValueOnce(json({ name: ['This name already exists.'], non_field_errors: ['Review this person.'] }, 400))
  renderApp()
  const dialog = openPerson()
  saveName(' Maya ')
  expect((await within(dialog).findByRole('alert')).textContent).toBe('Review this person.')
  expect(screen.getByText('This name already exists.')).toBeTruthy()
  const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
  expect(input.value).toBe(' Maya ')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(input)
  expect(getPeople).not.toHaveBeenCalled()
  saveName('Leila')
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(postPerson).toHaveBeenCalledTimes(2)
})

it.each(['network', 'server', 'invalid JSON'])('keeps values after a %s failure and permits retry', async (failure) => {
  if (failure === 'network') postPerson.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  else postPerson.mockResolvedValueOnce(new Response('Unavailable', { status: failure === 'server' ? 500 : 400 }))
  renderApp()
  const dialog = openPerson()
  saveName('Leila')
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toBe('Could not add person. Please try again.')
  expect(document.activeElement).toBe(alert)
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Leila')
  expect((screen.getByRole('button', { name: 'Save Person' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Save Person' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(postPerson).toHaveBeenCalledTimes(2)
})

it('disables editing, duplicate submissions, and dismissal while saving', async () => {
  let resolve!: (response: Response) => void
  postPerson.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  renderApp()
  const dialog = openPerson()
  const form = within(dialog).getByRole('button', { name: 'Save Person' }).closest('form')!
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Leila' } })
  fireEvent.submit(form)
  fireEvent.submit(form)
  await waitFor(() => { expect(postPerson).toHaveBeenCalledTimes(1) })
  expect(form.getAttribute('aria-busy')).toBe('true')
  for (const control of [screen.getByLabelText('Name'), screen.getByRole('button', { name: 'Saving…' }), screen.getByRole('button', { name: 'Close Add Person' })]) {
    expect((control as HTMLInputElement | HTMLButtonElement).disabled).toBe(true)
  }
  expect(within(dialog).getByRole('status').textContent).toBe('Adding person…')
  fireEvent.submit(form)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Add Person' }))
  expect(screen.getByRole('dialog', { name: 'Add Person' })).toBe(dialog)
  expect(postPerson).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(json(added, 201)) })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('keeps a successful creation closed when refreshing participants fails and offers retry in Add Expense', async () => {
  getPeople.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementation(() => Promise.resolve(json([added, ...people])))
  renderApp()
  openPerson()
  saveName('Leila')
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  await waitFor(() => { expect(getPeople).toHaveBeenCalledTimes(1) })
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
  const dialog = screen.getByRole('dialog', { name: 'Add Expense' })
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Could not load participants')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry participants' }))
  await screen.findAllByRole('option', { name: 'Leila' })
  expect(postPerson).toHaveBeenCalledTimes(1)
  expect(getPeople).toHaveBeenCalledTimes(3)
})
