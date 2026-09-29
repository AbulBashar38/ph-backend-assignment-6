# Domain Model & Business Rules

Derived from [Project Requirements.md](../Project%20Requirements.md). If this file and the requirements disagree,
the requirements win. Update this file when they do.

## Entities (Prisma models)

One `.prisma` file per model in `prisma/schema/`, styled like the example (`@@map("snake_plural")`, `createdAt`/`updatedAt`,
`isDeleted`/`deletedAt` where soft-deletable, relations with `onDelete: Cascade, onUpdate: Cascade` only for true children).

**Every `tenantId` / `ownerId` below is a `User.id`** (a user with role TENANT / OWNER). The database can't enforce the
role, so services check it (e.g. `findActiveOwner` in `property.service.ts`).

| Model | Key fields | Notes |
|---|---|---|
| `User` | see [auth.md](auth.md#roles-status-user-model); plus `gender?`, `occupation?` (tenants), `address?` (owners) | **One table for all roles, no Tenant/Owner profile tables** |
| `RoommateProfile` | tenantId @unique (user id), age, budgetMin, budgetMax (whole taka), preferredCity, preferredArea?, moveInDate, smokingPreference, petPreference (`Preference`), sleepSchedule, lifestyle `LifestyleTag[]`, genderPreference? (null = any), bio?, isActive | **Implemented.** One per tenant, never deleted: `isActive` = roommate search on/off (account deletion turns it off). Gender and occupation live on `User` and can be sent with the profile |
| `Property` | ownerId, title, description, propertyType, address, city, area, latitude?, longitude?, amenities `Amenity[]`, status, publishedAt?, expiresAt?, moderationNote?, moderatedAt?, isDeleted, deletedAt | **Implemented.** Photos live in `PropertyImage` |
| `PropertyImage` | propertyId, url, publicId, createdAt | **Implemented.** Max 20 per property; rows are file references, so removing a photo deletes the row (not a soft delete) |
| `Room` | propertyId, name, roomType, monthlyRent **Int (whole taka)**, maxOccupants, description?, amenities `Amenity[]`, availableFrom?, status, isDeleted, deletedAt | **Implemented.** One tenant rents the **whole room**; `maxOccupants` is information only. Name unique among the property's live rooms |
| `RoomImage` | roomId, url, publicId, createdAt | **Implemented.** Max 10 per room |
| `ViewingRequest` | tenantId, propertyId, roomId?, preferredAt, message?, status, scheduledAt?, ownerNote?, respondedAt?, cancelledAt?, cancellationReason?, completedAt? | **Implemented.** Never deleted, only changes status. One open request per tenant per property/room |
| `Application` | tenantId, propertyId, roomId, moveInDate, message?, status, expiresAt, reviewedAt?, rejectionReason?, cancelledAt?, cancellationReason?, pendingKey? @unique | **Implemented.** Never deleted. `pendingKey` = `tenantId:roomId` while PENDING (null after), so the database refuses a second pending application |
| `Rental` | applicationId @unique, tenantId, ownerId, propertyId, roomId, monthlyRent (Int snapshot), startDate, endDate?, status, activatedAt?, completedAt?, terminatedAt?, terminationReason?, liveRoomKey? @unique | **Implemented.** Open-ended monthly, never deleted. `liveRoomKey` = roomId while PENDING/ACTIVE, so the database refuses two live rentals for one room |
| `Payment` | rentalId, tenantId, periodNumber, periodStart, periodEnd (exclusive), dueDate, amount **Int (whole taka)**, currency @default("BDT"), status, paidAt?, failedAt?, failureReason?, cancelledAt?, cancellationReason?, paymentGateway @default("stripe"), stripeSessionId? @unique, stripeCheckoutUrl?, stripeSessionExpiresAt?, stripePaymentIntentId? @unique (the payment reference), gatewayResponse Json? (never returned) | **Implemented.** One row per rent month, never deleted. `@@unique([rentalId, periodStart])` |
| `Notification` | userId, type (`NotificationType`), title, message, data Json? (ids to link to), isRead, readAt? | **Implemented.** Created with `createNotifications(tx, [...])` (`utils/notification.ts`) in the event's transaction |
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
Preference:        YES | NO | NO_PREFERENCE          (smoking, pets: "I do / fine with it", "please no", "don't mind")
LifestyleTag:      QUIET | SOCIAL | CLEAN | STUDIOUS | WORK_FROM_HOME | FITNESS | COOKING | GAMING | MUSIC | VEGETARIAN
                   | RELIGIOUS | PARTY
NotificationType:  (in the enum now) VIEWING_REQUESTED | VIEWING_APPROVED | VIEWING_REJECTED | VIEWING_RESCHEDULED
                   | VIEWING_CANCELLED | VIEWING_COMPLETED | APPLICATION_SUBMITTED | APPLICATION_APPROVED
                   | APPLICATION_REJECTED | APPLICATION_CANCELLED | RENTAL_STATUS_CHANGED | PAYMENT_SUCCESS
                   | PAYMENT_RECEIVED | PAYMENT_FAILED | PAYMENT_REFUNDED; (planned) APPLICATION_EXPIRED | RENT_DUE
                   | ROOM_AVAILABILITY_CHANGED | ACCOUNT_STATUS_CHANGED
AuditAction:       see the Audit section below
```

## State machines

Enforce transitions with guard clauses in the service, the way the example's `updateAppointmentStatus` and `approveDoctor` do
(`if (x.status !== ApplicationStatus.PENDING) throw new AppError(httpStatus.CONFLICT, \`Application Is Already ${status}\`)`).
For contended records, the final write is also conditional (see [Concurrency](#concurrency-pattern-use-everywhere-a-status-gates-a-write)).

**Application** (implemented in `ApplicationServices`; all changes via `PATCH /application/:id/status`):

```text
(tenant)  → PENDING     AVAILABLE room of a public property; move-in today..+180 days; expiresAt = now + APPLICATION_EXPIRY_DAYS
PENDING   → APPROVED    property owner / admin; not expired; room still AVAILABLE (see rule 4 below)
PENDING   → REJECTED    property owner / admin (optional rejectionReason), or automatically when a competitor is approved
PENDING   → CANCELLED   the tenant (optional reason), or automatically when the room/property/an account is removed
PENDING   → EXPIRED     cron (TODO); until then an expired application simply can't be approved
```

**Room** (implemented in `RoomServices`; conditional updates + audit log):

```text
AVAILABLE ↔ UNAVAILABLE ↔ MAINTENANCE     owner of the property or any admin (PATCH /room/:id/status)
AVAILABLE → RESERVED                      system only: application approved (rental PENDING until first payment)
RESERVED  → OCCUPIED                      system only: first rent payment PAID → rental ACTIVE
RESERVED  → AVAILABLE                     system only: rental terminated before activation
OCCUPIED  → AVAILABLE                     system only: rental COMPLETED / TERMINATED
```

`RESERVED` / `OCCUPIED` rooms can't be changed by hand (409), can't be removed, and block archiving their property
and deleting their owner's account. Removing a room = soft delete (`isDeleted`, status `UNAVAILABLE`); the last live room
of a `PUBLISHED` property can't be removed. Public room search shows only `AVAILABLE` rooms of publicly visible properties;
an amenity filter matches if the amenity is on the room **or** its property.

**Rental** (implemented in `RentalServices`; created only by approving an application; ended via `PATCH /rental/:id/status`
by the tenant, the owner or an admin):

```text
PENDING → ACTIVE       first rent payment PAID (payments module; room RESERVED → OCCUPIED)
ACTIVE  → COMPLETED    moved out normally
PENDING | ACTIVE → TERMINATED   ended early, reason required
```

Ending a rental releases `liveRoomKey`, sets `endDate`, puts the room back to `AVAILABLE` and notifies the other side.

**Property** (implemented in `PropertyServices`; every change is a conditional `updateMany` + audit log):

```text
DRAFT | INACTIVE → PUBLISHED      owner/admin: needs ≥1 image, ≥1 room, expiresAt (if set) in the future
PUBLISHED        → INACTIVE       owner "disable" (later also cron when expiresAt passes)
any live status  → SUSPENDED      admin, with a reason (moderationNote); the owner can't publish it
SUSPENDED        → INACTIVE       admin "restore"; the owner reviews and re-publishes
any live status  → ARCHIVED       owner "remove" = soft delete (isDeleted); read-only afterwards
```

Public visibility = `PUBLISHED` + not deleted + not expired + owner account `ACTIVE` and not deleted.
**Who may do what:** ADMIN / SUPER_ADMIN can do **everything** with any property (create on behalf of an owner with a
required `ownerId`, edit, publish, disable, add/remove photos, archive), plus suspend / restore, which owners can't.
Owners can do everything except moderation, only on their own properties. An admin may publish a SUSPENDED listing
directly (clears the note); an owner can't. Rules that protect data apply to everyone: ≥1 image to publish, the last
image of a published listing stays, archived listings are read-only. Every admin action is audited with the admin as actor.
The last image of a `PUBLISHED` property can't be removed. Archiving a property removes its rooms too, and is refused
while any room is `RESERVED`/`OCCUPIED`. Public property search can filter by room (`minRent`, `maxRent`, `roomType`,
`occupants`): a property matches if at least one `AVAILABLE` room fits.

**Viewing** (implemented in `ViewingServices`; all changes go through `PATCH /viewing/:id/status`; every change is a
conditional `updateMany` + a notification):

```text
(tenant)            → PENDING        published property; room (optional) must be AVAILABLE; time in the future, ≤ 90 days
PENDING             → APPROVED       owner/admin; the requested time must still be in the future; scheduledAt = preferredAt
PENDING             → REJECTED       owner/admin, optional ownerNote shown to the tenant
PENDING | APPROVED | RESCHEDULED → RESCHEDULED   owner/admin, new scheduledAt (counts as confirmed)
APPROVED | RESCHEDULED → COMPLETED   owner/admin, only after scheduledAt
PENDING | APPROVED | RESCHEDULED → CANCELLED     tenant; or automatically when the room/property is removed or
                                                  either account is deleted (the other side is notified)
```

**Payment**: `PENDING → PAID` **only** from the verified Stripe webhook. `PENDING → FAILED` (async payment failed) or
`CANCELLED` (checkout expired) via Stripe events. While the rental is live, FAILED/CANCELLED can be retried (a new
checkout session sets the status back to PENDING). When the rental ends, unpaid bills become CANCELLED for good.

## Soft delete (applies to every delete)

Requirement §24: important records must never disappear. So **nothing is ever hard-deleted** by the API or by cron.

**Every "delete" endpoint must:**

1. Set `isDeleted: true` and `deletedAt: new Date()` (plus `status` = `DELETED`/`ARCHIVED` if the model has a status).
2. Soft-delete / archive dependent records in the **same transaction** (e.g. a deleted owner → their properties archived).
3. Be idempotent-safe: an already-deleted record is "not found" (404/401), never deleted twice.
4. Leave history intact: rentals, payments, applications and audit logs keep pointing at the deleted row.
5. Write an audit log (`USER_DELETED`, `PROPERTY_ARCHIVED`, …) once the audit module exists.

**Every read of live data** filters `isDeleted: false` (lists, search, detail, ownership checks, login, `auth()`).
Unique fields (email, phone) stay on deleted rows, so they can't be reused by a new signup; restoring is an admin action.

### Reading users (`GET /api/v1/user`, `GET /api/v1/user/:id`), implemented in `UserServices`

- **List** (`GET /user`): `ADMIN` / `SUPER_ADMIN` only (route guard `auth(Role.ADMIN, Role.SUPER_ADMIN)`). Admins can see
  every account, including other admins. Search `searchTerm` (name, email, phone); filters `role`, `status`,
  `authProvider`, `emailVerified`; sort `createdAt | updatedAt | name | email`; soft-deleted hidden unless `isDeleted=true`.
- **Details** (`GET /user/:id`): the user themselves, or any admin. Admins can also open soft-deleted accounts (support,
  restore); for everyone else a deleted account is 404. Anyone else → 403.
- Reading is broader than writing on purpose: an ADMIN may **view** another admin but not update or delete them.
- Passwords are never returned (`omit: { password: true }`).

### User update & delete (`PATCH` / `DELETE /api/v1/user/:id`), implemented in `UserServices`

**Who may manage whose account** (`assertCanManageUser`):

| Caller → target | Update | Delete |
|---|---|---|
| Anyone → themselves | ✅ | ✅ (except SUPER_ADMIN) |
| ADMIN → TENANT / OWNER | ✅ | ✅ |
| ADMIN → another ADMIN or the SUPER_ADMIN | ❌ 403 | ❌ 403 |
| SUPER_ADMIN → anyone | ✅ | ✅ (the SUPER_ADMIN itself can never be deleted) |
| TENANT / OWNER → someone else | ❌ 403 | ❌ 403 |

Deleted or unknown target → 404. Your own ID is `data.id` from `GET /auth/me`.

**Update (`PATCH /user/:id`):**

- At least one field. Unknown fields are rejected (`.strict()`), so `email`, `role`, `status`, `password`, `isDeleted` can
  never be changed here. Role/status changes will be separate admin actions.
- `name`, `phone` for every role (phone used by another account → 409). The **target account's** role decides the profile
  fields: TENANT → `occupation`, `gender`; OWNER → `address`. Another role's field → 400. `null` clears an optional field.
- Changing email is not supported (it would need OTP re-verification). The profile image has its own endpoint (Cloudinary).

**Delete (`DELETE /user/:id`), always a soft delete:**

- The **caller** re-confirms with **their own** password in the body (`{ password }`); an admin uses the admin's password,
  not the target's. Missing → 400, wrong → 401. A stolen access token alone can't delete anything. Callers without a
  password (Google-only) send `{}`.
- In one transaction: `User` → `isDeleted`, `deletedAt`, `status: DELETED`; an owner's properties → `ARCHIVED`.
- After commit: revoke every refresh token **of the deleted user** (logged out on all devices). Their current access token
  stops working at once, because `auth()` rejects deleted users. Auth cookies are cleared only when you delete **yourself**;
  an admin deleting someone stays logged in.
- Afterwards the deleted user gets: login → 401, Google login → 403, forgot-password → 404, and register with the same
  email/phone → 409 "belongs to a deleted account, contact support".
- **Done:** an owner with a `RESERVED`/`OCCUPIED` room → 409; otherwise their properties → `ARCHIVED` and rooms removed
  in the same transaction; audit `USER_DELETED` (every delete) and
  `USER_UPDATED` (when an admin edits someone else's account).
- **Done:** a tenant with a `PENDING`/`ACTIVE` rental → 409; pending applications and open viewings on either side are
  cancelled with the other party notified (`cancelPendingApplications`, `cancelOpenViewings`).

## Business rules and invariants

1. One pending application per tenant per room: service check **and** the unique `pendingKey` column
   (`"tenantId:roomId"` while PENDING, `null` afterwards). A double click can't create two.
2. Apply only to rooms that are `AVAILABLE`, in a publicly visible property.
3. **One PENDING/ACTIVE rental per room:** the unique `liveRoomKey` column (the roomId while live, `null` afterwards).
   Interpretation: a rental covers the whole room; `maxOccupants` is informational.
4. Approving an application happens atomically in one transaction (`approveApplication`):
   - `room.updateMany({ where: { id, status: 'AVAILABLE' } → RESERVED })`; `count === 0` → 409 "Room Is No Longer Available".
   - `application.updateMany({ where: { id, status: 'PENDING' } → APPROVED })`; `count === 0` → 409.
   - Create the `Rental` (PENDING, rent copied from the room, starts on the move-in date or today if that passed).
   - Every **other** PENDING application for the room → REJECTED ("The room was rented to another applicant").
   - Notifications (approved tenant + rejected competitors) and audit logs (`APPLICATION_APPROVED`, `RENTAL_CREATED`).
   - Two approvals racing for one room: exactly one wins (tested); a unique-key clash is also turned into 409.
   - The month-1 `Payment` is created in the same transaction (`createRentPayment`); paying it activates the rental.
5. `expiresAt = createdAt + APPLICATION_EXPIRY_DAYS` on application create.
6. An approved application always has exactly one rental (`Rental.applicationId @unique`).
7. A PAID `Payment` has a `stripePaymentIntentId`, and Stripe's `amount_total` equalled `amount × 100` in `bdt`
   (otherwise the money is refunded and the bill is FAILED).
8. BLOCKED users can't log in. All their refresh tokens are revoked (`authTokenUtils.revokeAllRefreshTokens`), and their properties are hidden from public search.
9. Users can see only their own private data. Owners see applications/viewings/payments for **their** properties only.

## Concurrency pattern (use everywhere a status gates a write)

Prefer **conditional updates** over "read then write":

```ts
const { count } = await tx.room.updateMany({ where: { id, status: RoomStatus.AVAILABLE }, data: { ... } })
if (count === 0) throw new AppError(httpStatus.CONFLICT, 'Room is no longer available')
```

Use `prisma.$transaction(async (tx) => { ... })` and **only `tx`** inside it. The example sometimes calls `prisma.` inside a
transaction, which is a bug; don't copy it. Pass `tx` into helpers: `createAuditLog(tx, {...})` (`utils/auditLog.ts`),
`NotificationServices.createNotification(tx, {...})`. Never call Stripe or send email inside the callback.

## Payments (Stripe)

Implemented: `PaymentServices`, helpers in `payment.utils.ts`, receipt in `payment.receipt.ts`.

**Bills.** One `Payment` per rent month, created by the system: month 1 inside `approveApplication`
(`createRentPayment(tx, rental, 1)`), later months by the `generateRentDues` cron (next). Periods are counted from
`rental.startDate` (`addMonths(startDate, n - 1)`, not chained, so the 31st doesn't drift), `periodEnd` is exclusive,
`dueDate = periodStart` (rent is paid in advance), `amount` = `rental.monthlyRent` in **whole taka (Int)**.
The client never sends an amount.

```text
POST /api/v1/payment/:id/checkout   (the TENANT who owes it; no body)
  → 403 not your bill · 409 already PAID · 409 rental not PENDING/ACTIVE ("This Rental Has Ended…")
  → SET payment-lock:{id} <token> NX EX 30 (409 if held); released in finally only if the token is still ours
  → bill PENDING with a session: retrieve it. complete → 409 "Being Processed" (webhook on its way);
    open with ≥ 5 min left → return it (no duplicate sessions); about to expire → expire it, then make a new one
  → stripe.checkout.sessions.create({ mode: 'payment', customer_email, client_reference_id: id,
        metadata + payment_intent_data.metadata: { paymentId, rentalId },
        line_items: [{ price_data: { currency: 'bdt', unit_amount: amount * 100, product_data }, quantity: 1 }],
        success_url: {FRONTEND}/dashboard/payments?status=success&session_id={CHECKOUT_SESSION_ID},
        cancel_url:  {FRONTEND}/dashboard/payments?status=cancelled&payment_id={id},
        expires_at: now + 31 min })                         Stripe error → 502
  → updateMany({ id, status in PENDING|FAILED|CANCELLED } → PENDING + stripeSessionId/CheckoutUrl/ExpiresAt)
    count 0 → expire the new session, 409  → 200 { paymentUrl, sessionId, expiresAt }

POST /api/v1/payment/webhook   (Stripe only; express.raw() for this path is mounted in app.ts before express.json())
  → stripe.webhooks.constructEvent(rawBody, Stripe-Signature, STRIPE_WEBHOOK_SECRET) → 400 on failure
  → no metadata.paymentId / unknown bill / other event types → 200, ignored
  → checkout.session.completed (payment_status 'paid') | async_payment_succeeded → settle:
      amount_total ≠ amount × 100 or currency ≠ bdt → FAILED (+ audit PAYMENT_FAILED) and refund
      $transaction: lock the rental row FIRST (PENDING → ACTIVE + activatedAt, else a no-op ACTIVE → ACTIVE update;
                    neither matched → rental ended → rollback, refund)
                    payment updateMany({ status in PENDING|FAILED|CANCELLED } → PAID, paidAt, stripeSessionId,
                    stripePaymentIntentId, gatewayResponse); count 0 → already PAID → rollback:
                        same session = redelivery (nothing) · other session = double payment → refund
                    first month: room RESERVED → OCCUPIED
                    notifications PAYMENT_SUCCESS (tenant) + PAYMENT_RECEIVED (owner), audit PAYMENT_COMPLETED
      after commit: receipt email (payment-success.ejs + pdfkit PDF from payment.receipt.ts), sendEmailSafely
  → checkout.session.completed with 'unpaid' → nothing yet (async method still processing)
  → async_payment_failed → FAILED (only the current session, only from PENDING) + PAYMENT_FAILED notification + audit
  → expired → CANCELLED (only the current session, only from PENDING); the rent is still due, the tenant can pay again
  → an error while processing → 500, so Stripe retries (everything above is idempotent)

Refunds: stripe.refunds.create({ payment_intent }, { idempotencyKey: `refund-${paymentIntentId}` }), then one
PAYMENT_REFUNDED audit + notification per PaymentIntent (checked before writing, so redeliveries don't duplicate).

GET /payment (T own · O own rentals · A all; ?status&rentalId&propertyId&tenantId) · GET /payment/:id
GET /payment/session/:sessionId (the success page polls until PAID) · GET /payment/:id/receipt (PDF, PAID only)
```

**Ending a rental** (`updateRentalStatus`) cancels its unpaid bills in the same transaction (`cancelUnpaidPayments`,
reason "The rental was completed/terminated") and, after the commit, expires their open Stripe sessions
(`expireCheckoutSessions`). If one is paid anyway, the webhook sees the rental isn't live and refunds it.
Rental ending and settlement both lock the rental row first, so they can't interleave.

Rules: no endpoint sets a status on a payment; admin payment routes are read-only; `gatewayResponse` (the raw
session) is stored but never returned; payments are never deleted.

## Roommate matching (implemented: `RoommateServices.getMatches`, scoring in `roommate.matching.ts`)

**Who may browse:** a tenant with their own roommate profile and search **on** (no profile → 404, search off → 403).
You can't browse others without being visible yourself.

**Who shows up** (database filter, then scored in code, at most 500 candidates, newest first):

1. Other profiles with `isActive`, whose account is a live, `ACTIVE` tenant.
2. Gender preference respected **both ways**: their gender fits my `genderPreference` (null = any) **and** my gender
   fits theirs. This is a hard filter, not scored.
3. Same `preferredCity` (case-insensitive) and an overlapping budget (`their.min ≤ my.max` and `their.max ≥ my.min`).

`GET /roommate/profile/:id` uses rules 1–2 only, so a profile in another city can still be opened and its score shows the fit.

**Score (0–100)**, weights in `roommate.constant.ts`; each factor also gets a label:

| Factor | Weight | Rule (ratio × weight, rounded) |
|---|---|---|
| Budget | 25 | overlap ÷ the narrower range (a single-value budget inside the other range = full) |
| Location | 20 | same area, or either side has no area preference → full; same city only → half |
| Move-in | 15 | ≤ 14 days apart → full, ≤ 30 days → 8/15, else 0 |
| Lifestyle | 10 | shared tags ÷ all tags (Jaccard); no tags on either side → half |
| Smoking | 10 | same answer → full, "don't mind" on one side → half, YES vs NO → 0 |
| Pets | 10 | same as smoking |
| Sleep | 10 | same → full, one FLEXIBLE → half, early bird vs night owl → 0 |

Factor label: ≥ 80% of its weight "Highly Compatible", ≥ 50% "Compatible", > 0 "Partially Compatible", else "Not Compatible".
Overall: ≥ 80 "Highly Compatible", ≥ 60 "Compatible", ≥ 40 "Partially Compatible", else "Low Compatibility".
The score is symmetric (A→B equals B→A). Results are sorted best first, then most recently updated; `minScore` filters,
and pagination is applied after scoring. Matches never include email, phone or account details. No Redis cache (not
needed at this size).

## Audit log (`AuditLog` model, `createAuditLog(tx, …)` in `utils/auditLog.ts`)

Append-only; `actorId`/`actorRole` of whoever acted (null for cron), `resource` + `resourceId`, and `previousData` /
`newData` holding **only the changed fields**. Always written inside the same transaction as the change.
Add new actions to the `AuditAction` enum as modules are built. **In the enum now:** `USER_UPDATED, USER_DELETED,
PROPERTY_CREATED, PROPERTY_UPDATED, PROPERTY_PUBLISHED, PROPERTY_DISABLED, PROPERTY_ARCHIVED, PROPERTY_SUSPENDED,
PROPERTY_RESTORED, ROOM_CREATED, ROOM_UPDATED, ROOM_STATUS_CHANGED, ROOM_ARCHIVED, APPLICATION_SUBMITTED,
APPLICATION_APPROVED, APPLICATION_REJECTED, APPLICATION_CANCELLED, RENTAL_CREATED, RENTAL_STATUS_CHANGED,
PAYMENT_COMPLETED, PAYMENT_FAILED, PAYMENT_REFUNDED` (payment actions are written by the webhook with a null actor).
**Planned:** `APPLICATION_EXPIRED, USER_BLOCKED, USER_ACTIVATED, VIEWING_STATUS_CHANGED`
