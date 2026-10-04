import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import AddExpenseModal from './AddExpenseModal'
import AddPersonModal from './AddPersonModal'
import DeleteExpenseModal from './DeleteExpenseModal'
import type { Expense } from './api'
import { balancesQuery, expensesQuery } from './queries'

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

function ExpensesView({ onDelete }: { onDelete: (expense: Expense, trigger: HTMLButtonElement) => void }) {
  const { data, isPending, isError, refetch } = useQuery(expensesQuery)
  const isDeleting = useIsMutating({ mutationKey: ['delete-expense'] }) > 0

  if (isPending) return <p className="view-state" role="status">Loading expenses…</p>
  if (isError) return <LoadError view="expenses" retry={() => { void refetch() }} />
  if (data.length === 0) {
    return (
      <div className="view-state" role="status">
        <p className="state-title">No expenses yet.</p>
        <p>Recorded expenses will appear here with who paid and who they were for.</p>
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
            </dl>
          </div>
        </li>
      ))}
    </ul>
  )
}

function BalancesView() {
  const { data, isPending, isError, refetch } = useQuery(balancesQuery)

  if (isPending) return <p className="view-state" role="status">Loading balances…</p>
  if (isError) return <LoadError view="balances" retry={() => { void refetch() }} />
  if (data.length === 0) {
    return (
      <div className="view-state" role="status">
        <p className="state-title">No outstanding balances.</p>
        <p>There are no amounts owed between participants.</p>
      </div>
    )
  }

  return (
    <ul className="balance-list" role="list" aria-label="Balances">
      {data.map((balance) => (
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
  const [dialog, setDialog] = useState<'expense' | 'person' | 'delete' | null>(null)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const addExpenseButton = useRef<HTMLButtonElement>(null)
  const addPersonButton = useRef<HTMLButtonElement>(null)
  const deleteExpenseButton = useRef<HTMLButtonElement>(null)
  const expensesTab = useRef<HTMLButtonElement>(null)
  const balancesTab = useRef<HTMLButtonElement>(null)

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
            <button ref={addPersonButton} type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => { setSuccessMessage(''); setDialog('person') }}>Add Person</button>
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
          {view === 'expenses' && <ExpensesView onDelete={(expense, trigger) => {
            deleteExpenseButton.current = trigger
            setExpenseToDelete(expense)
            setDialog('delete')
          }} />}
        </section>
        <section id="balances-panel" role="tabpanel" aria-labelledby="balances-tab" tabIndex={0} hidden={view !== 'balances'}>
          <h2>Balances</h2>
          <p className="view-description">See what is owed between each pair of people.</p>
          {view === 'balances' && <BalancesView />}
        </section>
      </section>
      {dialog === 'expense' && <AddExpenseModal onClose={() => { setDialog(null) }} returnFocusRef={addExpenseButton} />}
      {dialog === 'person' && <AddPersonModal onClose={() => { setDialog(null) }} onCreated={(person) => { setSuccessMessage(`${person.name} added. You can now select them in Add Expense.`) }} returnFocusRef={addPersonButton} />}
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
