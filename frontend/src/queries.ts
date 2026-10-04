import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { getBalances, getExpenses, getParticipants } from './api'
import type { Expense } from './api'

export const expensesQuery = queryOptions({
  queryKey: ['expenses'],
  queryFn: ({ signal }) => getExpenses(signal),
  retry: false,
  staleTime: 30_000,
})

export const balancesQuery = queryOptions({
  queryKey: ['balances'],
  queryFn: ({ signal }) => getBalances(signal),
  retry: false,
  staleTime: 30_000,
})

export const participantsQuery = queryOptions({
  queryKey: ['participants'],
  queryFn: ({ signal }) => getParticipants(signal),
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
    queryClient.setQueryData<Expense[]>(expensesQuery.queryKey, (expenses) =>
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
    queryClient.fetchQuery(expensesQuery),
    queryClient.fetchQuery(balancesQuery),
  ])
}
