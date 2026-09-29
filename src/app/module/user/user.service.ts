import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import {
    AuditAction,
    PropertyStatus,
    Role,
    RoomStatus,
    UserStatus,
} from '../../../generated/prisma/enums'
import type { UserWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { authTokenUtils } from '../../utils/authTokens'
import { cloudinaryUpload } from '../../utils/cloudinaryUpload'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isAdminRole } from '../../utils/roles'
import { cancelOpenViewings } from '../viewing/viewing.utils'
import { USER_SEARCHABLE_FIELDS, USER_SORTABLE_FIELDS } from './user.constant'
import type { IDeleteUserPayload, IUpdateUserPayload } from './user.interface'
import { GetAllUsersQueryZodSchema } from './user.validation'

const findActiveUser = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
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

// ADMIN / SUPER_ADMIN only (enforced by the route). Admins may read every account, including other admins.
const getAllUsers = async (query: IQuery) => {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        USER_SORTABLE_FIELDS,
        'createdAt',
    )
    // Invalid filter values (e.g. role=KING) → ZodError → 400 from the global error handler
    const filters = GetAllUsersQueryZodSchema.parse(query)

    const andConditions: UserWhereInput[] = [{ isDeleted: filters.isDeleted ?? false }]

    if (filters.searchTerm) {
        andConditions.push({
            OR: USER_SEARCHABLE_FIELDS.map((field) => ({
                [field]: { contains: filters.searchTerm, mode: 'insensitive' },
            })),
        })
    }

    if (filters.role) andConditions.push({ role: filters.role })
    if (filters.status) andConditions.push({ status: filters.status })
    if (filters.authProvider) andConditions.push({ authProvider: filters.authProvider })
    if (filters.emailVerified !== undefined) {
        andConditions.push({ emailVerified: filters.emailVerified })
    }

    const where: UserWhereInput = { AND: andConditions }

    // One transaction so the page and the total come from the same snapshot
    const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
            omit: { password: true },
        }),
        prisma.user.count({ where }),
    ])

    return { data: users, meta: buildPaginationMeta(page, limit, total) }
}

// Self, or any admin. Admins can also open soft-deleted accounts (for support/restore)
const getUserById = async (actor: RequestUser, userId: string) => {
    const isAdmin = isAdminRole(actor.role)

    if (!isAdmin && actor.userId !== userId) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only View Your Own Account')
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        omit: { password: true },
    })

    if (!user || (user.isDeleted && !isAdmin)) {
        throw new AppError(httpStatus.NOT_FOUND, 'User Not Found')
    }

    return user
}

const updateUser = async (actor: RequestUser, userId: string, payload: IUpdateUserPayload) => {
    const user = await findActiveUser(userId)
    assertCanManageUser(actor, user)

    const { name, phone, occupation, gender, address } = payload

    // Field rules follow the TARGET account's role (an admin editing a tenant may set occupation)
    if ((occupation !== undefined || gender !== undefined) && user.role !== Role.TENANT) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Occupation And Gender Can Only Be Set For Tenants',
        )
    }

    if (address !== undefined && user.role !== Role.OWNER) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Address Can Only Be Set For Owners')
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

    const isSelf = actor.userId === user.id
    const currentValues = {
        name: user.name,
        phone: user.phone,
        occupation: user.occupation,
        gender: user.gender,
        address: user.address,
    }

    return prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: { name, phone, occupation, gender, address },
            omit: { password: true },
        })

        // Requirement §19: log admins changing someone else's account
        if (!isSelf) {
            await createAuditLog(tx, {
                actor,
                action: AuditAction.USER_UPDATED,
                resource: 'User',
                resourceId: user.id,
                previousData: Object.fromEntries(
                    Object.keys(payload).map((key) => [
                        key,
                        currentValues[key as keyof typeof currentValues],
                    ]),
                ),
                newData: payload,
            })
        }

        return updatedUser
    })
}

const withoutPassword = { omit: { password: true } } as const

// Upload or replace the profile picture. Same who-may-manage-whom rules as updating the profile.
const uploadProfileImage = async (
    actor: RequestUser,
    userId: string,
    file: Express.Multer.File | undefined,
) => {
    const user = await findActiveUser(userId)
    assertCanManageUser(actor, user)

    if (!file) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Please Upload An Image In The "profileImage" Field',
        )
    }

    // Stored as a 512x512 square cropped around the face: small files, consistent avatars
    const uploaded = await cloudinaryUpload.uploadBuffer(file.buffer, `users/${user.id}`, {
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
    })

    const updatedUser = await cloudinaryUpload.withUploadRollback([uploaded], () =>
        prisma.user.update({
            where: { id: user.id },
            data: { imageUrl: uploaded.url, imagePublicId: uploaded.publicId },
            ...withoutPassword,
        }),
    )

    // Only after the DB points at the new image. A Google photo has no publicId, so nothing is deleted.
    await cloudinaryUpload.deleteFiles([user.imagePublicId])

    return updatedUser
}

const removeProfileImage = async (actor: RequestUser, userId: string) => {
    const user = await findActiveUser(userId)
    assertCanManageUser(actor, user)

    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { imageUrl: null, imagePublicId: null },
        ...withoutPassword,
    })

    await cloudinaryUpload.deleteFiles([user.imagePublicId])

    return updatedUser
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

    // An owner with a tenant moving in or living in one of their rooms can't disappear
    if (user.role === Role.OWNER) {
        const rentedRooms = await prisma.room.count({
            where: {
                isDeleted: false,
                status: { in: [RoomStatus.RESERVED, RoomStatus.OCCUPIED] },
                property: { ownerId: user.id },
            },
        })

        if (rentedRooms > 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                "This Owner Has Reserved Or Occupied Rooms, So The Account Can't Be Deleted Yet",
            )
        }
    }

    const deletedAt = new Date()

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: user.id },
            data: { isDeleted: true, deletedAt, status: UserStatus.DELETED },
        })
        // A deleted owner's listings and rooms leave the site too (kept for history)
        if (user.role === Role.OWNER) {
            await tx.property.updateMany({
                where: { ownerId: user.id, isDeleted: false },
                data: { isDeleted: true, deletedAt, status: PropertyStatus.ARCHIVED },
            })
            await tx.room.updateMany({
                where: { property: { ownerId: user.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt, status: RoomStatus.UNAVAILABLE },
            })
        }

        // Open viewings can't happen any more: cancel them and tell the other side
        if (user.role === Role.OWNER) {
            await cancelOpenViewings(
                tx,
                { property: { ownerId: user.id } },
                'The owner closed their account',
                'tenant',
            )
        } else if (user.role === Role.TENANT) {
            await cancelOpenViewings(
                tx,
                { tenantId: user.id },
                'The tenant closed their account',
                'owner',
            )
        }

        // A deleted account no longer appears in roommate matches
        await tx.roommateProfile.updateMany({
            where: { tenantId: user.id },
            data: { isActive: false },
        })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.USER_DELETED,
            resource: 'User',
            resourceId: user.id,
            previousData: { status: user.status, role: user.role, email: user.email },
            newData: { status: UserStatus.DELETED, deletedBy: isSelf ? 'self' : 'admin' },
        })

        // TODO(rental/application modules): a TENANT with a PENDING/ACTIVE rental → 409, and cancel
        // pending applications/viewings (docs/domain.md → User update & delete)
    })

    // Log the deleted user out everywhere; auth() already rejects their access token because isDeleted is set
    await authTokenUtils.revokeAllRefreshTokens(user.id)

    return { isSelf }
}

export const UserServices = {
    getAllUsers,
    getUserById,
    updateUser,
    uploadProfileImage,
    removeProfileImage,
    deleteUser,
}
