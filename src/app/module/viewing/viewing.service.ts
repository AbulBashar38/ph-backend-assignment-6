import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { NotificationType, Role, RoomStatus, ViewingStatus } from '../../../generated/prisma/enums'
import type { ViewingRequestWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createNotifications, type INotificationInput } from '../../utils/notification'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isAdminRole } from '../../utils/roles'
import { formatEmailDate } from '../../utils/sendEmail'
import { publiclyVisibleProperty } from '../property/property.service'
import { OPEN_VIEWING_STATUSES, VIEWING_SORTABLE_FIELDS } from './viewing.constant'
import type { ICreateViewingPayload, IUpdateViewingStatusPayload } from './viewing.interface'
import { ViewingsQueryZodSchema } from './viewing.validation'

// Both sides see each other's name, photo and phone so they can coordinate the visit
const personSelect = { id: true, name: true, imageUrl: true, phone: true } as const

const viewingInclude = {
    property: {
        select: {
            id: true,
            title: true,
            address: true,
            city: true,
            area: true,
            ownerId: true,
            owner: { select: personSelect },
        },
    },
    room: { select: { id: true, name: true, roomType: true, monthlyRent: true } },
    tenant: { select: personSelect },
} satisfies Prisma.ViewingRequestInclude

type TViewing = Prisma.ViewingRequestGetPayload<{ include: typeof viewingInclude }>

const findViewing = async (viewingId: string) => {
    const viewing = await prisma.viewingRequest.findUnique({
        where: { id: viewingId },
        include: viewingInclude,
    })

    if (!viewing) {
        throw new AppError(httpStatus.NOT_FOUND, 'Viewing Request Not Found')
    }

    return viewing
}

const assertPropertyOwnerOrAdmin = (actor: RequestUser, viewing: TViewing) => {
    if (!isAdminRole(actor.role) && viewing.property.ownerId !== actor.userId) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'You Can Only Manage Viewing Requests For Your Own Properties',
        )
    }
}

const describe = (viewing: TViewing) =>
    `"${viewing.property.title}"${viewing.room ? ` (${viewing.room.name})` : ''}`

/**
 * One status change: a conditional update (only from the allowed statuses, so double clicks and races
 * fail cleanly with 409) plus the notification, in one transaction.
 */
const transition = async (
    viewing: TViewing,
    from: ViewingStatus[],
    data: Prisma.ViewingRequestUpdateManyMutationInput,
    notification: Omit<INotificationInput, 'data'>,
) => {
    await prisma.$transaction(async (tx) => {
        const { count } = await tx.viewingRequest.updateMany({
            where: { id: viewing.id, status: { in: from } },
            data,
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Viewing Request Status Changed. Please Refresh And Try Again',
            )
        }

        await createNotifications(tx, [
            {
                ...notification,
                data: { viewingRequestId: viewing.id, propertyId: viewing.property.id },
            },
        ])
    })

    return findViewing(viewing.id)
}

const assertStatusIn = (viewing: TViewing, allowed: ViewingStatus[], action: string) => {
    if (!allowed.includes(viewing.status)) {
        throw new AppError(
            httpStatus.CONFLICT,
            `A ${viewing.status} Viewing Request Can't Be ${action}`,
        )
    }
}

// ---------- tenant ----------

const createViewing = async (actor: RequestUser, payload: ICreateViewingPayload) => {
    const property = await prisma.property.findFirst({
        where: { id: payload.propertyId, ...publiclyVisibleProperty() },
        select: { id: true, title: true, ownerId: true },
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found Or Not Open For Viewings')
    }

    if (payload.roomId) {
        const room = await prisma.room.findFirst({
            where: { id: payload.roomId, propertyId: property.id, isDeleted: false },
            select: { status: true },
        })

        if (!room) {
            throw new AppError(httpStatus.NOT_FOUND, 'Room Not Found In This Property')
        }

        if (room.status !== RoomStatus.AVAILABLE) {
            throw new AppError(httpStatus.CONFLICT, 'This Room Is Not Available For Viewings')
        }
    }

    const duplicate = await prisma.viewingRequest.findFirst({
        where: {
            tenantId: actor.userId,
            propertyId: property.id,
            roomId: payload.roomId ?? null,
            status: { in: OPEN_VIEWING_STATUSES },
        },
        select: { id: true },
    })

    if (duplicate) {
        throw new AppError(
            httpStatus.CONFLICT,
            'You Already Have An Open Viewing Request For This. Cancel It To Request A New Time',
        )
    }

    const viewing = await prisma.$transaction(async (tx) => {
        const created = await tx.viewingRequest.create({
            data: {
                tenantId: actor.userId,
                propertyId: property.id,
                roomId: payload.roomId ?? null,
                preferredAt: payload.preferredAt,
                message: payload.message,
            },
        })

        await createNotifications(tx, [
            {
                userId: property.ownerId,
                type: NotificationType.VIEWING_REQUESTED,
                title: 'New Viewing Request',
                message: `${actor.name} wants to view "${property.title}" on ${formatEmailDate(payload.preferredAt)}.`,
                data: { viewingRequestId: created.id, propertyId: property.id },
            },
        ])

        return created
    })

    return findViewing(viewing.id)
}

// Each status payload variant, e.g. TStatusPayload<'RESCHEDULED'> = { status, scheduledAt, ownerNote? }
type TStatusPayload<S extends IUpdateViewingStatusPayload['status']> = Extract<
    IUpdateViewingStatusPayload,
    { status: S }
>

const cancelViewing = async (viewing: TViewing, payload: TStatusPayload<'CANCELLED'>) => {
    assertStatusIn(viewing, OPEN_VIEWING_STATUSES, 'Cancelled')

    return transition(
        viewing,
        OPEN_VIEWING_STATUSES,
        {
            status: ViewingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: payload.reason ?? 'Cancelled by the tenant',
        },
        {
            userId: viewing.property.ownerId,
            type: NotificationType.VIEWING_CANCELLED,
            title: 'Viewing Cancelled',
            message: `${viewing.tenant.name} cancelled the viewing of ${describe(viewing)}.`,
        },
    )
}

// ---------- owner of the property, or admin ----------

const approveViewing = async (viewing: TViewing) => {
    assertStatusIn(viewing, [ViewingStatus.PENDING], 'Approved')

    if (viewing.preferredAt.getTime() <= Date.now()) {
        throw new AppError(
            httpStatus.CONFLICT,
            'The Requested Time Has Already Passed. Reschedule Instead',
        )
    }

    return transition(
        viewing,
        [ViewingStatus.PENDING],
        {
            status: ViewingStatus.APPROVED,
            scheduledAt: viewing.preferredAt,
            respondedAt: new Date(),
        },
        {
            userId: viewing.tenantId,
            type: NotificationType.VIEWING_APPROVED,
            title: 'Viewing Approved',
            message: `Your viewing of ${describe(viewing)} is confirmed for ${formatEmailDate(viewing.preferredAt)}.`,
        },
    )
}

const rejectViewing = async (viewing: TViewing, payload: TStatusPayload<'REJECTED'>) => {
    assertStatusIn(viewing, [ViewingStatus.PENDING], 'Rejected')

    return transition(
        viewing,
        [ViewingStatus.PENDING],
        { status: ViewingStatus.REJECTED, ownerNote: payload.ownerNote, respondedAt: new Date() },
        {
            userId: viewing.tenantId,
            type: NotificationType.VIEWING_REJECTED,
            title: 'Viewing Request Declined',
            message: `Your viewing request for ${describe(viewing)} was declined${payload.ownerNote ? `: ${payload.ownerNote}` : '.'}`,
        },
    )
}

// The new time counts as confirmed; the tenant can cancel if it doesn't suit them
const rescheduleViewing = async (viewing: TViewing, payload: TStatusPayload<'RESCHEDULED'>) => {
    assertStatusIn(viewing, OPEN_VIEWING_STATUSES, 'Rescheduled')

    return transition(
        viewing,
        OPEN_VIEWING_STATUSES,
        {
            status: ViewingStatus.RESCHEDULED,
            scheduledAt: payload.scheduledAt,
            ownerNote: payload.ownerNote,
            respondedAt: new Date(),
        },
        {
            userId: viewing.tenantId,
            type: NotificationType.VIEWING_RESCHEDULED,
            title: 'Viewing Rescheduled',
            message: `Your viewing of ${describe(viewing)} was moved to ${formatEmailDate(payload.scheduledAt)}${payload.ownerNote ? `: ${payload.ownerNote}` : '.'} Cancel it if the new time doesn't suit you.`,
        },
    )
}

const completeViewing = async (viewing: TViewing) => {
    assertStatusIn(viewing, [ViewingStatus.APPROVED, ViewingStatus.RESCHEDULED], 'Completed')

    if (!viewing.scheduledAt || viewing.scheduledAt.getTime() > Date.now()) {
        throw new AppError(
            httpStatus.CONFLICT,
            'A Viewing Can Only Be Completed After Its Scheduled Time',
        )
    }

    return transition(
        viewing,
        [ViewingStatus.APPROVED, ViewingStatus.RESCHEDULED],
        { status: ViewingStatus.COMPLETED, completedAt: new Date() },
        {
            userId: viewing.tenantId,
            type: NotificationType.VIEWING_COMPLETED,
            title: 'Viewing Completed',
            message: `Thanks for visiting ${describe(viewing)}. If you liked it, you can now apply.`,
        },
    )
}

/**
 * PATCH /viewing/:id/status — one endpoint for every status change (a dropdown on the frontend).
 * CANCELLED: only the tenant who asked. APPROVED / REJECTED / RESCHEDULED / COMPLETED: the property owner or an admin.
 */
const updateViewingStatus = async (
    actor: RequestUser,
    viewingId: string,
    payload: IUpdateViewingStatusPayload,
) => {
    const viewing = await findViewing(viewingId)

    if (payload.status === ViewingStatus.CANCELLED) {
        if (viewing.tenantId !== actor.userId) {
            throw new AppError(
                httpStatus.FORBIDDEN,
                'Only The Tenant Who Requested This Viewing Can Cancel It',
            )
        }

        return cancelViewing(viewing, payload)
    }

    assertPropertyOwnerOrAdmin(actor, viewing)

    switch (payload.status) {
        case ViewingStatus.APPROVED:
            return approveViewing(viewing)
        case ViewingStatus.REJECTED:
            return rejectViewing(viewing, payload)
        case ViewingStatus.RESCHEDULED:
            return rescheduleViewing(viewing, payload)
        case ViewingStatus.COMPLETED:
            return completeViewing(viewing)
    }
}

// ---------- read ----------

/**
 * Role-scoped list: TENANT → own requests, OWNER → requests for their properties, admins → all.
 */
const getViewings = async (actor: RequestUser, query: IQuery) => {
    const filters = ViewingsQueryZodSchema.parse(query)
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        VIEWING_SORTABLE_FIELDS,
        'createdAt',
    )

    const scope: ViewingRequestWhereInput =
        actor.role === Role.TENANT
            ? { tenantId: actor.userId }
            : actor.role === Role.OWNER
              ? { property: { ownerId: actor.userId } }
              : {}

    const where: ViewingRequestWhereInput = {
        AND: [
            scope,
            ...(filters.status ? [{ status: filters.status }] : []),
            ...(filters.propertyId ? [{ propertyId: filters.propertyId }] : []),
            ...(filters.roomId ? [{ roomId: filters.roomId }] : []),
        ],
    }

    const [data, total] = await prisma.$transaction([
        prisma.viewingRequest.findMany({
            where,
            include: viewingInclude,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        }),
        prisma.viewingRequest.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

// The tenant who asked, the property's owner, or an admin
const getViewingById = async (actor: RequestUser, viewingId: string) => {
    const viewing = await findViewing(viewingId)

    const canView =
        isAdminRole(actor.role) ||
        viewing.tenantId === actor.userId ||
        viewing.property.ownerId === actor.userId

    if (!canView) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only View Your Own Viewing Requests')
    }

    return viewing
}

export const ViewingServices = {
    createViewing,
    updateViewingStatus,
    getViewings,
    getViewingById,
}
