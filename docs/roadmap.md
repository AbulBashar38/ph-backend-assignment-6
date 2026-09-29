# Roadmap & Status

Update the checkboxes as work lands. Work top to bottom. For each item, it helps to look at how
`example-backend/` handled the same thing ([index](example-backend.md#where-to-look)), then build a cleaner version here.

## Phase 0: Foundation (bring `src/` up to the example's baseline, and fix known bugs)

- [x] Remove healthcare leftovers: `Patient` model, `DOCTOR`/`PATIENT` roles, `registerPatient`, "PH Healthcare" strings,
      the DB name, and the `package.json` name/description
- [x] Shared infrastructure for auth: `utils/AppError.ts`, `middleware/validateRequest.ts`, `lib/redis.ts`, `lib/nodemailer.ts`,
      `utils/authTokens.ts`, `utils/otp.ts`, `utils/sendEmail.ts`, `utils/setAuthCookie.ts`
- [x] Remaining infrastructure: `lib/cron.ts` (Google, pagination, Multer/Cloudinary done)
- [x] `config/index.ts` + `.env.example` (placeholders) for DB, JWT, super admin, Redis, SMTP, Swagger
- [x] Add env vars as features land (Google, Cloudinary, Stripe, `APPLICATION_EXPIRY_DAYS`)
- [x] `server.ts` boot order: DB → Redis → mailer verify (warn only) → seeds → listen → cron (unless `CRON_ENABLED=false`)
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
- [x] Property: cron `expireListings` (PUBLISHED past `expiresAt` → INACTIVE)
- [x] Room: create, list (role-scoped), details, update, status changes with guards, images, soft delete,
      public available-room search and details, audit log

## Phase 3: Matching & viewings

- [x] Roommate profile create/get/update, search on/off (`/roommate/profile`, `/profile/me`, `/profile/me/status`)
- [x] Matching: `GET /roommate/matches` (0–100 score + per-factor breakdown, gender both ways, city + budget filter),
      `GET /roommate/profile/:id` (no Redis cache: not needed at this size)
- [x] Viewing requests: request, cancel, approve / reject / reschedule / complete, role-scoped lists, cascades
- [x] Notifications: model, `createNotifications(tx, …)` helper, list / unread count / mark read / mark all read

## Phase 4: Applications & rentals

- [x] Apply, role-scoped lists and details; one status endpoint (approve / reject / cancel)
- [x] Atomic approve: room RESERVED, PENDING rental, competitors rejected, notifications + audit; DB unique keys against
      double pending applications and two live rentals per room
- [x] Rentals: role-scoped lists and details; complete / terminate frees the room
- [x] Cascades: room / property / account removal cancels pending applications; tenant with a live rental can't delete the account
- [x] Cron: pending applications past `expiresAt` → EXPIRED

## Phase 5: Payments (Stripe)

- [x] `Payment` model (one bill per rent month); month 1 created at approval
- [x] `lib/stripe.ts`, `POST /payment/:id/checkout` (Redis lock, reuse an open session, 502 on Stripe errors)
- [x] Webhook (raw body before `express.json()`, signature, idempotent conditional update, amount check, rental
      activation + room OCCUPIED, automatic refund of double / late / wrong-amount payments)
- [x] `payment-success` email with a `pdfkit` receipt; receipt download; role-scoped list, details, session lookup
- [x] Ending a rental cancels its unpaid bills and expires their open checkouts
- [x] Cron: `generateRentDues` (month 2+), `sendRentReminders`, `reconcileStalePayments`

## Phase 6: Notifications, audit, admin, analytics, cron

- [x] AuditLog model + `createAuditLog(tx, …)` helper
- [ ] Admin audit-log viewer
- [ ] Admin: users list/search, block/activate (delete the refresh token), create admin, property moderation
- [ ] Analytics: admin stats from requirements §18 (example `analytics.service.ts` style), owner stats
- [x] `lib/cron.ts`: generateRentDues, sendRentReminders, expirePendingApplications, expireListings, reconcileStalePayments

## Phase 7: Polish

- [ ] Every route documented in Swagger with examples
- [ ] README in the example's style (setup, env table, structure, API, known limitations)
- [ ] Manually test edge cases from requirements §26 (duplicate application, concurrent approve, duplicate webhook,
      amount mismatch, blocked user access)
