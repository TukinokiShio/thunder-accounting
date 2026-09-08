import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/i18n/LanguageContext'
import { formatLocalDate } from '@/utils/date'

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
}

const WEEKDAYS_ZH = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null
}

function toDateValue(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function AddBillDatePicker({ id, value, onChange }: Props) {
  const { language } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedDate = parseDateValue(value) ?? new Date()
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => startOfMonth(selectedDate))
  const [activeDate, setActiveDate] = useState(() => selectedDate)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number; width: number } | null>(null)

  const getPopoverPlacement = (rect: DOMRect, height: number) => {
    const dialog = rootRef.current?.closest<HTMLElement>('.add-bill-dialog')?.getBoundingClientRect()
    const content = rootRef.current?.closest<HTMLElement>('.add-bill-dialog-content')?.getBoundingClientRect()
    const topBoundary = Math.max(8, content?.top ?? 8)
    const bottomBoundary = Math.min(window.innerHeight - 8, dialog?.bottom ?? window.innerHeight - 8)
    const topSpace = rect.top - topBoundary - 8
    const bottomSpace = bottomBoundary - rect.bottom - 8
    const nextPlacement: 'bottom' | 'top' = bottomSpace >= height
      ? 'bottom'
      : topSpace >= height
        ? 'top'
        : topSpace >= bottomSpace ? 'top' : 'bottom'
    const top = nextPlacement === 'top' ? rect.top - height - 8 : rect.bottom + 8
    return { nextPlacement, top }
  }

  useEffect(() => {
    const nextMonth = startOfMonth(parseDateValue(value) ?? new Date())
    setViewDate((current) => isSameMonth(current, nextMonth) ? current : nextMonth)
    setActiveDate(parseDateValue(value) ?? new Date())
  }, [value])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    document.getElementById(`${id}-day-${toDateValue(activeDate)}`)?.focus()
  }, [activeDate, id, open, popoverPosition, viewDate])

  useLayoutEffect(() => {
    if (!open || !popoverPosition) return
    const inputRect = inputRef.current?.getBoundingClientRect()
    const popover = popoverRef.current
    if (!inputRect || !popover) return

    const popoverHeight = popover.getBoundingClientRect().height
    const { nextPlacement, top } = getPopoverPlacement(inputRect, popoverHeight)
    setPlacement(nextPlacement)
    setPopoverPosition((current) => {
      if (!current || current.top === top) return current
      return { ...current, top }
    })
  }, [open, popoverPosition])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return

      const estimatedHeight = 330
      const { nextPlacement, top } = getPopoverPlacement(rect, estimatedHeight)
      const width = Math.min(rect.width, 352)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      setPlacement(nextPlacement)
      setPopoverPosition({ top, left, width })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const openPicker = () => {
    setViewDate(startOfMonth(selectedDate))
    setActiveDate(selectedDate)
    setOpen(true)
  }

  const selectDate = (date: Date) => {
    onChange(toDateValue(date))
    setOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const calendarStart = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  const today = parseDateValue(formatLocalDate()) ?? new Date()
  const weekdays = language === 'zh' ? WEEKDAYS_ZH : WEEKDAYS_EN
  const monthLabel = language === 'zh' ? format(viewDate, 'yyyy年M月') : format(viewDate, 'MMMM yyyy')
  const calendarLabel = language === 'zh' ? '选择日期' : 'Choose date'
  const previousMonthLabel = language === 'zh' ? '上个月' : 'Previous month'
  const nextMonthLabel = language === 'zh' ? '下个月' : 'Next month'
  const portalTarget = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('.aurora-shell') ?? document.body
    : null
  const changeMonth = (offset: number) => {
    const nextMonth = addMonths(viewDate, offset)
    setViewDate(nextMonth)
    setActiveDate(startOfMonth(nextMonth))
  }

  const moveActiveDate = (offset: number) => {
    const nextDate = addDays(activeDate, offset)
    setActiveDate(nextDate)
    if (!isSameMonth(nextDate, viewDate)) setViewDate(startOfMonth(nextDate))
  }

  const handleCalendarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      inputRef.current?.focus()
      return
    }
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveActiveDate(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveActiveDate(1) }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveActiveDate(-7) }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActiveDate(7) }
    if (event.key === 'PageUp') { event.preventDefault(); changeMonth(event.shiftKey ? -12 : -1) }
    if (event.key === 'PageDown') { event.preventDefault(); changeMonth(event.shiftKey ? 12 : 1) }
  }

  return (
    <div ref={rootRef} className="add-bill-date-picker">
      <input
        ref={inputRef}
        id={id}
        name="date"
        type="text"
        inputMode="none"
        readOnly
        value={parseDateValue(value) ? format(selectedDate, 'yyyy/MM/dd') : value}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault()
            openPicker()
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}
        className="input-field add-bill-date-input"
      />
      <CalendarDays className="add-bill-date-icon" size={17} aria-hidden="true" />

      {open && popoverPosition && portalTarget && createPortal(
        <div
          ref={popoverRef}
          id={`${id}-calendar`}
          role="dialog"
          aria-label={calendarLabel}
          aria-modal="false"
          data-placement={placement}
          className="add-bill-date-popover"
          onKeyDown={handleCalendarKeyDown}
          style={{ top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width }}
        >
          <div className="add-bill-calendar-header">
            <button
              type="button"
              className="add-bill-calendar-nav"
              aria-label={previousMonthLabel}
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <strong className="add-bill-calendar-month" aria-live="polite">{monthLabel}</strong>
            <button
              type="button"
              className="add-bill-calendar-nav"
              aria-label={nextMonthLabel}
              onClick={() => changeMonth(1)}
            >
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="add-bill-calendar-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="add-bill-calendar-grid" role="grid" aria-label={calendarLabel}>
            {days.map((day) => {
              const dayValue = toDateValue(day)
              const isSelected = dayValue === value
              const isToday = isSameDay(day, today)
              return (
                <div key={dayValue} role="gridcell" aria-selected={isSelected} className="add-bill-calendar-cell">
                  <button
                    id={`${id}-day-${dayValue}`}
                    type="button"
                    tabIndex={dayValue === toDateValue(activeDate) ? 0 : -1}
                    className="add-bill-calendar-day"
                    data-selected={isSelected ? 'true' : undefined}
                    data-today={isToday ? 'true' : undefined}
                    data-outside-month={!isSameMonth(day, viewDate) ? 'true' : undefined}
                    aria-label={language === 'zh' ? format(day, 'yyyy年M月d日') : format(day, 'MMMM d, yyyy')}
                    aria-pressed={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    onFocus={() => setActiveDate(day)}
                    onClick={() => selectDate(day)}
                  >
                    {format(day, 'd')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>,
        portalTarget
      )}
    </div>
  )
}
