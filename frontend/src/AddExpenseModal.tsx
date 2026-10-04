import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, createExpense, expenseFields } from './api'
import type { ExpenseField, Participant } from './api'
import { participantsQuery, refreshExpenseViews } from './queries'
import { containDialogFocus } from './dialogFocus'

type FormValues = Record<ExpenseField, string>
type FieldErrors = Partial<FormValues>

function validate(values: FormValues, participants: Participant[]): FieldErrors {
  const errors: FieldErrors = {}
  const payer = participants.find((person) => String(person.id) === values.paid_by)
  const beneficiary = participants.find((person) => String(person.id) === values.expense_for)
  if (!payer) errors.paid_by = 'Choose who paid.'
  if (!beneficiary) errors.expense_for = 'Choose who the expense was for.'
  else if (payer?.id === beneficiary.id) errors.expense_for = 'Choose a different participant from the payer.'

  if (values.amount.trim() !== values.amount || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(values.amount)) {
    errors.amount = 'Enter an amount like 12.34, with up to two decimal places.'
  } else {
    const [whole, fraction = ''] = values.amount.split('.')
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
    if (cents < 1n || cents > 99_999_999n) errors.amount = 'Amount must be between 0.01 and 999999.99.'
  }

  if (!values.description.trim()) errors.description = 'Enter a description.'
  else if ([...values.description.trim()].length > 500) errors.description = 'Description must be 500 characters or fewer.'
  return errors
}

export default function AddExpenseModal({ onClose, returnFocusRef }: {
  onClose: () => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const submitting = useRef(false)
  const [values, setValues] = useState<FormValues>({ paid_by: '', expense_for: '', amount: '', description: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [errorAttempt, setErrorAttempt] = useState(0)
  const queryClient = useQueryClient()
  const participants = useQuery(participantsQuery)
  const mutation = useMutation({
    mutationFn: createExpense,
    retry: false,
    networkMode: 'always',
    onSuccess: async () => {
      onClose()
      await refreshExpenseViews(queryClient)
    },
    onError: (error) => {
      const errors: FieldErrors = {}
      if (error instanceof ApiError && error.status === 400) {
        for (const field of expenseFields) {
          if (error.fieldErrors[field]?.length) errors[field] = error.fieldErrors[field].join(' ')
        }
        setFormError(error.fieldErrors.non_field_errors?.join(' ') || (
          Object.keys(errors).length ? 'Check the highlighted fields.' : 'Could not save expense. Please try again.'
        ))
      } else {
        setFormError(onlineManager.isOnline()
          ? 'Could not save expense. Please try again.'
          : 'You are offline. Reconnect, then try saving the expense again.')
      }
      setFieldErrors(errors)
      setErrorAttempt((attempt) => attempt + 1)
    },
    onSettled: () => { submitting.current = false },
  })

  useEffect(() => {
    const dialog = dialogRef.current!
    const trigger = returnFocusRef.current
    dialog.showModal()
    titleRef.current?.focus()
    return () => {
      dialog.close()
      trigger?.focus()
    }
  }, [returnFocusRef])

  useEffect(() => {
    if (errorAttempt > 0) {
      const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? errorRef.current
      target?.focus()
    }
  }, [errorAttempt])

  const canSubmit = participants.isSuccess && participants.data.length >= 2 && !mutation.isPending

  function close() {
    if (!submitting.current) onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else containDialogFocus(event, titleRef.current)
  }

  function updateField(field: ExpenseField, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !canSubmit) return
    const errors = validate(values, participants.data!)
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      setFormError('Check the highlighted fields.')
      setErrorAttempt((attempt) => attempt + 1)
      return
    }
    setFormError(null)
    submitting.current = true
    mutation.mutate({
      paid_by: participants.data!.find((person) => String(person.id) === values.paid_by)!.id,
      expense_for: participants.data!.find((person) => String(person.id) === values.expense_for)!.id,
      amount: values.amount,
      description: values.description.trim(),
    })
  }

  function errorAttributes(field: ExpenseField, hint?: string) {
    return {
      'aria-invalid': Boolean(fieldErrors[field]),
      'aria-describedby': [hint, fieldErrors[field] ? `${field}-error` : undefined].filter(Boolean).join(' ') || undefined,
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="expense-modal"
      aria-modal="true"
      aria-labelledby="expense-modal-title"
      aria-describedby="expense-modal-description"
      onCancel={(event) => { event.preventDefault(); close() }}
      onKeyDown={handleKeyDown}
    >
      <header className="modal-header">
        <h2 ref={titleRef} id="expense-modal-title" tabIndex={-1}>Add Expense</h2>
        <button type="button" className="secondary-button" aria-label="Close Add Expense" onClick={close} disabled={mutation.isPending}>Close</button>
      </header>
      <p id="expense-modal-description" className="view-description">Record a payment for another person. All fields are required.</p>

      {participants.isPending && <p role="status">Loading participants…</p>}
      {participants.isError && (
        <div className="participant-error">
          <p role="alert">Could not load participants. Check your connection, then try again.</p>
          <button type="button" onClick={() => { void participants.refetch() }}>Retry participants</button>
        </div>
      )}
      {participants.isSuccess && participants.data.length < 2 && (
        <p role="status">At least two participants are needed to record an expense.</p>
      )}

      <form ref={formRef} onSubmit={submit} noValidate aria-busy={mutation.isPending}>
        {formError && <p ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <fieldset disabled={!canSubmit}>
          <legend className="visually-hidden">Expense details</legend>
          {([
            ['paid_by', 'Paid by'],
            ['expense_for', 'Expense for'],
          ] as const).map(([field, label]) => (
            <div className="form-field" key={field}>
              <label htmlFor={field}>{label}</label>
              <select id={field} name={field} value={values[field]} onChange={(event) => { updateField(field, event.target.value) }} required {...errorAttributes(field)}>
                <option value="">Choose a participant</option>
                {participants.data?.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              {fieldErrors[field] && <p className="field-error" id={`${field}-error`}>{fieldErrors[field]}</p>}
            </div>
          ))}
          <div className="form-field">
            <label htmlFor="amount">Amount</label>
            <input id="amount" name="amount" type="text" inputMode="decimal" value={values.amount} onChange={(event) => { updateField('amount', event.target.value) }} required {...errorAttributes('amount', 'amount-hint')} />
            <p className="field-hint" id="amount-hint">USD · 0.01 to 999999.99, with up to two decimal places.</p>
            {fieldErrors.amount && <p className="field-error" id="amount-error">{fieldErrors.amount}</p>}
          </div>
          <div className="form-field">
            <label htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={3} value={values.description} onChange={(event) => { updateField('description', event.target.value) }} required {...errorAttributes('description', 'description-hint')} />
            <p className="field-hint" id="description-hint">Up to 500 characters.</p>
            {fieldErrors.description && <p className="field-error" id="description-error">{fieldErrors.description}</p>}
          </div>
        </fieldset>
        {mutation.isPending && <p role="status">Saving expense…</p>}
        <button className="save-expense" type="submit" disabled={!canSubmit}>{mutation.isPending ? 'Saving…' : 'Save Expense'}</button>
      </form>
    </dialog>
  )
}
