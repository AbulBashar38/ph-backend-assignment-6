import { PaymentStatus } from '../../../generated/prisma/enums'

export const PAYMENT_SORTABLE_FIELDS = ['createdAt', 'dueDate', 'paidAt', 'amount'] as const

// A bill in one of these can (still) be paid, as long as its rental is live
export const PAYABLE_STATUSES: PaymentStatus[] = [
    PaymentStatus.PENDING,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
]

// Stripe allows 30 minutes to 24 hours; one extra minute so Stripe never rejects it as too short
export const CHECKOUT_SESSION_MINUTES = 31

// An open session that expires sooner than this is replaced instead of reused
export const MIN_REUSE_MINUTES = 5

// Only one checkout can be started per payment at a time (double clicks, two tabs)
export const CHECKOUT_LOCK_SECONDS = 30
export const checkoutLockKey = (paymentId: string) => `payment-lock:${paymentId}`

// Cron: the next month's bill is created this many days before it's due
export const RENT_BILL_DAYS_AHEAD = 7

// Cron: reminders go out when an unpaid bill is due in this many days (requirement §20: "due in 3 days")
export const RENT_REMINDER_DAYS = [3, 1] as const
export const reminderSentKey = (paymentId: string, daysLeft: number) =>
    `rent-reminder-sent:${paymentId}:${daysLeft}`

// Cron: a checkout this long past its expiry with no webhook result is checked with Stripe directly
export const STALE_SESSION_GRACE_MINUTES = 10
