const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type Participant = { id: number; name: string }

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  return (await response.json()) as T
}
