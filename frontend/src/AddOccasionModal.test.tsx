import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

const people = [{ id: 17, name: 'Maya' }, { id: 93, name: 'Theo' }]
const occasions = [{ id: 55, name: 'Trip' }]
const added = { id: 315, name: 'Dinner' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const fetchMock = vi.fn<typeof fetch>()
const getOccasions = vi.fn<() => Promise<Response>>()
const postOccasion = vi.fn<() => Promise<Response>>()
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

function openOccasion() {
  const button = screen.getByRole('button', { name: 'Add Occasion' })
  button.focus()
  fireEvent.click(button)
  return screen.getByRole('dialog', { name: 'Add Occasion' })
}

function saveName(name: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Occasion' }))
}

beforeEach(() => {
  getOccasions.mockReset().mockImplementation(() => Promise.resolve(json(occasions)))
  postOccasion.mockReset().mockImplementation(() => Promise.resolve(json(added, 201)))
  postExpense.mockReset().mockImplementation(() => Promise.resolve(json({
    id: 21, paid_by: people[0], expense_for: people[1], occasion: added, amount: '5.00',
    description: 'Coffee', created_at: '2026-10-04T10:00:00Z',
  }, 201)))
  fetchMock.mockReset().mockImplementation((input, options) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/participants/' && !options?.method) return Promise.resolve(json(people))
    if (path === '/api/occasions/') return options?.method === 'POST' ? postOccasion() : getOccasions()
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

it.each(['Close', 'Cancel', 'Escape', 'native cancel'])('focuses the name and restores Add Occasion focus after %s', async (action) => {
  renderApp()
  const dialog = openOccasion()
  expect(dialog.getAttribute('aria-describedby')).toBe('occasion-modal-description')
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
  if (action === 'Close') fireEvent.click(within(dialog).getByRole('button', { name: 'Close Add Occasion' }))
  else if (action === 'Cancel') fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  else if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
  else fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Occasion' }))
  expect(postOccasion).not.toHaveBeenCalled()
  await screen.findByText('No expenses yet.')
})

it('wraps Tab and Shift+Tab between enabled dialog controls', async () => {
  renderApp()
  const dialog = openOccasion()
  const close = within(dialog).getByRole('button', { name: 'Close Add Occasion' })
  const save = within(dialog).getByRole('button', { name: 'Save Occasion' })
  save.focus()
  fireEvent.keyDown(save, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(save)
  await screen.findByText('No expenses yet.')
})

it.each(['', ' \t\n ', 'x'.repeat(101), '🍽'.repeat(101)])('rejects invalid name (%#), associates the error, and makes no POST', async (name) => {
  renderApp()
  openOccasion()
  saveName(name)
  const input = screen.getByRole('textbox', { name: 'Name' })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toContain('occasion-name-error')
  expect(document.getElementById('occasion-name-error')?.textContent).toBeTruthy()
  expect(document.activeElement).toBe(input)
  expect(postOccasion).not.toHaveBeenCalled()
  await screen.findByText('No expenses yet.')
})

it('accepts 100 Unicode characters after trimming', async () => {
  renderApp()
  openOccasion()
  const name = '🍽'.repeat(100)
  postOccasion.mockResolvedValueOnce(json({ id: 316, name }, 201))
  saveName(`  ${name}  `)
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(options!.body as string)).toEqual({ name })
})

it('refreshes cached occasions, announces success, and makes the new ID selectable for expenses', async () => {
  const client = renderApp()
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
  await screen.findAllByRole('option', { name: 'Maya' })
  fireEvent.click(screen.getByRole('button', { name: 'Close Add Expense' }))
  openOccasion()
  getOccasions.mockImplementation(() => Promise.resolve(json([added, ...occasions])))
  saveName('  Dinner  ')
  expect(await screen.findByText('Dinner added. You can now select it in Add Expense.')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Occasion' }))
  await waitFor(() => { expect(client.getQueryData(['occasions'])).toEqual([added, ...occasions]) })
  expect(getOccasions).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
  for (const label of ['Occasion']) {
    const option = within(screen.getByRole('combobox', { name: label })).getByRole('option', { name: 'Dinner' }) as HTMLOptionElement
    expect(option.value).toBe('315')
  }
  fireEvent.change(screen.getByLabelText(/^Paid by/), { target: { value: '17' } })
  fireEvent.change(screen.getByLabelText(/^Expense for/), { target: { value: '93' } })
  fireEvent.change(screen.getByLabelText(/^Occasion/), { target: { value: '315' } })
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '5.00' } })
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Coffee' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Expense' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  const post = fetchMock.mock.calls.find(([url, options]) => new URL(String(url)).pathname === '/api/expenses/' && options?.method === 'POST')!
  expect(JSON.parse(post[1]!.body as string)).toEqual({ paid_by: 17, expense_for: 93, occasion: 315, amount: '5.00', description: 'Coffee' })
})

it.each(['Dinner', 'dinner', ' DINNER ', 'été', ' E\u0301TE\u0301 '])('shows duplicate name errors for %j, retains input, and allows correction', async (duplicateName) => {
  postOccasion.mockResolvedValueOnce(json({ name: ['This name already exists.'], non_field_errors: ['Review this occasion.'] }, 400))
  renderApp()
  const dialog = openOccasion()
  saveName(duplicateName)
  expect((await within(dialog).findByRole('alert')).textContent).toBe('Review this occasion.')
  expect(screen.getByText('This name already exists.')).toBeTruthy()
  const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
  expect(input.value).toBe(duplicateName)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(input)
  expect(getOccasions).not.toHaveBeenCalled()
  saveName('Dinner')
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(postOccasion).toHaveBeenCalledTimes(2)
})

it.each(['network', 'server', 'invalid JSON'])('keeps values after a %s failure and permits retry', async (failure) => {
  if (failure === 'network') postOccasion.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  else postOccasion.mockResolvedValueOnce(new Response('Unavailable', { status: failure === 'server' ? 500 : 400 }))
  renderApp()
  const dialog = openOccasion()
  saveName('Dinner')
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toBe('Could not add occasion. Please try again.')
  expect(document.activeElement).toBe(alert)
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dinner')
  expect((screen.getByRole('button', { name: 'Save Occasion' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Save Occasion' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(postOccasion).toHaveBeenCalledTimes(2)
})

it.each(['Cancel', 'Escape', 'native cancel'])('releases dismissal after a network failure using %s', async (action) => {
  postOccasion.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  const client = renderApp()
  const dialog = openOccasion()
  saveName('Dinner')
  await within(dialog).findByRole('alert')
  await waitFor(() => { expect(client.isMutating()).toBe(0) })
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
  expect(cancel.disabled).toBe(false)
  if (action === 'Cancel') fireEvent.click(cancel)
  else if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
  else fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Occasion' }))
  expect(postOccasion).toHaveBeenCalledTimes(1)
})

it('disables editing, duplicate submissions, and dismissal while saving', async () => {
  let resolve!: (response: Response) => void
  postOccasion.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  renderApp()
  const dialog = openOccasion()
  const form = within(dialog).getByRole('button', { name: 'Save Occasion' }).closest('form')!
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dinner' } })
  fireEvent.submit(form)
  fireEvent.submit(form)
  await waitFor(() => { expect(postOccasion).toHaveBeenCalledTimes(1) })
  expect(form.getAttribute('aria-busy')).toBe('true')
  for (const control of [screen.getByLabelText('Name'), screen.getByRole('button', { name: 'Saving…' }), screen.getByRole('button', { name: 'Close Add Occasion' }), screen.getByRole('button', { name: 'Cancel' })]) {
    expect((control as HTMLInputElement | HTMLButtonElement).disabled).toBe(true)
  }
  expect(within(dialog).getByRole('status').textContent).toBe('Adding occasion…')
  fireEvent.submit(form)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Add Occasion' }))
  expect(screen.getByRole('dialog', { name: 'Add Occasion' })).toBe(dialog)
  expect(postOccasion).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(json(added, 201)) })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('keeps a successful creation closed when refreshing occasions fails and offers retry in Add Expense', async () => {
  getOccasions.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementation(() => Promise.resolve(json([added, ...occasions])))
  renderApp()
  openOccasion()
  saveName('Dinner')
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  await waitFor(() => { expect(getOccasions).toHaveBeenCalledTimes(1) })
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
  const dialog = screen.getByRole('dialog', { name: 'Add Expense' })
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Could not load occasions')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry occasions' }))
  await screen.findAllByRole('option', { name: 'Dinner' })
  expect(postOccasion).toHaveBeenCalledTimes(1)
  expect(getOccasions).toHaveBeenCalledTimes(3)
})
