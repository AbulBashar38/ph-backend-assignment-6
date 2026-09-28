import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
    type Amenity,
    AuditAction,
    PropertyStatus,
    type PropertyType,
    UserStatus,
} from '../../../generated/prisma/enums'
import type { PropertyWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { cloudinaryUpload } from '../../utils/cloudinaryUpload'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isAdminRole } from '../../utils/roles'
import {
    MAX_IMAGES_PER_PROPERTY,
    PROPERTY_SEARCHABLE_FIELDS,
    PROPERTY_SORTABLE_FIELDS,
} from './property.constant'
import type {
    ICreatePropertyPayload,
    IModeratePropertyPayload,
    IUpdatePropertyPayload,
} from './property.interface'
import { PropertiesQueryZodSchema, PublicPropertiesQueryZodSchema } from './property.validation'

const RESOURCE = 'Property'

const imagesInOrder = { orderBy: { createdAt: 'asc' } } as const

// Full view for the owner and admins
const propertyDetailsInclude = {
    images: imagesInOrder,
    owner: { select: { id: true, name: true, email: true, userId: true } },
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
    images: { select: { id: true, url: true }, ...imagesInOrder },
    owner: { select: { id: true, name: true } },
} satisfies Prisma.PropertySelect

// A listing is public only if it's published, not expired, and its owner account is active
const publiclyVisible = (): PropertyWhereInput => ({
    status: PropertyStatus.PUBLISHED,
    isDeleted: false,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    owner: { isDeleted: false, user: { status: UserStatus.ACTIVE, isDeleted: false } },
})

// ---------- helpers ----------

const getOwnerProfile = async (userId: string) => {
    const owner = await prisma.owner.findUnique({ where: { userId } })

    if (!owner || owner.isDeleted) {
        throw new AppError(httpStatus.NOT_FOUND, 'Owner Profile Not Found')
    }

    return owner
}

/**
 * Loads a live (not archived) property and checks that the caller may manage it:
 * the owner of the property, or any ADMIN / SUPER_ADMIN (admins can do everything with properties).
 */
const findManageableProperty = async (actor: RequestUser, propertyId: string) => {
    const isAdminActor = isAdminRole(actor.role)
    // Admins have no owner profile, so only owners are looked up
    const owner = isAdminActor ? null : await getOwnerProfile(actor.userId)

    const property = await prisma.property.findFirst({
        where: { id: propertyId, isDeleted: false },
        include: { images: imagesInOrder },
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
    }

    if (!isAdminActor && property.ownerId !== owner?.id) {
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
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        PROPERTY_SORTABLE_FIELDS,
        'createdAt',
    )

    const [data, total] = await prisma.$transaction([
        prisma.property.findMany({
            ...args,
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        } as TArgs),
        prisma.property.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

// ---------- create & read ----------

// Resolves which owner a new property belongs to: an admin must name one, an owner creates for themselves
const resolveOwnerForCreate = async (actor: RequestUser, requestedOwnerId: string | undefined) => {
    if (!isAdminRole(actor.role)) {
        const owner = await getOwnerProfile(actor.userId)

        if (requestedOwnerId && requestedOwnerId !== owner.id) {
            throw new AppError(httpStatus.FORBIDDEN, 'You Can Only Create Properties For Yourself')
        }

        return owner
    }

    if (!requestedOwnerId) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'ownerId Is Required When An Admin Creates A Property',
        )
    }

    const owner = await prisma.owner.findUnique({
        where: { id: requestedOwnerId },
        include: { user: { select: { status: true, isDeleted: true } } },
    })

    if (!owner || owner.isDeleted || owner.user.isDeleted) {
        throw new AppError(httpStatus.NOT_FOUND, 'Owner Not Found')
    }

    return owner
}

const createProperty = async (actor: RequestUser, payload: ICreatePropertyPayload) => {
    const { ownerId: requestedOwnerId, ...propertyData } = payload
    const owner = await resolveOwnerForCreate(actor, requestedOwnerId)

    const property = await prisma.$transaction(async (tx) => {
        const created = await tx.property.create({
            data: { ...propertyData, ownerId: owner.id, status: PropertyStatus.DRAFT },
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
 * Archived (soft-deleted) listings only appear with status=ARCHIVED or isDeleted=true.
 */
const getProperties = async (actor: RequestUser, query: IQuery) => {
    const filters = PropertiesQueryZodSchema.parse(query)
    let ownerId = filters.ownerId

    if (!isAdminRole(actor.role)) {
        const owner = await getOwnerProfile(actor.userId)

        if (ownerId && ownerId !== owner.id) {
            throw new AppError(httpStatus.FORBIDDEN, 'You Can Only List Your Own Properties')
        }

        ownerId = owner.id
    }

    const showDeleted = filters.isDeleted ?? filters.status === PropertyStatus.ARCHIVED

    const where: PropertyWhereInput = {
        AND: [
            { isDeleted: showDeleted },
            ...(filters.status ? [{ status: filters.status }] : []),
            ...(ownerId ? [{ ownerId }] : []),
            ...buildListConditions(filters),
        ],
    }

    return paginate(query, where, { include: propertyDetailsInclude })
}

const getPublicProperties = async (query: IQuery) => {
    const filters = PublicPropertiesQueryZodSchema.parse(query)

    // TODO(room module): rent range, room type, occupants and availability filters
    const where: PropertyWhereInput = {
        AND: [publiclyVisible(), ...buildListConditions(filters)],
    }

    return paginate(query, where, { select: publicPropertySelect })
}

const getPublicPropertyById = async (propertyId: string) => {
    const property = await prisma.property.findFirst({
        where: { id: propertyId, ...publiclyVisible() },
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

    if (!isAdminRole(actor.role) && property.owner.userId !== actor.userId) {
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

const publishProperty = async (actor: RequestUser, propertyId: string) => {
    const property = await findManageableProperty(actor, propertyId)

    if (property.status === PropertyStatus.PUBLISHED) {
        throw new AppError(httpStatus.CONFLICT, 'Property Is Already Published')
    }

    const isAdminActor = isAdminRole(actor.role)

    // Owners can't bring back a listing an admin suspended; admins can (it clears the suspension)
    if (property.status === PropertyStatus.SUSPENDED && !isAdminActor) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            `This Property Was Suspended By An Admin${property.moderationNote ? `: ${property.moderationNote}` : ''}`,
        )
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

    // TODO(room module): require at least one room before publishing (docs/domain.md)

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
                ...(property.status === PropertyStatus.SUSPENDED && { moderationNote: null }),
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
    })

    return getPropertyDetails(property.id)
}

const disableProperty = async (actor: RequestUser, propertyId: string) => {
    const property = await findManageableProperty(actor, propertyId)

    if (property.status !== PropertyStatus.PUBLISHED) {
        throw new AppError(
            httpStatus.CONFLICT,
            `Only Published Properties Can Be Disabled (Current Status: ${property.status})`,
        )
    }

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: { id: property.id, isDeleted: false, status: PropertyStatus.PUBLISHED },
            data: { status: PropertyStatus.INACTIVE },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Property Status Changed. Please Refresh And Try Again',
            )
        }

        await createAuditLog(tx, {
            actor,
            action: AuditAction.PROPERTY_DISABLED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { status: PropertyStatus.PUBLISHED },
            newData: { status: PropertyStatus.INACTIVE },
        })
    })

    return getPropertyDetails(property.id)
}

// Soft delete: "remove from active listings" (requirement §4.2). History and images are kept.
const archiveProperty = async (actor: RequestUser, propertyId: string) => {
    const property = await findManageableProperty(actor, propertyId)

    // TODO(rental module): refuse (409) while any room of this property has a PENDING/ACTIVE rental

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: { id: property.id, isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date(), status: PropertyStatus.ARCHIVED },
        })

        if (count === 0) {
            throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
        }

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
const moderateProperty = async (
    actor: RequestUser,
    propertyId: string,
    payload: IModeratePropertyPayload,
) => {
    const property = await prisma.property.findFirst({
        where: { id: propertyId, isDeleted: false },
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
    }

    const isSuspend = payload.action === 'SUSPEND'

    if (isSuspend && property.status === PropertyStatus.SUSPENDED) {
        throw new AppError(httpStatus.CONFLICT, 'Property Is Already Suspended')
    }

    if (!isSuspend && property.status !== PropertyStatus.SUSPENDED) {
        throw new AppError(httpStatus.CONFLICT, 'Only Suspended Properties Can Be Restored')
    }

    // Restored listings go to INACTIVE: the owner reviews and re-publishes them
    const nextStatus = isSuspend ? PropertyStatus.SUSPENDED : PropertyStatus.INACTIVE

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
            where: {
                id: property.id,
                isDeleted: false,
                status: isSuspend ? { not: PropertyStatus.SUSPENDED } : PropertyStatus.SUSPENDED,
            },
            data: {
                status: nextStatus,
                moderationNote: isSuspend ? (payload.reason ?? null) : null,
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
            action: isSuspend ? AuditAction.PROPERTY_SUSPENDED : AuditAction.PROPERTY_RESTORED,
            resource: RESOURCE,
            resourceId: property.id,
            previousData: { status: property.status },
            newData: { status: nextStatus, reason: payload.reason ?? null },
        })
    })

    // TODO(notification module): notify the owner about the suspension / restore

    return getPropertyDetails(property.id)
}

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
            'A Published Property Needs At Least One Image. Add Another Image Or Disable The Property First',
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

export const PropertyServices = {
    createProperty,
    getProperties,
    getPublicProperties,
    getPublicPropertyById,
    getPropertyById,
    updateProperty,
    publishProperty,
    disableProperty,
    archiveProperty,
    moderateProperty,
    addImages,
    removeImage,
}
