import z from 'zod'
import { PaymentStatus, RentalStatus, RoomType } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { CHECKOUT_SESSION_MINUTES, PAYMENT_SORTABLE_FIELDS } from './payment.constant'

const TAG = 'Payment'

const personSchema = z.object({
    id: z.string(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    phone: z.string().nullable(),
})

const PaymentSchema = z
    .object({
        id: z.string(),
        periodNumber: z.number().int().meta({ description: '1 = the first month', example: 1 }),
        periodStart: z.iso.datetime(),
        periodEnd: z.iso.datetime().meta({ description: 'Exclusive: the next period starts here' }),
        dueDate: z.iso.datetime(),
        amount: z.number().int().meta({ description: 'Whole taka', example: 15000 }),
        currency: z.string().meta({ example: 'BDT' }),
        status: z.enum(PaymentStatus),
        paidAt: z.iso.datetime().nullable(),
        failedAt: z.iso.datetime().nullable(),
        failureReason: z.string().nullable(),
        cancelledAt: z.iso.datetime().nullable(),
        cancellationReason: z.string().nullable(),
        paymentGateway: z.string().meta({ example: 'stripe' }),
        stripeSessionId: z.string().nullable(),
        stripeCheckoutUrl: z
            .string()
            .nullable()
            .meta({ description: 'The open checkout to resume (null once paid/expired)' }),
        stripeSessionExpiresAt: z.iso.datetime().nullable(),
        stripePaymentIntentId: z
            .string()
            .nullable()
            .meta({ description: 'Payment reference (shown on the receipt)' }),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        rentalId: z.string(),
        tenantId: z.string(),
        tenant: personSchema,
        rental: z.object({
            id: z.string(),
            status: z.enum(RentalStatus),
            startDate: z.iso.datetime(),
            monthlyRent: z.number().int(),
            ownerId: z.string(),
            owner: personSchema,
            property: z.object({
                id: z.string(),
                title: z.string(),
                address: z.string(),
                city: z.string(),
                area: z.string(),
            }),
            room: z.object({ id: z.string(), name: z.string(), roomType: z.enum(RoomType) }),
        }),
    })
    .meta({ id: 'Payment' })

const CheckoutSchema = z.object({
    paymentUrl: z.string().meta({
        description: 'Redirect the browser here (Stripe-hosted checkout)',
        example: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3',
    }),
    sessionId: z.string().meta({ example: 'cs_test_a1b2c3' }),
    expiresAt: z.iso.datetime(),
})

const idParams = z.object({ id: z.string().meta({ description: 'Payment ID' }) })

const lifecycle =
    'One bill per rent month. Month 1 is created when the application is approved (due on the start date); ' +
    'paying it activates the rental and the room becomes `OCCUPIED`. `PENDING` → `PAID` **only via the verified ' +
    'Stripe webhook**. `PENDING` → `FAILED` (payment did not go through) or `CANCELLED` (checkout expired): both can be ' +
    'paid again while the rental is live. Ending a rental cancels its unpaid bills.'

registry.registerPath({
    method: 'post',
    path: '/payment/{id}/checkout',
    tags: [TAG],
    summary: 'Pay a rent bill: get a Stripe Checkout URL (TENANT who owes it)',
    description:
        'No body: the amount always comes from the bill. An open checkout for this bill is reused (no duplicate ' +
        `sessions); otherwise a new one is created, valid for ${CHECKOUT_SESSION_MINUTES} minutes. Redirect the browser to ` +
        '`paymentUrl`. Stripe then sends the user to `/dashboard/payments?status=success&session_id=…` (poll ' +
        '`GET /payment/session/{sessionId}` until `PAID`) or `?status=cancelled&payment_id=…`.\n\n' +
        '409: already paid, the rental has ended, a payment is being processed, or another checkout start is in progress. ' +
        `502: Stripe unavailable.\n\n**Lifecycle:** ${lifecycle}`,
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Checkout Session Created Successfully', CheckoutSchema),
        ...errorResponses(401, 403, 404, 409, 502),
    },
})

registry.registerPath({
    method: 'post',
    path: '/payment/webhook',
    tags: [TAG],
    summary: 'Stripe webhook (called by Stripe only)',
    description:
        'Needs a valid `Stripe-Signature` header over the raw body (→ 400 otherwise). Handles ' +
        '`checkout.session.completed` / `async_payment_succeeded` (→ `PAID`, rental `ACTIVE`, receipt email), ' +
        '`async_payment_failed` (→ `FAILED`) and `expired` (→ `CANCELLED`). Duplicate deliveries are ignored; a second ' +
        'payment for a paid bill, a payment for an ended rental, or a wrong amount is refunded automatically. ' +
        'Not callable from Swagger.',
    request: {
        headers: z.object({ 'stripe-signature': z.string() }),
        body: {
            content: {
                'application/json': { schema: z.object({}).meta({ description: 'Stripe event' }) },
            },
        },
    },
    responses: {
        200: successResponse(
            'Webhook Received',
            z.object({ received: z.literal(true), type: z.string() }),
        ),
        ...errorResponses(400),
    },
})

registry.registerPath({
    method: 'get',
    path: '/payment',
    tags: [TAG],
    summary: 'List payments (TENANT → own, OWNER → for own properties, ADMIN / SUPER_ADMIN → all)',
    description: `Payment history. **Lifecycle:** ${lifecycle}`,
    security: authSecurity,
    request: {
        query: z.object({
            status: z.enum(PaymentStatus).optional(),
            rentalId: z.string().optional(),
            propertyId: z.string().optional(),
            tenantId: z.string().optional(),
            ...paginationQueryParams(PAYMENT_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Payments Retrieved Successfully', PaymentSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/payment/session/{sessionId}',
    tags: [TAG],
    summary: 'Get a payment by its Stripe Checkout Session ID (for the success page)',
    description:
        'The webhook may take a few seconds: poll until `status` is `PAID`. Only the tenant, the owner, or an admin.',
    security: authSecurity,
    request: { params: z.object({ sessionId: z.string().meta({ example: 'cs_test_a1b2c3' }) }) },
    responses: {
        200: successResponse('Payment Retrieved Successfully', PaymentSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'get',
    path: '/payment/{id}',
    tags: [TAG],
    summary: 'Get a payment (the tenant, the owner, or admin)',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: successResponse('Payment Retrieved Successfully', PaymentSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'get',
    path: '/payment/{id}/receipt',
    tags: [TAG],
    summary: 'Download the PDF receipt of a paid payment (the tenant, the owner, or admin)',
    description:
        'Not paid yet → 409. The same PDF is emailed to the tenant when the payment succeeds.',
    security: authSecurity,
    request: { params: idParams },
    responses: {
        200: {
            description: 'The receipt',
            content: { 'application/pdf': { schema: z.string().meta({ format: 'binary' }) } },
        },
        ...errorResponses(401, 403, 404, 409),
    },
})
