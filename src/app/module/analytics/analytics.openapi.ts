import z from 'zod'
import {
    ApplicationStatus,
    PaymentStatus,
    PropertyStatus,
    RentalStatus,
    RoomStatus,
} from '../../../generated/prisma/enums'
import { authSecurity, errorResponses, registry, successResponse } from '../../docs/registry'
import { REVENUE_MONTHS } from './analytics.constant'

const TAG = 'Analytics'

const countsFor = (values: Record<string, string>) =>
    z.object(Object.fromEntries(Object.values(values).map((value) => [value, z.number().int()])))

const PlatformStatsSchema = z
    .object({
        users: z.object({
            total: z.number().int().meta({ example: 120 }),
            tenants: z.number().int().meta({ example: 90 }),
            owners: z.number().int().meta({ example: 27 }),
            admins: z.number().int().meta({ description: 'ADMIN + SUPER_ADMIN', example: 3 }),
            active: z.number().int(),
            blocked: z.number().int(),
        }),
        properties: z.object({
            total: z.number().int(),
            published: z.number().int(),
            byStatus: countsFor(PropertyStatus),
        }),
        rooms: z.object({
            total: z.number().int(),
            available: z.number().int(),
            occupied: z.number().int(),
            reserved: z.number().int(),
            byStatus: countsFor(RoomStatus),
        }),
        applications: z.object({
            total: z.number().int(),
            pending: z.number().int(),
            byStatus: countsFor(ApplicationStatus),
        }),
        rentals: z.object({
            total: z.number().int(),
            active: z.number().int(),
            pending: z.number().int(),
            byStatus: countsFor(RentalStatus),
        }),
        payments: z.object({
            total: z.number().int().meta({ description: 'All rent bills' }),
            paid: z.number().int(),
            unpaid: z.number().int().meta({ description: 'PENDING + FAILED' }),
            totalRevenue: z
                .number()
                .int()
                .meta({ description: 'Sum of PAID bills, whole taka', example: 1250000 }),
            currency: z.literal('BDT'),
            byStatus: countsFor(PaymentStatus),
            monthlyRevenue: z
                .array(
                    z.object({
                        month: z.string().meta({ example: '2026-10' }),
                        revenue: z.number().int().meta({ example: 185000 }),
                        payments: z.number().int().meta({ example: 14 }),
                    }),
                )
                .meta({
                    description: `Last ${REVENUE_MONTHS} months (Bangladesh time), oldest first, 0 when none`,
                }),
        }),
        generatedAt: z.iso.datetime(),
    })
    .meta({ id: 'PlatformStats' })

registry.registerPath({
    method: 'get',
    path: '/analytics',
    tags: [TAG],
    summary: 'Platform statistics (ADMIN / SUPER_ADMIN)',
    description:
        'Requirement §18: total users / tenants / owners, properties, rooms (available, occupied), pending applications, ' +
        'active rentals and payments, plus a breakdown by status and paid revenue per month. Soft-deleted users, ' +
        'properties and rooms are not counted.',
    security: authSecurity,
    responses: {
        200: successResponse('Platform Statistics Retrieved Successfully', PlatformStatsSchema),
        ...errorResponses(401, 403),
    },
})

const OwnerStatsSchema = z
    .object({
        properties: PlatformStatsSchema.shape.properties,
        rooms: PlatformStatsSchema.shape.rooms.extend({
            occupancyRate: z.number().int().meta({
                description: 'Occupied + reserved rooms as a share of all rooms, 0–100',
                example: 75,
            }),
        }),
        applications: PlatformStatsSchema.shape.applications,
        rentals: PlatformStatsSchema.shape.rentals,
        payments: PlatformStatsSchema.shape.payments.extend({
            outstanding: z
                .number()
                .int()
                .meta({ description: 'Sum of PENDING + FAILED bills, whole taka', example: 9500 }),
            byProperty: z
                .array(
                    z.object({
                        propertyId: z.string(),
                        title: z.string(),
                        revenue: z.number().int().meta({ example: 57000 }),
                        payments: z.number().int().meta({ example: 6 }),
                    }),
                )
                .meta({
                    description: 'All-time paid revenue per property, highest first (top 10)',
                }),
        }),
        generatedAt: z.iso.datetime(),
    })
    .meta({ id: 'OwnerStats' })

registry.registerPath({
    method: 'get',
    path: '/analytics/owner',
    tags: [TAG],
    summary: "The signed-in owner's earnings and occupancy (OWNER)",
    description:
        'Monthly paid revenue, revenue per property, payment counts by status, outstanding rent, rooms by status ' +
        '(with the occupancy rate), active rentals and pending applications, all limited to the owner’s own listings.',
    security: authSecurity,
    responses: {
        200: successResponse('Owner Statistics Retrieved Successfully', OwnerStatsSchema),
        ...errorResponses(401, 403),
    },
})
