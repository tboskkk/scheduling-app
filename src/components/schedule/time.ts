export type TimeDisplayFormat = '12h' | '24h'

export function formatTimeLabel(iso: string, timeZone: string | null, timeFormat: TimeDisplayFormat = '12h') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: timeFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    timeZone: timeZone || undefined,
    hour12: timeFormat === '12h',
  })
  const date = new Date(iso)
  return formatter.format(date)
}

export function formatTimeRange(startIso: string, endIso: string, timeZone: string | null, timeFormat: TimeDisplayFormat = '12h') {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: timeFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    timeZone: timeZone || undefined,
    hour12: timeFormat === '12h',
  })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

export function hoursBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  const diffMs = Math.max(0, end - start)
  return diffMs / (1000 * 60 * 60)
}

export function formatDurationLabel(hours: number) {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function isOvernightShift(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return end.getUTCDate() !== start.getUTCDate() || end.getTime() - start.getTime() > 24 * 60 * 60 * 1000
}

export function snapToQuarterHour(date: Date) {
  const minutes = date.getMinutes()
  const snapped = Math.round(minutes / 15) * 15
  date.setMinutes(snapped, 0, 0)
  return date
}

export function localTimeLabel(iso: string, timeZone: string | null) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(new Date(iso))
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  return `${lookup('hour')}:${lookup('minute')}`
}

export function toZonedISOString(baseDate: Date, time: string, timeZone: string | null) {
  const [hour, minute] = time.split(':').map(Number)
  
  if (!timeZone) {
    return new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), hour, minute, 0, 0)).toISOString()
  }

  // Get the Year/Month/Day of baseDate in the target timeZone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  const parts = formatter.formatToParts(baseDate)
  const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value)
  
  const year = getPart('year')
  const month = getPart('month') - 1 // 0-indexed
  const day = getPart('day')

  // Start with a guess in UTC using the local date components
  let guess = new Date(Date.UTC(year, month, day, hour, minute, 0, 0))

  // Iterate to converge on the correct UTC time that results in the desired local time
  for (let i = 0; i < 3; i++) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })

    const parts = formatter.formatToParts(guess)
    const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    
    // Construct the time that 'guess' represents in the timezone, but interpreted as UTC components
    // We need to handle month carefully (0-indexed in Date.UTC, 1-indexed in Intl)
    const asInZone = Date.UTC(lookup('year'), lookup('month') - 1, lookup('day'), lookup('hour'), lookup('minute'))
    
    // We want 'asInZone' to match the target time (baseDate + hour:minute)
    const targetTime = Date.UTC(year, month, day, hour, minute)
    
    const diff = targetTime - asInZone
    if (diff === 0) break
    
    guess = new Date(guess.getTime() + diff)
  }

  return guess.toISOString()
}
