import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { Role, UserStatus } from '../../../generated/prisma/enums'
import type { RoommateProfileWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { MATCH_SORTABLE_FIELDS, MAX_MATCH_CANDIDATES } from './roommate.constant'
import type {
    ICreateRoommateProfilePayload,
    IUpdateRoommateProfilePayload,
    IUpdateRoommateProfileStatusPayload,
} from './roommate.interface'
import { calculateCompatibility } from './roommate.matching'
import { RoommateMatchesQueryZodSchema } from './roommate.validation'

// The profile plus the person details that live on the user account
const profileInclude = {
    tenant: {
        select: { id: true, name: true, imageUrl: true, gender: true, occupation: true },
    },
} satisfies Prisma.RoommateProfileInclude

const findMyProfile = async (tenantId: string) => {
    const profile = await prisma.roommateProfile.findUnique({
        where: { tenantId },
        include: profileInclude,
    })

    if (!profile) {
        throw new AppError(
            httpStatus.NOT_FOUND,
            'You Have No Roommate Profile Yet. Create One First',
        )
    }

    return profile
}

const createMyProfile = async (actor: RequestUser, payload: ICreateRoommateProfilePayload) => {
    const { gender, occupation, ...profileData } = payload

    const [existingProfile, user] = await Promise.all([
        prisma.roommateProfile.findUnique({
            where: { tenantId: actor.userId },
            select: { id: true },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { gender: true } }),
    ])

    if (existingProfile) {
        throw new AppError(
            httpStatus.CONFLICT,
            'You Already Have A Roommate Profile. Update It Instead',
        )
    }

    // Matching filters by gender, so the account must have one
    if (!gender && !user.gender) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Gender Is Required To Create A Roommate Profile',
        )
    }

    await prisma.$transaction(async (tx) => {
        if (gender !== undefined || occupation !== undefined) {
            await tx.user.update({ where: { id: actor.userId }, data: { gender, occupation } })
        }

        await tx.roommateProfile.create({ data: { ...profileData, tenantId: actor.userId } })
    })

    return findMyProfile(actor.userId)
}

const getMyProfile = (actor: RequestUser) => findMyProfile(actor.userId)

const updateMyProfile = async (actor: RequestUser, payload: IUpdateRoommateProfilePayload) => {
    const profile = await findMyProfile(actor.userId)
    const { gender, occupation, ...profileData } = payload

    // Only one side of the budget may be sent, so check the pair against the saved values
    const budgetMin = profileData.budgetMin ?? profile.budgetMin
    const budgetMax = profileData.budgetMax ?? profile.budgetMax

    if (budgetMin > budgetMax) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Minimum Budget Must Not Be More Than Maximum Budget',
        )
    }

    await prisma.$transaction(async (tx) => {
        if (gender !== undefined || occupation !== undefined) {
            await tx.user.update({ where: { id: actor.userId }, data: { gender, occupation } })
        }

        if (Object.keys(profileData).length > 0) {
            await tx.roommateProfile.update({ where: { id: profile.id }, data: profileData })
        }
    })

    return findMyProfile(actor.userId)
}

// Switch roommate search on/off (requirement §8). Idempotent.
const updateMyProfileStatus = async (
    actor: RequestUser,
    payload: IUpdateRoommateProfileStatusPayload,
) => {
    const profile = await findMyProfile(actor.userId)

    if (profile.isActive !== payload.isActive) {
        await prisma.roommateProfile.update({
            where: { id: profile.id },
            data: { isActive: payload.isActive },
        })
    }

    return findMyProfile(actor.userId)
}

// ---------- matching ----------

// What another tenant may see of a profile: no email, phone, or account details
const matchProfileSelect = {
    id: true,
    age: true,
    budgetMin: true,
    budgetMax: true,
    preferredCity: true,
    preferredArea: true,
    moveInDate: true,
    smokingPreference: true,
    petPreference: true,
    sleepSchedule: true,
    lifestyle: true,
    genderPreference: true,
    bio: true,
    updatedAt: true,
    tenant: {
        select: { id: true, name: true, imageUrl: true, gender: true, occupation: true },
    },
} satisfies Prisma.RoommateProfileSelect

// The viewer must have a profile with search switched on: you can't browse others without being visible
const findMyActiveProfile = async (tenantId: string) => {
    const profile = await findMyProfile(tenantId)

    if (!profile.isActive) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Turn On Roommate Search To See Other Roommate Profiles',
        )
    }

    return profile
}

/**
 * Profiles `me` may see: search on, a live active tenant account, and gender preferences
 * respected in BOTH directions (theirs must accept my gender, mine must accept theirs).
 */
const visibleTo = (me: Awaited<ReturnType<typeof findMyProfile>>): RoommateProfileWhereInput => ({
    isActive: true,
    tenantId: { not: me.tenantId },
    tenant: {
        isDeleted: false,
        status: UserStatus.ACTIVE,
        role: Role.TENANT,
        ...(me.genderPreference && { gender: me.genderPreference }),
    },
    OR: [
        { genderPreference: null },
        ...(me.tenant.gender ? [{ genderPreference: me.tenant.gender }] : []),
    ],
})

/**
 * Compatible roommates, best first (requirement §9). Candidates share my preferred city and have an
 * overlapping budget; each one is then scored 0–100 with a per-factor breakdown.
 */
const getMatches = async (actor: RequestUser, query: IQuery) => {
    const me = await findMyActiveProfile(actor.userId)
    const { minScore } = RoommateMatchesQueryZodSchema.parse(query)
    const { page, limit, skip } = paginationHelper(query, MATCH_SORTABLE_FIELDS, 'score')

    const candidates = await prisma.roommateProfile.findMany({
        where: {
            AND: [
                visibleTo(me),
                { preferredCity: { equals: me.preferredCity, mode: 'insensitive' } },
                { budgetMin: { lte: me.budgetMax } },
                { budgetMax: { gte: me.budgetMin } },
            ],
        },
        select: matchProfileSelect,
        orderBy: { updatedAt: 'desc' },
        take: MAX_MATCH_CANDIDATES,
    })

    const scored = candidates
        .map((candidate) => ({
            ...candidate,
            compatibility: calculateCompatibility(me, candidate),
        }))
        .filter((match) => match.compatibility.score >= (minScore ?? 0))
        // Best score first; the most recently updated profile wins a tie
        .sort(
            (a, b) =>
                b.compatibility.score - a.compatibility.score ||
                b.updatedAt.getTime() - a.updatedAt.getTime(),
        )

    return {
        data: scored.slice(skip, skip + limit),
        meta: buildPaginationMeta(page, limit, scored.length),
    }
}

// One other tenant's roommate profile, with my compatibility score against it
const getProfileById = async (actor: RequestUser, profileId: string) => {
    const me = await findMyActiveProfile(actor.userId)

    const profile = await prisma.roommateProfile.findFirst({
        where: { id: profileId, ...visibleTo(me) },
        select: matchProfileSelect,
    })

    if (!profile) {
        throw new AppError(httpStatus.NOT_FOUND, 'Roommate Profile Not Found')
    }

    return { ...profile, compatibility: calculateCompatibility(me, profile) }
}

export const RoommateServices = {
    getMatches,
    getProfileById,
    createMyProfile,
    getMyProfile,
    updateMyProfile,
    updateMyProfileStatus,
}
