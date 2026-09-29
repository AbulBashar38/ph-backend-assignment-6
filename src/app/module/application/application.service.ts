import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
    ApplicationStatus,
    AuditAction,
    NotificationType,
    RentalStatus,
    Role,
    RoomStatus,
} from '../../../generated/prisma/enums'
import type { ApplicationWhereInput } from '../../../generated/prisma/models'
import config from '../../config'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { createNotifications } from '../../utils/notification'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isUniqueViolation } from '../../utils/prismaErrors'
import { isAdminRole } from '../../utils/roles'
import { afterIdFilter, runInBatches } from '../../utils/runInBatches'
import { formatEmailDate } from '../../utils/sendEmail'
import { createRentPayment } from '../payment/payment.utils'
import { publiclyVisibleProperty } from '../property/property.service'
import { APPLICATION_SORTABLE_FIELDS, pendingKeyFor } from './application.constant'
import type {
    ICreateApplicationPayload,
    IUpdateApplicationStatusPayload,
} from './application.interface'
import { ApplicationsQueryZodSchema } from './application.validation'

const RESOURCE = 'Application'
const DAY_MS = 24 * 60 * 60 * 1000

// Both sides see each other's name, photo and phone; the owner also sees the tenant's gender and occupation
const personSelect = { id: true, name: true, imageUrl: true, phone: true } as const

const applicationInclude = {
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
    room: { select: { id: true, name: true, roomType: true, monthlyRent: true, status: true } },
    tenant: { select: { ...personSelect, gender: true, occupation: true } },
    rental: { select: { id: true, status: true, startDate: true } },
} satisfies Prisma.ApplicationInclude

type TApplication = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>
type TStatusPayload<S extends IUpdateApplicationStatusPayload['status']> = Extract<
    IUpdateApplicationStatusPayload,
    { status: S }
>

const findApplication = async (applicationId: string) => {
    const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: applicationInclude,
    })

    if (!application) {
        throw new AppError(httpStatus.NOT_FOUND, 'Application Not Found')
    }

    return application
}

const assertPending = (application: TApplication) => {
    if (application.status !== ApplicationStatus.PENDING) {
        throw new AppError(httpStatus.CONFLICT, `This Application Is Already ${application.status}`)
    }
}

const describe = (application: TApplication) =>
    `"${application.property.title}" (${application.room.name})`

// ---------- tenant: apply ----------

const createApplication = async (actor: RequestUser, payload: ICreateApplicationPayload) => {
    const room = await prisma.room.findFirst({
        where: { id: payload.roomId, isDeleted: false, property: publiclyVisibleProperty() },
        include: { property: { select: { id: true, title: true, ownerId: true } } },
    })

    if (!room) {
        throw new AppError(httpStatus.NOT_FOUND, 'Room Not Found Or Not Open For Applications')
    }

    if (room.status !== RoomStatus.AVAILABLE) {
        throw new AppError(httpStatus.CONFLICT, 'This Room Is No Longer Available')
    }

    const pendingKey = pendingKeyFor(actor.userId, room.id)

    try {
        const application = await prisma.$transaction(async (tx) => {
            const created = await tx.application.create({
                data: {
                    tenantId: actor.userId,
                    propertyId: room.property.id,
                    roomId: room.id,
                    moveInDate: payload.moveInDate,
                    message: payload.message,
                    pendingKey,
                    expiresAt: new Date(Date.now() + config.application_expiry_days * DAY_MS),
                },
            })

            await createNotifications(tx, [
                {
                    userId: room.property.ownerId,
                    type: NotificationType.APPLICATION_SUBMITTED,
                    title: 'New Rental Application',
                    message: `${actor.name} applied for "${room.property.title}" (${room.name}), moving in ${formatEmailDate(payload.moveInDate)}.`,
                    data: {
                        applicationId: created.id,
                        propertyId: room.property.id,
                        roomId: room.id,
                    },
                },
            ])

            await createAuditLog(tx, {
                actor,
                action: AuditAction.APPLICATION_SUBMITTED,
                resource: RESOURCE,
                resourceId: created.id,
                newData: { roomId: room.id, moveInDate: payload.moveInDate },
            })

            return created
        })

        return findApplication(application.id)
    } catch (error) {
        // The unique pendingKey: the database refuses a second pending application (even under double clicks)
        if (isUniqueViolation(error)) {
            throw new AppError(
                httpStatus.CONFLICT,
                'You Already Have A Pending Application For This Room',
            )
        }
        throw error
    }
}

// ---------- status changes ----------

const cancelApplication = async (
    actor: RequestUser,
    application: TApplication,
    payload: TStatusPayload<'CANCELLED'>,
) => {
    assertPending(application)

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.application.updateMany({
            where: { id: application.id, status: ApplicationStatus.PENDING },
            data: {
                status: ApplicationStatus.CANCELLED,
                pendingKey: null,
                cancelledAt: new Date(),
                cancellationReason: payload.reason ?? 'Cancelled by the tenant',
            },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Application Status Changed. Please Refresh And Try Again',
            )
        }

        await createNotifications(tx, [
            {
                userId: application.property.ownerId,
                type: NotificationType.APPLICATION_CANCELLED,
                title: 'Application Cancelled',
                message: `${application.tenant.name} cancelled their application for ${describe(application)}.`,
                data: { applicationId: application.id, propertyId: application.property.id },
            },
        ])

        await createAuditLog(tx, {
            actor,
            action: AuditAction.APPLICATION_CANCELLED,
            resource: RESOURCE,
            resourceId: application.id,
            previousData: { status: ApplicationStatus.PENDING },
            newData: { status: ApplicationStatus.CANCELLED, reason: payload.reason ?? null },
        })
    })
}

const rejectApplication = async (
    actor: RequestUser,
    application: TApplication,
    payload: TStatusPayload<'REJECTED'>,
) => {
    assertPending(application)

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.application.updateMany({
            where: { id: application.id, status: ApplicationStatus.PENDING },
            data: {
                status: ApplicationStatus.REJECTED,
                pendingKey: null,
                reviewedAt: new Date(),
                rejectionReason: payload.rejectionReason,
            },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Application Status Changed. Please Refresh And Try Again',
            )
        }

        await createNotifications(tx, [
            {
                userId: application.tenantId,
                type: NotificationType.APPLICATION_REJECTED,
                title: 'Application Declined',
                message: `Your application for ${describe(application)} was declined${payload.rejectionReason ? `: ${payload.rejectionReason}` : '.'}`,
                data: { applicationId: application.id, propertyId: application.property.id },
            },
        ])

        await createAuditLog(tx, {
            actor,
            action: AuditAction.APPLICATION_REJECTED,
            resource: RESOURCE,
            resourceId: application.id,
            previousData: { status: ApplicationStatus.PENDING },
            newData: {
                status: ApplicationStatus.REJECTED,
                reason: payload.rejectionReason ?? null,
            },
        })
    })
}

/**
 * Approve = rent the room (requirement §13), all in ONE transaction:
 * 1. room AVAILABLE → RESERVED (conditional: fails with 409 if someone got there first)
 * 2. this application PENDING → APPROVED (conditional)
 * 3. a PENDING rental is created (its unique liveRoomKey refuses a second live rental for the room)
 * 4. every other PENDING application for the room is REJECTED
 * 5. notifications + audit logs
 */
const approveApplication = async (actor: RequestUser, application: TApplication) => {
    assertPending(application)

    if (application.expiresAt.getTime() <= Date.now()) {
        throw new AppError(
            httpStatus.CONFLICT,
            'This Application Has Expired And Can No Longer Be Approved',
        )
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // A move-in date that has already passed starts today
    const startDate = application.moveInDate < today ? today : application.moveInDate

    try {
        await prisma.$transaction(async (tx) => {
            const reserved = await tx.room.updateMany({
                where: { id: application.roomId, isDeleted: false, status: RoomStatus.AVAILABLE },
                data: { status: RoomStatus.RESERVED },
            })

            if (reserved.count === 0) {
                throw new AppError(httpStatus.CONFLICT, 'This Room Is No Longer Available')
            }

            const approved = await tx.application.updateMany({
                where: { id: application.id, status: ApplicationStatus.PENDING },
                data: {
                    status: ApplicationStatus.APPROVED,
                    pendingKey: null,
                    reviewedAt: new Date(),
                },
            })

            if (approved.count === 0) {
                throw new AppError(
                    httpStatus.CONFLICT,
                    'Application Status Changed. Please Refresh And Try Again',
                )
            }

            // Rent is copied now, so later price changes don't affect this rental
            const room = await tx.room.findUniqueOrThrow({
                where: { id: application.roomId },
                select: { monthlyRent: true },
            })

            const rental = await tx.rental.create({
                data: {
                    applicationId: application.id,
                    tenantId: application.tenantId,
                    ownerId: application.property.ownerId,
                    propertyId: application.property.id,
                    roomId: application.roomId,
                    monthlyRent: room.monthlyRent,
                    startDate,
                    status: RentalStatus.PENDING,
                    liveRoomKey: application.roomId,
                },
            })

            // The first month's bill; paying it activates the rental (the webhook) and the room becomes OCCUPIED
            const firstPayment = await createRentPayment(tx, rental, 1)

            // The room is taken: everyone else waiting for it is declined
            const competitors = await tx.application.findMany({
                where: {
                    roomId: application.roomId,
                    status: ApplicationStatus.PENDING,
                    id: { not: application.id },
                },
                select: { id: true, tenantId: true },
            })

            if (competitors.length > 0) {
                await tx.application.updateMany({
                    where: { id: { in: competitors.map((competitor) => competitor.id) } },
                    data: {
                        status: ApplicationStatus.REJECTED,
                        pendingKey: null,
                        reviewedAt: new Date(),
                        rejectionReason: 'The room was rented to another applicant',
                    },
                })
            }

            await createNotifications(tx, [
                {
                    userId: application.tenantId,
                    type: NotificationType.APPLICATION_APPROVED,
                    title: 'Application Approved',
                    message: `Your application for ${describe(application)} was approved. Pay the first month's rent (৳${room.monthlyRent.toLocaleString('en-US')}) to move in on ${formatEmailDate(startDate)}.`,
                    data: {
                        applicationId: application.id,
                        rentalId: rental.id,
                        paymentId: firstPayment.id,
                        propertyId: application.property.id,
                    },
                },
                ...competitors.map((competitor) => ({
                    userId: competitor.tenantId,
                    type: NotificationType.APPLICATION_REJECTED,
                    title: 'Application Declined',
                    message: `Your application for ${describe(application)} was declined: the room was rented to another applicant.`,
                    data: { applicationId: competitor.id, propertyId: application.property.id },
                })),
            ])

            await createAuditLog(tx, {
                actor,
                action: AuditAction.APPLICATION_APPROVED,
                resource: RESOURCE,
                resourceId: application.id,
                previousData: {
                    status: ApplicationStatus.PENDING,
                    roomStatus: RoomStatus.AVAILABLE,
                },
                newData: {
                    status: ApplicationStatus.APPROVED,
                    roomStatus: RoomStatus.RESERVED,
                    rentalId: rental.id,
                    firstPaymentId: firstPayment.id,
                    competitorsRejected: competitors.length,
                },
            })

            await createAuditLog(tx, {
                actor,
                action: AuditAction.RENTAL_CREATED,
                resource: 'Rental',
                resourceId: rental.id,
                newData: rental,
            })
        })
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new AppError(httpStatus.CONFLICT, 'This Room Already Has An Active Rental')
        }
        throw error
    }
}

/**
 * PATCH /application/:id/status — one endpoint for every status change.
 * CANCELLED: only the tenant who applied. APPROVED / REJECTED: the property owner or an admin.
 */
const updateApplicationStatus = async (
    actor: RequestUser,
    applicationId: string,
    payload: IUpdateApplicationStatusPayload,
) => {
    const application = await findApplication(applicationId)

    if (payload.status === ApplicationStatus.CANCELLED) {
        if (application.tenantId !== actor.userId) {
            throw new AppError(
                httpStatus.FORBIDDEN,
                'Only The Tenant Who Applied Can Cancel This Application',
            )
        }

        await cancelApplication(actor, application, payload)
        return findApplication(application.id)
    }

    if (!isAdminRole(actor.role) && application.property.ownerId !== actor.userId) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Only The Property Owner Or An Admin Can Review This Application',
        )
    }

    if (payload.status === ApplicationStatus.APPROVED) {
        await approveApplication(actor, application)
    } else {
        await rejectApplication(actor, application, payload)
    }

    return findApplication(application.id)
}

// ---------- read ----------

// Role-scoped: TENANT → own applications, OWNER → applications for their properties, admins → all
const getApplications = async (actor: RequestUser, query: IQuery) => {
    const filters = ApplicationsQueryZodSchema.parse(query)
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        APPLICATION_SORTABLE_FIELDS,
        'createdAt',
    )

    const scope: ApplicationWhereInput =
        actor.role === Role.TENANT
            ? { tenantId: actor.userId }
            : actor.role === Role.OWNER
              ? { property: { ownerId: actor.userId } }
              : {}

    const where: ApplicationWhereInput = {
        AND: [
            scope,
            ...(filters.status ? [{ status: filters.status }] : []),
            ...(filters.propertyId ? [{ propertyId: filters.propertyId }] : []),
            ...(filters.roomId ? [{ roomId: filters.roomId }] : []),
        ],
    }

    const [data, total] = await prisma.$transaction([
        prisma.application.findMany({
            where,
            include: applicationInclude,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        }),
        prisma.application.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

// The tenant who applied, the property owner, or an admin
const getApplicationById = async (actor: RequestUser, applicationId: string) => {
    const application = await findApplication(applicationId)

    const canView =
        isAdminRole(actor.role) ||
        application.tenantId === actor.userId ||
        application.property.ownerId === actor.userId

    if (!canView) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only View Your Own Applications')
    }

    return application
}

// ---------- cron ----------

/**
 * Cron (hourly): PENDING applications past `expiresAt` → EXPIRED, the tenant is notified. Approving already refuses an
 * expired application, so this just makes the status true and frees `pendingKey` (the tenant may apply again).
 */
const expireStaleApplications = () => {
    const now = new Date()

    return runInBatches(
        (afterId, take) =>
            prisma.application.findMany({
                where: {
                    status: ApplicationStatus.PENDING,
                    expiresAt: { lte: now },
                    ...afterIdFilter(afterId),
                },
                select: {
                    id: true,
                    tenantId: true,
                    property: { select: { id: true, title: true } },
                    room: { select: { name: true } },
                },
                orderBy: { id: 'asc' },
                take,
            }),
        (stale) =>
            prisma.$transaction(async (tx) => {
                const expired: typeof stale = []

                for (const application of stale) {
                    // Conditional: the tenant may have cancelled it a moment ago
                    const { count } = await tx.application.updateMany({
                        where: { id: application.id, status: ApplicationStatus.PENDING },
                        data: { status: ApplicationStatus.EXPIRED, pendingKey: null },
                    })
                    if (count === 0) continue

                    expired.push(application)
                    await createAuditLog(tx, {
                        actor: null,
                        action: AuditAction.APPLICATION_EXPIRED,
                        resource: RESOURCE,
                        resourceId: application.id,
                        previousData: { status: ApplicationStatus.PENDING },
                        newData: { status: ApplicationStatus.EXPIRED },
                    })
                }

                await createNotifications(
                    tx,
                    expired.map((application) => ({
                        userId: application.tenantId,
                        type: NotificationType.APPLICATION_EXPIRED,
                        title: 'Application Expired',
                        message: `Your application for "${application.property.title}" (${application.room.name}) expired without a response. You can apply again if the room is still available.`,
                        data: {
                            applicationId: application.id,
                            propertyId: application.property.id,
                        },
                    })),
                )

                return expired.length
            }),
    )
}

export const ApplicationServices = {
    createApplication,
    updateApplicationStatus,
    getApplications,
    getApplicationById,
    expireStaleApplications,
}
