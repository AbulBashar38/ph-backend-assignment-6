import z from 'zod'
import {
    ApplicationStatus,
    RentalStatus,
    RoomStatus,
    RoomType,
} from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { APPLICATION_SORTABLE_FIELDS, MAX_MOVE_IN_DAYS_AHEAD } from './application.constant'
import {
    CreateApplicationValidationZodSchema,
    UpdateApplicationStatusValidationZodSchema,
} from './application.validation'

const TAG = 'Application'

const personSchema = z.object({
    id: z.string(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    phone: z.string().nullable(),
})

const ApplicationSchema = z
    .object({
        id: z.string(),
        status: z.enum(ApplicationStatus),
        moveInDate: z.iso.datetime(),
        occupants: z.number().int().meta({ description: 'People moving in', example: 1 }),
        message: z.string().nullable(),
        expiresAt: z.iso
            .datetime()
            .meta({ description: "After this a PENDING application can't be approved" }),
        reviewedAt: z.iso.datetime().nullable(),
        rejectionReason: z.string().nullable(),
        cancelledAt: z.iso.datetime().nullable(),
        cancellationReason: z.string().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        tenantId: z.string(),
        propertyId: z.string(),
        roomId: z.string(),
        property: z.object({
            id: z.string(),
            title: z.string(),
            address: z.string(),
            city: z.string(),
            area: z.string(),
            ownerId: z.string(),
            owner: personSchema,
        }),
        room: z.object({
            id: z.string(),
            name: z.string(),
            roomType: z.enum(RoomType),
            monthlyRent: z.number().int(),
            maxOccupants: z.number().int(),
            status: z.enum(RoomStatus),
        }),
        tenant: personSchema.extend({
            gender: z.string().nullable(),
            occupation: z.string().nullable(),
        }),
        rental: z
            .object({ id: z.string(), status: z.enum(RentalStatus), startDate: z.iso.datetime() })
            .nullable()
            .meta({ description: 'Set once the application is approved' }),
    })
    .meta({ id: 'Application' })

registry.registerPath({
    method: 'post',
    path: '/application',
    tags: [TAG],
    summary: 'Apply to rent a room (TENANT)',
    description:
        'The room must be `AVAILABLE` in a published property. `moveInDate`: today or later, within ' +
        `${MAX_MOVE_IN_DAYS_AHEAD} days. One pending application per room (a second one → 409, enforced by the database). ` +
        "`occupants` (default 1) must fit the room's `maxOccupants` (→ 400). " +
        'The application expires after `APPLICATION_EXPIRY_DAYS` (default 7). The owner is notified and the tenant ' +
        "gets a confirmation. Approving it rents the room: competing applications are rejected and other tenants' " +
        'open viewings of that room are cancelled.',
    security: authSecurity,
    request: {
        body: jsonBody(
            CreateApplicationValidationZodSchema.meta({
                example: {
                    roomId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6c',
                    moveInDate: '2026-11-01T00:00:00Z',
                    occupants: 2,
                    message: 'I work nearby, non-smoker, can pay rent on the 1st of each month.',
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Application Submitted Successfully', ApplicationSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/application/{id}/status',
    tags: [TAG],
    summary: 'Approve, reject or cancel an application (one endpoint, e.g. a dropdown)',
    description:
        '| status | body | who | effect |\n' +
        '|---|---|---|---|\n' +
        '| `APPROVED` | — | property owner / admin | **In one transaction:** room `AVAILABLE` → `RESERVED`, a `PENDING` rental is created (rent copied from the room, starts on the move-in date), **every other pending application for the room is rejected**, everyone is notified. The rental becomes `ACTIVE` when the first rent is paid |\n' +
        '| `REJECTED` | `rejectionReason?` (shown to the tenant) | property owner / admin | tenant notified |\n' +
        '| `CANCELLED` | `reason?` | **the tenant who applied** | owner notified |\n\n' +
        'Only `PENDING` applications can change (→ 409). An expired application or a room that is no longer available ' +
        "can't be approved (→ 409); if two approvals race for one room, only one wins. Wrong person for the status → 403.",
    security: authSecurity,
    request: {
        params: z.object({ id: z.string() }),
        body: jsonBody(
            UpdateApplicationStatusValidationZodSchema.meta({
                examples: [
                    { status: 'APPROVED' },
                    { status: 'REJECTED', rejectionReason: 'Looking for a longer stay, sorry.' },
                    { status: 'CANCELLED', reason: 'Found another place' },
                ],
            }),
        ),
    },
    responses: {
        200: successResponse(
            'Application Approved: Rental Created And Room Reserved',
            ApplicationSchema,
        ),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'get',
    path: '/application',
    tags: [TAG],
    summary:
        'List applications (TENANT → own, OWNER → for own properties, ADMIN / SUPER_ADMIN → all)',
    description: "The owner sees each applicant's name, photo, phone, gender and occupation.",
    security: authSecurity,
    request: {
        query: z.object({
            status: z.enum(ApplicationStatus).optional(),
            propertyId: z.string().optional(),
            roomId: z.string().optional(),
            ...paginationQueryParams(APPLICATION_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Applications Retrieved Successfully', ApplicationSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/application/{id}',
    tags: [TAG],
    summary: 'Get an application (the tenant, the property owner, or admin)',
    security: authSecurity,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: successResponse('Application Retrieved Successfully', ApplicationSchema),
        ...errorResponses(401, 403, 404),
    },
})
