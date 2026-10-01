// Compatibility weights (total 100). Gender preference is not scored: it's a hard filter.
export const MATCH_WEIGHTS = {
    budget: 25,
    location: 20,
    moveIn: 15,
    lifestyle: 10,
    smoking: 10,
    pets: 10,
    sleepSchedule: 10,
} as const

// How many candidate profiles are scored per request (newest first)
export const MAX_MATCH_CANDIDATES = 500

export const MATCH_SORTABLE_FIELDS = ['score'] as const

// ---------- connection requests ----------

// Anti-spam: requests one tenant can send in any rolling 24 hours
export const MAX_ROOMMATE_REQUESTS_PER_DAY = 20

// After a decline, the same sender can't ask the same person again for this long
export const DECLINED_REQUEST_COOLDOWN_DAYS = 30

export const ROOMMATE_REQUEST_SORTABLE_FIELDS = ['createdAt', 'respondedAt'] as const

// Which side of the request the caller is on (GET /roommate/requests?type=…)
export const ROOMMATE_REQUEST_TYPES = ['received', 'sent'] as const

// Statuses PATCH /roommate/requests/:id/status accepts (PENDING is only the starting status)
export const ROOMMATE_REQUEST_RESPONSES = ['ACCEPTED', 'DECLINED', 'CANCELLED'] as const
