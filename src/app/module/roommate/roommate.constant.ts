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
