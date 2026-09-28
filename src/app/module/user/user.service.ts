import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import { Role, UserStatus } from '../../../generated/prisma/enums'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { authTokenUtils } from '../../utils/authTokens'
import type { IDeleteUserPayload, IUpdateUserPayload } from './user.interface'

const isAdminRole = (role: Role) => role === Role.ADMIN || role === Role.SUPER_ADMIN

const findActiveUser = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { tenant: true, owner: true },
    })

    if (!user || user.isDeleted) {
        throw new AppError(httpStatus.NOT_FOUND, 'User Not Found')
    }

    return user
}

/**
 * Who may update/delete whose account:
 * - anyone → themselves
 * - ADMIN → tenants and owners (not other admins or the super admin)
 * - SUPER_ADMIN → anyone
 */
const assertCanManageUser = (actor: RequestUser, target: { id: string; role: Role }) => {
    const isSelf = actor.userId === target.id
    const isAllowedAdmin =
        actor.role === Role.SUPER_ADMIN || (actor.role === Role.ADMIN && !isAdminRole(target.role))

    if (!isSelf && !isAllowedAdmin) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            isAdminRole(actor.role)
                ? 'Admins Can Only Manage Tenant And Owner Accounts'
                : 'You Can Only Manage Your Own Account',
        )
    }
}

const updateUser = async (actor: RequestUser, userId: string, payload: IUpdateUserPayload) => {
    const user = await findActiveUser(userId)
    assertCanManageUser(actor, user)

    const { name, phone, occupation, gender, address } = payload

    // Field rules follow the TARGET account's role (an admin editing a tenant may set occupation)
    if ((occupation !== undefined || gender !== undefined) && user.role !== Role.TENANT) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Occupation And Gender Can Only Be Set On A Tenant Profile',
        )
    }

    if (address !== undefined && user.role !== Role.OWNER) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Address Can Only Be Set On An Owner Profile')
    }

    if (phone && phone !== user.phone) {
        const phoneOwner = await prisma.user.findUnique({
            where: { phone },
            select: { id: true },
        })

        if (phoneOwner) {
            throw new AppError(httpStatus.CONFLICT, 'This Phone Number Is Already In Use')
        }
    }

    // The profile keeps a copy of the name, so both are updated together.
    // Upsert covers older accounts created before profiles existed.
    const profileName = name ?? user.name

    // TODO(audit module): write USER_UPDATED with previous/new data when actor !== target
    return prisma.user.update({
        where: { id: user.id },
        data: {
            name,
            phone,
            ...(user.role === Role.TENANT && {
                tenant: {
                    upsert: {
                        create: { name: profileName, email: user.email, occupation, gender },
                        update: { name, occupation, gender },
                    },
                },
            }),
            ...(user.role === Role.OWNER && {
                owner: {
                    upsert: {
                        create: { name: profileName, email: user.email, address },
                        update: { name, address },
                    },
                },
            }),
        },
        omit: { password: true },
        include: { tenant: true, owner: true },
    })
}

// Soft delete: the rows stay for history (rentals, payments, audit); the account just stops working
const deleteUser = async (actor: RequestUser, userId: string, payload: IDeleteUserPayload) => {
    const user = await findActiveUser(userId)

    if (user.role === Role.SUPER_ADMIN) {
        throw new AppError(httpStatus.FORBIDDEN, 'The Super Admin Account Cannot Be Deleted')
    }

    assertCanManageUser(actor, user)

    // Re-confirm the CALLER's identity: a stolen access token alone must not be enough to delete an account
    const isSelf = actor.userId === user.id
    const actorAccount = isSelf
        ? user
        : await prisma.user.findUnique({ where: { id: actor.userId }, select: { password: true } })

    if (actorAccount?.password) {
        if (!payload.password) {
            throw new AppError(httpStatus.BAD_REQUEST, 'Please Enter Your Password To Confirm')
        }

        const isPasswordMatched = await bcrypt.compare(payload.password, actorAccount.password)

        if (!isPasswordMatched) {
            throw new AppError(httpStatus.UNAUTHORIZED, 'Password Is Incorrect')
        }
    }

    const deletedAt = new Date()

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: user.id },
            data: { isDeleted: true, deletedAt, status: UserStatus.DELETED },
        })
        await tx.tenant.updateMany({
            where: { userId: user.id },
            data: { isDeleted: true, deletedAt },
        })
        await tx.owner.updateMany({
            where: { userId: user.id },
            data: { isDeleted: true, deletedAt },
        })

        // TODO(rentals/properties/audit modules): refuse while a PENDING/ACTIVE rental exists, archive the owner's
        // properties, cancel pending applications/viewings, and write a USER_DELETED audit log (docs/domain.md)
    })

    // Log the deleted user out everywhere; auth() already rejects their access token because isDeleted is set
    await authTokenUtils.revokeAllRefreshTokens(user.id)

    return { isSelf }
}

export const UserServices = {
    updateUser,
    deleteUser,
}
