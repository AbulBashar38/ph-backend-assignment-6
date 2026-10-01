import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
    type Amenity,
    AuditAction,
    NotificationType,
    PropertyStatus,
    type PropertyType,
    Role,
    RoomStatus,
    UserStatus,
} from '../../../generated/prisma/enums'
import type { PropertyWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { cloudinaryUpload } from '../../utils/cloudinaryUpload'
import { createNotifications } from '../../utils/notification'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isAdminRole } from '../../utils/roles'
import { afterIdFilter, runInBatches } from '../../utils/runInBatches'
import { cancelPendingApplications } from '../application/application.utils'
import { cancelOpenViewings } from '../viewing/viewing.utils'
import {
    MAX_IMAGES_PER_PROPERTY,
    NULLS_LAST_SORT_FIELDS,
    PROPERTY_SEARCHABLE_FIELDS,
    PROPERTY_SORT_ALIASES,
    PROPERTY_SORTABLE_FIELDS,
} from './property.constant'
import type {
    ICreatePropertyPayload,
    IUpdatePropertyPayload,
    IUpdatePropertyStatusPayload,
} from './property.interface'
import { PropertiesQueryZodSchema, PublicPropertiesQueryZodSchema } from './property.validation'

const RESOURCE = 'Property'

const imagesInOrder = { orderBy: { createdAt: 'asc' } } as const

// Full view for the owner and admins
// Live rooms, cheapest first, as a summary on the property
const roomSummary = {
    where: { isDeleted: false },
    select: {
        id: true,
        name: true,
        roomType: true,
        monthlyRent: true,
        maxOccupants: true,
        currentOccupants: true,
        status: true,
        availableFrom: true,
    },
    orderBy: { monthlyRent: 'asc' },
} as const

const propertyDetailsInclude = {
    images: imagesInOrder,
    rooms: roomSummary,
    owner: { select: { id: true, name: true, email: true, imageUrl: true } },
} satisfies Prisma.PropertyInclude

// Public view: no moderation notes, no owner contact details
const publicPropertySelect = {
    id: true,
    title: true,
    description: true,
    propertyType: true,
    address: true,
    city: true,
    area: true,
    latitude: true,
    longitude: true,
    amenities: true,
    publishedAt: true,
    createdAt: true,
    availableRoomCount: true,
    minAvailableRent: true,
    earliestAvailableFrom: true,
    images: { select: { id: true, url: true }, ...imagesInOrder },
    // Requirement §7: rooms, prices and availability (status tells which can be applied for)
    rooms: roomSummary,
    owner: { select: { id: true, name: true, imageUrl: true } },
} satisfies Prisma.PropertySelect

// A listing is public only if it's published, not expired, and its owner account is active
export const publiclyVisibleProperty = (): PropertyWhereInput => ({
    status: PropertyStatus.PUBLISHED,
    isDeleted: false,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    owner: { isDeleted: false, status: UserStatus.ACTIVE },
})

// ---------- helpers ----------

// An owner is a live user with role OWNER (there is no separate owner table)
const findActiveOwner = async (userId: string) => {
    const owner = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isDeleted: true },
    })

    if (!owner || owner.isDeleted || owner.role !== Role.OWNER) {
        return null
    }

    return owner
}

/**
 * Loads a live (not archived) property and checks that the caller may manage it:
 * the owner of the property, or any ADMIN / SUPER_ADMIN (admins can do everything with properties).
 */
const findManageableProperty = async (actor: RequestUser, propertyId: string) => {
    const property = await prisma.property.findFirst({
        where: { id: propertyId, isDeleted: false },
        include: { images: imagesInOrder },
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
    }

    if (!isAdminRole(actor.role) && property.ownerId !== actor.userId) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only Manage Your Own Properties')
    }

    return property
}

const getPropertyDetails = (propertyId: string) =>
    prisma.property.findUniqueOrThrow({
        where: { id: propertyId },
        include: propertyDetailsInclude,
    })

// Shared filters for the three list endpoints
const buildListConditions = (filters: {
    searchTerm?: string
    city?: string
    area?: string
    propertyType?: PropertyType
    amenities?: Amenity[]
}): PropertyWhereInput[] => {
    const conditions: PropertyWhereInput[] = []

    if (filters.searchTerm) {
        conditions.push({
            OR: PROPERTY_SEARCHABLE_FIELDS.map((field) => ({
                [field]: { contains: filters.searchTerm, mode: 'insensitive' },
            })),
        })
    }

    if (filters.city) conditions.push({ city: { equals: filters.city, mode: 'insensitive' } })
    if (filters.area) conditions.push({ area: { equals: filters.area, mode: 'insensitive' } })
    if (filters.propertyType) conditions.push({ propertyType: filters.propertyType })
    if (filters.amenities?.length) {
        conditions.push({ amenities: { hasEvery: filters.amenities } })
    }

    return conditions
}

const paginate = async <TArgs extends Prisma.PropertyFindManyArgs>(
    query: IQuery,
    where: PropertyWhereInput,
    args: TArgs,
) => {
    const requestedSort = typeof query.sortBy === 'string' ? query.sortBy : undefined
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        {
            ...query,
            sortBy: (requestedSort && PROPERTY_SORT_ALIASES[requestedSort]) ?? requestedSort,
        },
        PROPERTY_SORTABLE_FIELDS,
        'createdAt',
    )

    const orderBy: Prisma.PropertyOrderByWithRelationInput[] = [
        NULLS_LAST_SORT_FIELDS.includes(sortBy)
            ? { [sortBy]: { sort: sortOrder, nulls: 'last' } }
            : { [sortBy]: sortOrder },
        // Stable order for equal values (same price, same date), so pages never overlap
        { id: 'asc' },
    ]

    const [data, total] = await prisma.$transaction([
        prisma.property.findMany({
            ...args,
            where,
            skip,
            take: limit,
            orderBy,
        } as TArgs),
        prisma.property.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

// ---------- create & read ----------

// Resolves which owner (user id) a new property belongs to: an admin must name one, an owner creates for themselves
const resolveOwnerIdForCreate = async (
    actor: RequestUser,
    requestedOwnerId: string | undefined,
) => {
    if (!isAdminRole(actor.role)) {
        if (requestedOwnerId && requestedOwnerId !== actor.userId) {
            throw new AppError(httpStatus.FORBIDDEN, 'You Can Only Create Properties For Yourself')
        }

        return actor.userId
    }

    if (!requestedOwnerId) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'ownerId Is Required When An Admin Creates A Property',
        )
    }

    if (!(await findActiveOwner(requestedOwnerId))) {
        throw new AppError(
            httpStatus.NOT_FOUND,
            'Owner Not Found (ownerId Must Be The User ID Of An Owner)',
        )
    }

    return requestedOwnerId
}

const createProperty = async (actor: RequestUser, payload: ICreatePropertyPayload) => {
    const { ownerId: requestedOwnerId, ...propertyData } = payload
    const ownerId = await resolveOwnerIdForCreate(actor, requestedOwnerId)

    const property = await prisma.$transaction(async (tx) => {
        const created = await tx.property.create({
            data: { ...propertyData, ownerId, status: PropertyStatus.DRAFT },
        })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_CREATED,
            resource: RESOURCE,
            resourceId: created.id,
            newData: created,
        })

        return created
    })

    return getPropertyDetails(property.id)
}

/**
 * Management list (login required). Same response shape for everyone; the role decides the scope:
 * - OWNER → only their own listings, in every status (another owner's ownerId → 403)
 * - ADMIN / SUPER_ADMIN → every listing (ownerId is an optional filter)
 * Deleted (archived) listings are never returned, to anyone.
 */
const getProperties = async (actor: RequestUser, query: IQuery) => {
    const filters = PropertiesQueryZodSchema.parse(query)
    let ownerId = filters.ownerId

    if (!isAdminRole(actor.role)) {
        if (ownerId && ownerId !== actor.userId) {
            throw new AppError(httpStatus.FORBIDDEN, 'You Can Only List Your Own Properties')
        }

        ownerId = actor.userId
    }

    const where: PropertyWhereInput = {
        AND: [
            { isDeleted: false },
            ...(filters.status ? [{ status: filters.status }] : []),
            ...(ownerId ? [{ ownerId }] : []),
            ...buildListConditions(filters),
        ],
    }

    return paginate(query, where, { include: propertyDetailsInclude })
}

const getPublicProperties = async (query: IQuery) => {
    const filters = PublicPropertiesQueryZodSchema.parse(query)

    const hasRoomFilter =
        filters.minRent !== undefined ||
        filters.maxRent !== undefined ||
        filters.roomType !== undefined ||
        filters.occupants !== undefined ||
        filters.availableBy !== undefined

    const where: PropertyWhereInput = {
        AND: [
            publiclyVisibleProperty(),
            ...buildListConditions(filters),
            // At least one AVAILABLE room that matches every room filter
            ...(hasRoomFilter
                ? [
                      {
                          rooms: {
                              some: {
                                  isDeleted: false,
                                  status: RoomStatus.AVAILABLE,
                                  monthlyRent: { gte: filters.minRent, lte: filters.maxRent },
                                  ...(filters.roomType && { roomType: filters.roomType }),
                                  ...(filters.occupants !== undefined && {
                                      maxOccupants: { gte: filters.occupants },
                                  }),
                                  ...(filters.availableBy && {
                                      OR: [
                                          { availableFrom: null },
                                          { availableFrom: { lte: filters.availableBy } },
                                      ],
                                  }),
                              },
                          },
                      },
                  ]
                : []),
            ...(filters.availableOnly ? [{ availableRoomCount: { gt: 0 } }] : []),
        ],
    }

    return paginate(query, where, { select: publicPropertySelect })
}

const getPublicPropertyById = async (propertyId: string) => {
    const property = await prisma.property.findFirst({
        where: { id: propertyId, ...publiclyVisibleProperty() },
        select: publicPropertySelect,
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
    }

    return property
}

// The owner (any status, including archived) or any admin
const getPropertyById = async (actor: RequestUser, propertyId: string) => {
    const property = await prisma.property.findUnique({
        where: { id: propertyId },
        include: propertyDetailsInclude,
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
    }

    if (!isAdminRole(actor.role) && property.ownerId !== actor.userId) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only View Your Own Properties')
    }

    return property
}

// ---------- update ----------

const updateProperty = async (
    actor: RequestUser,
    propertyId: string,
    payload: IUpdatePropertyPayload,
) => {
    const property = await findManageableProperty(actor, propertyId)

    // Only the fields that were sent, for a readable audit entry
    const changedKeys = Object.keys(payload) as (keyof IUpdatePropertyPayload)[]
    const previousData = Object.fromEntries(changedKeys.map((key) => [key, property[key]]))

    await prisma.$transaction(async (tx) => {
        await tx.property.update({ where: { id: property.id }, data: payload })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_UPDATED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData,
            newData: payload,
        })
    })

    return getPropertyDetails(property.id)
}

// ---------- status changes (conditional updates: safe against double clicks and races) ----------

type ManageableProperty = Awaited<ReturnType<typeof findManageableProperty>>

const suspendedByAdminError = (property: ManageableProperty) =>
    new AppError(
        httpStatus.FORBIDDEN,
        `This Property Was Suspended By An Admin${property.moderationNote ? `: ${property.moderationNote}` : ''}`,
    )

// Only admins suspend or lift a suspension, so the owner is told about every such decision
const notifyOwnerOfModeration = (
    tx: Prisma.TransactionClient,
    property: ManageableProperty,
    nextStatus: PropertyStatus,
    reason?: string | null,
) =>
    createNotifications(tx, [
        nextStatus === PropertyStatus.SUSPENDED
            ? {
                  userId: property.ownerId,
                  type: NotificationType.LISTING_SUSPENDED,
                  title: 'Listing Suspended',
                  message: `An admin suspended your listing "${property.title}"${reason ? `: ${reason}` : ''}. It is hidden from tenants until an admin lifts the suspension.`,
                  data: { propertyId: property.id },
              }
            : {
                  userId: property.ownerId,
                  type: NotificationType.LISTING_RESTORED,
                  title: 'Listing Restored',
                  message: `An admin lifted the suspension on your listing "${property.title}". Its status is now ${nextStatus}.`,
                  data: { propertyId: property.id },
              },
    ])

// → PUBLISHED. An admin publishing a suspended listing also lifts the suspension.
const publishProperty = async (actor: RequestUser, property: ManageableProperty) => {
    if (property.status === PropertyStatus.PUBLISHED) {
        throw new AppError(httpStatus.CONFLICT, 'Property Is Already Published')
    }

    const isAdminActor = isAdminRole(actor.role)
    const isRestore = property.status === PropertyStatus.SUSPENDED

    // Owners can't bring back a listing an admin suspended
    if (isRestore && !isAdminActor) {
        throw suspendedByAdminError(property)
    }

    const publishableStatuses: PropertyStatus[] = isAdminActor
        ? [PropertyStatus.DRAFT, PropertyStatus.INACTIVE, PropertyStatus.SUSPENDED]
        : [PropertyStatus.DRAFT, PropertyStatus.INACTIVE]

    if (property.images.length === 0) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Add At Least One Image Before Publishing')
    }

    if (property.expiresAt && property.expiresAt.getTime() <= Date.now()) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'This Listing Has Expired. Update expiresAt Before Publishing',
        )
    }

    const liveRooms = await prisma.room.count({
        where: { propertyId: property.id, isDeleted: false },
    })

    if (liveRooms === 0) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Add At Least One Room Before Publishing')
    }

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: {
                id: property.id,
                isDeleted: false,
                status: { in: publishableStatuses },
            },
            data: {
                status: PropertyStatus.PUBLISHED,
                publishedAt: new Date(),
                ...(isRestore && { moderationNote: null, moderatedAt: new Date() }),
            },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Property Status Changed. Please Refresh And Try Again',
            )
        }

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_PUBLISHED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { status: property.status },
            newData: { status: PropertyStatus.PUBLISHED },
        })

        if (isRestore) {
            await notifyOwnerOfModeration(tx, property, PropertyStatus.PUBLISHED)
        }
    })
}

// → INACTIVE: the owner takes a published listing offline, or an admin lifts a suspension (the owner re-publishes)
const deactivateProperty = async (actor: RequestUser, property: ManageableProperty) => {
    if (property.status === PropertyStatus.INACTIVE) {
        throw new AppError(httpStatus.CONFLICT, 'Property Is Already Inactive')
    }

    const isRestore = property.status === PropertyStatus.SUSPENDED

    if (isRestore && !isAdminRole(actor.role)) {
        throw suspendedByAdminError(property)
    }

    if (!isRestore && property.status !== PropertyStatus.PUBLISHED) {
        throw new AppError(
            httpStatus.CONFLICT,
            `Only Published Properties Can Be Set To INACTIVE (Current Status: ${property.status})`,
        )
    }

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: { id: property.id, isDeleted: false, status: property.status },
            data: {
                status: PropertyStatus.INACTIVE,
                ...(isRestore && { moderationNote: null, moderatedAt: new Date() }),
            },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Property Status Changed. Please Refresh And Try Again',
            )
        }

        await createAuditLog(tx, {
            actor,
            action: isRestore ? AuditAction.PROPERTY_RESTORED : AuditAction.PROPERTY_DISABLED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { status: property.status },
            newData: { status: PropertyStatus.INACTIVE },
        })

        if (isRestore) {
            await notifyOwnerOfModeration(tx, property, PropertyStatus.INACTIVE)
        }
    })
}

// → SUSPENDED (admins only): hidden from search, and the owner can't publish it until an admin lifts it
const suspendProperty = async (
    actor: RequestUser,
    property: ManageableProperty,
    reason: string | null,
) => {
    if (property.status === PropertyStatus.SUSPENDED) {
        throw new AppError(httpStatus.CONFLICT, 'Property Is Already Suspended')
    }

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: { id: property.id, isDeleted: false, status: property.status },
            data: {
                status: PropertyStatus.SUSPENDED,
                moderationNote: reason,
                moderatedAt: new Date(),
            },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Property Status Changed. Please Refresh And Try Again',
            )
        }

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_SUSPENDED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { status: property.status },
            newData: { status: PropertyStatus.SUSPENDED, reason },
        })

        await notifyOwnerOfModeration(tx, property, PropertyStatus.SUSPENDED, reason)
    })
}

/**
 * One entry point for every manual status change. DRAFT is only the starting status, and ARCHIVED only comes
 * from DELETE, so neither can be requested here.
 */
const updatePropertyStatus = async (
    actor: RequestUser,
    propertyId: string,
    payload: IUpdatePropertyStatusPayload,
) => {
    // Before loading the property, so an owner learns nothing about listings they can't suspend anyway
    if (payload.status === PropertyStatus.SUSPENDED && !isAdminRole(actor.role)) {
        throw new AppError(httpStatus.FORBIDDEN, 'Only Admins Can Suspend A Property')
    }

    const property = await findManageableProperty(actor, propertyId)

    switch (payload.status) {
        case PropertyStatus.PUBLISHED:
            await publishProperty(actor, property)
            break
        case PropertyStatus.INACTIVE:
            await deactivateProperty(actor, property)
            break
        case PropertyStatus.SUSPENDED:
            await suspendProperty(actor, property, payload.reason ?? null)
            break
    }

    return getPropertyDetails(property.id)
}

const archiveProperty = async (actor: RequestUser, propertyId: string) => {
    const property = await findManageableProperty(actor, propertyId)

    // A reserved/occupied room means a tenant is moving in or living there
    const rentedRooms = await prisma.room.count({
        where: {
            propertyId: property.id,
            isDeleted: false,
            status: { in: [RoomStatus.RESERVED, RoomStatus.OCCUPIED] },
        },
    })

    if (rentedRooms > 0) {
        throw new AppError(
            httpStatus.CONFLICT,
            "This Property Has Reserved Or Occupied Rooms And Can't Be Removed",
        )
    }

    const deletedAt = new Date()

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: { id: property.id, isDeleted: false },
            data: { isDeleted: true, deletedAt, status: PropertyStatus.ARCHIVED },
        })

        if (count === 0) {
            throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
        }

        // Its rooms leave with it (kept for history)
        await tx.room.updateMany({
            where: { propertyId: property.id, isDeleted: false },
            data: { isDeleted: true, deletedAt, status: RoomStatus.UNAVAILABLE },
        })

        await cancelOpenViewings(
            tx,
            { propertyId: property.id },
            'The property was removed from listings',
            'tenant',
        )
        await cancelPendingApplications(
            tx,
            { propertyId: property.id },
            'The property was removed from listings',
            'tenant',
        )

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_ARCHIVED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { status: property.status },
            newData: { status: PropertyStatus.ARCHIVED },
        })
    })
}

// ADMIN / SUPER_ADMIN
// ---------- images ----------

const addImages = async (
    actor: RequestUser,
    propertyId: string,
    files: Express.Multer.File[] | undefined,
) => {
    const property = await findManageableProperty(actor, propertyId)

    if (!files?.length) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Please Upload At Least One Image In The "images" Field',
        )
    }

    const slotsLeft = MAX_IMAGES_PER_PROPERTY - property.images.length

    if (files.length > slotsLeft) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            `A Property Can Have At Most ${MAX_IMAGES_PER_PROPERTY} Images. You Can Add ${Math.max(slotsLeft, 0)} More`,
        )
    }

    // Keep originals reasonable: at most 1600px on the long side, aspect ratio kept
    const uploaded = await cloudinaryUpload.uploadMany(files, `properties/${property.id}`, {
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
    })

    await cloudinaryUpload.withUploadRollback(uploaded, () =>
        prisma.$transaction(async (tx) => {
            await tx.propertyImage.createMany({
                data: uploaded.map((file) => ({
                    propertyId: property.id,
                    url: file.url,
                    publicId: file.publicId,
                })),
            })

            await createAuditLog(tx, {
                actor,
                action: AuditAction.PROPERTY_UPDATED,
                resource: RESOURCE,
                resourceId: property.id,
                newData: { imagesAdded: uploaded.map((file) => file.url) },
            })
        }),
    )

    return getPropertyDetails(property.id)
}

const removeImage = async (actor: RequestUser, propertyId: string, imageId: string) => {
    const property = await findManageableProperty(actor, propertyId)
    const image = property.images.find((item) => item.id === imageId)

    if (!image) {
        throw new AppError(httpStatus.NOT_FOUND, 'Image Not Found On This Property')
    }

    if (property.status === PropertyStatus.PUBLISHED && property.images.length === 1) {
        throw new AppError(
            httpStatus.CONFLICT,
            'A Published Property Needs At Least One Image. Add Another Image Or Set The Property INACTIVE First',
        )
    }

    // Image rows only reference files, so they are removed (the soft-delete rule is for business records)
    await prisma.$transaction(async (tx) => {
        await tx.propertyImage.delete({ where: { id: image.id } })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_UPDATED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { imageRemoved: image.url },
        })
    })

    await cloudinaryUpload.deleteFiles([image.publicId])

    return getPropertyDetails(property.id)
}

// ---------- cron ----------

/**
 * Cron (daily): PUBLISHED listings past `expiresAt` → INACTIVE (requirement §20), the owner is notified. Public search
 * already hides them (`publiclyVisibleProperty`); this makes the status match. Rentals and rooms are untouched.
 */
const expireListings = () => {
    const now = new Date()

    return runInBatches(
        (afterId, take) =>
            prisma.property.findMany({
                where: {
                    status: PropertyStatus.PUBLISHED,
                    isDeleted: false,
                    expiresAt: { lte: now },
                    ...afterIdFilter(afterId),
                },
                select: { id: true, title: true, ownerId: true, expiresAt: true },
                orderBy: { id: 'asc' },
                take,
            }),
        (listings) =>
            prisma.$transaction(async (tx) => {
                const expired: typeof listings = []

                for (const property of listings) {
                    const { count } = await tx.property.updateMany({
                        where: {
                            id: property.id,
                            isDeleted: false,
                            status: PropertyStatus.PUBLISHED,
                        },
                        data: { status: PropertyStatus.INACTIVE },
                    })
                    if (count === 0) continue

                    expired.push(property)
                    await createAuditLog(tx, {
                        actor: null,
                        action: AuditAction.PROPERTY_EXPIRED,
                        resource: RESOURCE,
                        resourceId: property.id,
                        previousData: { status: PropertyStatus.PUBLISHED },
                        newData: { status: PropertyStatus.INACTIVE, expiresAt: property.expiresAt },
                    })
                }

                await createNotifications(
                    tx,
                    expired.map((property) => ({
                        userId: property.ownerId,
                        type: NotificationType.LISTING_EXPIRED,
                        title: 'Listing Expired',
                        message: `Your listing "${property.title}" reached its expiry date and is no longer shown to tenants. Update the expiry date and publish it again to relist it.`,
                        data: { propertyId: property.id },
                    })),
                )

                return expired.length
            }),
    )
}

export const PropertyServices = {
    createProperty,
    getProperties,
    getPublicProperties,
    getPublicPropertyById,
    getPropertyById,
    updateProperty,
    updatePropertyStatus,
    archiveProperty,
    addImages,
    removeImage,
    expireListings,
}
