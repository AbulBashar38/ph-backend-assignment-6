import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
    type Amenity,
    AuditAction,
    PropertyStatus,
    RoomStatus,
} from '../../../generated/prisma/enums'
import type { RoomWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { cloudinaryUpload } from '../../utils/cloudinaryUpload'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isAdminRole } from '../../utils/roles'
import { cancelPendingApplications } from '../application/application.utils'
import { publiclyVisibleProperty } from '../property/property.service'
import { cancelOpenViewings } from '../viewing/viewing.utils'
import { MAX_IMAGES_PER_ROOM, ROOM_SEARCHABLE_FIELDS, ROOM_SORTABLE_FIELDS } from './room.constant'
import type {
    ICreateRoomPayload,
    IUpdateRoomPayload,
    IUpdateRoomStatusPayload,
} from './room.interface'
import { PublicRoomsQueryZodSchema, RoomsQueryZodSchema } from './room.validation'

const RESOURCE = 'Room'

// A room with one of these statuses has (or is about to have) a tenant: it can't be edited away
const RENTAL_STATUSES: RoomStatus[] = [RoomStatus.RESERVED, RoomStatus.OCCUPIED]

const imagesInOrder = { orderBy: { createdAt: 'asc' } } as const

// Full view for the owner and admins
const roomDetailsInclude = {
    images: imagesInOrder,
    property: {
        select: { id: true, title: true, status: true, city: true, area: true, ownerId: true },
    },
} satisfies Prisma.RoomInclude

// Public view: the room plus a short summary of its property
const publicRoomSelect = {
    id: true,
    name: true,
    roomType: true,
    monthlyRent: true,
    maxOccupants: true,
    description: true,
    amenities: true,
    availableFrom: true,
    status: true,
    createdAt: true,
    images: { select: { id: true, url: true }, ...imagesInOrder },
    property: {
        select: {
            id: true,
            title: true,
            propertyType: true,
            address: true,
            city: true,
            area: true,
            amenities: true,
            images: { select: { id: true, url: true }, ...imagesInOrder, take: 1 },
            owner: { select: { id: true, name: true, imageUrl: true } },
        },
    },
} satisfies Prisma.RoomSelect

// ---------- helpers ----------

const assertCanManage = (actor: RequestUser, ownerId: string) => {
    if (!isAdminRole(actor.role) && ownerId !== actor.userId) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only Manage Rooms Of Your Own Properties')
    }
}

// A live room of a live property that the caller may manage (the property's owner, or any admin)
const findManageableRoom = async (actor: RequestUser, roomId: string) => {
    const room = await prisma.room.findFirst({
        where: { id: roomId, isDeleted: false, property: { isDeleted: false } },
        include: {
            images: imagesInOrder,
            property: { select: { id: true, ownerId: true, status: true } },
        },
    })

    if (!room) {
        throw new AppError(httpStatus.NOT_FOUND, 'Room Not Found')
    }

    assertCanManage(actor, room.property.ownerId)

    return room
}

// Room names must be unique among the property's live rooms
const assertNameIsFree = async (propertyId: string, name: string, exceptRoomId?: string) => {
    const clash = await prisma.room.findFirst({
        where: {
            propertyId,
            isDeleted: false,
            name: { equals: name, mode: 'insensitive' },
            ...(exceptRoomId && { id: { not: exceptRoomId } }),
        },
        select: { id: true },
    })

    if (clash) {
        throw new AppError(httpStatus.CONFLICT, `This Property Already Has A Room Named "${name}"`)
    }
}

const getRoomDetails = (roomId: string) =>
    prisma.room.findUniqueOrThrow({ where: { id: roomId }, include: roomDetailsInclude })

// Filters shared by the public search and the management list
const buildListConditions = (filters: {
    searchTerm?: string
    roomType?: RoomWhereInput['roomType']
    minRent?: number
    maxRent?: number
    occupants?: number
    amenities?: Amenity[]
    propertyId?: string
}): RoomWhereInput[] => {
    const conditions: RoomWhereInput[] = []

    if (filters.searchTerm) {
        conditions.push({
            OR: [
                ...ROOM_SEARCHABLE_FIELDS.map((field) => ({
                    [field]: { contains: filters.searchTerm, mode: 'insensitive' as const },
                })),
                { property: { title: { contains: filters.searchTerm, mode: 'insensitive' } } },
            ],
        })
    }

    if (filters.propertyId) conditions.push({ propertyId: filters.propertyId })
    if (filters.roomType) conditions.push({ roomType: filters.roomType })
    if (filters.minRent !== undefined || filters.maxRent !== undefined) {
        conditions.push({ monthlyRent: { gte: filters.minRent, lte: filters.maxRent } })
    }
    if (filters.occupants !== undefined)
        conditions.push({ maxOccupants: { gte: filters.occupants } })

    // Each amenity may be on the room itself or on its property (e.g. WIFI is usually property-wide)
    for (const amenity of filters.amenities ?? []) {
        conditions.push({
            OR: [{ amenities: { has: amenity } }, { property: { amenities: { has: amenity } } }],
        })
    }

    return conditions
}

const paginate = async <TArgs extends Prisma.RoomFindManyArgs>(
    query: IQuery,
    where: RoomWhereInput,
    args: TArgs,
) => {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        ROOM_SORTABLE_FIELDS,
        'createdAt',
    )

    const [data, total] = await prisma.$transaction([
        prisma.room.findMany({
            ...args,
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        } as TArgs),
        prisma.room.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

// ---------- create & read ----------

const createRoom = async (actor: RequestUser, payload: ICreateRoomPayload) => {
    const { propertyId, ...roomData } = payload

    const property = await prisma.property.findFirst({
        where: { id: propertyId, isDeleted: false },
        select: { id: true, ownerId: true },
    })

    if (!property) {
        throw new AppError(httpStatus.NOT_FOUND, 'Property Not Found')
    }

    assertCanManage(actor, property.ownerId)
    await assertNameIsFree(property.id, roomData.name)

    const room = await prisma.$transaction(async (tx) => {
        const created = await tx.room.create({
            data: { ...roomData, propertyId: property.id, status: RoomStatus.AVAILABLE },
        })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.ROOM_CREATED,
            resource: RESOURCE,
            resourceId: created.id,
            newData: created,
        })

        return created
    })

    return getRoomDetails(room.id)
}

/**
 * Management list (login required), scoped by role:
 * - OWNER → rooms of their own properties, any status
 * - ADMIN / SUPER_ADMIN → every room
 * Archived (soft-deleted) rooms only with isDeleted=true.
 */
const getRooms = async (actor: RequestUser, query: IQuery) => {
    const filters = RoomsQueryZodSchema.parse(query)

    const where: RoomWhereInput = {
        AND: [
            { isDeleted: filters.isDeleted ?? false },
            ...(isAdminRole(actor.role) ? [] : [{ property: { ownerId: actor.userId } }]),
            ...(filters.status ? [{ status: filters.status }] : []),
            ...buildListConditions(filters),
        ],
    }

    return paginate(query, where, { include: roomDetailsInclude })
}

// The property's owner (any state, including archived) or any admin
const getRoomById = async (actor: RequestUser, roomId: string) => {
    const room = await prisma.room.findUnique({
        where: { id: roomId },
        include: roomDetailsInclude,
    })

    if (!room) {
        throw new AppError(httpStatus.NOT_FOUND, 'Room Not Found')
    }

    if (!isAdminRole(actor.role) && room.property.ownerId !== actor.userId) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only View Rooms Of Your Own Properties')
    }

    return room
}

// Public search: only AVAILABLE rooms in publicly visible properties
const getPublicRooms = async (query: IQuery) => {
    const filters = PublicRoomsQueryZodSchema.parse(query)

    const where: RoomWhereInput = {
        AND: [
            { isDeleted: false, status: RoomStatus.AVAILABLE },
            { property: publiclyVisibleProperty() },
            ...(filters.city
                ? [{ property: { city: { equals: filters.city, mode: 'insensitive' as const } } }]
                : []),
            ...(filters.area
                ? [{ property: { area: { equals: filters.area, mode: 'insensitive' as const } } }]
                : []),
            ...(filters.propertyType ? [{ property: { propertyType: filters.propertyType } }] : []),
            ...(filters.availableBy
                ? [
                      {
                          OR: [
                              { availableFrom: null },
                              { availableFrom: { lte: filters.availableBy } },
                          ],
                      },
                  ]
                : []),
            ...buildListConditions(filters),
        ],
    }

    return paginate(query, where, { select: publicRoomSelect })
}

// Any live room of a public property (its status shows whether it can be applied for)
const getPublicRoomById = async (roomId: string) => {
    const room = await prisma.room.findFirst({
        where: { id: roomId, isDeleted: false, property: publiclyVisibleProperty() },
        select: publicRoomSelect,
    })

    if (!room) {
        throw new AppError(httpStatus.NOT_FOUND, 'Room Not Found')
    }

    return room
}

// ---------- update ----------

const updateRoom = async (actor: RequestUser, roomId: string, payload: IUpdateRoomPayload) => {
    const room = await findManageableRoom(actor, roomId)

    if (payload.name && payload.name.toLowerCase() !== room.name.toLowerCase()) {
        await assertNameIsFree(room.propertyId, payload.name, room.id)
    }

    const changedKeys = Object.keys(payload) as (keyof IUpdateRoomPayload)[]
    const previousData = Object.fromEntries(changedKeys.map((key) => [key, room[key]]))

    await prisma.$transaction(async (tx) => {
        await tx.room.update({ where: { id: room.id }, data: payload })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.ROOM_UPDATED,
            resource: RESOURCE,
            resourceId: room.id,
            previousData,
            newData: payload,
        })
    })

    return getRoomDetails(room.id)
}

// Owner / admin: AVAILABLE ↔ UNAVAILABLE ↔ MAINTENANCE. RESERVED / OCCUPIED rooms are locked (rentals own them).
const updateRoomStatus = async (
    actor: RequestUser,
    roomId: string,
    payload: IUpdateRoomStatusPayload,
) => {
    const room = await findManageableRoom(actor, roomId)

    if (RENTAL_STATUSES.includes(room.status)) {
        throw new AppError(
            httpStatus.CONFLICT,
            `This Room Is ${room.status} By A Tenant. Its Status Changes With The Rental`,
        )
    }

    if (room.status === payload.status) {
        throw new AppError(httpStatus.CONFLICT, `Room Is Already ${payload.status}`)
    }

    await prisma.$transaction(async (tx) => {
        // Conditional: loses cleanly if an application reserved the room in the meantime
        const { count } = await tx.room.updateMany({
            where: { id: room.id, isDeleted: false, status: { notIn: RENTAL_STATUSES } },
            data: { status: payload.status },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Room Status Changed. Please Refresh And Try Again',
            )
        }

        await createAuditLog(tx, {
            actor,
            action: AuditAction.ROOM_STATUS_CHANGED,
            resource: RESOURCE,
            resourceId: room.id,
            previousData: { status: room.status },
            newData: { status: payload.status },
        })
    })

    // TODO(notification module): notify the owner/tenants when availability changes (requirement §17)

    return getRoomDetails(room.id)
}

// Soft delete. A reserved/occupied room, or the last room of a published property, can't be removed.
const archiveRoom = async (actor: RequestUser, roomId: string) => {
    const room = await findManageableRoom(actor, roomId)

    if (RENTAL_STATUSES.includes(room.status)) {
        throw new AppError(
            httpStatus.CONFLICT,
            `This Room Is ${room.status} By A Tenant And Can't Be Removed`,
        )
    }

    if (room.property.status === PropertyStatus.PUBLISHED) {
        const liveRooms = await prisma.room.count({
            where: { propertyId: room.propertyId, isDeleted: false },
        })

        if (liveRooms <= 1) {
            throw new AppError(
                httpStatus.CONFLICT,
                'A Published Property Needs At Least One Room. Add Another Room Or Disable The Property First',
            )
        }
    }

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.room.updateMany({
            where: { id: room.id, isDeleted: false, status: { notIn: RENTAL_STATUSES } },
            data: { isDeleted: true, deletedAt: new Date(), status: RoomStatus.UNAVAILABLE },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Room Status Changed. Please Refresh And Try Again',
            )
        }

        await cancelOpenViewings(tx, { roomId: room.id }, 'The room was removed', 'tenant')
        await cancelPendingApplications(tx, { roomId: room.id }, 'The room was removed', 'tenant')

        await createAuditLog(tx, {
            actor,
            action: AuditAction.ROOM_ARCHIVED,
            resource: RESOURCE,
            resourceId: room.id,
            previousData: { status: room.status },
            newData: { isDeleted: true },
        })
    })
}

// ---------- images ----------

const addImages = async (
    actor: RequestUser,
    roomId: string,
    files: Express.Multer.File[] | undefined,
) => {
    const room = await findManageableRoom(actor, roomId)

    if (!files?.length) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Please Upload At Least One Image In The "images" Field',
        )
    }

    const slotsLeft = MAX_IMAGES_PER_ROOM - room.images.length

    if (files.length > slotsLeft) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            `A Room Can Have At Most ${MAX_IMAGES_PER_ROOM} Images. You Can Add ${Math.max(slotsLeft, 0)} More`,
        )
    }

    const uploaded = await cloudinaryUpload.uploadMany(files, `rooms/${room.id}`, {
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
    })

    await cloudinaryUpload.withUploadRollback(uploaded, () =>
        prisma.$transaction(async (tx) => {
            await tx.roomImage.createMany({
                data: uploaded.map((file) => ({
                    roomId: room.id,
                    url: file.url,
                    publicId: file.publicId,
                })),
            })

            await createAuditLog(tx, {
                actor,
                action: AuditAction.ROOM_UPDATED,
                resource: RESOURCE,
                resourceId: room.id,
                newData: { imagesAdded: uploaded.map((file) => file.url) },
            })
        }),
    )

    return getRoomDetails(room.id)
}

const removeImage = async (actor: RequestUser, roomId: string, imageId: string) => {
    const room = await findManageableRoom(actor, roomId)
    const image = room.images.find((item) => item.id === imageId)

    if (!image) {
        throw new AppError(httpStatus.NOT_FOUND, 'Image Not Found On This Room')
    }

    // Image rows only reference files, so they are removed (the soft-delete rule is for business records)
    await prisma.$transaction(async (tx) => {
        await tx.roomImage.delete({ where: { id: image.id } })

        await createAuditLog(tx, {
            actor,
            action: AuditAction.ROOM_UPDATED,
            resource: RESOURCE,
            resourceId: room.id,
            previousData: { imageRemoved: image.url },
        })
    })

    await cloudinaryUpload.deleteFiles([image.publicId])

    return getRoomDetails(room.id)
}

export const RoomServices = {
    createRoom,
    getRooms,
    getRoomById,
    getPublicRooms,
    getPublicRoomById,
    updateRoom,
    updateRoomStatus,
    archiveRoom,
    addImages,
    removeImage,
}
