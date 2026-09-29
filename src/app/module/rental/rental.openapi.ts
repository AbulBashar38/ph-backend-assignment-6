import z from 'zod'
import { RentalStatus, RoomStatus, RoomType } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { RENTAL_SORTABLE_FIELDS } from './rental.constant'
import { UpdateRentalStatusValidationZodSchema } from './rental.validation'

const TAG = 'Rental'

const personSchema = z.object({
    id: z.string(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    phone: z.string().nullable(),
})

const RentalSchema = z
    .object({
        id: z.string(),
        status: z.enum(RentalStatus),
        monthlyRent: z
            .number()
            .int()
            .meta({ description: 'Whole taka, copied from the room at approval', example: 15000 }),
        startDate: z.iso.datetime(),
        endDate: z.iso
            .datetime()
            .nullable()
            .meta({ description: 'Open-ended monthly: set when the rental ends' }),
        activatedAt: z.iso.datetime().nullable(),
        completedAt: z.iso.datetime().nullable(),
        terminatedAt: z.iso.datetime().nullable(),
        terminationReason: z.string().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        applicationId: z.string(),
        tenantId: z.string(),
        ownerId: z.string(),
        propertyId: z.string(),
        roomId: z.string(),
        property: z.object({
            id: z.string(),
            title: z.string(),
            address: z.string(),
            city: z.string(),
            area: z.string(),
        }),
        room: z.object({
            id: z.string(),
            name: z.string(),
            roomType: z.enum(RoomType),
            status: z.enum(RoomStatus),
        }),
        tenant: personSchema,
        owner: personSchema,
        application: z.object({
            id: z.string(),
            moveInDate: z.iso.datetime(),
            createdAt: z.iso.datetime(),
        }),
    })
    .meta({ id: 'Rental' })

const lifecycle =
    '`PENDING` (created when the application is approved; the room is `RESERVED`) → `ACTIVE` (first rent paid; the room ' +
    'is `OCCUPIED`) → `COMPLETED`. `PENDING` / `ACTIVE` → `TERMINATED` (ended early). Ending a rental frees the room.'

registry.registerPath({
    method: 'get',
    path: '/rental',
    tags: [TAG],
    summary: 'List rentals (TENANT → own, OWNER → own properties, ADMIN / SUPER_ADMIN → all)',
    description: `Rental history for both sides. **Lifecycle:** ${lifecycle}`,
    security: authSecurity,
    request: {
        query: z.object({
            status: z.enum(RentalStatus).optional(),
            propertyId: z.string().optional(),
            roomId: z.string().optional(),
            ...paginationQueryParams(RENTAL_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Rentals Retrieved Successfully', RentalSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/rental/{id}',
    tags: [TAG],
    summary: 'Get a rental (the tenant, the owner, or admin)',
    security: authSecurity,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: successResponse('Rental Retrieved Successfully', RentalSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/rental/{id}/status',
    tags: [TAG],
    summary: 'End a rental: complete or terminate (the tenant, the owner, or admin)',
    description:
        '| status | body | allowed from |\n' +
        '|---|---|---|\n' +
        '| `COMPLETED` | — | `ACTIVE` (moved out normally) |\n' +
        '| `TERMINATED` | `reason` (required) | `PENDING`, `ACTIVE` (ended early) |\n\n' +
        'The room goes back to `AVAILABLE` and the other side is notified. Already ended → 409; completing a rental ' +
        `that hasn't started → 409 (terminate it). **Lifecycle:** ${lifecycle}`,
    security: authSecurity,
    request: {
        params: z.object({ id: z.string() }),
        body: jsonBody(
            UpdateRentalStatusValidationZodSchema.meta({
                examples: [
                    { status: 'COMPLETED' },
                    { status: 'TERMINATED', reason: 'Tenant is moving to another city' },
                ],
            }),
        ),
    },
    responses: {
        200: successResponse('Rental Terminated Successfully', RentalSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})
