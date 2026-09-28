import z from 'zod'
import { Amenity, PropertyStatus, PropertyType } from '../../../generated/prisma/enums'
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
import { MAX_IMAGES_PER_PROPERTY, PROPERTY_SORTABLE_FIELDS } from './property.constant'
import {
    CreatePropertyValidationZodSchema,
    ModeratePropertyValidationZodSchema,
    UpdatePropertyValidationZodSchema,
} from './property.validation'

const TAG = 'Property'

// ---------- response schemas ----------

const PropertyImageSchema = z
    .object({
        id: z.string(),
        url: z.string().meta({
            example: 'https://res.cloudinary.com/demo/image/upload/housing/properties/x/a.jpg',
        }),
        publicId: z.string(),
        propertyId: z.string(),
        createdAt: z.iso.datetime(),
    })
    .meta({ id: 'PropertyImage' })

const propertyCoreFields = {
    id: z.string().meta({ example: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
    title: z.string().meta({ example: 'Sunny 3-bed apartment near Mirpur 10' }),
    description: z.string(),
    propertyType: z.enum(PropertyType),
    address: z.string().meta({ example: 'House 12, Road 5, Block C' }),
    city: z.string().meta({ example: 'Dhaka' }),
    area: z.string().meta({ example: 'Mirpur' }),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    amenities: z.array(z.enum(Amenity)).meta({ example: ['WIFI', 'LIFT', 'GENERATOR'] }),
    publishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
}

const PropertySchema = z
    .object({
        ...propertyCoreFields,
        status: z.enum(PropertyStatus),
        expiresAt: z.iso.datetime().nullable(),
        moderationNote: z.string().nullable(),
        moderatedAt: z.iso.datetime().nullable(),
        isDeleted: z.boolean(),
        deletedAt: z.iso.datetime().nullable(),
        updatedAt: z.iso.datetime(),
        ownerId: z.string().meta({ description: "The owner's user ID" }),
        images: z.array(PropertyImageSchema),
        owner: z.object({
            id: z.string(),
            name: z.string(),
            email: z.email(),
            imageUrl: z.string().nullable(),
        }),
    })
    .meta({ id: 'Property' })

const PublicPropertySchema = z
    .object({
        ...propertyCoreFields,
        images: z.array(z.object({ id: z.string(), url: z.string() })),
        owner: z.object({ id: z.string(), name: z.string(), imageUrl: z.string().nullable() }),
    })
    .meta({ id: 'PublicProperty' })

// ---------- params & queries ----------

const idParams = z.object({ id: z.string().meta({ description: 'Property ID' }) })

const listFilterParams = {
    searchTerm: z
        .string()
        .optional()
        .meta({ description: 'Matches title, description, address, city or area' }),
    city: z.string().optional().meta({ example: 'Dhaka' }),
    area: z.string().optional().meta({ example: 'Mirpur' }),
    propertyType: z.enum(PropertyType).optional(),
    amenities: z.string().optional().meta({
        description: 'Comma-separated; the property must have ALL of them',
        example: 'WIFI,AC',
    }),
    ...paginationQueryParams(PROPERTY_SORTABLE_FIELDS),
}

const ownerOrAdmin =
    "The **owner** of this property (someone else's → 403) or any **ADMIN / SUPER_ADMIN**. Admin actions are audited."

// ---------- public ----------

registry.registerPath({
    method: 'get',
    path: '/property/public/all-properties',
    tags: [TAG],
    summary: 'Search published properties (public)',
    description:
        'No login needed. Only `PUBLISHED`, non-expired listings whose owner account is active. ' +
        'Owner contact details and moderation notes are never included.\n\n' +
        '_Rent range, room type and availability filters are added with the Room module._',
    security: [],
    request: { query: z.object(listFilterParams) },
    responses: {
        200: paginatedResponse('Properties Retrieved Successfully', PublicPropertySchema),
        ...errorResponses(400),
    },
})

registry.registerPath({
    method: 'get',
    path: '/property/public/{id}',
    tags: [TAG],
    summary: 'Get a published property (public)',
    description: 'Unpublished, suspended, archived or expired listings → 404.',
    security: [],
    request: { params: idParams },
    responses: {
        200: successResponse('Property Retrieved Successfully', PublicPropertySchema),
        ...errorResponses(404),
    },
})

// ---------- owner ----------

registry.registerPath({
    method: 'post',
    path: '/property',
    tags: [TAG],
    summary: 'Create a property (OWNER for themselves, ADMIN / SUPER_ADMIN for an owner)',
    description:
        '- **OWNER**: created for yourself (`ownerId` may be omitted, or must be your own → else 403).\n' +
        '- **ADMIN / SUPER_ADMIN**: `ownerId` (the **user ID** of a user with role OWNER) is **required** (missing → 400, not an owner → 404).\n\n' +
        'Creates the listing as `DRAFT`. Then add photos with `POST /property/{id}/images` and publish it with ' +
        "`PATCH /property/{id}/publish`. `status` can't be set here.\n\n" +
        '- `expiresAt` (optional, future ISO date): after it, the listing is taken offline automatically.\n' +
        '- `amenities`: any of ' +
        Object.values(Amenity)
            .map((a) => `\`${a}\``)
            .join(', ') +
        '.',
    security: authSecurity,
    request: {
        body: jsonBody(
            CreatePropertyValidationZodSchema.meta({
                example: {
                    title: 'Sunny 3-bed apartment near Mirpur 10',
                    description:
                        'Bright apartment on the 4th floor with lift and generator backup, close to the metro.',
                    propertyType: 'APARTMENT',
                    address: 'House 12, Road 5, Block C',
                    city: 'Dhaka',
                    area: 'Mirpur',
                    amenities: ['WIFI', 'LIFT', 'GENERATOR'],
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Property Created Successfully', PropertySchema),
        ...errorResponses(400, 401, 403, 404),
    },
})

registry.registerPath({
    method: 'get',
    path: '/property/{id}',
    tags: [TAG],
    summary: 'Get full property details (owner of it, or admin)',
    description:
        'Any status, including drafts, suspended (with the moderation note) and archived listings. ' +
        'Owners only see their own (→ 403); `ADMIN` / `SUPER_ADMIN` see all.',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Property Retrieved Successfully', PropertySchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/property/{id}',
    tags: [TAG],
    summary: 'Update property details (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        "- **OWNER** → only your own property (someone else's → 403).\n" +
        '- **ADMIN / SUPER_ADMIN** → any property, e.g. to correct details. The audit log records the admin as the editor.\n\n' +
        'Send only the fields to change. `null` clears `latitude`, `longitude` or `expiresAt`; `amenities` replaces the ' +
        "whole list. A published listing stays published. Status can't be changed here (use publish / disable / moderate). " +
        'Archived → 404.',
    security: authSecurity,
    request: {
        params: idParams,
        body: jsonBody(
            UpdatePropertyValidationZodSchema.meta({
                example: { amenities: ['WIFI', 'AC', 'PARKING'] },
            }),
        ),
    },
    responses: {
        200: successResponse('Property Updated Successfully', PropertySchema),
        ...errorResponses(400, 401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/property/{id}/publish',
    tags: [TAG],
    summary: 'Publish a property (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\n` +
        '- From `DRAFT` or `INACTIVE` → `PUBLISHED` (visible in public search).\n' +
        '- Needs at least one image (400) and an `expiresAt` in the future if set (400).\n' +
        '- Already published → 409. Suspended: owner → 403 with the reason; an admin may publish it (clears the suspension).',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Property Published Successfully', PropertySchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/property/{id}/disable',
    tags: [TAG],
    summary: 'Take a published property offline (owner of it, ADMIN, SUPER_ADMIN)',
    description: `${ownerOrAdmin} \`PUBLISHED\` → \`INACTIVE\` (hidden from search; publish again any time). Other statuses → 409.`,
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Property Disabled Successfully', PropertySchema),
        ...errorResponses(401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'post',
    path: '/property/{id}/images',
    tags: [TAG],
    summary: 'Add photos to a property (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin}\n\n` +
        `\`multipart/form-data\` with 1–10 files in the **\`images\`** field (${IMAGE_UPLOAD_OPTIONS.allowedLabel}, ` +
        `max ${IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB each). At most ${MAX_IMAGES_PER_PROPERTY} images per property. ` +
        'Can be called repeatedly. All files are uploaded or none (502 if Cloudinary fails).',
    security: authSecurity,
    request: {
        params: idParams,
        body: multipartBody(z.object({ images: z.array(fileField('An image file')) })),
    },
    responses: {
        201: successResponse('Images Added Successfully', PropertySchema),
        ...errorResponses(400, 401, 403, 404, 413, 502),
    },
})

registry.registerPath({
    method: 'delete',
    path: '/property/{id}/images/{imageId}',
    tags: [TAG],
    summary: 'Remove one photo (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin} Deletes the file from Cloudinary. The last image of a **published** property can't be removed (409): ` +
        'add another first or disable the listing.',
    security: authSecurity,
    request: { params: idParams.extend({ imageId: z.string() }) },
    responses: {
        200: successResponse('Image Removed Successfully', PropertySchema),
        ...errorResponses(401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'delete',
    path: '/property/{id}',
    tags: [TAG],
    summary: 'Remove a property from listings: soft delete (owner of it, ADMIN, SUPER_ADMIN)',
    description:
        `${ownerOrAdmin} Sets status \`ARCHIVED\` + \`isDeleted\`. Nothing is erased: the listing, its images and its ` +
        'history are kept (and it stays visible in `GET /property?status=ARCHIVED`), but it can no longer be edited or published.',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Property Removed From Listings Successfully'),
        ...errorResponses(401, 403, 404),
    },
})

// ---------- admin ----------

registry.registerPath({
    method: 'get',
    path: '/property',
    tags: [TAG],
    summary: 'List properties for management (OWNER → own, ADMIN / SUPER_ADMIN → all)',
    description:
        'Full details in every status (drafts, suspended with the reason…). The role decides the scope:\n' +
        "- **OWNER** → only your own listings. Sending another owner's `ownerId` → 403.\n" +
        '- **ADMIN / SUPER_ADMIN** → every listing; `ownerId` filters by owner.\n\n' +
        'Archived (soft-deleted) listings only appear with `status=ARCHIVED` or `isDeleted=true`. ' +
        'For the public search, use `GET /property/public/all-properties`.',
    security: authSecurity,
    request: {
        query: z.object({
            ...listFilterParams,
            status: z.enum(PropertyStatus).optional(),
            ownerId: z
                .string()
                .optional()
                .meta({ description: 'Owner user ID (admins; owners may only pass their own)' }),
            isDeleted: z.enum(['true', 'false']).optional(),
        }),
    },
    responses: {
        200: paginatedResponse('Properties Retrieved Successfully', PropertySchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/property/{id}/moderate',
    tags: [TAG],
    summary: 'Suspend or restore a property (ADMIN, SUPER_ADMIN)',
    description:
        '- `SUSPEND` (needs a `reason`, min 5 characters): any status → `SUSPENDED`. Hidden from search; the owner sees ' +
        "the reason and can't publish it.\n" +
        '- `RESTORE`: `SUSPENDED` → `INACTIVE`. The owner reviews it and publishes again.\n' +
        'Archived → 404. Wrong current status → 409.',
    security: authSecurity,
    request: {
        params: idParams,
        body: jsonBody(
            ModeratePropertyValidationZodSchema.meta({
                example: { action: 'SUSPEND', reason: 'Photos do not match the listed property' },
            }),
        ),
    },
    responses: {
        200: successResponse('Property Suspended Successfully', PropertySchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})
