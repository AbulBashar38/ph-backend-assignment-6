import { ViewingStatus } from '../../../generated/prisma/enums'

// Requests that are still "alive" (can be approved, rescheduled, completed or cancelled)
export const OPEN_VIEWING_STATUSES: ViewingStatus[] = [
    ViewingStatus.PENDING,
    ViewingStatus.APPROVED,
    ViewingStatus.RESCHEDULED,
]

export const VIEWING_SORTABLE_FIELDS = ['createdAt', 'preferredAt', 'scheduledAt'] as const

// How far ahead a viewing can be requested or rescheduled
export const MAX_DAYS_AHEAD = 90
