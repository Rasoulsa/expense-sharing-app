import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const fetchMock = vi.fn<typeof fetch>()
const people = [{ id: 7, name: 'Nina' }, { id: 11, name: 'Omar' }]
const json = (data: unknown) => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('participants page', () => {
  it('shows loading, requests the API, and renders fetched names', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<App />)
    expect(screen.getByRole('status').textContent).toContain('Loading participants')
    const [url, options] = fetchMock.mock.calls[0]
    expect(new URL(String(url)).pathname).toBe('/api/participants/')
    expect(options?.headers).toEqual({ Accept: 'application/json' })
    await act(async () => { resolve(json(people)) })
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Nina', 'Omar'])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows an empty state for an empty API result', async () => {
    fetchMock.mockResolvedValue(json([]))
    render(<App />)
    expect(await screen.findByText('No participants are available yet.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows a network error and fetches again when Retry is clicked', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(people))
    render(<App />)
    expect((await screen.findByRole('alert')).textContent).toContain('Check that the backend')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByRole('status').textContent).toContain('Loading participants')
    expect(await screen.findByText('Nina')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a useful error on HTTP failure', async () => {
    fetchMock.mockResolvedValue(new Response('Unavailable', { status: 503 }))
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('aborts a pending fetch on unmount', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<App />)
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
