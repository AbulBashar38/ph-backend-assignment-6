import z from 'zod'
import { Amenity, PropertyType, RoomStatus, RoomType } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    fileField,
    jsonBody,
    multipartBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { IMAGE_UPLOAD_OPTIONS } from '../../lib/multer'
import { MAX_IMAGES_PER_ROOM, ROOM_SORTABLE_FIELDS } from './room.constant'
import {
    CreateRoomValidationZodSchema,
    UpdateRoomStatusValidationZodSchema,
    UpdateRoomValidationZodSchema,
} from './room.validation'

const TAG = 'Room'

// ---------- response schemas ----------

const imageSchema = z.object({ id: z.string(), url: z.string() })

const roomCoreFields = {
    id: z.string().meta({ example: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
    name: z.string().meta({ example: 'Room 2A' }),
    roomType: z.enum(RoomType),
    monthlyRent: z.number().int().meta({ description: 'Whole BDT (taka)', example: 15000 }),
    maxOccupants: z.number().int().meta({ example: 2 }),
    currentOccupants: z.number().int().meta({
        description: "People living there now: the rental's occupants while OCCUPIED, otherwise 0",
        example: 0,
    }),
    description: z.string().nullable(),
    amenities: z.array(z.enum(Amenity)).meta({ example: ['AC', 'ATTACHED_BATHROOM'] }),
    availableFrom: z.iso
        .datetime()
        .nullable()
        .meta({ description: '`null` = available right away' }),
    status: z.enum(RoomStatus),
    createdAt: z.iso.datetime(),
}

const RoomSchema = z
    .object({
        ...roomCoreFields,
        isDeleted: z.boolean(),
        deletedAt: z.iso.datetime().nullable(),
        updatedAt: z.iso.datetime(),
        propertyId: z.string(),
        images: z.array(
            imageSchema.extend({
                publicId: z.string(),
                roomId: z.string(),
                createdAt: z.iso.datetime(),
            }),
        ),
        property: z.object({
            id: z.string(),
            title: z.string(),
            status: z.string(),
            city: z.string(),
            area: z.string(),
            ownerId: z.string(),
        }),
    })
    .meta({ id: 'Room' })

const PublicRoomSchema = z
    .object({
        ...roomCoreFields,
        images: z.array(imageSchema),
        property: z.object({
            id: z.string(),
            title: z.string(),
            propertyType: z.enum(PropertyType),
            address: z.string(),
            city: z.string(),
            area: z.string(),
            amenities: z.array(z.enum(Amenity)),
            images: z.array(imageSchema).meta({ description: 'The cover image only' }),
            owner: z.object({ id: z.string(), name: z.string(), imageUrl: z.string().nullable() }),
        }),
    })
    .meta({ id: 'PublicRoom' })

// ---------- params & queries ----------

const idParams = z.object({ id: z.string().meta({ description: 'Room ID' }) })

const sharedFilterParams = {
    searchTerm: z
        .string()
        .optional()
        .meta({ description: 'Matches room name, description or property title' }),
    roomType: z.enum(RoomType).optional(),
    minRent: z.string().optional().meta({ description: 'Whole taka', example: '10000' }),
    maxRent: z.string().optional().meta({ description: 'Whole taka', example: '20000' }),
    occupants: z
        .string()
        .optional()
        .meta({ description: 'Rooms that fit at least this many people', example: '2' }),
    amenities: z.string().optional().meta({
        description: 'Comma-separated; each must be on the room **or** its property',
        example: 'WIFI,AC',
    }),
    ...paginationQueryParams(ROOM_SORTABLE_FIELDS),
}

const ownerOrAdmin =
    "The **owner** of the room's property (someone else's → 403) or any **ADMIN / SUPER_ADMIN**. Every change is audited."

// ---------- public ----------

registry.registerPath({
    method: 'get',
    path: '/room/public/available-rooms',
    tags: [TAG],
    summary: 'Search available rooms (public)',
    description:
        'No login needed. Only `AVAILABLE` rooms in published, non-expired properties whose owner is active. ' +
        'Example: `?city=Dhaka&area=Mirpur&minRent=10000&maxRent=20000&occupants=2&amenities=WIFI&availableBy=2026-11-01T00:00:00Z`.',
    security: [],
    request: {
        query: z.object({
            ...sharedFilterParams,
            city: z.string().optional().meta({ example: 'Dhaka' }),
            area: z.string().optional().meta({ example: 'Mirpur' }),
            propertyType: z.enum(PropertyType).optional(),
            propertyId: z.string().optional().meta({ description: 'Only rooms of this property' }),
            availableBy: z.string().optional().meta({
                description: 'ISO date: rooms you can move into on or before it',
                example: '2026-11-01T00:00:00Z',
            }),
        }),
    },
    responses: {
        200: paginatedResponse('Rooms Retrieved Successfully', PublicRoomSchema),
        ...errorResponses(400),
    },
})

registry.registerPath({
    method: 'get',
    path: '/room/public/{id}',
    tags: [TAG],
    summary: 'Get a room of a published property (public)',
    description:
        'Returns the room in any status (`status` shows whether it can be applied for). ' +
        'Removed rooms or rooms of non-public properties → 404.',
    security: [],
    request: { params: idParams },
    responses: {
        200: successResponse('Room Retrieved Successfully', PublicRoomSchema),
        ...errorResponses(404),
    },
})

// ---------- management ----------

registry.registerPath({
    method: 'post',
    path: '/room',
    tags: [TAG],
    summary: 'Add a room to a property (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\n` +
        '- Starts as `AVAILABLE`. One tenant rents the whole room; `maxOccupants` only says how many people it fits.\n' +
        '- `monthlyRent` is whole taka (e.g. `15000`). `availableFrom` is optional (`null` = right away).\n' +
        "- The name must be unique among the property's rooms (→ 409). Archived property → 404.",
    security: authSecurity,
    request: {
        body: jsonBody(
            CreateRoomValidationZodSchema.meta({
                example: {
                    propertyId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
                    name: 'Room 2A',
                    roomType: 'MASTER',
                    monthlyRent: 15000,
                    maxOccupants: 2,
                    amenities: ['AC', 'ATTACHED_BATHROOM'],
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Room Created Successfully', RoomSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'get',
    path: '/room',
    tags: [TAG],
    summary: 'List rooms for management (OWNER → own properties, ADMIN / SUPER_ADMIN → all)',
    description:
        'Any status. Owners only see rooms of their own properties. Removed rooms only with `isDeleted=true`.',
    security: authSecurity,
    request: {
        query: z.object({
            ...sharedFilterParams,
            propertyId: z.string().optional(),
            status: z.enum(RoomStatus).optional(),
            isDeleted: z.enum(['true', 'false']).optional(),
        }),
    },
    responses: {
        200: paginatedResponse('Rooms Retrieved Successfully', RoomSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/room/{id}',
    tags: [TAG],
    summary: 'Get full room details (owner of it, ADMIN, SUPER_ADMIN)',
    description: 'Any status, including removed rooms.',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Room Retrieved Successfully', RoomSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/room/{id}',
    tags: [TAG],
    summary: 'Update room details (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\nSend only the fields to change. \`null\` clears \`description\` or \`availableFrom\`; ` +
        '`amenities` replaces the whole list. Status has its own endpoint. Removed room → 404.',
    security: authSecurity,
    request: {
        params: idParams,
        body: jsonBody(UpdateRoomValidationZodSchema.meta({ example: { monthlyRent: 16000 } })),
    },
    responses: {
        200: successResponse('Room Updated Successfully', RoomSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/room/{id}/status',
    tags: [TAG],
    summary: 'Change room availability (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\n` +
        '- Allowed: `AVAILABLE`, `UNAVAILABLE`, `MAINTENANCE`.\n' +
        '- `RESERVED` and `OCCUPIED` are set only by the system (application approved / rent paid). A room in one of ' +
        "those states can't be changed by hand (→ 409), so an occupied room can never be marked available.\n" +
        '- Same status as now → 409.',
    security: authSecurity,
    request: {
        params: idParams,
        body: jsonBody(
            UpdateRoomStatusValidationZodSchema.meta({ example: { status: 'MAINTENANCE' } }),
        ),
    },
    responses: {
        200: successResponse('Room Status Updated Successfully', RoomSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'post',
    path: '/room/{id}/images',
    tags: [TAG],
    summary: 'Add photos to a room (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\n` +
        `\`multipart/form-data\` with 1–10 files in the **\`images\`** field (${IMAGE_UPLOAD_OPTIONS.allowedLabel}, ` +
        `max ${IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB each). At most ${MAX_IMAGES_PER_ROOM} images per room.`,
    security: authSecurity,
    request: {
        params: idParams,
        body: multipartBody(z.object({ images: z.array(fileField('An image file')) })),
    },
    responses: {
        201: successResponse('Images Added Successfully', RoomSchema),
        ...errorResponses(400, 401, 403, 404, 413, 502),
    },
})

registry.registerPath({
    method: 'delete',
    path: '/room/{id}/images/{imageId}',
    tags: [TAG],
    summary: 'Remove one room photo (owner of it, ADMIN, SUPER_ADMIN)',
    description: `${ownerOrAdmin} Deletes the file from Cloudinary.`,
    security: authSecurity,
    request: { params: idParams.extend({ imageId: z.string() }) },
    responses: {
        200: successResponse('Image Removed Successfully', RoomSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'delete',
    path: '/room/{id}',
    tags: [TAG],
    summary: 'Remove a room: soft delete (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\n` +
        'Marks the room removed (kept for history). Refused (409) when the room is `RESERVED`/`OCCUPIED`, or when it ' +
        'is the last room of a `PUBLISHED` property (add another room or disable the property first).',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Room Removed Successfully'),
        ...errorResponses(401, 403, 404, 409),
    },
})
