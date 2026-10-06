import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { getBalances, getExpenses, getOccasions, getParticipants } from './api'
import type { Expense } from './api'

function expenseListQuery(occasionId?: number) {
  return queryOptions({
    queryKey: occasionId === undefined ? ['expenses'] : ['expenses', { occasion: occasionId }],
    queryFn: ({ signal }) => getExpenses(signal, occasionId),
    retry: false,
    staleTime: 30_000,
  })
}

export const expensesQuery = expenseListQuery()

export function occasionExpensesQuery(occasionId: number) {
  return expenseListQuery(occasionId)
}

export function balanceListQuery(occasionId?: number) {
  return queryOptions({
    queryKey: occasionId === undefined ? ['balances'] : ['balances', { occasion: occasionId }],
    queryFn: ({ signal }) => getBalances(signal, occasionId),
    retry: false,
    staleTime: 30_000,
  })
}

export const balancesQuery = balanceListQuery()

export const participantsQuery = queryOptions({
  queryKey: ['participants'],
  queryFn: ({ signal }) => getParticipants(signal),
  retry: false,
  staleTime: 30_000,
})

export const occasionsQuery = queryOptions({
  queryKey: ['occasions'],
  queryFn: ({ signal }) => getOccasions(signal),
  retry: false,
  staleTime: 30_000,
})

export async function refreshExpenseViews(queryClient: QueryClient, deletedExpenseId?: number) {
  // Cancel reads started before a mutation so late responses cannot restore old data.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: expensesQuery.queryKey }),
    queryClient.cancelQueries({ queryKey: balancesQuery.queryKey }),
  ])
  if (deletedExpenseId !== undefined) {
    // Cancellation can restore the pre-GET snapshot. Remove the persisted deletion
    // after canceling, before the next GET takes its own cancellation snapshot.
    queryClient.setQueriesData<Expense[]>({ queryKey: expensesQuery.queryKey }, (expenses) =>
      expenses?.filter((expense) => expense.id !== deletedExpenseId),
    )
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: expensesQuery.queryKey, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: balancesQuery.queryKey, refetchType: 'none' }),
  ])
  // Reads can pause offline or remain slow. Start both, including an unopened view,
  // without keeping the completed write pending. Read errors keep their retry state.
  void Promise.allSettled([
    queryClient.refetchQueries({ queryKey: expensesQuery.queryKey, type: 'all' }),
    queryClient.refetchQueries({ queryKey: balancesQuery.queryKey, type: 'all' }),
    queryClient.fetchQuery(expensesQuery),
    queryClient.fetchQuery(balancesQuery),
  ])
}
