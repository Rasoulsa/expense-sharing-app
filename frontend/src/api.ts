const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type Participant = { id: number; name: string }

export type Expense = {
  id: number
  paid_by: Participant
  expense_for: Participant
  amount: string
  description: string
  created_at: string
}

export type Balance = {
  debtor: Participant
  creditor: Participant
  amount: string
}

export type NewExpense = {
  paid_by: number
  expense_for: number
  amount: string
  description: string
}

export const expenseFields = ['paid_by', 'expense_for', 'amount', 'description'] as const
export type ExpenseField = typeof expenseFields[number]
export type ExpenseValidationErrors = Partial<Record<ExpenseField | 'non_field_errors', string[]>>
export type ApiValidationErrors = ExpenseValidationErrors & { name?: string[] }

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: ApiValidationErrors

  constructor(status: number, fieldErrors: ApiValidationErrors = {}) {
    super(`Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export function getParticipants(signal?: AbortSignal): Promise<Participant[]> {
  return getJson('/api/participants/', signal)
}

export function getExpenses(signal?: AbortSignal): Promise<Expense[]> {
  return getJson('/api/expenses/', signal)
}

export function getBalances(signal?: AbortSignal): Promise<Balance[]> {
  return getJson('/api/balances/', signal)
}

async function postJson<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const fieldErrors: ApiValidationErrors = {}
    if (response.status === 400) {
      const body: unknown = await response.json().catch(() => null)
      if (body !== null && typeof body === 'object') {
        const details = body as Record<string, unknown>
        for (const field of [...expenseFields, 'name', 'non_field_errors'] as const) {
          const messages = details[field]
          if (Array.isArray(messages) && messages.every((message) => typeof message === 'string')) {
            fieldErrors[field] = messages
          }
        }
      }
    }
    throw new ApiError(response.status, fieldErrors)
  }
  return (await response.json()) as T
}

export function createExpense(expense: NewExpense): Promise<Expense> {
  return postJson('/api/expenses/', expense)
}

export function createParticipant(person: { name: string }): Promise<Participant> {
  return postJson('/api/participants/', person)
}

export async function deleteExpense(id: number): Promise<void> {
  const response = await fetch(new URL(`/api/expenses/${id}/`, API_BASE_URL), {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new ApiError(response.status)
  // A successful DELETE has an empty 204 response body.
}
