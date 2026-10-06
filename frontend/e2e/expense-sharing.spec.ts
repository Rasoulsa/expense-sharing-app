import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

type Participant = { id: number; name: string }
type Occasion = { id: number; name: string }
type Expense = { id: number; description: string; occasion: Occasion | null }
type Balance = { debtor: Participant; creditor: Participant; amount: string }

const apiUrl = 'http://127.0.0.1:8001'

async function createOccasion(page: Page, name: string): Promise<Occasion> {
  await page.getByRole('button', { name: 'Add Occasion', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Occasion' })
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`  ${name}  `)
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/occasions/' && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Save Occasion' }).click()
  const response = await saved
  expect(response.status()).toBe(201)
  expect(response.request().postDataJSON()).toEqual({ name })
  const occasion = await response.json() as Occasion
  expect(occasion.name).toBe(name)
  expect(Number.isInteger(occasion.id)).toBe(true)
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Occasion', exact: true })).toBeFocused()
  await expect(page.getByText(`${name} added. You can now select it in Add Expense.`, { exact: true })).toBeVisible()
  return occasion
}

async function createExpense(page: Page, participants: Participant[], occasion: Occasion | null, payer: string, beneficiary: string, amount: string, description: string) {
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Expense' })
  await dialog.getByRole('combobox', { name: 'Paid by', exact: true }).selectOption({ label: payer })
  await dialog.getByRole('combobox', { name: 'Expense for', exact: true }).selectOption({ label: beneficiary })
  await dialog.getByRole('combobox', { name: 'Occasion', exact: true }).selectOption(occasion ? String(occasion.id) : '')
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill(amount)
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill(description)
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/expenses/' && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Save Expense' }).click()
  const response = await saved
  expect(response.status()).toBe(201)
  expect(response.request().postDataJSON()).toEqual({
    paid_by: participants.find((person) => person.name === payer)!.id,
    expense_for: participants.find((person) => person.name === beneficiary)!.id,
    ...(occasion ? { occasion: occasion.id } : {}),
    amount,
    description,
  })
  expect((await response.json() as Expense).occasion).toEqual(occasion)
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Expense', exact: true })).toBeFocused()
  const expense = expenseCard(page, description)
  await expect(expense).toBeVisible()
  await expect(expense.getByRole('definition').nth(0)).toHaveText(payer)
  await expect(expense.getByRole('definition').nth(1)).toHaveText(beneficiary)
  await expect(expense.getByText(`$${amount}`, { exact: true })).toBeVisible()
  if (occasion) await expect(expense.getByRole('button', { name: `Show expenses for ${occasion.name}`, exact: true })).toHaveText(occasion.name)
  else await expect(expense.getByRole('button', { name: /Show expenses for/ })).toHaveCount(0)
}

function expenseCard(page: Page, description: string) {
  return page.getByRole('list', { name: 'Expenses', exact: true }).getByRole('listitem').filter({
    has: page.getByRole('heading', { name: description, exact: true }),
  })
}

async function expectWithinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
}

async function expectRequiredExpenseFields(dialog: Locator) {
  for (const [id, label, role] of [
    ['paid_by', 'Paid by', 'combobox'],
    ['expense_for', 'Expense for', 'combobox'],
    ['amount', 'Amount', 'textbox'],
    ['description', 'Description', 'textbox'],
  ] as const) {
    await expect(dialog.getByRole(role, { name: label, exact: true })).toHaveAttribute('required', '')
    const marker = dialog.locator(`label[for="${id}"] .required-mark`)
    await expect(marker).toHaveText('*')
    await expect(marker).toHaveAttribute('aria-hidden', 'true')
    await expect(marker).toHaveCSS('color', 'rgb(165, 44, 44)')
  }
  await expect(dialog.getByRole('combobox', { name: 'Occasion', exact: true })).not.toHaveAttribute('required', '')
  await expect(dialog.locator('label[for="occasion"] .required-mark')).toHaveCount(0)
}

test('occasions, accessible forms and filters, historical expenses, deletion, and global/filtered balances through the real API', async ({ page, request }, testInfo) => {
  const response = await request.get(`${apiUrl}/api/participants/`, {
    headers: { Origin: 'http://localhost:5173' },
  })
  expect(response.status()).toBe(200)
  expect(response.headers()['access-control-allow-origin']).toBe('http://localhost:5173')
  const participants = await response.json() as Participant[]
  expect(participants.map((person) => person.name)).toEqual(['Alice', 'Bob', 'Charlie', 'David'])
  expect((await request.post(`${apiUrl}/api/participants/`, { data: { name: 'Should not be created' } })).status()).toBe(405)
  expect(await (await request.get(`${apiUrl}/api/participants/`)).json()).toEqual(participants)
  expect(await (await request.get(`${apiUrl}/api/expenses/`)).json()).toEqual([])

  // An older client can still create an ungrouped expense during the rollout.
  const historical = await request.post(`${apiUrl}/api/expenses/`, { data: {
    paid_by: participants.find((person) => person.name === 'Charlie')!.id,
    expense_for: participants.find((person) => person.name === 'David')!.id,
    amount: '7.00', description: 'Historical coffee',
  } })
  expect(historical.status()).toBe(201)
  expect((await historical.json() as Expense).occasion).toBeNull()
  const balanceRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/balances/') balanceRequests.push(new URL(request.url()).search)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add Person', exact: true })).toHaveCount(0)
  await expect(expenseCard(page, 'Historical coffee')).toBeVisible()
  await expect(expenseCard(page, 'Historical coffee').getByRole('button', { name: /Show expenses for/ })).toHaveCount(0)

  const addExpense = page.getByRole('button', { name: 'Add Expense', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Add Expense' })
  await addExpense.click()
  await expect(dialog.getByRole('heading', { name: 'Add Expense' })).toBeFocused()
  for (const label of ['Paid by', 'Expense for']) {
    await expect(dialog.getByRole('combobox', { name: label, exact: true }).getByRole('option')).toHaveText([
      'Choose a participant', ...participants.map((person) => person.name),
    ])
  }
  await expect(dialog.getByText('No occasions yet. You can save with No occasion.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save Expense' })).toBeEnabled()
  await expectRequiredExpenseFields(dialog)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(addExpense).toBeFocused()

  await createExpense(page, participants, null, 'Bob', 'Alice', '10.00', 'Ungrouped snack')

  const addOccasion = page.getByRole('button', { name: 'Add Occasion', exact: true })
  const occasionDialog = page.getByRole('dialog', { name: 'Add Occasion' })
  const name = occasionDialog.getByRole('textbox', { name: 'Name', exact: true })
  const closeOccasion = occasionDialog.getByRole('button', { name: 'Close Add Occasion' })
  const cancelOccasion = occasionDialog.getByRole('button', { name: 'Cancel', exact: true })
  const saveOccasion = occasionDialog.getByRole('button', { name: 'Save Occasion' })
  await addOccasion.click()
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute('required', '')
  for (const control of [cancelOccasion, saveOccasion, closeOccasion, name]) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
  }
  for (const control of [closeOccasion, saveOccasion, cancelOccasion, name]) {
    await page.keyboard.press('Shift+Tab')
    await expect(control).toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(occasionDialog).not.toBeVisible()
  await expect(addOccasion).toBeFocused()
  const dinner = await createOccasion(page, 'Birthday')
  const trip = await createOccasion(page, 'Weekend trip')

  // Real duplicate-name validation remains associated with the retained input.
  await addOccasion.click()
  await name.fill(' birthday ')
  const duplicate = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/occasions/' && response.request().method() === 'POST')
  await saveOccasion.click()
  expect((await duplicate).status()).toBe(400)
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveValue(' birthday ')
  await expect(name).toBeFocused()
  await expect(occasionDialog.locator('#occasion-name-error')).toBeVisible()
  await cancelOccasion.click()
  await expect(addOccasion).toBeFocused()

  for (const dismiss of ['Cancel', 'Escape']) {
    await addOccasion.click()
    await name.fill('Offline occasion')
    await page.context().setOffline(true)
    await saveOccasion.click()
    await expect(occasionDialog.getByRole('alert')).toContainText(/Could not add occasion|You are offline/)
    await expect(saveOccasion).toBeEnabled()
    await expect(cancelOccasion).toBeEnabled()
    if (dismiss === 'Cancel') await cancelOccasion.click()
    else await page.keyboard.press('Escape')
    await expect(occasionDialog).not.toBeVisible()
    await expect(addOccasion).toBeFocused()
    await page.context().setOffline(false)
  }

  await addExpense.click()
  await expect(dialog.getByRole('combobox', { name: 'Occasion', exact: true }).getByRole('option')).toHaveText(['No occasion', 'Birthday', 'Weekend trip'])
  await expectRequiredExpenseFields(dialog)
  const close = dialog.getByRole('button', { name: 'Close Add Expense' })
  const save = dialog.getByRole('button', { name: 'Save Expense' })
  for (const control of [close,
    dialog.getByRole('combobox', { name: 'Paid by', exact: true }),
    dialog.getByRole('combobox', { name: 'Expense for', exact: true }),
    dialog.getByRole('combobox', { name: 'Occasion', exact: true }),
    dialog.getByRole('textbox', { name: 'Amount', exact: true }),
    dialog.getByRole('textbox', { name: 'Description', exact: true }), save, close,
  ]) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
  }
  await page.keyboard.press('Shift+Tab')
  await expect(save).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(addExpense).toBeFocused()

  await createExpense(page, participants, dinner, 'Alice', 'Bob', '50.00', 'Shared lunch')
  await createExpense(page, participants, trip, 'Bob', 'Alice', '20.00', 'Return payment')
  await createExpense(page, participants, trip, 'Alice', 'Charlie', '15.00', 'Trip tickets')
  await page.reload()
  const expenses = page.getByRole('list', { name: 'Expenses', exact: true }).getByRole('listitem')
  const balances = page.getByRole('list', { name: 'Balances', exact: true }).getByRole('listitem')
  await expect(expenses).toHaveCount(5)
  await expect(expenseCard(page, 'Historical coffee')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desktop-expenses.png'), fullPage: true })
  await addExpense.click()
  await expectWithinViewport(page, dialog)
  await page.screenshot({ path: testInfo.outputPath('desktop-add-expense.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Save Expense' }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Save Expense' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desktop-add-expense-fields.png'), fullPage: true })
  await page.keyboard.press('Escape')

  async function filterDinner() {
    await expenseCard(page, 'Shared lunch').getByRole('button', { name: 'Show expenses for Birthday', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Clear filter', exact: true })).toBeFocused()
    await expect(expenses).toHaveCount(1)
    await expect(expenseCard(page, 'Shared lunch')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Historical coffee', exact: true })).toHaveCount(0)
  }
  await filterDinner()
  await page.screenshot({ path: testInfo.outputPath('desktop-filtered-expenses.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $20.00', 'Charlie owes Alice $15.00', 'David owes Charlie $7.00'])
  const balanceFilter = page.getByRole('combobox', { name: 'Filter balances by occasion' })
  await expect(balanceFilter).toHaveValue('')
  await expect(balanceFilter.getByRole('option')).toHaveText(['All occasions', 'Birthday', 'Weekend trip'])
  await balanceFilter.selectOption(String(dinner.id))
  await expect(balances).toHaveText(['Bob owes Alice $50.00'])
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(balanceFilter).toHaveValue('')
  await expect(balanceFilter).toBeFocused()
  await expect(balances).toHaveText(['Bob owes Alice $20.00', 'Charlie owes Alice $15.00', 'David owes Charlie $7.00'])
  await page.screenshot({ path: testInfo.outputPath('desktop-balances.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Expenses' }).click()
  await expect(expenses).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(expenses).toHaveCount(5)
  await expect(expenseCard(page, 'Historical coffee')).toBeVisible()

  await page.setViewportSize({ width: 320, height: 740 })
  for (const row of await expenses.all()) {
    await expectWithinViewport(page, row)
    await expectWithinViewport(page, row.getByRole('heading'))
    await expectWithinViewport(page, row.getByRole('definition').nth(2))
    for (const control of await row.getByRole('button').all()) await expectWithinViewport(page, control)
  }
  expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(320)
  await page.screenshot({ path: testInfo.outputPath('phone-expenses.png'), fullPage: true })
  await filterDinner()
  await expectWithinViewport(page, page.locator('.expense-filter'))
  await expectWithinViewport(page, page.getByRole('button', { name: 'Clear filter', exact: true }))
  await page.screenshot({ path: testInfo.outputPath('phone-filtered-expenses.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balanceFilter).toHaveValue('')
  await expect(balances).toHaveText(['Bob owes Alice $20.00', 'Charlie owes Alice $15.00', 'David owes Charlie $7.00'])
  await balanceFilter.selectOption(String(dinner.id))
  await expect(balances).toHaveText(['Bob owes Alice $50.00'])
  await expectWithinViewport(page, balanceFilter)
  await expectWithinViewport(page, page.getByRole('button', { name: 'Clear filter', exact: true }))
  expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
  expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(320)
  await balanceFilter.selectOption(String(trip.id))
  await expect(balances).toHaveText(['Alice owes Bob $20.00', 'Charlie owes Alice $15.00'])
  for (const row of await balances.all()) await expectWithinViewport(page, row)
  await page.screenshot({ path: testInfo.outputPath('phone-balances.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Expenses' }).click()
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await addOccasion.click()
  await expect(name).toBeFocused()
  await expectWithinViewport(page, occasionDialog)
  await page.screenshot({ path: testInfo.outputPath('phone-add-occasion.png'), fullPage: true })
  await cancelOccasion.click()
  await expect(addOccasion).toBeFocused()
  await addExpense.click()
  await expectWithinViewport(page, dialog)
  await expectRequiredExpenseFields(dialog)
  for (const field of await dialog.locator('select, input, textarea').all()) await expectWithinViewport(page, field)
  await page.screenshot({ path: testInfo.outputPath('phone-add-expense.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Save Expense' }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Save Expense' })).toBeVisible()
  await expectWithinViewport(page, dialog.getByRole('button', { name: 'Save Expense' }))
  await page.screenshot({ path: testInfo.outputPath('phone-add-expense-fields.png'), fullPage: true })
  await page.keyboard.press('Escape')

  const beforeDeletion = await (await request.get(`${apiUrl}/api/expenses/`)).json() as Expense[]
  const balancesBeforeDeletion = await (await request.get(`${apiUrl}/api/balances/`)).json()
  const reverseExpense = beforeDeletion.find((expense) => expense.description === 'Return payment')!
  const tripExpense = beforeDeletion.find((expense) => expense.description === 'Trip tickets')!
  const deleteRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deleteRequests.push(new URL(request.url()).pathname)
  })
  await expenseCard(page, 'Return payment').getByRole('button', { name: 'Show expenses for Weekend trip', exact: true }).click()
  await expect(expenses).toHaveCount(2)
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balanceFilter).toHaveValue(String(trip.id))
  await expect(balances).toHaveText(['Alice owes Bob $20.00', 'Charlie owes Alice $15.00'])
  await page.getByRole('tab', { name: 'Expenses' }).click()
  const deleteReverse = page.getByRole('button', { name: 'Delete expense: Return payment ($20.00)', exact: true })
  await deleteReverse.click()
  const confirmation = page.getByRole('dialog', { name: 'Delete Expense?' })
  const cancelDelete = confirmation.getByRole('button', { name: 'Cancel', exact: true })
  const confirmDelete = confirmation.getByRole('button', { name: 'Delete Expense', exact: true })
  await expect(cancelDelete).toBeFocused()
  await expectWithinViewport(page, confirmation)
  await expect(confirmation.getByText('“Return payment”', { exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(confirmDelete).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancelDelete).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirmDelete).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('phone-delete-expense.png'), fullPage: true })
  await cancelDelete.click()
  await expect(deleteReverse).toBeFocused()
  expect(deleteRequests).toEqual([])
  expect(await (await request.get(`${apiUrl}/api/expenses/`)).json()).toEqual(beforeDeletion)
  expect(await (await request.get(`${apiUrl}/api/balances/`)).json()).toEqual(balancesBeforeDeletion)
  await deleteReverse.click()
  await page.keyboard.press('Escape')
  await expect(deleteReverse).toBeFocused()
  expect(deleteRequests).toEqual([])
  await deleteReverse.click()
  const removed = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/expenses/${reverseExpense.id}/` && response.request().method() === 'DELETE')
  await confirmDelete.click()
  expect((await removed).status()).toBe(204)
  await expect(confirmation).not.toBeVisible()
  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeFocused()
  await expect(expenses).toHaveCount(1)
  await expect(expenseCard(page, 'Trip tickets')).toBeVisible()
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balanceFilter).toHaveValue(String(trip.id))
  await expect(balances).toHaveText(['Charlie owes Alice $15.00'])
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(balances).toHaveText(['Bob owes Alice $40.00', 'Charlie owes Alice $15.00', 'David owes Charlie $7.00'])
  await page.getByRole('tab', { name: 'Expenses' }).click()
  await expect(expenses).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(expenses).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Return payment', exact: true })).toHaveCount(0)
  expect(deleteRequests).toEqual([`/api/expenses/${reverseExpense.id}/`])
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $40.00', 'Charlie owes Alice $15.00', 'David owes Charlie $7.00'])
  await page.reload()
  await expect(expenses).toHaveCount(4)
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $40.00', 'Charlie owes Alice $15.00', 'David owes Charlie $7.00'])
  await page.getByRole('tab', { name: 'Expenses' }).click()

  // Another client's deletion still produces the existing recoverable 404 flow.
  expect((await request.delete(`${apiUrl}/api/expenses/${tripExpense.id}/`)).status()).toBe(204)
  const deleteMissing = page.getByRole('button', { name: 'Delete expense: Trip tickets ($15.00)', exact: true })
  await deleteMissing.click()
  const missing = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/expenses/${tripExpense.id}/` && response.request().method() === 'DELETE')
  await confirmDelete.click()
  expect((await missing).status()).toBe(404)
  const error = confirmation.getByRole('alert')
  await expect(error).toHaveText('This expense no longer exists. Reload the page to refresh your list.')
  await expect(error).toBeFocused()
  await cancelDelete.click()
  await expect(deleteMissing).toBeFocused()
  await page.reload()
  await expect(expenses).toHaveCount(3)
  await expect(expenseCard(page, 'Historical coffee')).toBeVisible()
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $40.00', 'David owes Charlie $7.00'])
  expect(balanceRequests).toContain('')
  expect(balanceRequests).toContain(`?occasion=${dinner.id}`)
  expect(balanceRequests).toContain(`?occasion=${trip.id}`)
  expect(await (await request.get(`${apiUrl}/api/participants/`)).json()).toEqual(participants)
  await expect(page.getByRole('button', { name: 'Add Person', exact: true })).toHaveCount(0)
})


test('records an ungrouped expense through the real API when the occasion lookup fails', async ({ page, request }) => {
  const participants = await (await request.get(`${apiUrl}/api/participants/`)).json() as Participant[]
  // Fail only the lookup transport; participant reads and expense writes use Django.
  await page.route('**/api/occasions/', (route) => route.abort('failed'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Expense' })
  await expect(dialog.getByRole('alert')).toContainText('You can save with No occasion')
  await expect(dialog.getByRole('button', { name: 'Save Expense' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await createExpense(page, participants, null, 'Alice', 'Bob', '3.00', 'No occasion during lookup failure')
  const persisted = await (await request.get(`${apiUrl}/api/expenses/`)).json() as Expense[]
  expect(persisted.find((expense) => expense.description === 'No occasion during lookup failure')?.occasion).toBeNull()
})


test('Unicode occasion names retain display spelling and reject equivalent forms through the real API', async ({ page, request }) => {
  const participants = await (await request.get(`${apiUrl}/api/participants/`)).json() as Participant[]
  const historicalResponse = await request.post(`${apiUrl}/api/expenses/`, { data: {
    paid_by: participants.find((person) => person.name === 'Charlie')!.id,
    expense_for: participants.find((person) => person.name === 'David')!.id,
    amount: '7.00', description: 'Unicode test ungrouped coffee',
  } })
  expect(historicalResponse.status()).toBe(201)
  const historical = await historicalResponse.json() as Expense
  try {
    expect(historical.occasion).toBeNull()
    await page.goto('/')
    await expect(expenseCard(page, historical.description)).toBeVisible()
    await expect(expenseCard(page, historical.description).getByRole('button', { name: /Show expenses for/ })).toHaveCount(0)
    const occasion = await createOccasion(page, 'Été')
    for (const duplicateName of ['été', ' E\u0301TE\u0301 ']) {
      await page.getByRole('button', { name: 'Add Occasion', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Add Occasion' })
      const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
      await name.fill(duplicateName)
      const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/occasions/' && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: 'Save Occasion' }).click()
      const response = await saved
      expect(response.status()).toBe(400)
      expect((await response.json() as { name: string[] }).name[0]).toContain('already exists')
      await expect(name).toHaveValue(duplicateName)
      await expect(name).toHaveAttribute('aria-invalid', 'true')
      await expect(name).toBeFocused()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    const occasions = await (await request.get(`${apiUrl}/api/occasions/`)).json() as Occasion[]
    expect(occasions.filter((row) => row.id === occasion.id)).toEqual([occasion])
    expect(occasions.some((row) => row.name === 'été' || row.name === 'E\u0301TE\u0301')).toBe(false)
    await createExpense(page, participants, occasion, 'Alice', 'Bob', '5.00', 'Summer coffee')
    await expenseCard(page, 'Summer coffee').getByRole('button', { name: 'Show expenses for Été', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Expenses', exact: true }).getByRole('listitem')).toHaveCount(1)
    await expect(expenseCard(page, historical.description)).toHaveCount(0)
    await page.getByRole('tab', { name: 'Balances' }).click()
    await expect(page.getByRole('combobox', { name: 'Filter balances by occasion' })).toHaveValue('')
    await page.getByRole('combobox', { name: 'Filter balances by occasion' }).selectOption(String(occasion.id))
    await expect(page.getByRole('list', { name: 'Balances', exact: true }).getByRole('listitem')).toHaveText(['Bob owes Alice $5.00'])
    await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Filter balances by occasion' })).toHaveValue('')
    await page.getByRole('tab', { name: 'Expenses' }).click()
    await expect(expenseCard(page, historical.description)).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
    await expect(expenseCard(page, historical.description)).toBeVisible()
    await expect(expenseCard(page, 'Summer coffee')).toBeVisible()
  } finally {
    expect((await request.delete(`${apiUrl}/api/expenses/${historical.id}/`)).status()).toBe(204)
  }
})

test('independent tab filters show one global net and one selected occasion net', async ({ page, request }) => {
  const participants = await (await request.get(`${apiUrl}/api/participants/`)).json() as Participant[]
  const alice = participants.find((person) => person.name === 'Alice')!
  const charlie = participants.find((person) => person.name === 'Charlie')!
  const baseline = await (await request.get(`${apiUrl}/api/balances/`)).json() as Balance[]
  const occasionResponse = await request.post(`${apiUrl}/api/occasions/`, { data: { name: 'Independent filters' } })
  expect(occasionResponse.status()).toBe(201)
  const occasion = await occasionResponse.json() as Occasion
  const fixtureIds: number[] = []
  try {
    for (const input of [
      { paid_by: charlie.id, expense_for: alice.id, occasion: occasion.id, description: 'Independent birthday payment' },
      { paid_by: alice.id, expense_for: charlie.id, description: 'Independent ungrouped repayment' },
    ]) {
      const response = await request.post(`${apiUrl}/api/expenses/`, { data: { ...input, amount: '50.00' } })
      expect(response.status()).toBe(201)
      fixtureIds.push((await response.json() as Expense).id)
    }
    // Opposing expenses contribute zero globally regardless of other tests' data.
    expect(await (await request.get(`${apiUrl}/api/balances/`)).json()).toEqual(baseline)
    const balanceRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/balances/') balanceRequests.push(url.search)
    })
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 740 })
      await page.goto('/')
      const assigned = expenseCard(page, 'Independent birthday payment')
      await assigned.getByRole('button', { name: 'Show expenses for Independent filters', exact: true }).click()
      await expect(page.getByRole('list', { name: 'Expenses', exact: true }).getByRole('listitem')).toHaveCount(1)
      await page.getByRole('tab', { name: 'Balances' }).click()
      const select = page.getByRole('combobox', { name: 'Filter balances by occasion' })
      await expect(select).toHaveValue('')
      const balances = page.getByRole('list', { name: 'Balances', exact: true })
      if (baseline.length === 0) {
        await expect(page.getByText('No outstanding balances.', { exact: true })).toBeVisible()
        await expect(page.getByText('All participant pairs are settled across all occasions and ungrouped expenses.', { exact: true })).toBeVisible()
        await expect(balances).toHaveCount(0)
      } else {
        await expect(balances.getByRole('listitem')).toHaveText(baseline.map((row) => `${row.debtor.name} owes ${row.creditor.name} $${row.amount}`))
        await expect(page.getByRole('list')).toHaveCount(1)
      }
      await expect(page.getByRole('heading', { name: 'Overall', exact: true })).toHaveCount(0)
      await select.selectOption(String(occasion.id))
      await expect(balances.getByRole('listitem')).toHaveText(['Alice owes Charlie $50.00'])
      await expectWithinViewport(page, select)
      await expectWithinViewport(page, balances)
      await page.getByRole('tab', { name: 'Expenses' }).click()
      await expect(assigned).toBeVisible()
      await expect(expenseCard(page, 'Independent ungrouped repayment')).toHaveCount(0)
      await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
      await expect(expenseCard(page, 'Independent ungrouped repayment')).toBeVisible()
      await page.getByRole('tab', { name: 'Balances' }).click()
      await expect(select).toHaveValue(String(occasion.id))
      await expect(balances.getByRole('listitem')).toHaveText(['Alice owes Charlie $50.00'])
      await page.getByRole('button', { name: 'Clear filter', exact: true }).click()
      await expect(select).toHaveValue('')
      await page.getByRole('tab', { name: 'Expenses' }).click()
      await expect(expenseCard(page, 'Independent ungrouped repayment')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Clear filter', exact: true })).toHaveCount(0)
      expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(width)
    }
    expect(balanceRequests).toContain('')
    expect(balanceRequests).toContain(`?occasion=${occasion.id}`)
    expect(balanceRequests.every((search) => search === '' || search === `?occasion=${occasion.id}`)).toBe(true)
  } finally {
    for (const id of fixtureIds) expect((await request.delete(`${apiUrl}/api/expenses/${id}/`)).status()).toBe(204)
  }
})
