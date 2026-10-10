import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DndContext, type DragEndEvent, type DragOverEvent, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { pdf } from '@react-pdf/renderer'
import { supabase } from '../../lib/supabaseClient'
import QuickAddShiftDialog from './QuickAddShiftDialog'
import EditShiftDialog from './EditShiftDialog'
import ShiftCard, { type RoleInfo } from './ShiftCard'
import { SchedulePDF } from './SchedulePDF'
import { hoursBetween, localTimeLabel, toZonedISOString } from './time'
import { formatWeekRange, useScheduleStore } from './useScheduleStore'
import type { GridEmployee, ShiftRecord, CoverageRequirement, EmployeeAvailability, EmployeeUnavailability, Schedule } from '../../types'
import { validateSchedule, ConflictSeverity } from '../../lib/rules-engine'
import { copyShiftsToNextWeek } from '../../lib/schedule-utils'
import { computeFixSuggestions } from '../../lib/fix-suggestions'
import type { AddShiftParams } from '../../lib/fix-suggestions'
import { ErrorDetailsModal } from './ErrorDetailsModal'

type ScheduleGridProps = {
  organizationId: string
  locationId: string
}

type ScheduleCellProps = {
  employee: GridEmployee | null
  dayIndex: number
  dayDate: Date
  shifts: ShiftRecord[]
  timezone: string | null
  onOpenQuickAdd: (employee: GridEmployee | null, day: Date) => void
  renderShiftCard: (shift: ShiftRecord) => React.ReactNode
  canPaste?: boolean
  onPaste?: (employee: GridEmployee | null, day: Date) => void
  dragState: { cellId: string; isValid: boolean } | null
}

function ScheduleCell({ employee, dayIndex, dayDate, shifts, onOpenQuickAdd, renderShiftCard, canPaste, onPaste, dragState }: ScheduleCellProps) {
  const key = employee ? employee.id : 'unassigned'
  const droppableId = `cell-${key}-${dayIndex}`
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { type: 'cell', employeeId: employee?.id ?? null, dayIndex },
  })

  const isDragTarget = dragState?.cellId === droppableId
  const isValidDrop = dragState?.isValid ?? true

  const handleQuickAddClick = useCallback(() => {
    onOpenQuickAdd(employee, dayDate)
  }, [onOpenQuickAdd, employee, dayDate])

  const handlePasteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onPaste?.(employee, dayDate)
  }, [onPaste, employee, dayDate])

  return (
    <div
      ref={setNodeRef}
      className={`group relative min-h-[110px] border-r border-slate-800 bg-slate-950/50 p-2 transition ${
        isDragTarget
          ? isValidDrop
            ? 'border-emerald-500/70 bg-emerald-900/20'
            : 'border-red-500/70 bg-red-900/20'
          : isOver
          ? 'border-blue-500/70 bg-slate-900/70'
          : ''
      }`}
    >
      {canPaste && (
        <button
          type="button"
          onClick={handlePasteClick}
          className="absolute right-1 top-1 z-30 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white opacity-0 shadow-sm transition group-hover:opacity-100"
          title="Paste shifts starting here"
        >
          Paste
        </button>
      )}
      {shifts.length === 0 && (
        <button
          type="button"
          onClick={handleQuickAddClick}
          className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-slate-800/80 bg-slate-950/70 text-xs font-semibold text-slate-400 transition hover:border-blue-500/60 hover:text-blue-100"
        >
          + Quick add shift
        </button>
      )}
      {shifts.length > 0 && (
        <div className="space-y-2">
          {shifts.map((shift) => renderShiftCard(shift))}
          <button
            type="button"
            onClick={handleQuickAddClick}
            className="w-full rounded-md border border-dashed border-slate-800/80 px-2 py-2 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/60 hover:text-blue-100"
          >
            + Add shift
          </button>
        </div>
      )}
    </div>
  )
}

// Memoize ScheduleCell to prevent unnecessary re-renders
const MemoizedScheduleCell = React.memo(ScheduleCell)

type SortableRowApi = ReturnType<typeof useSortable>
type DragHandleProps = { attributes: SortableRowApi['attributes']; listeners: SortableRowApi['listeners']; isDragging: boolean }

function SortableEmployeeRow({ employee, children }: { employee: GridEmployee; children: (props: DragHandleProps) => React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: employee.id, data: { type: 'employee-row', employee } })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    position: isDragging ? 'relative' : undefined,
  } as React.CSSProperties

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, isDragging })}
    </div>
  )
}

// Memoize SortableEmployeeRow to prevent unnecessary re-renders
const MemoizedSortableEmployeeRow = React.memo(SortableEmployeeRow)

function ScheduleGrid({ organizationId, locationId }: ScheduleGridProps) {
  const queryClient = useQueryClient()
  const {
    weekStartIso,
    timezone,
    shifts,
    employees,
    organizationSettings,
    setShifts,
    setEmployees,
    setAvailability,
    setUnavailability,
    setCoverageRequirements,
    setIsLoading,
    setError,
    setTimezone,
    selectedShiftIds,
    toggleShiftSelection,
    clearSelection,
    clipboardShifts,
    setClipboardShifts,
    validationErrors,
    schedule,
    setSchedule,
    validate,
  } = useScheduleStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [flashShiftId, setFlashShiftId] = useState<string | null>(null)

  const [quickAddTarget, setQuickAddTarget] = useState<{ employee: GridEmployee | null; day: Date } | null>(null)
  const [editingShift, setEditingShift] = useState<ShiftRecord | null>(null)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [dragState, setDragState] = useState<{ cellId: string; isValid: boolean } | null>(null)
  const [mobileSelectedDay, setMobileSelectedDay] = useState(0)

  // Debounce validation during drag operations
  const dragValidationTimeoutRef = useRef<number | null>(null)

  const safeShifts = useMemo(() => (Array.isArray(shifts) ? shifts : []), [shifts])
  const employeeIdsWithShifts = useMemo(() => {
    const ids = new Set<string>()
    safeShifts.forEach((shift) => {
      if (shift.employee_id) ids.add(shift.employee_id)
    })
    return ids
  }, [safeShifts])
  const timeFormat = organizationSettings.time_format ?? '12h'

  const hardBlockCount = validationErrors.filter((e) => e.severity === ConflictSeverity.HARD_BLOCK).length
  const softWarningCount = validationErrors.filter((e) => e.severity === ConflictSeverity.SOFT_WARNING).length

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  )

  const weekStartDate = useMemo(() => {
    const start = new Date(weekStartIso)
    if (!timezone) return start
    // Anchor week start to midnight in the location timezone so early-morning shifts don't fall outside the current week.
    return new Date(toZonedISOString(start, '00:00', timezone))
  }, [weekStartIso, timezone])

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, idx) => {
      const date = new Date(weekStartDate)
      date.setDate(weekStartDate.getDate() + idx)
      const label = date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone || undefined,
      })
      return { index: idx, date, label }
    })
  }, [weekStartDate, timezone])

  const weekEndIso = useMemo(() => {
    const end = new Date(weekStartDate)
    end.setDate(weekStartDate.getDate() + 7)
    return end.toISOString()
  }, [weekStartDate])

  // Widen the fetch window by a day on either side to avoid timezone-boundary gaps after drag/drop.
  const queryStartIso = useMemo(() => {
    const start = new Date(weekStartDate)
    start.setDate(start.getDate() - 1)
    return start.toISOString()
  }, [weekStartDate])

  const queryEndIso = useMemo(() => {
    const end = new Date(weekEndIso)
    const parsed = new Date(end)
    parsed.setDate(parsed.getDate() + 1)
    return parsed.toISOString()
  }, [weekEndIso])

  const { data: locationData, isLoading: isLocationLoading, error: locationError } = useQuery({
    queryKey: ['schedule-location', locationId],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, timezone')
        .eq('id', locationId)
        .single()

      if (error) throw new Error(error.message)
      if (data?.timezone) setTimezone(data.timezone)
      return data
    },
  })

  const scheduleQuery = useQuery<Schedule | null>({
    queryKey: ['schedule-meta', organizationId, locationId, weekStartIso],
    enabled: Boolean(organizationId && locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedules')
        .select('*')
        .eq('location_id', locationId)
        .eq('week_start_date', weekStartIso.split('T')[0])
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw new Error(error.message)
      return data as Schedule | null
    },
  })

  useEffect(() => {
    setSchedule(scheduleQuery.data ?? null)
  }, [scheduleQuery.data, setSchedule])

  const handleCopyLastWeek = async () => {
    const prevWeekStart = new Date(weekStartDate)
    prevWeekStart.setDate(prevWeekStart.getDate() - 7)
    
    const prevQueryStart = new Date(queryStartIso)
    prevQueryStart.setDate(prevQueryStart.getDate() - 7)
    const prevQueryStartIso = prevQueryStart.toISOString()

    const prevQueryEnd = new Date(queryEndIso)
    prevQueryEnd.setDate(prevQueryEnd.getDate() - 7)
    const prevQueryEndIso = prevQueryEnd.toISOString()

    const { data: prevShifts, error } = await supabase
      .from('shifts')
      .select('id, schedule_id, location_id, employee_id, role_id, start_datetime, end_datetime, break_start_datetime, break_end_datetime')
      .eq('location_id', locationId)
      .gte('start_datetime', prevQueryStartIso)
      .lt('start_datetime', prevQueryEndIso)

    if (error) {
      setError(error.message)
      return
    }

    if (!prevShifts || prevShifts.length === 0) {
      alert('No shifts found in the previous week.')
      return
    }

    if (!confirm(`Copy ${prevShifts.length} shifts from the previous week?`)) {
      return
    }

    const newShifts = copyShiftsToNextWeek(prevShifts, prevWeekStart, weekStartDate, timezone)

    const { data: insertedShifts, error: insertError } = await supabase
      .from('shifts')
      .insert(newShifts)
      .select()

    if (insertError) {
      setError(insertError.message)
    } else if (insertedShifts) {
      setShifts((prev) => [...(Array.isArray(prev) ? prev : []), ...(insertedShifts as ShiftRecord[])])
      alert(`Copied ${insertedShifts.length} shifts.`)
    }
  }

  const handleExportPDF = async () => {
    if (!locationId || !locationData) return
    
    const locationName = locationData.name
    const weekLabel = formatWeekRange(weekStartIso, timezone)

    try {
      const blob = await pdf(
        <SchedulePDF
          locationName={locationName}
          weekRangeLabel={weekLabel}
          employees={employees}
          shifts={safeShifts}
          days={days}
          timezone={timezone}
          timeFormat={timeFormat}
          roles={rolesQuery.data ?? []}
        />
      ).toBlob()
      
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${locationName.replace(/\s+/g, '_')}_${weekStartIso.split('T')[0]}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF generation failed:', err)
      alert('Failed to generate PDF. Please try again.')
    }
  }

  const handlePublish = async () => {
    if (hardBlockCount > 0) {
      alert('Cannot publish with hard blocks. Please resolve conflicts first.')
      return
    }

    if (softWarningCount > 0) {
      if (!confirm(`There are ${softWarningCount} warnings. Are you sure you want to publish?`)) {
        return
      }
    }

    const currentVersion = schedule?.version ?? 0
    const nextVersion = currentVersion + 1
    
    const payload = {
        organization_id: organizationId,
        location_id: locationId,
        week_start_date: weekStartIso.split('T')[0],
        status: 'published',
        published_at: new Date().toISOString(),
        version: nextVersion,
        snapshot: safeShifts
    }

    const { data, error } = await supabase
      .from('schedules')
      .upsert(payload, { onConflict: 'location_id,week_start_date' })
      .select()
      .single()

    if (error) {
        setError(error.message)
        return
    }

    // Link all shifts in this week to the schedule so employees can see them.
    // Without this, schedule_id stays NULL and the employee RLS blocks all access.
    const { error: linkError } = await supabase
      .from('shifts')
      .update({ schedule_id: data.id })
      .eq('location_id', locationId)
      .gte('start_datetime', weekStartDate.toISOString())
      .lt('start_datetime', weekEndIso)

    if (linkError) {
      setError(linkError.message)
      return
    }

    setSchedule(data as Schedule)
    queryClient.invalidateQueries({ queryKey: ['schedule-meta'] })
    queryClient.invalidateQueries({ queryKey: ['schedule-shifts', organizationId, locationId, weekStartIso, timezone] })
    alert(`Schedule published (Version ${nextVersion})`)
  }

  const employeesQuery = useQuery<GridEmployee[]>({
    queryKey: ['schedule-employees', organizationId, locationId],
    enabled: Boolean(organizationId && locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, is_floating, home_location_id, is_active, organization_id, display_order')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })

      if (error) throw new Error(error.message)
      return (data ?? []) as GridEmployee[]
    },
  })

  const rolesQuery = useQuery<RoleInfo[]>(
    {
      queryKey: ['schedule-roles', organizationId],
      enabled: Boolean(organizationId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('roles')
          .select('id, name, color')
          .eq('organization_id', organizationId)
          .order('name', { ascending: true })

        if (error) throw new Error(error.message)
        return (data ?? []) as RoleInfo[]
      },
    },
  )

  useEffect(() => {
    if (employeesQuery.data) setEmployees(employeesQuery.data)
  }, [employeesQuery.data, setEmployees])

  const coverageQuery = useQuery<CoverageRequirement[]>({
    queryKey: ['schedule-coverage', locationId],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage_requirements')
        .select('*')
        .eq('location_id', locationId)

      if (error) throw new Error(error.message)
      return (data ?? []) as CoverageRequirement[]
    },
  })

  useEffect(() => {
    if (coverageQuery.data) setCoverageRequirements(coverageQuery.data)
  }, [coverageQuery.data, setCoverageRequirements])

  const availabilityQuery = useQuery<EmployeeAvailability[]>({
    queryKey: ['schedule-availability', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_availability')
        .select('*')
        .eq('organization_id', organizationId)

      if (error) throw new Error(error.message)
      return (data ?? []) as EmployeeAvailability[]
    },
  })

  useEffect(() => {
    if (availabilityQuery.data) setAvailability(availabilityQuery.data)
  }, [availabilityQuery.data, setAvailability])

  const unavailabilityQuery = useQuery<EmployeeUnavailability[]>({
    queryKey: ['schedule-unavailability', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_unavailability')
        .select('*')
        .eq('organization_id', organizationId)

      if (error) throw new Error(error.message)
      return (data ?? []) as EmployeeUnavailability[]
    },
  })

  // Fetch approved time-off requests that overlap the current week and convert
  // them to EmployeeUnavailability shape so the rules engine flags them as HARD_BLOCK.
  const approvedTimeOffQuery = useQuery<EmployeeUnavailability[]>({
    queryKey: ['schedule-approved-time-off', organizationId, weekStartIso, weekEndIso],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('id, employee_id, organization_id, start_date, end_date')
        .eq('organization_id', organizationId)
        .eq('status', 'approved')
        .gte('end_date', weekStartIso.slice(0, 10))
        .lte('start_date', weekEndIso.slice(0, 10))

      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => ({
        id: `tor-${r.id}`,
        organization_id: r.organization_id as string,
        employee_id: r.employee_id as string,
        start_datetime: `${r.start_date}T00:00:00.000Z`,
        end_datetime: `${r.end_date}T23:59:59.999Z`,
      }))
    },
  })

  useEffect(() => {
    const merged = [
      ...(unavailabilityQuery.data ?? []),
      ...(approvedTimeOffQuery.data ?? []),
    ]
    setUnavailability(merged)
  }, [unavailabilityQuery.data, approvedTimeOffQuery.data, setUnavailability])

  const shiftsQuery = useQuery<ShiftRecord[]>({
    queryKey: ['schedule-shifts', organizationId, locationId, weekStartIso, timezone],
    enabled: Boolean(organizationId && locationId),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('id, location_id, employee_id, role_id, start_datetime, end_datetime, break_start_datetime, break_end_datetime')
        .eq('location_id', locationId)
        .gte('start_datetime', queryStartIso)
        .lt('start_datetime', queryEndIso)
        .order('start_datetime', { ascending: true })

      if (error) throw new Error(error.message)
      return (data ?? []) as ShiftRecord[]
    },
  })

  useEffect(() => {
    if (shiftsQuery.data) setShifts(shiftsQuery.data)
  }, [shiftsQuery.data, setShifts])

  // Ensure validation stays in sync when any schedule inputs change (shifts, coverage, timezone, week start, etc.)
  useEffect(() => {
    if (!shiftsQuery.data) return
    validate()
  }, [
    shiftsQuery.data,
    employeesQuery.data,
    availabilityQuery.data,
    unavailabilityQuery.data,
    approvedTimeOffQuery.data,
    coverageQuery.data,
    timezone,
    weekStartIso,
    organizationSettings,
    validate,
  ])

  useEffect(() => {
    setIsLoading(isLocationLoading || employeesQuery.isLoading || shiftsQuery.isLoading || rolesQuery.isLoading || coverageQuery.isLoading)
  }, [isLocationLoading, employeesQuery.isLoading, shiftsQuery.isLoading, rolesQuery.isLoading, coverageQuery.isLoading, setIsLoading])

  // Scroll to + flash a highlighted shift when the ?highlight= URL param is set.
  const highlightParam = searchParams.get('highlight')
  // The flash is started while rendering (once per param value) rather than from an effect.
  const [handledHighlight, setHandledHighlight] = useState<string | null>(null)
  if (highlightParam && shifts.length && handledHighlight !== highlightParam) {
    setHandledHighlight(highlightParam)
    setFlashShiftId(highlightParam)
  } else if (!highlightParam && handledHighlight) {
    setHandledHighlight(null)
  }
  useEffect(() => {
    if (!highlightParam || !shifts.length) return
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-shift-id="${highlightParam}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setSearchParams((prev) => { prev.delete('highlight'); return prev }, { replace: true })
      setTimeout(() => setFlashShiftId(null), 2000)
    }, 150)
    return () => clearTimeout(timer)
  }, [highlightParam, shifts.length, setSearchParams])

  // Open QuickAddShift when the ?fixDate=ISO&fixEmployee=UUID params are set (navigated from AppLayout modal).
  const fixDateParam = searchParams.get('fixDate')
  const fixEmployeeParam = searchParams.get('fixEmployee')
  // The dialog target is set while rendering (once per param pair); the effect only clears the params.
  const fixKey = fixDateParam ? `${fixDateParam}|${fixEmployeeParam ?? ''}` : null
  const [handledFixKey, setHandledFixKey] = useState<string | null>(null)
  if (fixDateParam && employees.length && handledFixKey !== fixKey) {
    setHandledFixKey(fixKey)
    const emp = fixEmployeeParam ? (employees.find(e => e.id === fixEmployeeParam) ?? null) : null
    setQuickAddTarget({ employee: emp, day: new Date(fixDateParam) })
  } else if (!fixDateParam && handledFixKey) {
    setHandledFixKey(null)
  }
  useEffect(() => {
    if (!fixDateParam || !employees.length) return
    setSearchParams((prev) => { prev.delete('fixDate'); prev.delete('fixEmployee'); return prev }, { replace: true })
  }, [fixDateParam, fixEmployeeParam, employees, setSearchParams])

  // Suggestions for coverage gap auto-fix
  const fixSuggestions = useMemo(
    () => computeFixSuggestions(validationErrors, employees, shifts, availabilityQuery.data ?? []),
    [validationErrors, employees, shifts, availabilityQuery.data]
  )

  const handleAddShift = useCallback((params: AddShiftParams) => {
    const emp = employees.find(e => e.id === params.employeeId) ?? null
    const day = params.startTime ? new Date(params.startTime) : new Date()
    setShowErrorDetails(false)
    setQuickAddTarget({ employee: emp, day })
  }, [employees])

  useEffect(() => {
    const firstError =
      (locationError as Error | undefined)?.message ??
      (employeesQuery.error as Error | undefined)?.message ??
      (shiftsQuery.error as Error | undefined)?.message ??
      (rolesQuery.error as Error | undefined)?.message ??
      (coverageQuery.error as Error | undefined)?.message
    setError(firstError ?? null)
  }, [employeesQuery.error, locationError, rolesQuery.error, setError, shiftsQuery.error, coverageQuery.error])

  useEffect(() => {
    if (!locationId) return
    const channel = supabase
      .channel(`shifts-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts', filter: `location_id=eq.${locationId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['schedule-shifts', organizationId, locationId, weekStartIso, timezone] })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [locationId, organizationId, queryClient, weekStartIso, timezone])

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [timezone],
  )

  const dayKeys = useMemo(() => days.map((day) => dayFormatter.format(day.date)), [dayFormatter, days])

  // Group all coverage-gap warnings (both understaffing and break-caused) by day column index.
  type DayGapEntry = {
    id: string
    startTime: string
    endTime?: string
    count: number
    min: number
    isBreakCaused: boolean
    shiftId?: string
  }
  const gapsByDay = useMemo(() => {
    const map = new Map<number, DayGapEntry[]>()
    for (const err of validationErrors) {
      if (err.ruleType !== 'COVERAGE_GAP' || !err.meta?.startTime) continue
      const key = dayFormatter.format(new Date(err.meta.startTime))
      const idx = dayKeys.indexOf(key)
      if (idx < 0) continue
      const entry: DayGapEntry = {
        id: err.id,
        startTime: err.meta.startTime,
        endTime: err.meta.endTime,
        count: err.meta.missingCount !== undefined
          ? (err.meta as { missingCount: number }).missingCount
          : 0,
        min: 0,
        isBreakCaused: Boolean(err.shiftId),
        shiftId: err.shiftId,
      }
      // Parse count from message: "Coverage missing: 1/2" or "Break causes coverage gap (1/2)"
      const m = err.message.match(/(\d+)\/(\d+)/)
      if (m) { entry.count = Number(m[1]); entry.min = Number(m[2]) }
      const list = map.get(idx) ?? []
      list.push(entry)
      map.set(idx, list)
    }
    return map
  }, [validationErrors, dayFormatter, dayKeys])

  const gapDayIndexes = useMemo(() => new Set(gapsByDay.keys()), [gapsByDay])

  function formatGapTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    })
  }

  const visibleEmployees = useMemo(() => {
    return employees.filter(
      (emp) => emp.is_floating || emp.home_location_id === locationId || employeeIdsWithShifts.has(emp.id),
    )
  }, [employees, locationId, employeeIdsWithShifts])

  const employeeIdSet = useMemo(() => new Set(visibleEmployees.map((e) => e.id)), [visibleEmployees])

  const shiftsByEmployeeAndDay = useMemo(() => {
    const bucket: Record<string, Record<number, ShiftRecord[]>> = {}
    safeShifts.forEach((shift) => {
      const dayKey = dayFormatter.format(new Date(shift.start_datetime))
      const dayIndex = dayKeys.indexOf(dayKey)
      if (dayIndex < 0 || dayIndex > 6) return
      const belongsToKnownEmployee = shift.employee_id && employeeIdSet.has(shift.employee_id)
      const key = belongsToKnownEmployee ? shift.employee_id! : 'unassigned'
      bucket[key] = bucket[key] || {}
      bucket[key][dayIndex] = bucket[key][dayIndex] || []
      bucket[key][dayIndex].push(shift)
    })
    return bucket
  }, [dayFormatter, dayKeys, employeeIdSet, safeShifts])

  const weeklyHours = useMemo(() => {
    const totals = new Map<string, number>()
    safeShifts.forEach((shift) => {
      const key = shift.employee_id ?? 'unassigned'
      const rawDuration = hoursBetween(shift.start_datetime, shift.end_datetime)
      
      let breakHours = 0
      if (shift.break_start_datetime && shift.break_end_datetime) {
        const bStart = new Date(shift.break_start_datetime).getTime()
        const bEnd = new Date(shift.break_end_datetime).getTime()
        breakHours = Math.max(0, (bEnd - bStart) / (1000 * 60 * 60))
      }

      const duration = Math.max(0, rawDuration - breakHours)
      const next = (totals.get(key) ?? 0) + duration
      totals.set(key, next)
    })
    return totals
  }, [safeShifts])

  const roleLookup = useMemo(() => {
    const map = new Map<string, RoleInfo>()
    ;(rolesQuery.data ?? []).forEach((role) => {
      map.set(role.id, role)
    })
    return map
  }, [rolesQuery.data])

  const orderedRows: GridEmployee[] = useMemo(() => {
    return visibleEmployees
  }, [visibleEmployees])

  const persistShiftUpdate = async (nextShift: ShiftRecord) => {
    const previous = safeShifts
    setShifts(previous.map((shift) => (shift.id === nextShift.id ? nextShift : shift)))

    const { data, error } = await supabase
      .from('shifts')
      .update({
        employee_id: nextShift.employee_id,
        start_datetime: nextShift.start_datetime,
        end_datetime: nextShift.end_datetime,
        role_id: nextShift.role_id,
        location_id: nextShift.location_id,
        break_start_datetime: nextShift.break_start_datetime,
        break_end_datetime: nextShift.break_end_datetime,
      })
      .eq('id', nextShift.id)
      .select('id, location_id, employee_id, role_id, start_datetime, end_datetime, break_start_datetime, break_end_datetime')
      .single()

    if (error || !data) {
      setShifts(previous)
      setError(error?.message ?? 'Unable to update shift')
      return null
    }

    setShifts((current) =>
      Array.isArray(current)
        ? current.map((shift) => (shift.id === nextShift.id ? (data as ShiftRecord) : shift))
        : [data as ShiftRecord],
    )
    return data as ShiftRecord
  }

  const moveShiftToTarget = useCallback((shift: ShiftRecord, targetEmployeeId: string | null, dayIndex: number) => {
    const startLabel = localTimeLabel(shift.start_datetime, timezone)
    const endLabel = localTimeLabel(shift.end_datetime, timezone)
    const targetDate = new Date(weekStartDate)
    targetDate.setDate(weekStartDate.getDate() + dayIndex)

    const startIso = toZonedISOString(targetDate, startLabel, timezone)
    let endIso = toZonedISOString(targetDate, endLabel, timezone)

    if (new Date(endIso) <= new Date(startIso)) {
      const nextDay = new Date(targetDate)
      nextDay.setDate(targetDate.getDate() + 1)
      endIso = toZonedISOString(nextDay, endLabel, timezone)
    }

    return { ...shift, employee_id: targetEmployeeId, start_datetime: startIso, end_datetime: endIso }
  }, [weekStartDate, timezone])

  const handleDragStart = () => {
    // No-op for now
  }

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !active.data.current?.shift) {
      setDragState(null)
      return
    }

    const overData = over.data.current as { type?: string; employeeId?: string | null; dayIndex?: number } | undefined
    if (!overData || overData.type !== 'cell' || typeof overData.dayIndex !== 'number') {
      setDragState(null)
      return
    }

    const shift = active.data.current.shift as ShiftRecord
    const isExplicitUnassign = overData.employeeId === null && (over.id as string).startsWith('cell-unassigned-')
    const targetEmployeeId = isExplicitUnassign ? null : overData.employeeId ?? shift.employee_id

    // Set immediate visual feedback without validation
    setDragState({
      cellId: over.id as string,
      isValid: true, // Assume valid initially for smooth UX
    })

    // Debounce expensive validation
    if (dragValidationTimeoutRef.current) {
      clearTimeout(dragValidationTimeoutRef.current)
    }

    dragValidationTimeoutRef.current = window.setTimeout(() => {
      const potentialShift = moveShiftToTarget(shift, targetEmployeeId, overData.dayIndex!)

      // Create temp shifts list
      const tempShifts = safeShifts.map((s) => (s.id === potentialShift.id ? potentialShift : s))

      const errors = validateSchedule(
        tempShifts,
        employees,
        availabilityQuery.data ?? [],
        unavailabilityQuery.data ?? [],
        coverageQuery.data ?? [],
        { 
          timezone: timezone ?? 'UTC',
          weekStart: weekStartDate
        },
      )

      const hasHardBlock = errors.some((e) => e.shiftId === shift.id && e.severity === ConflictSeverity.HARD_BLOCK)

      setDragState({
        cellId: over.id as string,
        isValid: !hasHardBlock,
      })
    }, 100) // 100ms debounce
  }, [safeShifts, employees, availabilityQuery.data, unavailabilityQuery.data, coverageQuery.data, timezone, weekStartDate, moveShiftToTarget])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragValidationTimeoutRef.current) {
        clearTimeout(dragValidationTimeoutRef.current)
      }
    }
  }, [])

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragState(null)
    const activeData = event.active.data.current as { type?: string; shift?: ShiftRecord; employee?: GridEmployee }
    if (!activeData?.type) return

    if (activeData.type === 'employee-row') {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const oldIndex = employees.findIndex((item) => item.id === active.id)
        const newIndex = employees.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(employees, oldIndex, newIndex)
          setEmployees(newOrder)

          const updates = newOrder.map((emp, index) => ({
            id: emp.id,
            display_order: index,
          }))

          Promise.all(
            updates.map((u) =>
              supabase.from('employees').update({ display_order: u.display_order }).eq('id', u.id),
            ),
          ).catch((err) => {
            console.error('Failed to update order', err)
            setError('Failed to save new order')
          })
        }
      }
      return
    }

    if (activeData.type === 'shift' && activeData.shift) {
      const overData = event.over?.data.current as { type?: string; employeeId?: string | null; dayIndex?: number } | undefined
      if (!overData || overData.type !== 'cell' || typeof overData.dayIndex !== 'number') return

      const overId = typeof event.over?.id === 'string' ? event.over.id : ''
      const isExplicitUnassign = overData.employeeId === null && overId.startsWith('cell-unassigned-')
      const targetEmployeeId = isExplicitUnassign ? null : overData.employeeId ?? activeData.shift.employee_id

      const updated = moveShiftToTarget(activeData.shift, targetEmployeeId, overData.dayIndex)
      const noChange =
        updated.employee_id === activeData.shift.employee_id &&
        updated.start_datetime === activeData.shift.start_datetime &&
        updated.end_datetime === activeData.shift.end_datetime
      if (noChange) return
      await persistShiftUpdate(updated)
      return
    }
  }

  const handleShiftClick = useCallback((shift: ShiftRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    if (e.shiftKey || isSelectionMode) {
      if (shift.id) toggleShiftSelection(shift.id)
    } else {
      if (selectedShiftIds.length > 0) {
        clearSelection()
      } else {
        setEditingShift(shift)
      }
    }
  }, [isSelectionMode, toggleShiftSelection, selectedShiftIds.length, clearSelection])

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selectedShiftIds.length} shifts?`)) return

    const previousShifts = safeShifts
    const idsToDelete = new Set(selectedShiftIds)
    setShifts(previousShifts.filter((s) => s.id && !idsToDelete.has(s.id)))
    clearSelection()

    const { error } = await supabase.from('shifts').delete().in('id', Array.from(idsToDelete))

    if (error) {
      setShifts(previousShifts)
      setError(error.message)
    }
  }

  const handleCopySelected = () => {
    const selected = safeShifts.filter((s) => s.id && selectedShiftIds.includes(s.id))
    setClipboardShifts(selected)
    clearSelection()
  }

  const handlePaste = async (targetEmployee: GridEmployee | null, targetDate: Date) => {
    if (clipboardShifts.length === 0) return

    const sortedClipboard = [...clipboardShifts].sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    const anchorShift = sortedClipboard[0]
    
    // Calculate the midnight instant of the anchor shift in the current timezone
    // This ensures we calculate the day difference correctly even across timezone boundaries
    const anchorStart = new Date(anchorShift.start_datetime)
    const anchorMidnightIso = toZonedISOString(anchorStart, '00:00', timezone)
    const anchorMidnight = new Date(anchorMidnightIso)
    
    const diffTime = targetDate.getTime() - anchorMidnight.getTime()

    const potentialShifts = sortedClipboard.map((shift) => {
      const start = new Date(shift.start_datetime)
      const end = new Date(shift.end_datetime)
      
      // Calculate break offset if exists
      let newBreakStart: string | null = null
      let newBreakEnd: string | null = null
      
      if (shift.break_start_datetime && shift.break_end_datetime) {
        const bStart = new Date(shift.break_start_datetime)
        const bEnd = new Date(shift.break_end_datetime)
        newBreakStart = new Date(bStart.getTime() + diffTime).toISOString()
        newBreakEnd = new Date(bEnd.getTime() + diffTime).toISOString()
      }

      return {
        organization_id: organizationId,
        location_id: locationId,
        employee_id: targetEmployee?.id ?? null,
        role_id: shift.role_id,
        start_datetime: new Date(start.getTime() + diffTime).toISOString(),
        end_datetime: new Date(end.getTime() + diffTime).toISOString(),
        break_start_datetime: newBreakStart,
        break_end_datetime: newBreakEnd,
      }
    })

    const newShifts = potentialShifts.filter((newShift) => {
      const newStart = new Date(newShift.start_datetime).getTime()
      const newEnd = new Date(newShift.end_datetime).getTime()
      
      // Check for overlaps with existing shifts for the same employee
      const hasOverlap = safeShifts.some((existing) => {
        if (existing.employee_id !== newShift.employee_id) return false
        
        const existingStart = new Date(existing.start_datetime).getTime()
        const existingEnd = new Date(existing.end_datetime).getTime()
        
        // Overlap condition: StartA < EndB && EndA > StartB
        return newStart < existingEnd && newEnd > existingStart
      })
      
      return !hasOverlap
    })

    if (newShifts.length === 0) return

    const tempIds: string[] = newShifts.map(() => crypto.randomUUID())
    const optimisticShifts = newShifts.map((s, i) => ({ ...s, id: tempIds[i] } as ShiftRecord))

    setShifts([...safeShifts, ...optimisticShifts])

    const { data, error } = await supabase.from('shifts').insert(newShifts).select()

    if (error) {
      setShifts(safeShifts)
      setError(error.message)
    } else if (data) {
      setShifts((prev) => {
        const withoutOptimistic = prev.filter((s) => !tempIds.includes(s.id ?? ''))
        return [...withoutOptimistic, ...(data as ShiftRecord[])]
      })
    }
  }

  const renderShiftCard = useCallback((shift: ShiftRecord) => {
    const shiftErrors = validationErrors.filter((e) => e.shiftId === shift.id)
    return (
      <ShiftCard
        key={shift.id}
        shift={shift}
        role={shift.role_id ? roleLookup.get(shift.role_id) ?? null : null}
        timezone={timezone}
        timeFormat={timeFormat}
        isSelected={selectedShiftIds.includes(shift.id ?? '')}
        isSelectionMode={isSelectionMode}
        isHighlighted={flashShiftId === shift.id}
        onClick={handleShiftClick}
        validationErrors={shiftErrors}
      />
    )
  }, [validationErrors, roleLookup, timezone, timeFormat, selectedShiftIds, isSelectionMode, flashShiftId, handleShiftClick])

  const handleShiftCreated = (shift: ShiftRecord) => {
    setShifts([...safeShifts, shift])
  }

  const handleShiftUpdated = (updatedShift: ShiftRecord) => {
    setShifts(safeShifts.map((s) => (s.id === updatedShift.id ? updatedShift : s)))
  }

  const handleShiftDeleted = (shiftId: string) => {
    setShifts(safeShifts.filter((s) => s.id !== shiftId))
  }

  const handleOpenQuickAdd = useCallback((employee: GridEmployee | null, day: Date) => {
    setQuickAddTarget({ employee, day })
  }, [])

  const renderRow = (employee: GridEmployee | null, dragProps?: DragHandleProps) => {
    const key = employee ? employee.id : 'unassigned'
    const weeklyTotal = weeklyHours.get(key) ?? 0
    const { attributes, listeners, isDragging } = dragProps || {}

    return (
      <div
        key={key}
        className={`grid grid-cols-[160px_repeat(7,minmax(120px,1fr))] border-t border-slate-800 bg-slate-950/60 ${isDragging ? 'opacity-50' : ''}`}
      >
        <div className="sticky left-0 z-10 flex items-center gap-2 border-r border-slate-800 bg-slate-900/80 px-3 py-3 text-sm font-semibold text-slate-100">
          {employee && attributes && listeners && (
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab text-slate-600 hover:text-slate-300"
              title="Drag to reorder"
            >
              ⋮⋮
            </button>
          )}
          <div className="flex flex-1 items-center justify-between gap-3">
            <div className="flex flex-col">
              <span>{employee ? (employee.name.length > 0 ? employee.name : 'Untitled') : 'Unassigned (parking lot)'}</span>
              {employee && employee.is_floating && <span className="text-[11px] text-emerald-300">Floating</span>}
            </div>
            <span className="text-[11px] font-semibold text-slate-300">{weeklyTotal.toFixed(1)}h</span>
          </div>
        </div>
        {days.map((day) => (
          <MemoizedScheduleCell
            key={`${key}-${day.index}`}
            employee={employee}
            dayIndex={day.index}
            dayDate={day.date}
            shifts={shiftsByEmployeeAndDay[key]?.[day.index] ?? []}
            timezone={timezone}
            onOpenQuickAdd={handleOpenQuickAdd}
            renderShiftCard={renderShiftCard}
            canPaste={clipboardShifts.length > 0}
            onPaste={handlePaste}
            dragState={dragState}
          />
        ))}
      </div>
    )
  }

  const hasError = Boolean((locationError as Error | undefined) || employeesQuery.error || shiftsQuery.error || rolesQuery.error)
  const isLoading = isLocationLoading || employeesQuery.isLoading || shiftsQuery.isLoading || rolesQuery.isLoading

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6 text-sm text-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Smart Grid</p>
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-3 sm:mb-4">
                <h3 className="text-lg sm:text-xl font-semibold text-white">Week view</h3>
                {(hardBlockCount > 0 || softWarningCount > 0) && (
                  <div className="flex items-center gap-2">
                    {hardBlockCount > 0 && (
                      <button
                        onClick={() => setShowErrorDetails(true)}
                        className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-500/20 hover:bg-red-500/20 transition-colors"
                      >
                        <span>🔴</span> {hardBlockCount} Error{hardBlockCount !== 1 ? 's' : ''}
                      </button>
                    )}
                    {softWarningCount > 0 && (
                      <button
                        onClick={() => setShowErrorDetails(true)}
                        className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/20 transition-colors"
                      >
                        <span>⚠️</span> {softWarningCount} Warning{softWarningCount !== 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="hidden sm:inline text-xs font-medium text-slate-400 uppercase tracking-wider">Quick Actions:</span>
                <button
                  onClick={handleCopyLastWeek}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
                  title="Copy all shifts from the previous week to this week"
                >
                  <span>📋</span>
                  <span className="hidden sm:inline">Copy Last Week</span>
                  <span className="sm:hidden">Copy</span>
                </button>
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode)
                    if (isSelectionMode) clearSelection()
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold transition-colors shadow-sm ${
                    isSelectionMode
                      ? 'bg-orange-600 text-white hover:bg-orange-500'
                      : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                  }`}
                  title={isSelectionMode ? 'Exit selection mode' : 'Select multiple shifts for bulk actions'}
                >
                  <span>{isSelectionMode ? '✓' : '☑️'}</span>
                  <span className="hidden sm:inline">{isSelectionMode ? 'Done Selecting' : 'Select Shifts'}</span>
                  <span className="sm:hidden">{isSelectionMode ? 'Done' : 'Select'}</span>
                </button>

                <div className="hidden sm:block h-6 w-px bg-slate-600"></div>

                <span className="hidden sm:inline text-xs font-medium text-slate-400 uppercase tracking-wider">Export & Publish:</span>
                <button
                  onClick={handleExportPDF}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-slate-600 transition-colors shadow-sm"
                  title="Download schedule as PDF for printing or sharing"
                >
                  <span>📄</span>
                  <span className="hidden sm:inline">Export PDF</span>
                  <span className="sm:hidden">PDF</span>
                </button>
                <button
                  onClick={handlePublish}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  disabled={hardBlockCount > 0}
                  title={hardBlockCount > 0 ? 'Fix errors before publishing' : 'Make schedule visible to employees'}
                >
                  <span className="hidden sm:inline">{schedule?.status === 'published' ? 'Publish Changes' : 'Publish Schedule'}</span>
                  <span className="sm:hidden">Publish</span>
                </button>
              </div>
            </div>
            
            {/* Clipboard Status */}
            {clipboardShifts.length > 0 && (
              <div className="flex flex-shrink-0 items-center gap-2 rounded-lg bg-green-600/20 border border-green-500/30 px-3 py-2 text-sm font-medium text-green-300">
                <span>📎</span>
                <span className="hidden sm:inline">{clipboardShifts.length} shifts copied</span>
                <span className="sm:hidden">{clipboardShifts.length}</span>
                <button
                  onClick={() => setClipboardShifts([])}
                  className="ml-1 text-green-400 hover:text-green-200 font-bold"
                  title="Clear clipboard"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          
          <div className="hidden sm:block mt-4 pt-4 border-t border-slate-700">
            <p className="text-sm text-slate-300 leading-relaxed">
              {isSelectionMode
                ? '💡 Click individual shifts to select them, then use the toolbar at the bottom for bulk actions like copy or delete.'
                : '💡 Click any empty cell to add a shift. Shift+Click to select multiple shifts. Drag shifts to move them between days or employees.'}
            </p>
          </div>
        </div>

        {/* Mobile View (< md): day tabs + single-day employee cards */}
        <div className="md:hidden space-y-3">
          {/* Day selector tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map((day, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setMobileSelectedDay(idx)}
                className={`flex-shrink-0 rounded-lg px-3 py-2 text-center transition ${
                  mobileSelectedDay === idx
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <div className="text-[10px] font-semibold uppercase">
                  {day.date.toLocaleDateString(undefined, { weekday: 'short', timeZone: timezone || undefined })}
                </div>
                <div className="text-sm font-bold">
                  {day.date.toLocaleDateString(undefined, { day: 'numeric', timeZone: timezone || undefined })}
                </div>
                {gapDayIndexes.has(idx) && (
                  <div className="mx-auto mt-0.5 h-1 w-1 rounded-full bg-amber-400" />
                )}
              </button>
            ))}
          </div>

          {/* Selected day navigation bar */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2">
            <button
              type="button"
              onClick={() => setMobileSelectedDay((d) => Math.max(0, d - 1))}
              disabled={mobileSelectedDay === 0}
              className="rounded p-1 text-xl leading-none text-slate-400 hover:text-white disabled:opacity-30 transition"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-white">{days[mobileSelectedDay]?.label}</span>
            <button
              type="button"
              onClick={() => setMobileSelectedDay((d) => Math.min(6, d + 1))}
              disabled={mobileSelectedDay === 6}
              className="rounded p-1 text-xl leading-none text-slate-400 hover:text-white disabled:opacity-30 transition"
            >
              ›
            </button>
          </div>

          {/* Coverage gaps for selected day */}
          {gapDayIndexes.has(mobileSelectedDay) && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-400">Coverage Gaps</div>
              {(gapsByDay.get(mobileSelectedDay) ?? []).map((gap) => (
                <div key={gap.id} className="text-[11px] text-amber-300">
                  ⚠ {gap.count}/{gap.min} — {formatGapTime(gap.startTime)}
                  {gap.endTime ? ` – ${formatGapTime(gap.endTime)}` : '+'}
                  {gap.isBreakCaused ? ' (break)' : ''}
                </div>
              ))}
            </div>
          )}

          {/* Loading / Error states */}
          {hasError && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-red-200">Unable to load schedule data.</div>
          )}
          {isLoading && !hasError && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-4 text-sm text-slate-300">Loading schedule…</div>
          )}

          {/* Employee cards for selected day */}
          {!isLoading && !hasError && (
            <div className="space-y-2">
              {([null as GridEmployee | null, ...orderedRows]).map((employee) => {
                const key = employee ? employee.id : 'unassigned'
                const dayShifts = shiftsByEmployeeAndDay[key]?.[mobileSelectedDay] ?? []
                const dayDate = days[mobileSelectedDay]?.date
                const weeklyTotal = weeklyHours.get(key) ?? 0
                return (
                  <div key={key} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
                    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-100">
                          {employee ? employee.name : 'Unassigned'}
                        </span>
                        {employee?.is_floating && (
                          <span className="text-[11px] text-emerald-300">Floating</span>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400">{weeklyTotal.toFixed(1)}h/wk</span>
                    </div>
                    <div className="p-2">
                      {dayShifts.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => dayDate && handleOpenQuickAdd(employee, dayDate)}
                          className="flex h-12 w-full items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs font-semibold text-slate-400 transition hover:border-blue-500/60 hover:text-blue-300"
                        >
                          + Add shift
                        </button>
                      ) : (
                        <div className="space-y-2">
                          {dayShifts.map((shift) => renderShiftCard(shift))}
                          <button
                            type="button"
                            onClick={() => dayDate && handleOpenQuickAdd(employee, dayDate)}
                            className="w-full rounded-md border border-dashed border-slate-700 px-2 py-2 text-[11px] font-semibold text-slate-400 transition hover:border-blue-500/60 hover:text-blue-300"
                          >
                            + Add shift
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Desktop View (>= md): full 7-day grid */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 shadow-xl shadow-black/30">
          <div className="overflow-auto">
            <div className="min-w-fit">
              <div className="grid grid-cols-[160px_repeat(7,minmax(120px,1fr))] border-b border-slate-800 bg-slate-900/90 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                <div className="sticky left-0 top-0 z-20 border-r border-slate-800 bg-slate-900/90 px-3 py-3 text-slate-200">
                  Employee / Hours
                </div>
                {days.map((day) => (
                  <div
                    key={day.index}
                    className="sticky top-0 z-10 border-r border-slate-800 bg-slate-900/90 px-3 py-3 text-left text-slate-200"
                  >
                    <div className="text-[11px] text-slate-400">{day.date.toLocaleDateString(undefined, { weekday: 'short', timeZone: timezone || undefined })}</div>
                    <div className="text-sm font-semibold text-white">{day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: timezone || undefined })}</div>
                    {gapDayIndexes.has(day.index) && (
                      <div className="mt-1 h-0.5 w-full rounded-full bg-amber-500/50" title="Coverage gap on this day" />
                    )}
                  </div>
                ))}
              </div>

              {hasError && (
                <div className="border-t border-slate-800 px-4 py-3 text-sm text-red-200">Unable to load schedule data.</div>
              )}

              {isLoading && !hasError && (
                <div className="border-t border-slate-800 px-4 py-4 text-sm text-slate-300">Loading schedule…</div>
              )}

              {!isLoading && !hasError && (
                <div className="divide-y divide-slate-800">
                  {renderRow(null)}
                  {orderedRows.length === 0 && (
                    <div className="border-t border-slate-800 px-4 py-4 text-sm text-slate-400">No employees for this location yet.</div>
                  )}
                  <SortableContext items={orderedRows.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                    {orderedRows.map((employee) => (
                      <MemoizedSortableEmployeeRow key={employee.id} employee={employee}>
                        {(dragProps) => renderRow(employee, dragProps)}
                      </MemoizedSortableEmployeeRow>
                    ))}
                  </SortableContext>

                  {/* Coverage Gaps row — shows the specific time windows where staffing falls below minimum */}
                  {gapsByDay.size > 0 && (
                    <div className="grid grid-cols-[160px_repeat(7,minmax(120px,1fr))] border-t-2 border-amber-500/30 bg-amber-950/20">
                      <div className="flex items-start border-r border-slate-800 px-3 py-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-400/80">Coverage Gaps</span>
                      </div>
                      {days.map((day) => {
                        const dayGaps = gapsByDay.get(day.index) ?? []
                        return (
                          <div key={day.index} className="border-r border-slate-800 px-2 py-2">
                            {dayGaps.length === 0 ? (
                              <div className="flex h-full min-h-[32px] items-center justify-center">
                                <span className="text-[10px] text-slate-600">✓ covered</span>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {dayGaps.map((gap) => (
                                  <div
                                    key={gap.id}
                                    onClick={() => {
                                      if (gap.shiftId) {
                                        setFlashShiftId(gap.shiftId)
                                        setTimeout(() => {
                                          const el = document.querySelector(`[data-shift-id="${gap.shiftId}"]`)
                                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                          setTimeout(() => setFlashShiftId(null), 2000)
                                        }, 100)
                                      } else {
                                        setShowErrorDetails(true)
                                      }
                                    }}
                                    className="cursor-pointer rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 hover:bg-amber-500/20"
                                  >
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-amber-400">⚠</span>
                                      <span className="text-[10px] font-medium text-amber-300">
                                        {gap.count}/{gap.min} {gap.isBreakCaused ? '(break)' : ''}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-amber-400/70">
                                      {formatGapTime(gap.startTime)}
                                      {gap.endTime ? ` – ${formatGapTime(gap.endTime)}` : '+'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {selectedShiftIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full border border-slate-700 bg-slate-900/90 px-6 py-3 shadow-2xl backdrop-blur-md">
            <span className="text-sm font-semibold text-white">{selectedShiftIds.length} selected</span>
            <div className="h-4 w-px bg-slate-700" />
            <button
              onClick={handleCopySelected}
              className="text-sm font-medium text-slate-300 hover:text-white"
            >
              Copy
            </button>
            <button
              onClick={handleDeleteSelected}
              className="text-sm font-medium text-red-400 hover:text-red-300"
            >
              Delete
            </button>
            <div className="h-4 w-px bg-slate-700" />
            <button
              onClick={clearSelection}
              className="text-xs text-slate-500 hover:text-slate-400"
            >
              Cancel
            </button>
          </div>
        )}

        <QuickAddShiftDialog
          isOpen={Boolean(quickAddTarget)}
          onClose={() => setQuickAddTarget(null)}
          date={quickAddTarget?.day ?? null}
          timezone={timezone}
          employee={quickAddTarget?.employee ?? null}
          locationId={locationId}
          organizationId={organizationId}
          roles={rolesQuery.data ?? []}
          onCreated={handleShiftCreated}
        />

        <EditShiftDialog
          isOpen={Boolean(editingShift)}
          onClose={() => setEditingShift(null)}
          shift={editingShift}
          timezone={timezone}
          employees={employees}
          roles={rolesQuery.data ?? []}
          onUpdated={handleShiftUpdated}
          onDeleted={handleShiftDeleted}
        />

        <ErrorDetailsModal
          isOpen={showErrorDetails}
          onClose={() => setShowErrorDetails(false)}
          errors={validationErrors}
          title="Schedule Issues"
          onShiftClick={(shiftId) => {
            setShowErrorDetails(false)
            setFlashShiftId(shiftId)
            setTimeout(() => {
              const el = document.querySelector(`[data-shift-id="${shiftId}"]`)
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
              setTimeout(() => setFlashShiftId(null), 2000)
            }, 100)
          }}
          suggestions={fixSuggestions}
          onAddShift={handleAddShift}
        />
      </div>
    </DndContext>
  )
}

export default ScheduleGrid
