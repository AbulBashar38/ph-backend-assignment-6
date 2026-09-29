import { randomUUID } from 'node:crypto'
import { addDays, addMonths } from 'date-fns'
import httpStatus from 'http-status'
import type Stripe from 'stripe'
import type { Prisma } from '../../../generated/prisma/client'
import {
    AuditAction,
    NotificationType,
    PaymentStatus,
    RentalStatus,
    Role,
    RoomStatus,
} from '../../../generated/prisma/enums'
import type { PaymentWhereInput } from '../../../generated/prisma/models'
import config from '../../config'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import { redisClient } from '../../lib/redis'
import { stripe } from '../../lib/stripe'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { createNotifications } from '../../utils/notification'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { isUniqueViolation } from '../../utils/prismaErrors'
import { isAdminRole } from '../../utils/roles'
import { afterIdFilter, runInBatches } from '../../utils/runInBatches'
import { formatEmailDate, sendEmailSafely } from '../../utils/sendEmail'
import { LIVE_RENTAL_STATUSES } from '../rental/rental.constant'
import {
    CHECKOUT_LOCK_SECONDS,
    CHECKOUT_SESSION_MINUTES,
    checkoutLockKey,
    MIN_REUSE_MINUTES,
    PAYABLE_STATUSES,
    PAYMENT_SORTABLE_FIELDS,
    RENT_BILL_DAYS_AHEAD,
    RENT_REMINDER_DAYS,
    reminderSentKey,
    STALE_SESSION_GRACE_MINUTES,
} from './payment.constant'
import { generatePaymentReceipt } from './payment.receipt'
import { createRentPayment, describePeriod, formatDay, formatTaka } from './payment.utils'
import { PaymentsQueryZodSchema } from './payment.validation'

const RESOURCE = 'Payment'
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

const personSelect = { id: true, name: true, imageUrl: true, phone: true } as const

// gatewayResponse (the raw Stripe session) is kept for admins/debugging but never sent to clients
const paymentOmit = { gatewayResponse: true } as const

const paymentInclude = {
    tenant: { select: personSelect },
    rental: {
        select: {
            id: true,
            status: true,
            startDate: true,
            monthlyRent: true,
            ownerId: true,
            owner: { select: personSelect },
            property: { select: { id: true, title: true, address: true, city: true, area: true } },
            room: { select: { id: true, name: true, roomType: true } },
        },
    },
} satisfies Prisma.PaymentInclude

type TPayment = NonNullable<Awaited<ReturnType<typeof findPaymentOrNull>>>

const findPaymentOrNull = (where: Prisma.PaymentWhereUniqueInput) =>
    prisma.payment.findUnique({ where, include: paymentInclude, omit: paymentOmit })

const findPayment = async (paymentId: string) => {
    const payment = await findPaymentOrNull({ id: paymentId })

    if (!payment) {
        throw new AppError(httpStatus.NOT_FOUND, 'Payment Not Found')
    }

    return payment
}

// The tenant who owes it, the owner of the property, or an admin
const assertCanView = (
    actor: RequestUser,
    payment: { tenantId: string; rental: { ownerId: string } },
) => {
    const allowed =
        isAdminRole(actor.role) ||
        payment.tenantId === actor.userId ||
        payment.rental.ownerId === actor.userId

    if (!allowed) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only View Your Own Payments')
    }
}

const isRentalLive = (status: RentalStatus) => LIVE_RENTAL_STATUSES.includes(status)

const describeRoom = (payment: TPayment) =>
    `${payment.rental.room.name} at "${payment.rental.property.title}"`

// ---------- checkout ----------

type TCheckout = { paymentUrl: string; sessionId: string; expiresAt: Date }

const toCheckout = (session: Stripe.Checkout.Session): TCheckout => ({
    paymentUrl: session.url as string,
    sessionId: session.id,
    expiresAt: new Date(session.expires_at * 1000),
})

// The open session of this payment if it can still be used; null if a new one is needed
const reusableSession = async (payment: TPayment) => {
    if (payment.status !== PaymentStatus.PENDING || !payment.stripeSessionId) return null

    const session = await stripe.checkout.sessions.retrieve(payment.stripeSessionId)

    if (session.status === 'complete') {
        // Paid (or processing) on Stripe; the webhook will update the payment
        throw new AppError(
            httpStatus.CONFLICT,
            'This Payment Is Being Processed. Please Check Again In A Moment',
        )
    }

    if (session.status !== 'open') return null

    const minutesLeft = (session.expires_at * 1000 - Date.now()) / MINUTE_MS
    if (minutesLeft >= MIN_REUSE_MINUTES && session.url) return session

    // About to expire: close it so it can't be paid alongside the new one
    try {
        await stripe.checkout.sessions.expire(session.id)
    } catch {
        const latest = await stripe.checkout.sessions.retrieve(session.id)
        if (latest.status === 'complete') {
            throw new AppError(
                httpStatus.CONFLICT,
                'This Payment Is Being Processed. Please Check Again In A Moment',
            )
        }
    }

    return null
}

/**
 * POST /payment/:id/checkout — the tenant starts (or resumes) paying a bill. The amount always comes from the
 * Payment row. Returns a Stripe Checkout URL; only the webhook marks the payment PAID.
 */
const createCheckoutSession = async (actor: RequestUser, paymentId: string) => {
    const payment = await findPayment(paymentId)

    if (payment.tenantId !== actor.userId) {
        throw new AppError(httpStatus.FORBIDDEN, 'You Can Only Pay Your Own Rent')
    }

    if (payment.status === PaymentStatus.PAID) {
        throw new AppError(httpStatus.CONFLICT, 'Payment Has Already Been Completed')
    }

    if (!isRentalLive(payment.rental.status)) {
        throw new AppError(
            httpStatus.CONFLICT,
            'This Rental Has Ended, So This Bill Can No Longer Be Paid',
        )
    }

    // One checkout start at a time per payment (double clicks, two tabs)
    const lockKey = checkoutLockKey(payment.id)
    const lockToken = randomUUID()
    const locked = await redisClient.set(lockKey, lockToken, {
        condition: 'NX',
        expiration: { type: 'EX', value: CHECKOUT_LOCK_SECONDS },
    })

    if (locked !== 'OK') {
        throw new AppError(
            httpStatus.CONFLICT,
            'A Payment For This Bill Is Already Being Started. Please Wait A Moment',
        )
    }

    try {
        const existing = await reusableSession(payment)
        if (existing) return toCheckout(existing)

        const paymentsPage = `${config.frontend_url}/dashboard/payments`
        let session: Stripe.Checkout.Session

        try {
            session = await stripe.checkout.sessions.create({
                mode: 'payment',
                customer_email: actor.email,
                client_reference_id: payment.id,
                metadata: { paymentId: payment.id, rentalId: payment.rentalId },
                payment_intent_data: {
                    metadata: { paymentId: payment.id, rentalId: payment.rentalId },
                    description: `Rent month ${payment.periodNumber}: ${describeRoom(payment)}`,
                },
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: payment.currency.toLowerCase(),
                            // Stripe amounts are in the smallest unit (poisha)
                            unit_amount: payment.amount * 100,
                            product_data: {
                                name: `Rent: ${payment.rental.room.name}, ${payment.rental.property.title}`,
                                description: `Month ${payment.periodNumber}: ${describePeriod(payment)}`,
                            },
                        },
                    },
                ],
                success_url: `${paymentsPage}?status=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${paymentsPage}?status=cancelled&payment_id=${payment.id}`,
                expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_MINUTES * 60,
            })
        } catch (error) {
            console.error('Stripe checkout session creation failed:', error)
            throw new AppError(
                httpStatus.BAD_GATEWAY,
                'Could Not Start The Payment. Please Try Again',
            )
        }

        const { count } = await prisma.payment.updateMany({
            where: { id: payment.id, status: { in: PAYABLE_STATUSES } },
            data: {
                status: PaymentStatus.PENDING,
                stripeSessionId: session.id,
                stripeCheckoutUrl: session.url,
                stripeSessionExpiresAt: new Date(session.expires_at * 1000),
            },
        })

        if (count === 0) {
            await stripe.checkout.sessions.expire(session.id).catch(() => undefined)
            throw new AppError(httpStatus.CONFLICT, 'Payment Has Already Been Completed')
        }

        return toCheckout(session)
    } finally {
        // Release only our own lock (it may have expired and been taken by another request)
        if ((await redisClient.get(lockKey)) === lockToken) {
            await redisClient.del(lockKey)
        }
    }
}

// ---------- webhook ----------

type TPaymentForSettlement = Prisma.PaymentGetPayload<{
    include: {
        tenant: { select: { id: true; name: true; email: true } }
        rental: {
            include: {
                owner: { select: { id: true; name: true } }
                property: { select: { id: true; title: true; address: true; city: true } }
                room: { select: { id: true; name: true } }
            }
        }
    }
}>

const findPaymentForSession = async (session: Stripe.Checkout.Session) => {
    const paymentId = session.metadata?.paymentId
    // Not one of ours (e.g. another integration on the same Stripe account)
    if (!paymentId) return null

    return prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            tenant: { select: { id: true, name: true, email: true } },
            rental: {
                include: {
                    owner: { select: { id: true, name: true } },
                    property: { select: { id: true, title: true, address: true, city: true } },
                    room: { select: { id: true, name: true } },
                },
            },
        },
    })
}

const paymentIntentIdOf = (session: Stripe.Checkout.Session) =>
    typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null)

const toJson = (session: Stripe.Checkout.Session) =>
    JSON.parse(JSON.stringify(session)) as Prisma.InputJsonValue

// Rolls the settlement transaction back when the money can't be applied to the bill
class SettlementSkipped extends Error {
    constructor(readonly reason: 'already_paid' | 'rental_ended') {
        super(reason)
    }
}

/**
 * Money that can't be applied to the bill (a second paid session, a bill voided because the rental ended, or a
 * wrong amount) goes back to the tenant. Idempotent per PaymentIntent (the charge): Stripe dedupes the refund by
 * key, and it's recorded once.
 */
const refundSession = async (
    payment: TPaymentForSettlement,
    session: Stripe.Checkout.Session,
    reason: string,
) => {
    const paymentIntentId = paymentIntentIdOf(session)
    if (!paymentIntentId) return

    await stripe.refunds.create(
        { payment_intent: paymentIntentId, metadata: { paymentId: payment.id, reason } },
        { idempotencyKey: `refund-${paymentIntentId}` },
    )

    const alreadyRecorded = await prisma.auditLog.count({
        where: {
            action: AuditAction.PAYMENT_REFUNDED,
            resourceId: payment.id,
            newData: { path: ['paymentIntentId'], equals: paymentIntentId },
        },
    })
    if (alreadyRecorded > 0) return

    const amount = (session.amount_total ?? 0) / 100

    await prisma.$transaction(async (tx) => {
        await createNotifications(tx, [
            {
                userId: payment.tenantId,
                type: NotificationType.PAYMENT_REFUNDED,
                title: 'Payment Refunded',
                message: `Your payment of ${formatTaka(amount)} for "${payment.rental.property.title}" was refunded: ${reason}. It may take 5-10 days to reach your account.`,
                data: { paymentId: payment.id, rentalId: payment.rentalId },
            },
        ])

        await createAuditLog(tx, {
            actor: null,
            action: AuditAction.PAYMENT_REFUNDED,
            resource: RESOURCE,
            resourceId: payment.id,
            newData: { stripeSessionId: session.id, paymentIntentId, amount, reason },
        })
    })
}

const sendReceiptEmail = async (
    payment: TPaymentForSettlement,
    paidAt: Date,
    reference: string,
) => {
    const receipt = await generatePaymentReceipt({
        ...payment,
        paidAt,
        stripePaymentIntentId: reference,
        owner: payment.rental.owner,
        property: payment.rental.property,
        room: payment.rental.room,
    })

    await sendEmailSafely({
        to: payment.tenant.email,
        subject: `Payment received: ${formatTaka(payment.amount)} for ${payment.rental.property.title}`,
        templateName: 'payment-success',
        templateData: {
            name: payment.tenant.name,
            amount: formatTaka(payment.amount),
            propertyTitle: payment.rental.property.title,
            roomName: payment.rental.room.name,
            period: `Month ${payment.periodNumber}: ${describePeriod(payment)}`,
            paidAt: formatEmailDate(paidAt),
            reference,
            isFirstPayment: payment.periodNumber === 1,
            moveInDate: formatDay(payment.rental.startDate),
        },
        text: `We received your rent payment of ${formatTaka(payment.amount)} for ${payment.rental.property.title}. Reference: ${reference}.`,
        attachments: [
            {
                filename: `receipt-${payment.id}.pdf`,
                content: receipt,
                contentType: 'application/pdf',
            },
        ],
    })
}

// checkout.session.completed (paid) / async_payment_succeeded
const settlePaidSession = async (session: Stripe.Checkout.Session) => {
    const payment = await findPaymentForSession(session)
    if (!payment) return

    const paymentIntentId = paymentIntentIdOf(session)
    const amountMatches =
        session.amount_total === payment.amount * 100 &&
        session.currency?.toLowerCase() === payment.currency.toLowerCase()

    if (!amountMatches) {
        const failureReason = `Amount mismatch: expected ${payment.amount * 100} ${payment.currency.toLowerCase()}, got ${session.amount_total} ${session.currency}`

        await prisma.$transaction(async (tx) => {
            const { count } = await tx.payment.updateMany({
                where: { id: payment.id, status: { not: PaymentStatus.PAID } },
                data: { status: PaymentStatus.FAILED, failedAt: new Date(), failureReason },
            })

            if (count > 0) {
                await createAuditLog(tx, {
                    actor: null,
                    action: AuditAction.PAYMENT_FAILED,
                    resource: RESOURCE,
                    resourceId: payment.id,
                    previousData: { status: payment.status },
                    newData: {
                        status: PaymentStatus.FAILED,
                        failureReason,
                        stripeSessionId: session.id,
                    },
                })
            }
        })

        await refundSession(payment, session, 'the amount did not match the bill')
        return
    }

    const paidAt = new Date()

    try {
        await prisma.$transaction(async (tx) => {
            // Lock the rental row first (ending a rental does the same), so the two can't interleave
            const activated = await tx.rental.updateMany({
                where: { id: payment.rentalId, status: RentalStatus.PENDING },
                data: { status: RentalStatus.ACTIVE, activatedAt: paidAt },
            })

            if (activated.count === 0) {
                const stillActive = await tx.rental.updateMany({
                    where: { id: payment.rentalId, status: RentalStatus.ACTIVE },
                    data: { status: RentalStatus.ACTIVE },
                })
                if (stillActive.count === 0) throw new SettlementSkipped('rental_ended')
            }

            const paid = await tx.payment.updateMany({
                where: { id: payment.id, status: { in: PAYABLE_STATUSES } },
                data: {
                    status: PaymentStatus.PAID,
                    paidAt,
                    stripeSessionId: session.id,
                    stripePaymentIntentId: paymentIntentId,
                    stripeCheckoutUrl: null,
                    gatewayResponse: toJson(session),
                },
            })

            if (paid.count === 0) throw new SettlementSkipped('already_paid')

            // The tenant moves in: the reserved room becomes occupied
            if (activated.count > 0) {
                await tx.room.updateMany({
                    where: { id: payment.rental.roomId, status: RoomStatus.RESERVED },
                    data: { status: RoomStatus.OCCUPIED },
                })
            }

            const place = `${payment.rental.room.name} at "${payment.rental.property.title}"`
            const data = { paymentId: payment.id, rentalId: payment.rentalId }

            await createNotifications(tx, [
                {
                    userId: payment.tenantId,
                    type: NotificationType.PAYMENT_SUCCESS,
                    title: 'Payment Successful',
                    message: `Your rent of ${formatTaka(payment.amount)} for ${place} (${describePeriod(payment)}) was paid.${activated.count > 0 ? ' Your rental is now active.' : ''}`,
                    data,
                },
                {
                    userId: payment.rental.ownerId,
                    type: NotificationType.PAYMENT_RECEIVED,
                    title: 'Payment Received',
                    message: `${payment.tenant.name} paid ${formatTaka(payment.amount)} rent for ${place} (${describePeriod(payment)}).`,
                    data,
                },
            ])

            await createAuditLog(tx, {
                actor: null,
                action: AuditAction.PAYMENT_COMPLETED,
                resource: RESOURCE,
                resourceId: payment.id,
                previousData: { status: payment.status, rentalStatus: payment.rental.status },
                newData: {
                    status: PaymentStatus.PAID,
                    amount: payment.amount,
                    stripeSessionId: session.id,
                    paymentIntentId,
                    rentalStatus: RentalStatus.ACTIVE,
                    ...(activated.count > 0 ? { roomStatus: RoomStatus.OCCUPIED } : {}),
                },
            })
        })
    } catch (error) {
        if (!(error instanceof SettlementSkipped)) throw error

        if (error.reason === 'rental_ended') {
            await refundSession(payment, session, 'the rental had already ended')
            return
        }

        // Already PAID: the same event delivered again (nothing to do), or a second session paid the same bill
        const current = await prisma.payment.findUnique({
            where: { id: payment.id },
            select: { stripeSessionId: true },
        })
        if (current?.stripeSessionId !== session.id) {
            await refundSession(payment, session, 'this bill was already paid')
        }
        return
    }

    // After the commit
    await sendReceiptEmail(payment, paidAt, paymentIntentId ?? session.id)
}

// checkout.session.async_payment_failed (e.g. a bank debit bounced)
const markSessionFailed = async (session: Stripe.Checkout.Session) => {
    const payment = await findPaymentForSession(session)
    if (!payment) return

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
            where: { id: payment.id, status: PaymentStatus.PENDING, stripeSessionId: session.id },
            data: {
                status: PaymentStatus.FAILED,
                failedAt: new Date(),
                failureReason: 'The payment did not go through',
                stripeCheckoutUrl: null,
            },
        })
        if (count === 0) return

        await createNotifications(tx, [
            {
                userId: payment.tenantId,
                type: NotificationType.PAYMENT_FAILED,
                title: 'Payment Failed',
                message: `Your rent payment of ${formatTaka(payment.amount)} for "${payment.rental.property.title}" did not go through. Please try again.`,
                data: { paymentId: payment.id, rentalId: payment.rentalId },
            },
        ])

        await createAuditLog(tx, {
            actor: null,
            action: AuditAction.PAYMENT_FAILED,
            resource: RESOURCE,
            resourceId: payment.id,
            previousData: { status: PaymentStatus.PENDING },
            newData: { status: PaymentStatus.FAILED, stripeSessionId: session.id },
        })
    })
}

// checkout.session.expired: the tenant left the checkout unpaid. The rent is still due; they can pay again.
const markSessionExpired = async (session: Stripe.Checkout.Session) => {
    const payment = await findPaymentForSession(session)
    if (!payment) return

    await prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING, stripeSessionId: session.id },
        data: {
            status: PaymentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: 'The checkout expired before the payment was made',
            stripeCheckoutUrl: null,
        },
    })
}

/**
 * POST /payment/webhook — called by Stripe only. The signature proves the event is from Stripe; everything else
 * (amount, currency, which bill) is checked against the database. Safe to receive the same event many times.
 * Throwing here → 500 → Stripe retries later.
 */
const handleStripeWebhook = async (rawBody: unknown, signature: string | undefined) => {
    if (!Buffer.isBuffer(rawBody) || !signature) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Invalid Stripe Webhook Request')
    }

    let event: Stripe.Event
    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe_webhook_secret)
    } catch {
        throw new AppError(httpStatus.BAD_REQUEST, 'Invalid Stripe Signature')
    }

    switch (event.type) {
        case 'checkout.session.completed':
            // 'unpaid' = an async method (bank debit) still processing: wait for async_payment_succeeded/failed
            if (event.data.object.payment_status === 'paid') {
                await settlePaidSession(event.data.object)
            }
            break
        case 'checkout.session.async_payment_succeeded':
            await settlePaidSession(event.data.object)
            break
        case 'checkout.session.async_payment_failed':
            await markSessionFailed(event.data.object)
            break
        case 'checkout.session.expired':
            await markSessionExpired(event.data.object)
            break
        default:
            // Other event types are acknowledged and ignored
            break
    }

    return { received: true, type: event.type }
}

// ---------- read ----------

// Role-scoped: TENANT → own bills, OWNER → bills of their rentals, admins → all
const getPayments = async (actor: RequestUser, query: IQuery) => {
    const filters = PaymentsQueryZodSchema.parse(query)
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        PAYMENT_SORTABLE_FIELDS,
        'createdAt',
    )

    const scope: PaymentWhereInput =
        actor.role === Role.TENANT
            ? { tenantId: actor.userId }
            : actor.role === Role.OWNER
              ? { rental: { ownerId: actor.userId } }
              : {}

    const where: PaymentWhereInput = {
        AND: [
            scope,
            ...(filters.status ? [{ status: filters.status }] : []),
            ...(filters.rentalId ? [{ rentalId: filters.rentalId }] : []),
            ...(filters.propertyId ? [{ rental: { propertyId: filters.propertyId } }] : []),
            ...(filters.tenantId ? [{ tenantId: filters.tenantId }] : []),
        ],
    }

    const [data, total] = await prisma.$transaction([
        prisma.payment.findMany({
            where,
            include: paymentInclude,
            omit: paymentOmit,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        }),
        prisma.payment.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

const getPaymentById = async (actor: RequestUser, paymentId: string) => {
    const payment = await findPayment(paymentId)
    assertCanView(actor, payment)
    return payment
}

// For the frontend's success page (?session_id=…). May still be PENDING for a few seconds until the webhook lands.
const getPaymentBySessionId = async (actor: RequestUser, sessionId: string) => {
    const payment = await findPaymentOrNull({ stripeSessionId: sessionId })

    if (!payment) {
        throw new AppError(httpStatus.NOT_FOUND, 'Payment Not Found')
    }

    assertCanView(actor, payment)
    return payment
}

// GET /payment/:id/receipt — PDF, only for PAID payments
const getPaymentReceipt = async (actor: RequestUser, paymentId: string) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            tenant: { select: { name: true, email: true } },
            rental: {
                select: {
                    ownerId: true,
                    owner: { select: { name: true } },
                    property: { select: { title: true, address: true, city: true } },
                    room: { select: { name: true } },
                },
            },
        },
    })

    if (!payment) {
        throw new AppError(httpStatus.NOT_FOUND, 'Payment Not Found')
    }

    assertCanView(actor, payment)

    if (payment.status !== PaymentStatus.PAID || !payment.paidAt) {
        throw new AppError(httpStatus.CONFLICT, 'A Receipt Is Only Available For A Paid Payment')
    }

    const pdf = await generatePaymentReceipt({
        ...payment,
        paidAt: payment.paidAt,
        owner: payment.rental.owner,
        property: payment.rental.property,
        room: payment.rental.room,
    })

    return { pdf, filename: `receipt-${payment.id}.pdf` }
}

// ---------- cron ----------

/**
 * Cron (daily): for every ACTIVE rental, create each next month's bill once it's due within RENT_BILL_DAYS_AHEAD days
 * (catches up if the server was down). Safe to re-run: `@@unique([rentalId, periodStart])` refuses duplicates.
 */
const generateRentDues = () => {
    const horizon = addDays(new Date(), RENT_BILL_DAYS_AHEAD)

    return runInBatches(
        (afterId, take) =>
            prisma.rental.findMany({
                where: { status: RentalStatus.ACTIVE, ...afterIdFilter(afterId) },
                select: {
                    id: true,
                    tenantId: true,
                    monthlyRent: true,
                    startDate: true,
                    property: { select: { title: true } },
                    room: { select: { name: true } },
                    payments: {
                        select: { periodNumber: true },
                        orderBy: { periodNumber: 'desc' },
                        take: 1,
                    },
                },
                orderBy: { id: 'asc' },
                take,
            }),
        async (rentals) => {
            let created = 0

            for (const rental of rentals) {
                let periodNumber = (rental.payments[0]?.periodNumber ?? 0) + 1

                while (addMonths(rental.startDate, periodNumber - 1) <= horizon) {
                    try {
                        const bill = await prisma.$transaction(async (tx) => {
                            // Lock the rental row (like ending a rental does) and make sure it's still ACTIVE
                            const { count } = await tx.rental.updateMany({
                                where: { id: rental.id, status: RentalStatus.ACTIVE },
                                data: { status: RentalStatus.ACTIVE },
                            })
                            if (count === 0) return null

                            const payment = await createRentPayment(tx, rental, periodNumber)

                            await createNotifications(tx, [
                                {
                                    userId: rental.tenantId,
                                    type: NotificationType.RENT_BILL_CREATED,
                                    title: 'New Rent Bill',
                                    message: `Your rent of ${formatTaka(payment.amount)} for ${rental.room.name} at "${rental.property.title}" (${describePeriod(payment)}) is due on ${formatDay(payment.dueDate)}.`,
                                    data: { paymentId: payment.id, rentalId: rental.id },
                                },
                            ])

                            return payment
                        })

                        if (!bill) break
                        created++
                    } catch (error) {
                        // Another instance created this bill a moment ago
                        if (!isUniqueViolation(error)) throw error
                    }
                    periodNumber++
                }
            }

            return created
        },
    )
}

/**
 * Cron (daily, morning): an unpaid bill of a live rental due in 3 days or 1 day → notification + email
 * ("Your rent payment of ৳15,000 is due in 3 days"). Each reminder is sent once (Redis key, 7 days).
 */
const sendRentReminders = () => {
    const now = new Date()
    const latestDue = addDays(now, Math.max(...RENT_REMINDER_DAYS))

    return runInBatches(
        (afterId, take) =>
            prisma.payment.findMany({
                where: {
                    status: { in: PAYABLE_STATUSES },
                    dueDate: { gt: now, lte: latestDue },
                    rental: { status: { in: LIVE_RENTAL_STATUSES } },
                    ...afterIdFilter(afterId),
                },
                include: {
                    tenant: { select: { name: true, email: true, isDeleted: true } },
                    rental: {
                        select: {
                            property: { select: { title: true } },
                            room: { select: { name: true } },
                        },
                    },
                },
                orderBy: { id: 'asc' },
                take,
            }),
        async (bills) => {
            let reminded = 0

            for (const bill of bills) {
                // Due at midnight; the job runs in the morning, so "2.6 days away" counts as 3
                const daysLeft = Math.ceil((bill.dueDate.getTime() - now.getTime()) / DAY_MS)
                if (!(RENT_REMINDER_DAYS as readonly number[]).includes(daysLeft)) continue
                if (bill.tenant.isDeleted) continue

                const key = reminderSentKey(bill.id, daysLeft)
                const claimed = await redisClient.set(key, '1', {
                    condition: 'NX',
                    expiration: { type: 'EX', value: 7 * 24 * 60 * 60 },
                })
                if (claimed !== 'OK') continue

                const amount = formatTaka(bill.amount)
                const dueDate = formatDay(bill.dueDate)
                const place = `${bill.rental.room.name} at "${bill.rental.property.title}"`
                const dueIn = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`

                try {
                    await prisma.$transaction((tx) =>
                        createNotifications(tx, [
                            {
                                userId: bill.tenantId,
                                type: NotificationType.RENT_DUE,
                                title: 'Rent Due Soon',
                                message: `Your rent payment of ${amount} for ${place} is due ${dueIn} (${dueDate}).`,
                                data: { paymentId: bill.id, rentalId: bill.rentalId },
                            },
                        ]),
                    )
                } catch (error) {
                    // Let the next run try again
                    await redisClient.del(key)
                    throw error
                }

                await sendEmailSafely({
                    to: bill.tenant.email,
                    subject: `Rent due ${dueIn}: ${amount}`,
                    templateName: 'rent-reminder',
                    templateData: {
                        name: bill.tenant.name,
                        amount,
                        dueDate,
                        daysLeft,
                        propertyTitle: bill.rental.property.title,
                        roomName: bill.rental.room.name,
                        period: `Month ${bill.periodNumber}: ${describePeriod(bill)}`,
                    },
                    text: `Your rent payment of ${amount} for ${place} is due ${dueIn} (${dueDate}).`,
                })

                reminded++
            }

            return reminded
        },
    )
}

/**
 * Cron (every 15 minutes): a safety net for missed webhooks. PENDING bills whose checkout expired a while ago are
 * checked with Stripe's API (server to server, with our secret key) and get the same handling the webhook would give.
 */
const reconcileStalePayments = () => {
    const cutoff = new Date(Date.now() - STALE_SESSION_GRACE_MINUTES * MINUTE_MS)

    return runInBatches(
        (afterId, take) =>
            prisma.payment.findMany({
                where: {
                    status: PaymentStatus.PENDING,
                    stripeSessionId: { not: null },
                    stripeSessionExpiresAt: { lte: cutoff },
                    ...afterIdFilter(afterId),
                },
                select: { id: true, stripeSessionId: true },
                orderBy: { id: 'asc' },
                take,
            }),
        async (bills) => {
            let reconciled = 0

            for (const bill of bills) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(
                        bill.stripeSessionId as string,
                    )

                    if (session.status === 'complete' && session.payment_status === 'paid') {
                        await settlePaidSession(session)
                        reconciled++
                    } else if (session.status === 'expired') {
                        await markSessionExpired(session)
                        reconciled++
                    }
                    // 'complete' + 'unpaid' = a bank debit still processing: its webhook will come
                } catch (error) {
                    // One bad session must not stop the rest
                    console.error(`Reconcile: payment ${bill.id} failed:`, error)
                }
            }

            return reconciled
        },
    )
}

export const PaymentServices = {
    createCheckoutSession,
    handleStripeWebhook,
    getPayments,
    getPaymentById,
    getPaymentBySessionId,
    getPaymentReceipt,
    generateRentDues,
    sendRentReminders,
    reconcileStalePayments,
}
