import { subMonths } from 'date-fns'
import {
    ApplicationStatus,
    PaymentStatus,
    PropertyStatus,
    RentalStatus,
    Role,
    RoomStatus,
    UserStatus,
} from '../../../generated/prisma/enums'
import { prisma } from '../../lib/prisma'
import { REVENUE_MONTHS } from './analytics.constant'

// groupBy rows → { VALUE: count } with every enum value present (0 when none)
const countsBy = <T extends string, K extends string>(
    values: Record<string, T>,
    rows: (Record<K, T> & { _count: { _all: number } })[],
    field: K,
) => {
    const counts = Object.fromEntries(Object.values(values).map((value) => [value, 0])) as Record<
        T,
        number
    >
    for (const row of rows) counts[row[field]] = row._count._all
    return counts
}

// "2026-10" for a date, in Bangladesh time
const monthKey = (date: Date) =>
    date
        .toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' })
        .slice(0, 7)

// Paid revenue per month (Bangladesh time) for the last REVENUE_MONTHS months, oldest first, empty months = 0
const getMonthlyRevenue = async () => {
    const now = new Date()
    const months = Array.from({ length: REVENUE_MONTHS }, (_, index) =>
        monthKey(subMonths(now, REVENUE_MONTHS - 1 - index)),
    )
    // The 1st of the first month, as a Dhaka date (+06:00)
    const since = new Date(`${months[0]}-01T00:00:00+06:00`)

    const rows = await prisma.$queryRaw<{ month: string; revenue: number; count: number }[]>`
        SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') AS month,
               SUM("amount")::int AS revenue,
               COUNT(*)::int AS count
        FROM "payments"
        WHERE "status" = 'PAID' AND "paidAt" >= ${since}
        GROUP BY 1`

    const byMonth = new Map(rows.map((row) => [row.month, row]))
    return months.map((month) => ({
        month,
        revenue: byMonth.get(month)?.revenue ?? 0,
        payments: byMonth.get(month)?.count ?? 0,
    }))
}

/**
 * GET /analytics — platform statistics for admins (requirement §18). Counts live data only (soft-deleted rows are
 * left out). Amounts are whole taka. All counts come from one read-only transaction, so they agree with each other.
 */
const getPlatformStats = async () => {
    const liveUser = { isDeleted: false }
    const liveProperty = { isDeleted: false }
    const liveRoom = { isDeleted: false, property: { isDeleted: false } }

    const [
        usersByRole,
        usersByStatus,
        propertiesByStatus,
        roomsByStatus,
        applicationsByStatus,
        rentalsByStatus,
        paymentsByStatus,
        paidTotals,
    ] = await prisma.$transaction([
        prisma.user.groupBy({
            by: ['role'],
            where: liveUser,
            _count: { _all: true },
            orderBy: { role: 'asc' },
        }),
        prisma.user.groupBy({
            by: ['status'],
            where: liveUser,
            _count: { _all: true },
            orderBy: { status: 'asc' },
        }),
        prisma.property.groupBy({
            by: ['status'],
            where: liveProperty,
            _count: { _all: true },
            orderBy: { status: 'asc' },
        }),
        prisma.room.groupBy({
            by: ['status'],
            where: liveRoom,
            _count: { _all: true },
            orderBy: { status: 'asc' },
        }),
        prisma.application.groupBy({
            by: ['status'],
            _count: { _all: true },
            orderBy: { status: 'asc' },
        }),
        prisma.rental.groupBy({
            by: ['status'],
            _count: { _all: true },
            orderBy: { status: 'asc' },
        }),
        prisma.payment.groupBy({
            by: ['status'],
            _count: { _all: true },
            orderBy: { status: 'asc' },
        }),
        prisma.payment.aggregate({
            where: { status: PaymentStatus.PAID },
            _sum: { amount: true },
            _count: { _all: true },
        }),
    ])

    const roles = countsBy(Role, usersByRole, 'role')
    const userStatuses = countsBy(UserStatus, usersByStatus, 'status')
    const properties = countsBy(PropertyStatus, propertiesByStatus, 'status')
    const rooms = countsBy(RoomStatus, roomsByStatus, 'status')
    const applications = countsBy(ApplicationStatus, applicationsByStatus, 'status')
    const rentals = countsBy(RentalStatus, rentalsByStatus, 'status')
    const payments = countsBy(PaymentStatus, paymentsByStatus, 'status')
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0)

    const monthlyRevenue = await getMonthlyRevenue()

    return {
        users: {
            total: sum(roles),
            tenants: roles.TENANT,
            owners: roles.OWNER,
            admins: roles.ADMIN + roles.SUPER_ADMIN,
            active: userStatuses.ACTIVE,
            blocked: userStatuses.BLOCKED,
        },
        properties: {
            total: sum(properties),
            published: properties.PUBLISHED,
            byStatus: properties,
        },
        rooms: {
            total: sum(rooms),
            available: rooms.AVAILABLE,
            occupied: rooms.OCCUPIED,
            reserved: rooms.RESERVED,
            byStatus: rooms,
        },
        applications: {
            total: sum(applications),
            pending: applications.PENDING,
            byStatus: applications,
        },
        rentals: {
            total: sum(rentals),
            active: rentals.ACTIVE,
            pending: rentals.PENDING,
            byStatus: rentals,
        },
        payments: {
            total: sum(payments),
            paid: paidTotals._count._all,
            unpaid: payments.PENDING + payments.FAILED,
            totalRevenue: paidTotals._sum.amount ?? 0,
            currency: 'BDT',
            byStatus: payments,
            monthlyRevenue,
        },
        generatedAt: new Date(),
    }
}

export const AnalyticsServices = {
    getPlatformStats,
}
