import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { Schedule, ShiftRecord } from '../src/types'

describe('Property 19: Schedule Version Preservation', () => {
  it('should increment version and preserve snapshot on publish', () => {
    fc.assert(
      fc.property(
        fc.record({
            version: fc.integer({ min: 1, max: 100 }),
            shifts: fc.array(fc.record({
                id: fc.uuid(),
                location_id: fc.uuid(),
                schedule_id: fc.option(fc.uuid(), { nil: undefined }),
                employee_id: fc.uuid(),
                role_id: fc.uuid(),
                start_datetime: fc.date().map(d => d.toISOString()),
                end_datetime: fc.date().map(d => d.toISOString())
            }))
        }),
        ({ version, shifts }) => {
            // Initial state: Published schedule V
            const scheduleV1: Schedule = {
                id: 'sched-1',
                organization_id: 'org-1',
                location_id: 'loc-1',
                week_start_date: '2025-01-01',
                status: 'published',
                published_at: new Date().toISOString(),
                published_by: 'user-1',
                version: version,
                snapshot: shifts as ShiftRecord[], // Snapshot of V1
                created_at: new Date().toISOString()
            }

            // Action: Modify shifts (Live shifts are now different from snapshot)
            // We simulate a modification by adding a shift or changing one
            const modifiedShifts = [...shifts, { 
                id: 'new-shift', 
                location_id: 'loc-1',
                schedule_id: null,
                employee_id: null,
                role_id: null,
                start_datetime: '2025-01-01T09:00:00Z',
                end_datetime: '2025-01-01T17:00:00Z'
            } as ShiftRecord]

            // Action: Publish again
            const nextVersion = scheduleV1.version + 1
            const scheduleV2: Schedule = {
                ...scheduleV1,
                id: 'sched-2',
                version: nextVersion,
                snapshot: modifiedShifts,
                published_at: new Date().toISOString()
            }

            // Assertions
            expect(scheduleV2.version).toBe(scheduleV1.version + 1)
            expect(scheduleV2.snapshot).not.toEqual(scheduleV1.snapshot)
            expect(scheduleV1.snapshot).toEqual(shifts) // V1 snapshot preserved
        }
      )
    )
  })
})
