import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { onlineManager, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, createParticipant } from './api'
import type { Participant } from './api'
import { containDialogFocus } from './dialogFocus'
import { participantsQuery } from './queries'

export default function AddPersonModal({ onClose, onCreated, returnFocusRef }: {
  onClose: () => void
  onCreated: (person: Participant) => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const submitting = useRef(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [errorAttempt, setErrorAttempt] = useState(0)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: createParticipant,
    retry: false,
    networkMode: 'always',
    onSuccess: async (person) => {
      onCreated(person)
      onClose()
      await queryClient.cancelQueries({ queryKey: participantsQuery.queryKey })
      await queryClient.invalidateQueries({ queryKey: participantsQuery.queryKey, refetchType: 'none' })
      // Refresh the options even if Add Expense has not been opened yet.
      // A failed refresh belongs to the participant query's existing retry state.
      // A paused/slow participant read must not keep a successful write pending.
      void Promise.allSettled([queryClient.fetchQuery(participantsQuery)])
    },
    onError: (error) => {
      const fieldError = error instanceof ApiError ? error.fieldErrors.name?.join(' ') : undefined
      setNameError(fieldError || null)
      setFormError(error instanceof ApiError && error.fieldErrors.non_field_errors?.length
        ? error.fieldErrors.non_field_errors.join(' ')
        : fieldError ? 'Check the highlighted field.'
          : onlineManager.isOnline() ? 'Could not add person. Please try again.'
            : 'You are offline. Reconnect, then try adding the person again.')
      setErrorAttempt((attempt) => attempt + 1)
    },
    onSettled: () => { submitting.current = false },
  })

  useEffect(() => {
    const dialog = dialogRef.current!
    const trigger = returnFocusRef.current
    dialog.showModal()
    inputRef.current?.focus()
    return () => {
      dialog.close()
      trigger?.focus()
    }
  }, [returnFocusRef])

  useEffect(() => {
    if (errorAttempt > 0) (nameError ? inputRef.current : errorRef.current)?.focus()
  }, [errorAttempt, nameError])

  function close() {
    if (!submitting.current) onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else containDialogFocus(event, titleRef.current)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || mutation.isPending) return
    const trimmed = name.trim()
    const error = !trimmed ? 'Enter a name.'
      : [...trimmed].length > 100 ? 'Name must be 100 characters or fewer.' : null
    setNameError(error)
    if (error) {
      setFormError('Check the highlighted field.')
      setErrorAttempt((attempt) => attempt + 1)
      return
    }
    setFormError(null)
    submitting.current = true
    mutation.mutate({ name: trimmed })
  }

  return (
    <dialog
      ref={dialogRef}
      className="expense-modal person-modal"
      aria-modal="true"
      aria-labelledby="person-modal-title"
      aria-describedby="person-modal-description"
      onCancel={(event) => { event.preventDefault(); close() }}
      onKeyDown={handleKeyDown}
    >
      <header className="modal-header">
        <h2 ref={titleRef} id="person-modal-title" tabIndex={-1}>Add Person</h2>
        <button type="button" className="secondary-button" aria-label="Close Add Person" onClick={close} disabled={mutation.isPending}>Close</button>
      </header>
      <p id="person-modal-description" className="view-description">Add someone to the expense participant list.</p>
      <form onSubmit={submit} noValidate aria-busy={mutation.isPending}>
        {formError && <p ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <div className="form-field">
          <label htmlFor="person-name">Name</label>
          <input
            ref={inputRef}
            id="person-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => { setName(event.target.value); setNameError(null); setFormError(null) }}
            required
            disabled={mutation.isPending}
            aria-invalid={Boolean(nameError)}
            aria-describedby={`person-name-hint${nameError ? ' person-name-error' : ''}`}
          />
          <p id="person-name-hint" className="field-hint">Use a unique display name, up to 100 characters.</p>
          {nameError && <p id="person-name-error" className="field-error">{nameError}</p>}
        </div>
        {mutation.isPending && <p role="status">Adding person…</p>}
        <button className="save-expense" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save Person'}</button>
      </form>
    </dialog>
  )
}
