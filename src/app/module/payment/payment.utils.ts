import { addMonths, subDays } from 'date-fns'
import type { Prisma } from '../../../generated/prisma/client'
import { PaymentStatus } from '../../../generated/prisma/enums'
import { stripe } from '../../lib/stripe'
import { PAYABLE_STATUSES } from './payment.constant'

// e.g. "৳15,000" (emails, notifications). PDFs use "BDT 15,000": the built-in PDF fonts have no ৳ glyph.
export const formatTaka = (amount: number) => `৳${amount.toLocaleString('en-US')}`

// e.g. "1 Oct 2026", in Bangladesh time
export const formatDay = (date: Date) =>
    date.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' })

// periodEnd is exclusive, so the last day shown is the day before it
export const describePeriod = (payment: { periodStart: Date; periodEnd: Date }) =>
    `${formatDay(payment.periodStart)} – ${formatDay(subDays(payment.periodEnd, 1))}`

/**
 * The bill for month `periodNumber` (1 = the first month) of a rental. Periods are counted from the start date
 * (not chained), so a rental starting on the 31st doesn't drift to the 28th after February.
 */
export const createRentPayment = (
    tx: Prisma.TransactionClient,
    rental: { id: string; tenantId: string; monthlyRent: number; startDate: Date },
    periodNumber: number,
) => {
    const periodStart = addMonths(rental.startDate, periodNumber - 1)

    return tx.payment.create({
        data: {
            rentalId: rental.id,
            tenantId: rental.tenantId,
            periodNumber,
            periodStart,
            periodEnd: addMonths(rental.startDate, periodNumber),
            // Rent is paid in advance: due on the first day of the period
            dueDate: periodStart,
            amount: rental.monthlyRent,
        },
    })
}

/**
 * When a rental ends, its unpaid bills are void. Returns the Checkout Sessions to close AFTER the commit
 * (with `expireCheckoutSessions`). If one gets paid anyway, the webhook refunds it (the rental is no longer live).
 */
export const cancelUnpaidPayments = async (
    tx: Prisma.TransactionClient,
    rentalId: string,
    reason: string,
) => {
    const unpaid = await tx.payment.findMany({
        where: { rentalId, status: { in: PAYABLE_STATUSES } },
        select: { id: true, stripeSessionId: true },
    })

    if (unpaid.length > 0) {
        await tx.payment.updateMany({
            where: { id: { in: unpaid.map((payment) => payment.id) } },
            data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
                cancellationReason: reason,
                stripeCheckoutUrl: null,
            },
        })
    }

    return {
        count: unpaid.length,
        sessionIds: unpaid.flatMap((payment) =>
            payment.stripeSessionId ? [payment.stripeSessionId] : [],
        ),
    }
}

// Best effort: a session that is already expired/complete makes Stripe throw, which is fine
export const expireCheckoutSessions = async (sessionIds: string[]) => {
    await Promise.all(
        sessionIds.map((sessionId) =>
            stripe.checkout.sessions.expire(sessionId).catch(() => undefined),
        ),
    )
}
