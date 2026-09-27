# Domain Model & Business Rules

Derived from [Project Requirements.md](../Project%20Requirements.md). If this file and the requirements disagree,
the requirements win. Update this file when they do.

## Entities (Prisma models)

One `.prisma` file per model in `prisma/schema/`, styled like the example (`@@map("snake_plural")`, `createdAt`/`updatedAt`,
`isDeleted`/`deletedAt` where soft-deletable, relations with `onDelete: Cascade, onUpdate: Cascade` only for true children).

| Model | Key fields | Notes |
|---|---|---|
| `User` | see [auth.md](auth.md#roles-status-user-model) | One table for all roles |
| `Tenant` | userId @unique, name, email @unique, contactNumber?, occupation?, isDeleted | Role profile, like the example's `Patient` |
| `Owner` | userId @unique, name, email @unique, contactNumber?, address?, isDeleted | Role profile, like the example's `Doctor` |
| `RoommateProfile` | tenantId @unique, age, gender, occupation, budgetMin, budgetMax, preferredCity, preferredArea, moveInDate, smoking, pets, sleepSchedule, lifestyle String[], genderPreference, isActive | `isActive` = "roommate search enabled" |
| `Property` | ownerId, title, description, propertyType, address, city, area, amenities String[], images Json? `[{ url, publicId }]`, status, expiresAt?, isDeleted | Images stored like the example's `Doctor.additionalFiles` |
| `Room` | propertyId, name, roomType, monthlyRent Decimal(10,2), maxOccupants, currentOccupants, amenities String[], images Json?, status, availableFrom, description?, isDeleted | |
| `ViewingRequest` | tenantId, propertyId, roomId?, preferredDate, preferredTime, message?, status, scheduledAt?, ownerNote? | |
| `Application` | tenantId, propertyId, roomId, message?, documents Json?, status, expiresAt, reviewedAt?, rejectionReason? | Mirrors the example's `reviewedAt` / `rejectionReason` |
| `Rental` | applicationId @unique, tenantId, ownerId, propertyId, roomId, monthlyRent, startDate, endDate?, status | Rent is a snapshot, so don't read the live `Room.monthlyRent` |
| `Payment` | rentalId, tenantId, amount Decimal(10,2), currency @default("BDT"), paymentGateway @default("stripe"), periodStart, periodEnd, dueDate, status, stripeSessionId? @unique, stripePaymentIntentId? @unique, paidAt?, gatewayResponse Json? | One row per rent period, shaped like the example's `Payment`. `@@unique([rentalId, periodStart])` |
| `Notification` | userId, type (enum), title, message, isRead, readAt? | |
| `AuditLog` | actorId?, actorRole?, action (enum), resource, resourceId, previousData Json?, newData Json?, createdAt | Append-only. `actorId` is null for cron actions |

Add indexes on FKs and common filters (`city`, `area`, `status`, `monthlyRent`), like the example's `@@index(..., name: "idx_...")`.

## Enums (`prisma/schema/enums.prisma`)

```text
Role:              SUPER_ADMIN | ADMIN | OWNER | TENANT
UserStatus:        ACTIVE | BLOCKED | DELETED
AuthProvider:      GOOGLE | CREDENTIAL
Gender:            MALE | FEMALE | OTHER
PropertyType:      APARTMENT | HOUSE | HOSTEL | SUBLET | STUDIO
PropertyStatus:    DRAFT | PUBLISHED | INACTIVE | SUSPENDED | ARCHIVED
RoomType:          SINGLE | SHARED | MASTER | STUDIO
RoomStatus:        AVAILABLE | RESERVED | OCCUPIED | UNAVAILABLE | MAINTENANCE
ViewingStatus:     PENDING | APPROVED | RESCHEDULED | REJECTED | CANCELLED | COMPLETED
ApplicationStatus: PENDING | APPROVED | REJECTED | CANCELLED | EXPIRED
RentalStatus:      PENDING | ACTIVE | COMPLETED | TERMINATED
PaymentStatus:     PENDING | PAID | FAILED | CANCELLED
SleepSchedule:     EARLY_BIRD | NIGHT_OWL | FLEXIBLE
Preference:        YES | NO | NO_PREFERENCE          (smoking, pets)
NotificationType:  VIEWING_REQUESTED | VIEWING_UPDATED | APPLICATION_SUBMITTED | APPLICATION_APPROVED | APPLICATION_REJECTED
                   | APPLICATION_CANCELLED | APPLICATION_EXPIRED | PAYMENT_SUCCESS | PAYMENT_RECEIVED | RENT_DUE
                   | RENTAL_STATUS_CHANGED | ROOM_AVAILABILITY_CHANGED | ACCOUNT_STATUS_CHANGED
AuditAction:       see the Audit section below
```

## State machines

Enforce transitions with guard clauses in the service, the way the example's `updateAppointmentStatus` and `approveDoctor` do
(`if (x.status !== ApplicationStatus.PENDING) throw new AppError(httpStatus.CONFLICT, \`Application Is Already ${status}\`)`).
For contended records, the final write is also conditional (see [Concurrency](#concurrency-pattern-use-everywhere-a-status-gates-a-write)).

**Application**

```text
PENDING → APPROVED   (owner of the property; room must be AVAILABLE)
PENDING → REJECTED   (owner)
PENDING → CANCELLED  (tenant who applied)
PENDING → EXPIRED    (cron only)
```
All other states are terminal.

**Room**

```text
AVAILABLE ↔ UNAVAILABLE / MAINTENANCE    (owner)
AVAILABLE → RESERVED                     (application approved; rental PENDING until first payment)
RESERVED  → OCCUPIED                     (first rent payment PAID → rental ACTIVE)
RESERVED  → AVAILABLE                    (rental terminated before activation)
OCCUPIED  → AVAILABLE                    (rental COMPLETED/TERMINATED)
```
An owner can **never** set OCCUPIED/RESERVED → AVAILABLE by hand while a PENDING/ACTIVE rental exists.

**Rental**: `PENDING → ACTIVE` (first payment), `PENDING → TERMINATED`, `ACTIVE → COMPLETED | TERMINATED`.

**Property**: `DRAFT → PUBLISHED` (owner, needs ≥1 room), `PUBLISHED ↔ INACTIVE` (owner/cron),
`any → SUSPENDED` (admin), `SUSPENDED → PUBLISHED` (admin), `any → ARCHIVED` (owner "remove"; soft delete).
An owner can't archive a property with a PENDING/ACTIVE rental.

**Viewing**: `PENDING → APPROVED | REJECTED | RESCHEDULED`, `RESCHEDULED → APPROVED | CANCELLED`,
`APPROVED → COMPLETED | CANCELLED`, `PENDING → CANCELLED` (tenant).

**Payment**: `PENDING → PAID` **only** from the verified Stripe webhook. `PENDING → FAILED | CANCELLED` via Stripe events.
FAILED/CANCELLED can be retried (a new checkout session), which sets the status back to PENDING.

## Business rules and invariants

1. One active application per tenant per room. Enforce in the service **and** with a partial unique index
   (raw SQL in the migration):
   `CREATE UNIQUE INDEX uniq_active_application ON applications(tenant_id, room_id) WHERE status = 'PENDING';`
2. Apply only to rooms that are `AVAILABLE`, in a `PUBLISHED`, non-deleted property. The tenant can't be the owner.
3. **One PENDING/ACTIVE rental per room.** Partial unique index on `rentals(room_id) WHERE status IN ('PENDING','ACTIVE')`.
   (Interpretation: a rental covers the whole room. `maxOccupants` is informational.)
4. Approving an application must happen atomically in one transaction:
   - `room.updateMany({ where: { id, status: 'AVAILABLE' }, data: { status: 'RESERVED' } })`. If `count === 0`, return 409 "Room is no longer available".
   - `application.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED' } })`. If `count === 0`, return 409.
   - Create a `Rental` (PENDING) and the first `Payment` (PENDING, due = startDate).
   - Set all **other** PENDING applications for that room to REJECTED (reason: "Room was rented to another applicant").
   - Create notifications for the approved and rejected tenants, and write the audit log (same transaction).
   - After commit: send the `application-status` emails (`sendEmail`, in try/catch).
5. `expiresAt = createdAt + APPLICATION_EXPIRY_DAYS` on application create.
6. An approved application always has exactly one rental (`Rental.applicationId @unique`).
7. A PAID `Payment` has a `stripePaymentIntentId`, and Stripe's `amount_total` equalled `amount × 100`.
8. BLOCKED users can't log in. Their `refresh-token:{userId}` is deleted, and their properties are hidden from public search.
9. Users can see only their own private data. Owners see applications/viewings/payments for **their** properties only.

## Concurrency pattern (use everywhere a status gates a write)

Prefer **conditional updates** over "read then write":

```ts
const { count } = await tx.room.updateMany({ where: { id, status: RoomStatus.AVAILABLE }, data: { ... } })
if (count === 0) throw new AppError(httpStatus.CONFLICT, 'Room is no longer available')
```

Use `prisma.$transaction(async (tx) => { ... })` and **only `tx`** inside it. The example sometimes calls `prisma.` inside a
transaction, which is a bug; don't copy it. Pass `tx` into helpers: `AuditServices.createAuditLog(tx, {...})`,
`NotificationServices.createNotification(tx, {...})`. Never call Stripe or send email inside the callback.

## Payments (Stripe)

Same shape as the example's bKash flow (create → redirect → gateway result → mark paid → email with a PDF invoice),
but with Stripe Checkout, and the **webhook** (not the browser redirect) is what marks a payment PAID.
Amounts are `Decimal` taka, and are sent to Stripe as `Math.round(Number(amount) * 100)` in `bdt`.

```text
POST /api/v1/payment/pay-rent/:paymentId   (TENANT who owns it)
  → SET payment-lock:{paymentId} NX EX 30 (409 if held)
  → Payment must be PENDING/FAILED/CANCELLED and its rental not TERMINATED
  → an open, unexpired stripeSessionId → return its URL (no duplicate sessions)
  → stripe.checkout.sessions.create({
        mode: 'payment', customer_email: user.email,
        line_items: [{ price_data: { currency: 'bdt', unit_amount, product_data: { name: 'Rent – <room> – <period>' } }, quantity: 1 }],
        metadata: { paymentId }, client_reference_id: paymentId,
        success_url: `${config.frontend_url}/dashboard/my-payments?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${config.frontend_url}/dashboard/my-payments?status=cancel`,
        expires_at: now + 30 min,
    })
  → update Payment { status: PENDING, stripeSessionId, gatewayResponse: session } → 200 { paymentUrl: session.url }

POST /api/v1/payment/webhook   (Stripe only; raw body; no auth; mounted before express.json())
  → stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe_webhook_secret) → 400 on failure
  → checkout.session.completed with payment_status 'paid' (or checkout.session.async_payment_succeeded):
      amount_total / currency mismatch → Payment FAILED + audit, stop
      prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({ where: { id, status: { not: PaymentStatus.PAID } },
                                                        data: { status: PAID, paidAt, stripePaymentIntentId, gatewayResponse } })
        if (count === 0) return            // duplicate delivery: already processed
        rental PENDING → ACTIVE, room RESERVED → OCCUPIED (first payment only)
        notifications (tenant PAYMENT_SUCCESS, owner PAYMENT_RECEIVED) + audit PAYMENT_COMPLETED
      })
      after commit: pdfkit receipt (the example's invoice code) → sendEmail('payment-success', ..., attachments)
  → checkout.session.async_payment_failed → FAILED + notify the tenant;  checkout.session.expired → CANCELLED
  → respond 200 { received: true } for every verified event, including ignored types

GET /api/v1/payment/my-payments | owner-payments | all-payments | /:paymentId   (example read patterns)
```

Rules: the client never sends an amount (it's always `Payment.amount`). No endpoint sets PAID. Admin payment routes are read-only.

## Roommate matching (`roommate.service.ts`)

1. Candidates come from the DB: other active roommate profiles, same `preferredCity`, overlapping budget, and `tenantId != mine`,
   excluding blocked/deleted users. Limit ~500.
2. Score each candidate in code (0–100, weights as a `const` object at the top of `roommate.service.ts`):

| Factor | Weight | Rule |
|---|---|---|
| Budget | 25 | overlap ratio of `[min,max]` ranges |
| Location | 20 | same area 20, same city 10 |
| Move-in date | 15 | ≤14 days apart 15, ≤30 days 8, else 0 |
| Lifestyle tags | 10 | Jaccard similarity × 10 |
| Smoking | 10 | compatible 10, NO_PREFERENCE 5, conflict 0 |
| Pets | 10 | same as smoking |
| Sleep schedule | 10 | equal 10, one FLEXIBLE 5, else 0 |
| Gender preference | hard filter | exclude if either side's preference is violated |

3. Return a sorted, paginated list with `{ score, breakdown: { budget: 'Compatible', ... } }`.
   Label bands: ≥80% "Highly Compatible", ≥60% "Compatible", ≥40% "Partially Compatible", else "Low".
4. Cache the results in `roommate-matches:{tenantId}` (10 min) and delete that key when the tenant's profile changes.

## Audit actions (`AuditAction` Prisma enum)

`PROPERTY_CREATED, PROPERTY_UPDATED, PROPERTY_PUBLISHED, PROPERTY_ARCHIVED, PROPERTY_SUSPENDED, ROOM_CREATED,
ROOM_STATUS_CHANGED, APPLICATION_SUBMITTED, APPLICATION_APPROVED, APPLICATION_REJECTED, APPLICATION_CANCELLED,
APPLICATION_EXPIRED, RENTAL_CREATED, RENTAL_STATUS_CHANGED, PAYMENT_COMPLETED, PAYMENT_FAILED, USER_BLOCKED,
USER_ACTIVATED, VIEWING_STATUS_CHANGED`
