import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AddBillDatePicker } from './AddBillDatePicker'

function StatefulPicker() {
  const [value, setValue] = useState('2026-09-06')
  return <AddBillDatePicker id="test-date" value={value} onChange={setValue} />
}

describe('AddBillDatePicker', () => {
  it('uses an app-owned text trigger instead of the native date control', () => {
    render(<AddBillDatePicker id="test-date" value="2026-09-06" onChange={() => {}} />)

    const input = document.getElementById('test-date') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('readonly')
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument()
  })

  it('opens the themed calendar and preserves the YYYY-MM-DD value contract', async () => {
    const user = userEvent.setup()
    render(<StatefulPicker />)

    await user.click(screen.getByRole('textbox'))
    expect(screen.getByRole('dialog', { name: '选择日期' })).toBeInTheDocument()
    expect(screen.getByText('2026年9月')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '2026年9月15日' }))
    expect(screen.getByRole('textbox')).toHaveValue('2026/09/15')
    expect(screen.queryByRole('dialog', { name: '选择日期' })).not.toBeInTheDocument()
  })

  it('supports month navigation and keyboard opening/closing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const parentKeyDown = vi.fn()
    render(
      <div onKeyDown={parentKeyDown}>
        <AddBillDatePicker id="test-date" value="2026-09-06" onChange={onChange} />
      </div>
    )

    const input = screen.getByRole('textbox')
    input.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('2026年9月')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下个月' }))
    expect(screen.getByText('2026年10月')).toBeInTheDocument()

    parentKeyDown.mockClear()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '选择日期' })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('keeps an invalid legacy value visible until the user explicitly selects a date', async () => {
    const user = userEvent.setup()
    render(<AddBillDatePicker id="test-date" value="legacy-date" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('legacy-date')
    await user.click(input)
    expect(screen.getByRole('dialog', { name: '选择日期' })).toBeInTheDocument()
  })

  it('uses roving focus for arrow-key date navigation', async () => {
    const user = userEvent.setup()
    render(<StatefulPicker />)

    await user.click(screen.getByRole('textbox'))
    const selectedDay = screen.getByRole('button', { name: '2026年9月6日' })
    expect(selectedDay).toHaveAttribute('tabindex', '0')
    expect(document.activeElement).toBe(selectedDay)

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: '2026年9月7日' })).toHaveAttribute('tabindex', '0')
    expect(selectedDay).toHaveAttribute('tabindex', '-1')
  })
})
