import z from 'zod'
import { RoomType, ViewingStatus } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { MAX_DAYS_AHEAD, VIEWING_SORTABLE_FIELDS } from './viewing.constant'
import {
    CreateViewingValidationZodSchema,
    UpdateViewingStatusValidationZodSchema,
} from './viewing.validation'

const TAG = 'Viewing'

const personSchema = z.object({
    id: z.string(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    phone: z.string().nullable(),
})

const ViewingRequestSchema = z
    .object({
        id: z.string(),
        status: z.enum(ViewingStatus),
        preferredAt: z.iso.datetime().meta({ description: 'Time the tenant asked for' }),
        scheduledAt: z.iso.datetime().nullable().meta({
            description: 'Confirmed time (preferredAt on approve, the new time on reschedule)',
        }),
        message: z.string().nullable(),
        ownerNote: z.string().nullable(),
        respondedAt: z.iso.datetime().nullable(),
        cancelledAt: z.iso.datetime().nullable(),
        cancellationReason: z.string().nullable(),
        completedAt: z.iso.datetime().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        tenantId: z.string(),
        propertyId: z.string(),
        roomId: z.string().nullable(),
        property: z.object({
            id: z.string(),
            title: z.string(),
            address: z.string(),
            city: z.string(),
            area: z.string(),
            ownerId: z.string(),
            owner: personSchema,
        }),
        room: z
            .object({
                id: z.string(),
                name: z.string(),
                roomType: z.enum(RoomType),
                monthlyRent: z.number().int(),
            })
            .nullable(),
        tenant: personSchema,
    })
    .meta({ id: 'ViewingRequest' })

const idParams = z.object({ id: z.string().meta({ description: 'Viewing request ID' }) })

const lifecycle =
    '`PENDING` → `APPROVED` | `REJECTED` | `RESCHEDULED` (owner/admin) · `APPROVED` | `RESCHEDULED` → `COMPLETED` ' +
    '(owner/admin, after the time) · open → `CANCELLED` (tenant, or automatically if the property, room or an account is removed).'

registry.registerPath({
    method: 'post',
    path: '/viewing',
    tags: [TAG],
    summary: 'Request a viewing (TENANT)',
    description:
        'Ask to see a **published** property, optionally a specific **available** room. `preferredAt` must be in the ' +
        `future, within ${MAX_DAYS_AHEAD} days. One open request per property/room at a time (→ 409). The owner is notified.\n\n` +
        `**Lifecycle:** ${lifecycle}`,
    security: authSecurity,
    request: {
        body: jsonBody(
            CreateViewingValidationZodSchema.meta({
                example: {
                    propertyId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
                    roomId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6c',
                    preferredAt: '2026-11-05T16:00:00+06:00',
                    message: 'Can I come after work? I am interested in the master room.',
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Viewing Requested Successfully', ViewingRequestSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'get',
    path: '/viewing',
    tags: [TAG],
    summary:
        'List viewing requests (TENANT → own, OWNER → for own properties, ADMIN / SUPER_ADMIN → all)',
    description: `Both sides see each other's name, photo and phone to coordinate. **Lifecycle:** ${lifecycle}`,
    security: authSecurity,
    request: {
        query: z.object({
            status: z.enum(ViewingStatus).optional(),
            propertyId: z.string().optional(),
            roomId: z.string().optional(),
            ...paginationQueryParams(VIEWING_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Viewing Requests Retrieved Successfully', ViewingRequestSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/viewing/{id}',
    tags: [TAG],
    summary: 'Get a viewing request (the tenant, the property owner, or admin)',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Viewing Request Retrieved Successfully', ViewingRequestSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/viewing/{id}/status',
    tags: [TAG],
    summary: 'Change a viewing status (one endpoint, e.g. a dropdown)',
    description:
        '**The body depends on the status** (unknown or mismatched fields → 400):\n\n' +
        '| status | body | who | allowed from |\n' +
        '|---|---|---|---|\n' +
        '| `APPROVED` | — | property owner / admin | `PENDING`, and the requested time must still be in the future (sets `scheduledAt` = `preferredAt`) |\n' +
        '| `REJECTED` | `ownerNote?` (shown to the tenant) | property owner / admin | `PENDING` |\n' +
        `| \`RESCHEDULED\` | \`scheduledAt\` (future, ≤ ${MAX_DAYS_AHEAD} days), \`ownerNote?\` | property owner / admin | \`PENDING\`, \`APPROVED\`, \`RESCHEDULED\` (the new time counts as confirmed) |\n` +
        '| `COMPLETED` | — | property owner / admin | `APPROVED`, `RESCHEDULED`, only after `scheduledAt` |\n' +
        '| `CANCELLED` | `reason?` | **the tenant who asked** | `PENDING`, `APPROVED`, `RESCHEDULED` |\n\n' +
        'Wrong person for that status → 403. Not allowed from the current status, or changed by someone else meanwhile → 409. ' +
        'The other side gets a notification.',
    security: authSecurity,
    request: {
        params: idParams,
        body: jsonBody(
            UpdateViewingStatusValidationZodSchema.meta({
                examples: [
                    { status: 'APPROVED' },
                    { status: 'REJECTED', ownerNote: 'The room was just rented, sorry.' },
                    {
                        status: 'RESCHEDULED',
                        scheduledAt: '2026-11-06T11:00:00+06:00',
                        ownerNote: 'I am away that evening.',
                    },
                    { status: 'COMPLETED' },
                    { status: 'CANCELLED', reason: 'Found another place' },
                ],
            }),
        ),
    },
    responses: {
        200: successResponse('Viewing Approved Successfully', ViewingRequestSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})
