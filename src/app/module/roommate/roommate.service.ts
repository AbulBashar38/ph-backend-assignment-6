import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import type {
    ICreateRoommateProfilePayload,
    IUpdateRoommateProfilePayload,
    IUpdateRoommateProfileStatusPayload,
} from './roommate.interface'

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

export const RoommateServices = {
    createMyProfile,
    getMyProfile,
    updateMyProfile,
    updateMyProfileStatus,
}
