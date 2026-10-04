import type { KeyboardEvent } from 'react'

export function containDialogFocus(event: KeyboardEvent<HTMLDialogElement>, fallback: HTMLElement | null) {
  if (event.key !== 'Tab') return
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'))
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled'))
  const first = controls[0]
  const last = controls.at(-1)
  const active = document.activeElement
  if (!first) {
    event.preventDefault()
    fallback?.focus()
  } else if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) {
    event.preventDefault()
    first.focus()
  }
}
