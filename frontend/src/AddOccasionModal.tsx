import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { onlineManager, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, createOccasion } from './api'
import type { Occasion } from './api'
import { containDialogFocus } from './dialogFocus'
import { occasionsQuery } from './queries'

export default function AddOccasionModal({ onClose, onCreated, returnFocusRef }: {
  onClose: () => void
  onCreated: (occasion: Occasion) => void
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
    mutationFn: createOccasion,
    retry: false,
    networkMode: 'always',
    onSuccess: async (occasion) => {
      onCreated(occasion)
      onClose()
      await queryClient.cancelQueries({ queryKey: occasionsQuery.queryKey })
      await queryClient.invalidateQueries({ queryKey: occasionsQuery.queryKey, refetchType: 'none' })
      // Refresh the options even if Add Expense has not been opened yet.
      // A failed refresh belongs to the occasion query's existing retry state.
      // A paused/slow read must not keep a successful write pending.
      void Promise.allSettled([queryClient.fetchQuery(occasionsQuery)])
    },
    onError: (error) => {
      const fieldError = error instanceof ApiError ? error.fieldErrors.name?.join(' ') : undefined
      setNameError(fieldError || null)
      setFormError(error instanceof ApiError && error.fieldErrors.non_field_errors?.length
        ? error.fieldErrors.non_field_errors.join(' ')
        : fieldError ? 'Check the highlighted field.'
          : onlineManager.isOnline() ? 'Could not add occasion. Please try again.'
            : 'You are offline. Reconnect, then try adding the occasion again.')
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
      className="expense-modal occasion-modal"
      aria-modal="true"
      aria-labelledby="occasion-modal-title"
      aria-describedby="occasion-modal-description"
      onCancel={(event) => { event.preventDefault(); close() }}
      onKeyDown={handleKeyDown}
    >
      <header className="modal-header">
        <h2 ref={titleRef} id="occasion-modal-title" tabIndex={-1}>Add Occasion</h2>
        <button type="button" className="secondary-button" aria-label="Close Add Occasion" onClick={close} disabled={mutation.isPending}>Close</button>
      </header>
      <p id="occasion-modal-description" className="view-description">Create an occasion to organize your expenses.</p>
      <form onSubmit={submit} noValidate aria-busy={mutation.isPending}>
        {formError && <p ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <div className="form-field">
          <label htmlFor="occasion-name">Name</label>
          <input
            ref={inputRef}
            id="occasion-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => { setName(event.target.value); setNameError(null); setFormError(null) }}
            required
            disabled={mutation.isPending}
            aria-invalid={Boolean(nameError)}
            aria-describedby={`occasion-name-hint${nameError ? ' occasion-name-error' : ''}`}
          />
          <p id="occasion-name-hint" className="field-hint">Required. Use a unique name (case-insensitive), up to 100 characters.</p>
          {nameError && <p id="occasion-name-error" className="field-error">{nameError}</p>}
        </div>
        {mutation.isPending && <p role="status">Adding occasion…</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={mutation.isPending}>Cancel</button>
          <button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save Occasion'}</button>
        </div>
      </form>
    </dialog>
  )
}
