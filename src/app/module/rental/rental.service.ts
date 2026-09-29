import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
    AuditAction,
    NotificationType,
    RentalStatus,
    Role,
    RoomStatus,
} from '../../../generated/prisma/enums'
import type { RentalWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { createNotifications, type INotificationInput } from '../../utils/notification'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isAdminRole } from '../../utils/roles'
import { RENTAL_SORTABLE_FIELDS } from './rental.constant'
import type { IUpdateRentalStatusPayload } from './rental.interface'
import { RentalsQueryZodSchema } from './rental.validation'

const personSelect = { id: true, name: true, imageUrl: true, phone: true } as const

const rentalInclude = {
    property: { select: { id: true, title: true, address: true, city: true, area: true } },
    room: { select: { id: true, name: true, roomType: true, status: true } },
    tenant: { select: personSelect },
    owner: { select: personSelect },
    application: { select: { id: true, moveInDate: true, createdAt: true } },
} satisfies Prisma.RentalInclude

const findRental = async (rentalId: string) => {
    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        include: rentalInclude,
    })

    if (!rental) {
        throw new AppError(httpStatus.NOT_FOUND, 'Rental Not Found')
    }

    return rental
}

// The tenant, the owner, or an admin
const assertInvolvedOrAdmin = (
    actor: RequestUser,
    rental: { tenantId: string; ownerId: string },
    action: string,
) => {
    const involved =
        isAdminRole(actor.role) ||
        rental.tenantId === actor.userId ||
        rental.ownerId === actor.userId

    if (!involved) {
        throw new AppError(httpStatus.FORBIDDEN, `You Can Only ${action} Your Own Rentals`)
    }
}

// Role-scoped: TENANT → rentals as tenant, OWNER → rentals of their properties, admins → all
const getRentals = async (actor: RequestUser, query: IQuery) => {
    const filters = RentalsQueryZodSchema.parse(query)
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        RENTAL_SORTABLE_FIELDS,
        'createdAt',
    )

    const scope: RentalWhereInput =
        actor.role === Role.TENANT
            ? { tenantId: actor.userId }
            : actor.role === Role.OWNER
              ? { ownerId: actor.userId }
              : {}

    const where: RentalWhereInput = {
        AND: [
            scope,
            ...(filters.status ? [{ status: filters.status }] : []),
            ...(filters.propertyId ? [{ propertyId: filters.propertyId }] : []),
            ...(filters.roomId ? [{ roomId: filters.roomId }] : []),
        ],
    }

    const [data, total] = await prisma.$transaction([
        prisma.rental.findMany({
            where,
            include: rentalInclude,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        }),
        prisma.rental.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

const getRentalById = async (actor: RequestUser, rentalId: string) => {
    const rental = await findRental(rentalId)
    assertInvolvedOrAdmin(actor, rental, 'View')
    return rental
}

/**
 * End a rental and free the room (one endpoint). COMPLETED: only an ACTIVE rental.
 * TERMINATED: a PENDING or ACTIVE rental, with a reason. The other side is notified.
 */
const updateRentalStatus = async (
    actor: RequestUser,
    rentalId: string,
    payload: IUpdateRentalStatusPayload,
) => {
    const rental = await findRental(rentalId)
    assertInvolvedOrAdmin(actor, rental, 'Manage')

    const isComplete = payload.status === RentalStatus.COMPLETED
    const allowedFrom: RentalStatus[] = isComplete
        ? [RentalStatus.ACTIVE]
        : [RentalStatus.PENDING, RentalStatus.ACTIVE]

    if (!allowedFrom.includes(rental.status)) {
        throw new AppError(
            httpStatus.CONFLICT,
            isComplete && rental.status === RentalStatus.PENDING
                ? "A Rental That Hasn't Started Can't Be Completed. Terminate It Instead"
                : `This Rental Is Already ${rental.status}`,
        )
    }

    const now = new Date()

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.rental.updateMany({
            where: { id: rental.id, status: { in: allowedFrom } },
            data: {
                status: payload.status,
                liveRoomKey: null,
                endDate: now,
                ...(isComplete
                    ? { completedAt: now }
                    : { terminatedAt: now, terminationReason: payload.reason }),
            },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Rental Status Changed. Please Refresh And Try Again',
            )
        }

        // The room can be rented again
        await tx.room.updateMany({
            where: {
                id: rental.roomId,
                status: { in: [RoomStatus.RESERVED, RoomStatus.OCCUPIED] },
            },
            data: { status: RoomStatus.AVAILABLE },
        })

        // TODO(payment module): cancel this rental's unpaid rent dues

        const endedBy =
            actor.userId === rental.tenantId
                ? rental.tenant.name
                : actor.userId === rental.ownerId
                  ? rental.owner.name
                  : 'An admin'
        const message = `${endedBy} ${isComplete ? 'completed' : 'terminated'} the rental of "${rental.property.title}" (${rental.room.name})${isComplete ? '.' : `: ${payload.reason}`}`
        const recipients = [rental.tenantId, rental.ownerId].filter(
            (userId) => userId !== actor.userId,
        )

        await createNotifications(
            tx,
            recipients.map(
                (userId): INotificationInput => ({
                    userId,
                    type: NotificationType.RENTAL_STATUS_CHANGED,
                    title: isComplete ? 'Rental Completed' : 'Rental Terminated',
                    message,
                    data: { rentalId: rental.id, propertyId: rental.property.id },
                }),
            ),
        )

        await createAuditLog(tx, {
            actor,
            action: AuditAction.RENTAL_STATUS_CHANGED,
            resource: 'Rental',
            resourceId: rental.id,
            previousData: { status: rental.status },
            newData: {
                status: payload.status,
                reason: isComplete ? null : payload.reason,
                roomStatus: RoomStatus.AVAILABLE,
            },
        })
    })

    return findRental(rental.id)
}

export const RentalServices = {
    getRentals,
    getRentalById,
    updateRentalStatus,
}
