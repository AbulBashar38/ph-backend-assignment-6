# Roadmap & Status

Update the checkboxes as work lands. Work top to bottom. For each item, it helps to look at how
`example-backend/` handled the same thing ([index](example-backend.md#where-to-look)), then build a cleaner version here.

## Phase 0: Foundation (bring `src/` up to the example's baseline, and fix known bugs)

- [ ] Remove healthcare leftovers: `Patient` model, `DOCTOR`/`PATIENT` roles, `registerPatient`, "PH Healthcare" strings,
      the DB name, and the `package.json` name/description
- [ ] Add the shared infrastructure (the example has working versions to learn from): `utils/AppError.ts`, `middleware/validateRequest.ts`,
      `interfaces/index.ts` (`IQuery`), `utils/paginationHelper.ts`, and `lib/` (`redis.ts`, `nodemailer.ts`, `cloudinary.ts`, `multer.ts`,
      `googleAuth.ts`, `cron.ts`)
- [ ] Extend `config/index.ts` with the example's env names (plus Stripe) and update `.env.example` with **placeholders**
- [ ] `server.ts` boot order like the example: DB → Redis → mailer verify → seeds → cron → listen
- [ ] Fix bugs in the starter (the example has most of them too):
  - [ ] `globalErrorHandler` sends HTTP 500 for everything (use `statusCode`), and hides 4xx messages in production
  - [ ] Services throw plain `Error`. Use `AppError` everywhere
  - [ ] Cookies `sameSite: 'none'` + `secure: false` → `utils/setAuthCookie.ts`
  - [ ] `bcrypt.hash(password, 8)` → `Number(config.bcrypt_salt_rounds)`
  - [ ] `checkAuth` looks users up by `{ id, email, name, role }` → look up by `id`, and also reject `DELETED` / `isDeleted`
  - [ ] `config.bak_url` reads `APP_URL` → `backend_url: process.env.BACKEND_URL`
  - [ ] Mount `notFound` before `globalErrorHandler`
- [ ] `utils/seed.ts`: `seedSuperAdmin`, `seedTesterOwner`, `seedTesterTenant` (example style)
- [ ] Swagger: `src/app/docs/` + `/api/docs`, and document the auth routes

## Phase 1: Auth (example `module/auth/`)

- [ ] Prisma: `User` (+ `authProvider`, `googleId`, `imageUrl`, `imagePublicId`, `phone`), `Tenant`, `Owner`, enums
- [ ] `utils/sendEmail.ts` + templates `registration-user-otp`, `welcome-email`, `forgot-password`, `reset-password-success`
- [ ] Register (pending data in Redis) → verify-email → user + profile created; resend-otp with cooldown; OTP attempt limit
- [ ] Login, refresh-token (Redis-stored, rotated), logout, me
- [ ] Google login (`idToken`)
- [ ] Forgot / reset / change password

## Phase 2: Listings

- [ ] User: profile image (example `uploadProfileImage`), update my profile
- [ ] `utils/uploadToCloudinary.ts` + the image filter in `lib/multer.ts`
- [ ] Property: create (multipart), my/all/public lists with search/filter/sort/paginate, update, publish/disable, images, soft delete
- [ ] Room: create, update, status changes with guards, public available rooms

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

- [ ] Notification + AuditLog helpers taking `tx`, plus their endpoints
- [ ] Admin: users list/search, block/activate (delete the refresh token), create admin, property moderation
- [ ] Analytics: admin stats from requirements §18 (example `analytics.service.ts` style), owner stats
- [ ] `lib/cron.ts`: generateRentDues, sendRentReminders, expirePendingApplications, expireListings, reconcileStalePayments

## Phase 7: Polish

- [ ] Every route documented in Swagger with examples
- [ ] README in the example's style (setup, env table, structure, API, known limitations)
- [ ] Manually test edge cases from requirements §26 (duplicate application, concurrent approve, duplicate webhook,
      amount mismatch, blocked user access)
