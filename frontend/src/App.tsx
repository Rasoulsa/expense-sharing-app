import { useEffect, useState } from 'react'
import { getJson } from './api'
import type { Participant } from './api'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; participants: Participant[] }
  | { status: 'error' }

export default function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getJson<Participant[]>('/api/participants/', controller.signal)
      .then((participants) => {
        if (!controller.signal.aborted) setState({ status: 'ready', participants })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => {
      controller.abort()
    }
  }, [attempt])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <main className="page-shell">
      <section className="welcome-card" aria-labelledby="page-title">
        <span className="eyebrow">Expense sharing</span>
        <h1 id="page-title">Keep shared costs clear.</h1>
        <p className="description">
          A simple place to see what is owed between people.
        </p>
        <h2>Participants</h2>
        {state.status === 'loading' && <p role="status">Loading participants…</p>}
        {state.status === 'ready' && (
          state.participants.length === 0 ? (
            <p role="status">No participants are available yet.</p>
          ) : (
            <ul className="participants" aria-label="Participants">
              {state.participants.map((participant) => (
                <li key={participant.id}>{participant.name}</li>
              ))}
            </ul>
          )
        )}
        {state.status === 'error' && (
          <div>
            <p role="alert">
              Could not load participants. Check that the backend is running, then try again.
            </p>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        )}
      </section>
    </main>
  )
}
