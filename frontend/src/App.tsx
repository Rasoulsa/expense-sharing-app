import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import AddExpenseModal from './AddExpenseModal'
import AddOccasionModal from './AddOccasionModal'
import DeleteExpenseModal from './DeleteExpenseModal'
import type { Balance, Expense, Occasion } from './api'
import { balanceListQuery, expensesQuery, occasionExpensesQuery, occasionsQuery } from './queries'

type View = 'expenses' | 'balances'

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function PersonMarker({ name }: { name: string }) {
  const words = name.trim().split(/\s+/)
  const initials = [words[0], ...(words.length > 1 ? [words.at(-1)!] : [])]
    .map((word) => [...word][0]).join('').toLocaleUpperCase()
  return <span className="person-marker" aria-hidden="true" data-initials={initials} />
}

function LoadError({ view, retry }: { view: View; retry: () => void }) {
  return (
    <div className="view-state">
      <p role="alert">Could not load {view}. Check your connection, then try again.</p>
      <button type="button" onClick={retry}>Retry {view}</button>
    </div>
  )
}

function ExpensesView({ onDelete, occasionFilter, onFilter }: {
  onDelete: (expense: Expense, trigger: HTMLButtonElement) => void
  occasionFilter: Occasion | null
  onFilter: (occasion: Occasion) => void
}) {
  const { data, isPending, isError, refetch } = useQuery(occasionFilter ? occasionExpensesQuery(occasionFilter.id) : expensesQuery)
  const isDeleting = useIsMutating({ mutationKey: ['delete-expense'] }) > 0

  if (isPending) return <p className="view-state" role="status">Loading expenses…</p>
  if (isError) return <LoadError view="expenses" retry={() => { void refetch() }} />
  if (data.length === 0) {
    return (
      <div className="view-state" role="status">
        <p className="state-title">{occasionFilter ? `No expenses for ${occasionFilter.name}.` : 'No expenses yet.'}</p>
        <p>{occasionFilter ? 'Clear the filter to see all expenses.' : 'Recorded expenses will appear here with who paid and who they were for.'}</p>
      </div>
    )
  }

  return (
    <ul className="expense-list" role="list" aria-label="Expenses">
      {data.map((expense) => (
        <li className="expense-card" key={expense.id}>
          <PersonMarker name={expense.paid_by.name} />
          <div className="expense-body">
            <div className="expense-heading">
              <h3>{expense.description}</h3>
              <button type="button" className="delete-expense-action" aria-label={`Delete expense: ${expense.description} ($${expense.amount})`} aria-haspopup="dialog" disabled={isDeleting} onClick={(event) => { onDelete(expense, event.currentTarget) }}>Delete</button>
            </div>
            <dl className="expense-details">
              <div className="expense-relationship">
                <dt className="visually-hidden">Paid by</dt><dd>{expense.paid_by.name}</dd>
                <span className="relationship-arrow" aria-hidden="true">→</span>
                <dt className="visually-hidden">For</dt><dd>{expense.expense_for.name}</dd>
              </div>
              <div className="expense-total"><dt className="visually-hidden">Amount</dt><dd className="amount">${expense.amount}</dd></div>
              <div className="expense-date">
                <dt className="visually-hidden">Date</dt>
                <dd><time dateTime={expense.created_at}>{dateFormatter.format(new Date(expense.created_at))}</time></dd>
              </div>
              {expense.occasion && <div className="expense-occasion">
                <dt className="visually-hidden">Occasion</dt>
                <dd><button type="button" className="occasion-action" aria-label={`Show expenses for ${expense.occasion.name}`} aria-pressed={occasionFilter?.id === expense.occasion.id} aria-controls="expenses-panel" onClick={() => { onFilter(expense.occasion!) }}>{expense.occasion.name}</button></dd>
              </div>}
            </dl>
          </div>
        </li>
      ))}
    </ul>
  )
}

function BalanceOccasionFilter({ occasionFilter, onFilter }: {
  occasionFilter: Occasion | null
  onFilter: (occasion: Occasion | null) => void
}) {
  const occasions = useQuery(occasionsQuery)
  const selectRef = useRef<HTMLSelectElement>(null)
  const choices = occasions.data ?? []
  const selectedMissing = occasionFilter && !choices.some((occasion) => occasion.id === occasionFilter.id)

  return (
    <div className="expense-filter balance-filter" aria-busy={occasions.isFetching}>
      <div className="form-field">
        <label htmlFor="balance-occasion-filter">Filter balances by occasion</label>
        <select ref={selectRef} id="balance-occasion-filter" value={occasionFilter?.id ?? ''} onChange={(event) => {
          onFilter(choices.find((occasion) => String(occasion.id) === event.target.value) ?? null)
        }}>
          <option value="">All occasions</option>
          {selectedMissing && <option value={occasionFilter.id}>{occasionFilter.name}</option>}
          {choices.map((occasion) => <option key={occasion.id} value={occasion.id}>{occasion.name}</option>)}
        </select>
      </div>
      {occasionFilter && <button type="button" className="secondary-button" onClick={() => { onFilter(null); selectRef.current?.focus() }}>Clear filter</button>}
      {occasions.isPending && <p className="field-hint">Loading occasion choices…</p>}
      {occasions.isError && <div className="filter-error">
        <p role="alert">Could not load occasion choices. All occasions is still available.</p>
        <button type="button" onClick={() => { void occasions.refetch() }}>Retry occasion choices</button>
      </div>}
    </div>
  )
}

function BalancesView({ occasionFilter }: { occasionFilter: Occasion | null }) {
  const { data, isPending, isError, refetch } = useQuery(balanceListQuery(occasionFilter?.id))

  if (isPending) return <p className="view-state" role="status">Loading balances…</p>
  if (isError) return <LoadError view="balances" retry={() => { void refetch() }} />
  if (data.length === 0) {
    return (
      <div className="view-state" role="status">
        <p className="state-title">{occasionFilter ? `No outstanding balances for ${occasionFilter.name}.` : 'No outstanding balances.'}</p>
        <p>{occasionFilter
          ? 'There are no amounts owed for this occasion. Clear the filter to see all occasions.'
          : 'All participant pairs are settled across all occasions and ungrouped expenses.'}</p>
      </div>
    )
  }
  return <BalanceRows balances={data} />
}

function BalanceRows({ balances }: { balances: Balance[] }) {
  return (
    <ul className="balance-list" role="list" aria-label="Balances">
      {balances.map((balance) => (
        <li className="balance-card" key={`${balance.debtor.id}-${balance.creditor.id}`}>
          <PersonMarker name={balance.debtor.name} />
          <p className="balance-statement">
            <strong>{balance.debtor.name}</strong> owes <strong>{balance.creditor.name}</strong>{' '}
            <span className="amount">${balance.amount}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

export default function App() {
  const [view, setView] = useState<View>('expenses')
  const [dialog, setDialog] = useState<'expense' | 'occasion' | 'delete' | null>(null)
  const [expenseOccasion, setExpenseOccasion] = useState<Occasion | null>(null)
  const [balanceOccasion, setBalanceOccasion] = useState<Occasion | null>(null)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const addExpenseButton = useRef<HTMLButtonElement>(null)
  const addOccasionButton = useRef<HTMLButtonElement>(null)
  const clearFilterButton = useRef<HTMLButtonElement>(null)
  const deleteExpenseButton = useRef<HTMLButtonElement>(null)
  const expensesTab = useRef<HTMLButtonElement>(null)
  const balancesTab = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (expenseOccasion && !clearFilterButton.current?.closest('[hidden]')) clearFilterButton.current?.focus()
  }, [expenseOccasion])

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let nextView: View
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        nextView = view === 'expenses' ? 'balances' : 'expenses'
        break
      case 'Home':
        nextView = 'expenses'
        break
      case 'End':
        nextView = 'balances'
        break
      default:
        return
    }
    event.preventDefault()
    setView(nextView)
    const nextTab = nextView === 'expenses' ? expensesTab : balancesTab
    nextTab.current?.focus()
  }

  return (
    <main className="page-shell">
      <section className="welcome-card" aria-labelledby="page-title">
        <header className="page-header">
          <div>
            <span className="eyebrow">Expense sharing</span>
            <h1 id="page-title">Shared costs, made clear.</h1>
            <p className="description">Record expenses. See who owes whom.</p>
          </div>
          <div className="page-actions">
            <button ref={addOccasionButton} type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => { setSuccessMessage(''); setDialog('occasion') }}>Add Occasion</button>
            <button ref={addExpenseButton} type="button" aria-haspopup="dialog" onClick={() => { setDialog('expense') }}>Add Expense</button>
          </div>
        </header>
        <div role={successMessage ? 'status' : undefined} aria-live="polite" aria-atomic="true" className={successMessage ? 'success-message' : undefined}>{successMessage}</div>

        <div className="view-tabs" role="tablist" aria-label="Expense sharing views" onKeyDown={handleTabKeyDown}>
          <button
            ref={expensesTab}
            type="button"
            role="tab"
            id="expenses-tab"
            aria-controls="expenses-panel"
            aria-selected={view === 'expenses'}
            tabIndex={view === 'expenses' ? 0 : -1}
            onClick={() => { setView('expenses') }}
          >Expenses</button>
          <button
            ref={balancesTab}
            type="button"
            role="tab"
            id="balances-tab"
            aria-controls="balances-panel"
            aria-selected={view === 'balances'}
            tabIndex={view === 'balances' ? 0 : -1}
            onClick={() => { setView('balances') }}
          >Balances</button>
        </div>

        <section id="expenses-panel" role="tabpanel" aria-labelledby="expenses-tab" tabIndex={0} hidden={view !== 'expenses'}>
          <h2>Expenses</h2>
          <p className="view-description">See who paid and who each expense was for.</p>
          {expenseOccasion && <div className="expense-filter">
            <p role="status">Showing expenses for <strong>{expenseOccasion.name}</strong>.</p>
            <button ref={clearFilterButton} type="button" className="secondary-button" onClick={() => { setExpenseOccasion(null); expensesTab.current?.focus() }}>Clear filter</button>
          </div>}
          {view === 'expenses' && <ExpensesView occasionFilter={expenseOccasion} onFilter={setExpenseOccasion} onDelete={(expense, trigger) => {
            deleteExpenseButton.current = trigger
            setExpenseToDelete(expense)
            setDialog('delete')
          }} />}
        </section>
        <section id="balances-panel" role="tabpanel" aria-labelledby="balances-tab" tabIndex={0} hidden={view !== 'balances'}>
          <h2>Balances</h2>
          <p className="view-description">{balanceOccasion ? `See what is owed between each pair of people for ${balanceOccasion.name}.` : 'See what is owed between each pair of people across all occasions and ungrouped expenses.'}</p>
          {view === 'balances' && <>
            <BalanceOccasionFilter occasionFilter={balanceOccasion} onFilter={setBalanceOccasion} />
            <BalancesView occasionFilter={balanceOccasion} />
          </>}
        </section>
      </section>
      {dialog === 'expense' && <AddExpenseModal onClose={() => { setDialog(null) }} returnFocusRef={addExpenseButton} />}
      {dialog === 'occasion' && <AddOccasionModal onClose={() => { setDialog(null) }} onCreated={(occasion) => { setSuccessMessage(`${occasion.name} added. You can now select it in Add Expense.`) }} returnFocusRef={addOccasionButton} />}
      {dialog === 'delete' && expenseToDelete && <DeleteExpenseModal
        expense={expenseToDelete}
        onClose={() => { setDialog(null); setExpenseToDelete(null) }}
        onDeleted={() => { setSuccessMessage(`Deleted “${expenseToDelete.description}” ($${expenseToDelete.amount}).`) }}
        returnFocusRef={deleteExpenseButton}
        fallbackFocusRef={expensesTab}
      />}
    </main>
  )
}
