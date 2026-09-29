# Roadmap & Status

Update the checkboxes as work lands. Work top to bottom. For each item, it helps to look at how
`example-backend/` handled the same thing ([index](example-backend.md#where-to-look)), then build a cleaner version here.

## Phase 0: Foundation (bring `src/` up to the example's baseline, and fix known bugs)

- [x] Remove healthcare leftovers: `Patient` model, `DOCTOR`/`PATIENT` roles, `registerPatient`, "PH Healthcare" strings,
      the DB name, and the `package.json` name/description
- [x] Shared infrastructure for auth: `utils/AppError.ts`, `middleware/validateRequest.ts`, `lib/redis.ts`, `lib/nodemailer.ts`,
      `utils/authTokens.ts`, `utils/otp.ts`, `utils/sendEmail.ts`, `utils/setAuthCookie.ts`
- [ ] Remaining infrastructure: `lib/cron.ts` (Google, pagination, Multer/Cloudinary done)
- [x] `config/index.ts` + `.env.example` (placeholders) for DB, JWT, super admin, Redis, SMTP, Swagger
- [ ] Add env vars as features land: Stripe, `APPLICATION_EXPIRY_DAYS` (Google, Cloudinary done)
- [x] `server.ts` boot order: DB → Redis → mailer verify (warn only) → seeds → listen (add cron when it exists)
- [x] Fix bugs in the starter (the example has most of them too):
  - [x] `globalErrorHandler` sends HTTP 500 for everything (use `statusCode`), and hides 4xx messages in production
  - [x] Services throw plain `Error`. Use `AppError` everywhere
  - [x] Cookies `sameSite: 'none'` + `secure: false` → `utils/setAuthCookie.ts`
  - [x] `bcrypt.hash(password, 8)` → `Number(config.bcrypt_salt_rounds)`
  - [x] `checkAuth` looks users up by `{ id, email, name, role }` → look up by `id`, and also reject `DELETED` / `isDeleted`
  - [x] `config.bak_url` reads `APP_URL` → `backend_url: process.env.BACKEND_URL`
  - [x] Mount `notFound` before `globalErrorHandler`
- [x] `utils/seed.ts`: `seedSuperAdmin`
- [ ] `seedTesterOwner`, `seedTesterTenant`
- [x] Swagger: `src/app/docs/` + `/api/docs`, and document the auth routes

## Phase 1: Auth (example `module/auth/`)

- [x] Prisma: `User` (+ `authProvider`, `googleId`, `imageUrl`, `imagePublicId`, `phone`, `gender`, `occupation`, `address`), enums
- [x] Merged the Tenant/Owner profile tables into `User` (migration `merge_profiles_into_users` copies the data)
- [x] `utils/sendEmail.ts` + templates `registration-user-otp`, `welcome-email`, `forgot-password`, `reset-password-success`
- [x] Register (pending data in Redis) → verify-email → user + profile created; resend-otp with cooldown; OTP attempt limit
- [x] Login, refresh-token (Redis-stored, rotated), logout, me
- [x] Google login (`idToken`)
- [x] Forgot / reset / change password

## Phase 2: Listings

- [x] User: update profile, self or admin (`PATCH /user/:id`)
- [x] User: delete account, soft delete, self or admin (`DELETE /user/:id`)
- [x] User: list with search/filter/sort/pagination, admins only (`GET /user`); details, self or admin (`GET /user/:id`)
- [x] User: profile image upload/replace/remove (`PATCH`/`DELETE /user/:id/profile-image`)
- [ ] Account deletion side effects once rentals/properties/applications exist (see docs/domain.md → Account deletion)
- [x] Upload infrastructure: `lib/multer.ts` presets (image, document), `lib/cloudinary.ts`, `utils/cloudinaryUpload.ts`
- [x] Property: create (JSON), my/all/public lists with search/filter/sort/paginate, details, update, publish/disable,
      images (add/remove), admin suspend/restore, soft delete (archive), audit log
- [x] Property: rent/room filters in public search, rooms in property details, "needs ≥1 room to publish",
      archive refused with reserved/occupied rooms (rooms archived with the property)
- [ ] Property: cron `expireListings` (PUBLISHED past `expiresAt` → INACTIVE)
- [x] Room: create, list (role-scoped), details, update, status changes with guards, images, soft delete,
      public available-room search and details, audit log

## Phase 3: Matching & viewings

- [ ] Roommate profile create/get/update/toggle
- [ ] Matching score + Redis cache
- [ ] Viewing requests (request, cancel, owner update-status, lists)

## Phase 4: Applications & rentals

- [ ] Submit / cancel / lists, with a partial unique index for one PENDING application per tenant per room
- [ ] Approve in one `tx` (conditional room + application updates, rental + first payment, reject competitors, notify, audit)
- [ ] Reject; rental terminate/complete frees the room

## Phase 5: Payments (Stripe)

- [ ] `lib/stripe.ts`, `pay-rent` checkout session (lock, reuse an open session)
- [ ] Webhook (raw body before `express.json()`, signature, idempotent conditional update, amount check)
- [ ] `payment-success` email with a `pdfkit` receipt (example invoice code); my/owner/all/single payment lists

## Phase 6: Notifications, audit, admin, analytics, cron

- [x] AuditLog model + `createAuditLog(tx, …)` helper
- [ ] Notification helper taking `tx`; admin audit-log viewer and notification endpoints
- [ ] Admin: users list/search, block/activate (delete the refresh token), create admin, property moderation
- [ ] Analytics: admin stats from requirements §18 (example `analytics.service.ts` style), owner stats
- [ ] `lib/cron.ts`: generateRentDues, sendRentReminders, expirePendingApplications, expireListings, reconcileStalePayments

## Phase 7: Polish

- [ ] Every route documented in Swagger with examples
- [ ] README in the example's style (setup, env table, structure, API, known limitations)
- [ ] Manually test edge cases from requirements §26 (duplicate application, concurrent approve, duplicate webhook,
      amount mismatch, blocked user access)
