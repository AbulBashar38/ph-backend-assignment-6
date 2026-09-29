import type { LifestyleTag } from '../../../generated/prisma/enums'
import { Preference, SleepSchedule } from '../../../generated/prisma/enums'
import { MATCH_WEIGHTS } from './roommate.constant'

// Pure scoring functions: no database access, so the rules are easy to read and test.

export interface IMatchableProfile {
    budgetMin: number
    budgetMax: number
    preferredCity: string
    preferredArea: string | null
    moveInDate: Date
    smokingPreference: Preference
    petPreference: Preference
    sleepSchedule: SleepSchedule
    lifestyle: LifestyleTag[]
}

type TFactor = keyof typeof MATCH_WEIGHTS

export type TCompatibilityLabel =
    | 'Highly Compatible'
    | 'Compatible'
    | 'Partially Compatible'
    | 'Not Compatible'

export interface IFactorResult {
    score: number
    max: number
    label: TCompatibilityLabel
}

const DAY_MS = 24 * 60 * 60 * 1000

const labelFor = (ratio: number): TCompatibilityLabel => {
    if (ratio >= 0.8) return 'Highly Compatible'
    if (ratio >= 0.5) return 'Compatible'
    if (ratio > 0) return 'Partially Compatible'
    return 'Not Compatible'
}

// Share of the narrower budget range that both can afford (0–1)
const budgetRatio = (a: IMatchableProfile, b: IMatchableProfile) => {
    const overlap = Math.min(a.budgetMax, b.budgetMax) - Math.max(a.budgetMin, b.budgetMin)
    if (overlap < 0) return 0

    const narrowestRange = Math.min(a.budgetMax - a.budgetMin, b.budgetMax - b.budgetMin)
    // A single-value budget inside the other range is a full match
    return narrowestRange === 0 ? 1 : Math.min(overlap / narrowestRange, 1)
}

// Same area, or no area preference on either side ("anywhere in the city") → full; same city only → half
const locationRatio = (a: IMatchableProfile, b: IMatchableProfile) => {
    if (a.preferredCity.toLowerCase() !== b.preferredCity.toLowerCase()) return 0
    if (!a.preferredArea || !b.preferredArea) return 1
    return a.preferredArea.toLowerCase() === b.preferredArea.toLowerCase() ? 1 : 0.5
}

const moveInRatio = (a: IMatchableProfile, b: IMatchableProfile) => {
    const daysApart = Math.abs(a.moveInDate.getTime() - b.moveInDate.getTime()) / DAY_MS
    if (daysApart <= 14) return 1
    if (daysApart <= 30) return 8 / 15
    return 0
}

// Jaccard similarity of the tag sets; neither has tags → neutral
const lifestyleRatio = (a: IMatchableProfile, b: IMatchableProfile) => {
    if (a.lifestyle.length === 0 && b.lifestyle.length === 0) return 0.5
    const setB = new Set(b.lifestyle)
    const shared = a.lifestyle.filter((tag) => setB.has(tag)).length
    const union = new Set([...a.lifestyle, ...b.lifestyle]).size
    return shared / union
}

// Same answer → full, "don't mind" on one side → half, "yes" vs "no" → conflict
const preferenceRatio = (a: Preference, b: Preference) => {
    if (a === b) return 1
    if (a === Preference.NO_PREFERENCE || b === Preference.NO_PREFERENCE) return 0.5
    return 0
}

const sleepRatio = (a: SleepSchedule, b: SleepSchedule) => {
    if (a === b) return 1
    if (a === SleepSchedule.FLEXIBLE || b === SleepSchedule.FLEXIBLE) return 0.5
    return 0
}

export const calculateCompatibility = (a: IMatchableProfile, b: IMatchableProfile) => {
    const ratios: Record<TFactor, number> = {
        budget: budgetRatio(a, b),
        location: locationRatio(a, b),
        moveIn: moveInRatio(a, b),
        lifestyle: lifestyleRatio(a, b),
        smoking: preferenceRatio(a.smokingPreference, b.smokingPreference),
        pets: preferenceRatio(a.petPreference, b.petPreference),
        sleepSchedule: sleepRatio(a.sleepSchedule, b.sleepSchedule),
    }

    const breakdown = Object.fromEntries(
        (Object.keys(MATCH_WEIGHTS) as TFactor[]).map((factor) => [
            factor,
            {
                score: Math.round(ratios[factor] * MATCH_WEIGHTS[factor]),
                max: MATCH_WEIGHTS[factor],
                label: labelFor(ratios[factor]),
            },
        ]),
    ) as Record<TFactor, IFactorResult>

    const score = Math.round(
        (Object.keys(MATCH_WEIGHTS) as TFactor[]).reduce(
            (total, factor) => total + ratios[factor] * MATCH_WEIGHTS[factor],
            0,
        ),
    )

    const overallLabel =
        score >= 80
            ? 'Highly Compatible'
            : score >= 60
              ? 'Compatible'
              : score >= 40
                ? 'Partially Compatible'
                : 'Low Compatibility'

    return { score, label: overallLabel, breakdown }
}
