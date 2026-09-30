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
