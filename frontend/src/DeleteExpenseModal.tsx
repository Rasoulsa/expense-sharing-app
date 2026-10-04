import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { onlineManager, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, deleteExpense } from './api'
import type { Expense } from './api'
import { containDialogFocus } from './dialogFocus'
import { refreshExpenseViews } from './queries'

export default function DeleteExpenseModal({ expense, onClose, onDeleted, returnFocusRef, fallbackFocusRef }: {
  expense: Expense
  onClose: () => void
  onDeleted: () => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const submitting = useRef(false)
  const deleted = useRef(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorAttempt, setErrorAttempt] = useState(0)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: ['delete-expense'],
    mutationFn: () => deleteExpense(expense.id),
    retry: false,
    networkMode: 'always',
    onSuccess: async () => {
      deleted.current = true
      onDeleted()
      onClose()
      await refreshExpenseViews(queryClient, expense.id)
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError && error.status === 404
        ? 'This expense no longer exists. Reload the page to refresh your list.'
        : onlineManager.isOnline() ? 'Could not delete expense. Check your connection and try again.'
          : 'You are offline. Reconnect, then try deleting the expense again.')
      setErrorAttempt((attempt) => attempt + 1)
    },
    onSettled: () => { submitting.current = false },
  })

  useEffect(() => {
    const dialog = dialogRef.current!
    const trigger = returnFocusRef.current
    const fallback = fallbackFocusRef.current
    dialog.showModal()
    cancelRef.current?.focus()
    return () => {
      dialog.close()
      // The deleted card will disappear, so return to the stable Expenses tab.
      const target = deleted.current || !trigger?.isConnected ? fallback : trigger
      target?.focus()
    }
  }, [returnFocusRef, fallbackFocusRef])

  useEffect(() => {
    if (errorAttempt > 0) errorRef.current?.focus()
  }, [errorAttempt])

  function close() {
    if (!submitting.current) onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else containDialogFocus(event, titleRef.current)
  }

  function confirm() {
    if (submitting.current || mutation.isPending) return
    submitting.current = true
    setErrorMessage(null)
    mutation.mutate()
  }

  return (
    <dialog
      ref={dialogRef}
      className="expense-modal delete-modal"
      aria-modal="true"
      aria-labelledby="delete-expense-title"
      aria-describedby="delete-expense-description"
      onCancel={(event) => { event.preventDefault(); close() }}
      onKeyDown={handleKeyDown}
    >
      <header className="modal-header">
        <h2 ref={titleRef} id="delete-expense-title" tabIndex={-1}>Delete Expense?</h2>
      </header>
      <p id="delete-expense-description" className="delete-description">
        Delete <strong>“{expense.description}”</strong> for <strong>${expense.amount}</strong>?
        {' '}This will remove the expense and update balances.
      </p>
      {errorMessage && <p ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{errorMessage}</p>}
      {mutation.isPending && <p role="status">Deleting expense…</p>}
      <div className="modal-actions" aria-busy={mutation.isPending}>
        <button ref={cancelRef} type="button" className="secondary-button" onClick={close} disabled={mutation.isPending}>Cancel</button>
        <button type="button" className="danger-button" onClick={confirm} disabled={mutation.isPending}>{mutation.isPending ? 'Deleting…' : 'Delete Expense'}</button>
      </div>
    </dialog>
  )
}
