import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type Participant = { id: number; name: string }

async function createExpense(page: Page, participants: Participant[], payer: string, beneficiary: string, amount: string, description: string) {
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Expense' })
  await dialog.getByRole('combobox', { name: 'Paid by' }).selectOption({ label: payer })
  await dialog.getByRole('combobox', { name: 'Expense for' }).selectOption({ label: beneficiary })
  await dialog.getByRole('textbox', { name: 'Amount' }).fill(amount)
  await dialog.getByRole('textbox', { name: 'Description' }).fill(description)
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/expenses/' && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Save Expense' }).click()
  const response = await saved
  expect(response.status()).toBe(201)
  expect(response.request().postDataJSON()).toEqual({
    paid_by: participants.find((person) => person.name === payer)!.id,
    expense_for: participants.find((person) => person.name === beneficiary)!.id,
    amount,
    description,
  })
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Expense', exact: true })).toBeFocused()
  const expense = page.getByRole('list', { name: 'Expenses' }).getByRole('listitem').filter({
    has: page.getByRole('heading', { name: description, exact: true }),
  })
  await expect(expense).toBeVisible()
  await expect(expense.getByRole('definition').nth(0)).toHaveText(payer)
  await expect(expense.getByRole('definition').nth(1)).toHaveText(beneficiary)
  await expect(expense.getByText(`$${amount}`, { exact: true })).toBeVisible()
}

test('accessible dialogs, creation, deletion, and persisted pairwise balances through the real API', async ({ page, request }, testInfo) => {
  // Read the real API independently of React StrictMode's canceled mount GETs.
  // The browser's fetched select options must match this completed response.
  const response = await request.get('http://127.0.0.1:8001/api/participants/', {
    headers: { Origin: 'http://localhost:5173' },
  })
  expect(response.status()).toBe(200)
  expect(response.headers()['access-control-allow-origin']).toBe('http://localhost:5173')
  const participants = await response.json() as Participant[]
  expect(participants.map((person) => person.name)).toEqual(['Alice', 'Bob', 'Charlie', 'David'])
  expect(participants.every((person) => Number.isInteger(person.id))).toBe(true)

  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Expenses' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('No expenses yet.', { exact: true })).toBeVisible()

  const addExpense = page.getByRole('button', { name: 'Add Expense', exact: true })
  await addExpense.click()
  const dialog = page.getByRole('dialog', { name: 'Add Expense' })
  await expect(dialog.getByRole('heading', { name: 'Add Expense' })).toBeFocused()
  for (const label of ['Paid by', 'Expense for']) {
    await expect(dialog.getByRole('combobox', { name: label }).getByRole('option')).toHaveText([
      'Choose a participant', ...participants.map((person) => person.name),
    ])
  }

  const close = dialog.getByRole('button', { name: 'Close Add Expense' })
  const save = dialog.getByRole('button', { name: 'Save Expense' })
  await expect(save).toBeEnabled()
  for (const control of [
    close,
    dialog.getByRole('combobox', { name: 'Paid by' }),
    dialog.getByRole('combobox', { name: 'Expense for' }),
    dialog.getByRole('textbox', { name: 'Amount' }),
    dialog.getByRole('textbox', { name: 'Description' }),
    save,
    close,
  ]) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
  }
  await page.keyboard.press('Shift+Tab')
  await expect(save).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(addExpense).toBeFocused()

  await createExpense(page, participants, 'Alice', 'Bob', '50.00', 'Shared lunch')
  await createExpense(page, participants, 'Bob', 'Alice', '20.00', 'Return payment')
  await page.getByRole('tab', { name: 'Balances' }).click()
  const balances = page.getByRole('list', { name: 'Balances' }).getByRole('listitem')
  await expect(balances).toHaveCount(1)
  await expect(balances).toHaveText(['Bob owes Alice $30.00'])

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Expenses' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('list', { name: 'Expenses' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Shared lunch', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Return payment', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveCount(1)
  await expect(balances).toHaveText(['Bob owes Alice $30.00'])

  const addPerson = page.getByRole('button', { name: 'Add Person', exact: true })
  await addPerson.click()
  const personDialog = page.getByRole('dialog', { name: 'Add Person' })
  const name = personDialog.getByRole('textbox', { name: 'Name' })
  const closePerson = personDialog.getByRole('button', { name: 'Close Add Person' })
  const savePerson = personDialog.getByRole('button', { name: 'Save Person' })
  await expect(name).toBeFocused()
  for (const control of [savePerson, closePerson, name]) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
  }
  for (const control of [closePerson, savePerson, name]) {
    await page.keyboard.press('Shift+Tab')
    await expect(control).toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(personDialog).not.toBeVisible()
  await expect(addPerson).toBeFocused()
  await addPerson.click()
  await name.fill('  Mina Farah  ')
  const personSaved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/participants/' && response.request().method() === 'POST')
  await savePerson.click()
  const createdResponse = await personSaved
  expect(createdResponse.status()).toBe(201)
  expect(createdResponse.request().postDataJSON()).toEqual({ name: 'Mina Farah' })
  const created = await createdResponse.json() as Participant
  expect(created.name).toBe('Mina Farah')
  expect(Number.isInteger(created.id)).toBe(true)
  await expect(personDialog).not.toBeVisible()
  await expect(addPerson).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Mina Farah added. You can now select them in Add Expense.')

  await page.getByRole('tab', { name: 'Expenses' }).click()
  await addExpense.click()
  for (const label of ['Paid by', 'Expense for']) {
    await expect(dialog.getByRole('combobox', { name: label }).getByRole('option', { name: created.name })).toHaveAttribute('value', String(created.id))
  }
  await dialog.getByRole('button', { name: 'Close Add Expense' }).click()
  await createExpense(page, [...participants, created], 'Alice', created.name, '15.00', 'Coffee with Mina')

  await page.reload()
  const expenses = page.getByRole('list', { name: 'Expenses' }).getByRole('listitem')
  await expect(expenses).toHaveCount(3)
  await expect(page.getByRole('heading', { name: 'Coffee with Mina', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desktop-expenses.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $30.00', 'Mina Farah owes Alice $15.00'])
  await page.screenshot({ path: testInfo.outputPath('desktop-balances.png'), fullPage: true })

  await page.setViewportSize({ width: 320, height: 740 })
  // Assert visible content fits the narrow viewport; screenshots also cover spacing.
  async function expectWithinPhone(locator: ReturnType<Page['getByRole']>) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  }
  for (const row of await balances.all()) await expectWithinPhone(row)
  await page.screenshot({ path: testInfo.outputPath('phone-balances.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Expenses' }).click()
  for (const row of await expenses.all()) {
    await expectWithinPhone(row)
    await expectWithinPhone(row.getByRole('heading'))
    await expectWithinPhone(row.getByRole('definition').nth(2))
  }
  await page.screenshot({ path: testInfo.outputPath('phone-expenses.png'), fullPage: true })
  await addPerson.click()
  await expect(name).toBeFocused()
  await expectWithinPhone(personDialog)
  await page.screenshot({ path: testInfo.outputPath('phone-add-person.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(addPerson).toBeFocused()
  await addExpense.click()
  await expect(dialog.getByRole('heading', { name: 'Add Expense' })).toBeFocused()
  await expectWithinPhone(dialog)
  await page.screenshot({ path: testInfo.outputPath('phone-add-expense.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(addExpense).toBeFocused()

  const apiUrl = 'http://127.0.0.1:8001'
  const beforeDeletion = await (await request.get(`${apiUrl}/api/expenses/`)).json() as {
    id: number; description: string; amount: string
  }[]
  const balancesBeforeDeletion = await (await request.get(`${apiUrl}/api/balances/`)).json()
  const reverseExpense = beforeDeletion.find((expense) => expense.description === 'Return payment')!
  const personExpense = beforeDeletion.find((expense) => expense.description === 'Coffee with Mina')!
  const deleteRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deleteRequests.push(new URL(request.url()).pathname)
  })

  const deleteReverse = page.getByRole('button', { name: 'Delete expense: Return payment ($20.00)', exact: true })
  await deleteReverse.click()
  const confirmation = page.getByRole('dialog', { name: 'Delete Expense?' })
  const cancelDelete = confirmation.getByRole('button', { name: 'Cancel', exact: true })
  const confirmDelete = confirmation.getByRole('button', { name: 'Delete Expense', exact: true })
  await expect(cancelDelete).toBeFocused()
  await expect(confirmation.getByText('“Return payment”', { exact: true })).toBeVisible()
  await expect(confirmation.getByText('$20.00', { exact: true })).toBeVisible()
  await expectWithinPhone(confirmation)
  await page.keyboard.press('Tab')
  await expect(confirmDelete).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancelDelete).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirmDelete).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('phone-delete-expense.png'), fullPage: true })
  await cancelDelete.click()
  await expect(confirmation).not.toBeVisible()
  await expect(deleteReverse).toBeFocused()
  await expect(expenses).toHaveCount(3)
  expect(deleteRequests).toEqual([])
  expect(await (await request.get(`${apiUrl}/api/expenses/`)).json()).toEqual(beforeDeletion)
  expect(await (await request.get(`${apiUrl}/api/balances/`)).json()).toEqual(balancesBeforeDeletion)

  await deleteReverse.click()
  await page.keyboard.press('Escape')
  await expect(confirmation).not.toBeVisible()
  await expect(deleteReverse).toBeFocused()
  expect(deleteRequests).toEqual([])

  await deleteReverse.click()
  const removed = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/expenses/${reverseExpense.id}/` && response.request().method() === 'DELETE')
  await confirmDelete.click()
  const deleteResponse = await removed
  expect(deleteResponse.status()).toBe(204)
  await expect(confirmation).not.toBeVisible()
  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeFocused()
  await expect(expenses).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Return payment', exact: true })).not.toBeVisible()
  expect(deleteRequests).toEqual([`/api/expenses/${reverseExpense.id}/`])
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $50.00', 'Mina Farah owes Alice $15.00'])

  await page.reload()
  await expect(expenses).toHaveCount(2)
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $50.00', 'Mina Farah owes Alice $15.00'])
  await page.getByRole('tab', { name: 'Expenses' }).click()

  // Simulate another client deleting a displayed expense. The browser must show
  // the real 404 without removing other expenses or changing the surviving pair.
  expect((await request.delete(`${apiUrl}/api/expenses/${personExpense.id}/`)).status()).toBe(204)
  const deleteMissing = page.getByRole('button', { name: 'Delete expense: Coffee with Mina ($15.00)', exact: true })
  await deleteMissing.click()
  const missing = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/expenses/${personExpense.id}/` && response.request().method() === 'DELETE')
  await confirmDelete.click()
  expect((await missing).status()).toBe(404)
  const error = confirmation.getByRole('alert')
  await expect(error).toHaveText('This expense no longer exists. Reload the page to refresh your list.')
  await expect(error).toBeFocused()
  await expect(confirmation.getByText('“Coffee with Mina”', { exact: true })).toBeVisible()
  await cancelDelete.click()
  await expect(deleteMissing).toBeFocused()
  await expect(expenses).toHaveCount(2)
  await page.reload()
  await expect(expenses).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Shared lunch', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(balances).toHaveText(['Bob owes Alice $50.00'])
})
