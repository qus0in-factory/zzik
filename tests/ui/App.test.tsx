// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '@ui/App'

afterEach(cleanup)

describe('Given the dashboard', () => {
  it('When it renders Then Hello Young-In is the main heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Hello Young-In', level: 1 })).toBeTruthy()
  })
})
