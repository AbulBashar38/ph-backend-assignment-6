# Architecture

The layout is inspired by `example-backend/` (see [example-backend.md](example-backend.md)), with helpers added where the example repeats code.

## Folder layout (target)

```text
src/
  server.ts                  # main(): prisma.$connect → redisClient.connect → transporter.verify → seeds → cron → app.listen
  app.ts                     # cors, Stripe webhook (raw body), json/urlencoded, cookieParser, Swagger, routes, globalErrorHandler, notFound
  app/
    config/index.ts          # plain object reading process.env (the only place that does)
    interfaces/index.ts      # IQuery (and other shared types)
    lib/
      prisma.ts  redis.ts  nodemailer.ts  cloudinary.ts  multer.ts  googleAuth.ts  stripe.ts
      cron.ts                # all cron schedules (see Cron below)
    middleware/              # checkAuth.ts (auth + RequestUser), validateRequest.ts, globalErrorHandler.ts, notFound.ts
    utils/                   # AppError.ts, catchAsync.ts, sendResponse.ts, jwt.ts, seed.ts,
                             # setAuthCookie.ts, authTokens.ts, otp.ts, sendEmail.ts, cloudinaryUpload.ts, paginationHelper.ts, roles.ts
    templates/               # flat: <kebab-name>.ejs
    docs/                    # Swagger: registry.ts (components + helpers), index.ts (builds the document)
    module/
      auth/ user/ property/ room/ roommate/ viewing/ application/
      rental/ payment/ notification/ admin/ analytics/ audit/
  generated/prisma/          # generated, never edit
prisma/
  schema/                    # schema.prisma, enums.prisma, one file per model (user.prisma, tenant.prisma, …)
  migrations/
```

## Redis (`redis` SDK), as in `example-backend/src/app/lib/redis.ts`

```ts
export const redisClient = createClient({
    username: config.redis_user,
    password: config.redis_password,
    socket: { host: config.redis_host, port: Number(config.redis_port) },
})
// server.ts: await redisClient.connect()
```

Write with an expiry: `await redisClient.set(key, value, { expiration: { type: 'EX', value: seconds } })`.
Use `get`, `del`, `incr`, `expire`, `ttl`. Objects are stored as `JSON.stringify` strings.

Key registry. Use kebab-case prefixes like the example's (`patient-registration-otp:${email}`):

| Key | Value | TTL | Used by |
|---|---|---|---|
| `user-registration-otp:{email}` | 6-digit OTP | 5 min | register → verify-email |
| `user-registration-data:{email}` | JSON `{ name, email, phone, password(hashed), role }` | 30 min | the user is created only after verification |
| `forgot-password-otp:{email}` | 6-digit OTP | 5 min | forgot → reset password |
| `otp-attempts:{purpose}:{email}` | counter | 5 min | max 5 wrong tries, then delete the OTP (`purpose` = `user-registration` \| `forgot-password`) |
| `otp-cooldown:{purpose}:{email}` | `1` | 60 s | resend throttle |
| `refresh-token:{userId}:{jti}` | `active`, then `used:<ms timestamp>` | refresh TTL (7 d) | rotation + reuse detection; logout deletes one, password change deletes all |
| `roommate-matches:{tenantId}` | JSON | 10 min | **Not used yet.** Optional cache if matching ever gets slow (currently computed per request) |
| `payment-lock:{paymentId}` | random token | 30 s | stops double checkout creation; released only by its owner |
| `rent-reminder-sent:{paymentId}:{daysBefore}` | `1` | 7 d | reminder de-duplication |

## Email (`nodemailer` + `ejs`)

Same as the example: a Gmail transporter in `lib/nodemailer.ts` (`service: 'gmail'`, `SMTP_USER` / `SMTP_PASSWORD` app password),
and templates in `src/app/templates/` (shared parts in `templates/partials/`) rendered with
`ejs.renderFile(path.join(process.cwd(), 'src/app/templates/<name>.ejs'), data)`.

All sending goes through `utils/sendEmail.ts`:

- `sendEmail({ to, subject, templateName, templateData, text?, attachments? })` renders the template and sends it.
  `templateData` is **typed per template** (`IEmailTemplateData`), so a missing field fails `tsc`.
- Shared values are merged into every render automatically: `appName`, `frontendUrl`, `currentYear`.
- `text` is the plain-text alternative. Always pass one for OTP emails (better deliverability, readable in notifications).
- `formatEmailDate(date)` → `"28 Sept 2026, 14:05 (Bangladesh time)"`.
- OTP emails are awaited: if sending fails, the request fails (502), because the user needs the code.
- Other emails use `sendEmailSafely` **after** the DB transaction: it logs and continues, so a mail error doesn't fail a committed action.

### Template design system (`src/app/templates/`)

Emails are **email-client safe**: table layout, inline styles (Outlook and Gmail ignore most `<style>` rules), a hidden
preheader (the inbox preview line), and a 560px card that works on mobile. Never use flexbox/grid, external CSS, web fonts,
or `<script>`. Output every value with escaped `<%= %>`; use `<%- %>` only for `include(...)`.

| Partial (`partials/`) | Use |
|---|---|
| `layout-start` / `layout-end` | Every email starts with `include('partials/layout-start', { title, preheader })` and ends with `include('partials/layout-end')`: brand header, card, footer |
| `heading` | `{ text }`: the H1 |
| `button` | `{ href, label }`: bulletproof CTA button |
| `otp-code` | `{ otp, expirationMinutes }`: large one-time-code box + expiry line |
| `callout` | `{ tone: 'info' \| 'warning', title, text }`: highlighted note (security tips, "wasn't you?") |

Brand tokens (in the partials): primary `#0f766e` (teal), text `#0f172a` / `#334155`, muted `#64748b`, page `#f1f5f4`.

To add an email: add its data type to `IEmailTemplateData`, create `<name>.ejs` using the partials, then write a subject that
says what happened (put codes in the subject: `"482913 is your … code"`).

| Template | Data (+ shared `appName, frontendUrl, currentYear`) |
|---|---|
| `registration-user-otp.ejs` | `name, email, otp, expirationMinutes` |
| `forgot-password.ejs` | `name, email, otp, expirationMinutes` |
| `reset-password-success.ejs` | `name, email, changedAt` |
| `welcome-email.ejs` | `name, email, role` (steps + CTA differ for OWNER / TENANT) |
| `viewing-status.ejs` | `name, propertyTitle, status, scheduledAt?` |
| `application-status.ejs` | `name, propertyTitle, roomName, status, reason?` |
| `payment-success.ejs` | `name, amount, propertyTitle, roomName, period, paidAt, reference, isFirstPayment, moveInDate` (+ the `pdfkit` receipt from `payment.receipt.ts` attached) |
| `rent-reminder.ejs` | `name, amount, dueDate, daysLeft` |
| `account-status.ejs` | `name, status` |

## File upload (`multer` → `cloudinary`)

Reference implementation: profile image (`PATCH /user/:id/profile-image` → `UserServices.uploadProfileImage`).

**`lib/multer.ts`**: memory storage (no temp files), one preset per kind of file. The limits live in one place and are
reused by Swagger descriptions:

| Preset | Types | Max size | Max files | Use for |
|---|---|---|---|---|
| `imageUpload` (`IMAGE_UPLOAD_OPTIONS`) | JPG, PNG, WEBP | 5 MB | 10 | profile picture, property/room photos |
| `documentUpload` (`DOCUMENT_UPLOAD_OPTIONS`) | JPG, PNG, WEBP, PDF | 10 MB | 5 | application documents |

Route order: `auth(...)` **before** the upload middleware (anonymous requests never get buffered), e.g.
`router.patch('/:id/profile-image', auth(), imageUpload.single('profileImage'), controller)`.
Use `.single(field)`, `.array(field, max)` or `.fields([...])`.

Errors (all turned into JSON by `globalErrorHandler`): wrong type → 400 "Only JPG, PNG Or WEBP…", wrong field name or too
many files → 400, too large → 413, Cloudinary failure → 502.

**`utils/cloudinaryUpload.ts`** (the only place that talks to Cloudinary):

| Helper | Does |
|---|---|
| `uploadBuffer(buffer, folder, options?)` | Streams one file → `{ url, publicId }`. `resource_type: 'image'` by default, so Cloudinary rejects files that aren't really images. Failure → `AppError(502)` |
| `uploadMany(files, folder, options?)` | Parallel uploads, **all or nothing**: if one fails, the others are deleted, then 502 |
| `withUploadRollback(uploaded, dbWrite)` | Runs the DB write; if it throws, deletes the files just uploaded, then rethrows |
| `deleteFiles(publicIds)` | Best-effort delete (never throws, logs failures); skips `null`/`undefined` |

**Design decision: files are uploaded to the record they belong to. There is no generic `POST /upload` endpoint.**
A generic "upload, get a URL, send the URL later" flow would need ownership checks on client-sent URLs/publicIds (otherwise
a user could attach, or later delete, someone else's file) and a cron job for abandoned uploads. Instead:

- Single-file fields (profile picture): one multipart request that uploads and saves (`PATCH /user/:id/profile-image`).
- Records with many files (properties, rooms): **create the record with JSON first**, then add files to it:
  `POST /property/:id/images` (multipart, 1–10 files, can be repeated), `DELETE /property/:id/images/:imageId`.
  No "JSON inside a `data` field" multipart requests.

**Rules for every upload feature:**

1. Check permissions and load the record **before** uploading (no uploads for requests that will be rejected).
2. Upload → `withUploadRollback([...], () => prisma...update(...))` → only then `deleteFiles([oldPublicId])`.
3. Store **both** `url` and `publicId`. A URL without a `publicId` (e.g. a Google profile photo) isn't ours; never delete it.
4. Folders under `housing/`: `users/<userId>`, `properties/<propertyId>`, `rooms/<roomId>`, `applications/<applicationId>`.
5. Transform on upload when the use is known (avatars: `512×512`, `crop: 'fill'`, `gravity: 'face'`).
6. Removing a file removes the **file**, not a business record: set the DB fields to `null`; soft-delete rules apply to rows.
7. Swagger: `multipartBody(z.object({ field: fileField('…') }))` from `docs/registry.ts` shows a file picker.

## Payments (`stripe`)

`lib/stripe.ts`: `export const stripe = new Stripe(config.stripe_secret_key, { maxNetworkRetries: 2, timeout: 20_000 })`.
The flow is in [domain.md](domain.md#payments-stripe).

- The webhook needs the raw body. `app.ts` mounts `app.use('/api/v1/payment/webhook', express.raw({ type: '*/*' }))`
  **before** `express.json()` (which then skips the already-parsed body); the route itself is in `payment.route.ts`.
- Local dev: `stripe listen --forward-to localhost:<PORT>/api/v1/payment/webhook` → copy the `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
  Events to enable for a Dashboard endpoint: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`.
  Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (declined).

## Cron (`node-cron`), implemented in `lib/cron.ts`

The logic of each job is a **service method** (callable and testable on its own); `lib/cron.ts` only schedules them.
`CRON_JOBS` lists `{ name, schedule, run, lockSeconds }`; `startCronJobs()` is called from `server.ts` after `listen`
unless `CRON_ENABLED=false`. Improvements over the example (one copy-pasted `cron.schedule` + try/catch per job):

- One runner, `runCronJob(job)`: catches and logs errors (never crashes the process), logs how many records changed.
- `timezone: 'Asia/Dhaka'` and `noOverlap: true` (a slow run is never started twice in one process).
- A Redis lock `cron-lock:{name}` (`SET NX EX lockSeconds`, released only by its owner): with several API
  instances, only one runs each tick.
- Every job is **idempotent** (conditional updates, unique keys, Redis de-duplication), so a re-run or a run after
  downtime is safe, and big backlogs are processed 100 rows at a time (`utils/runInBatches.ts`, by id cursor).
- Jobs have no user, so their audit logs have `actor: null`.

| Job (`name`) | Schedule | Service method | Does |
|---|---|---|---|
| `generate-rent-dues` | `0 1 * * *` | `PaymentServices.generateRentDues` | For each ACTIVE rental, create every next month's bill due within 7 days (catches up after downtime); `RENT_BILL_CREATED` notification. `@@unique([rentalId, periodStart])` refuses duplicates |
| `send-rent-reminders` | `0 9 * * *` | `PaymentServices.sendRentReminders` | Unpaid bills of live rentals due in 3 days / 1 day → `RENT_DUE` notification + `rent-reminder.ejs`; once each (Redis `rent-reminder-sent:{paymentId}:{daysLeft}`, 7 d) |
| `expire-pending-applications` | `0 * * * *` | `ApplicationServices.expireStaleApplications` | PENDING past `expiresAt` → EXPIRED, `pendingKey` freed, tenant notified, audit `APPLICATION_EXPIRED` |
| `expire-listings` | `30 0 * * *` | `PropertyServices.expireListings` | PUBLISHED past `expiresAt` → INACTIVE, owner notified (`LISTING_EXPIRED`), audit `PROPERTY_EXPIRED` |
| `reconcile-stale-payments` | `*/15 * * * *` | `PaymentServices.reconcileStalePayments` | PENDING bills whose checkout expired 10+ min ago: retrieve the session **from Stripe's API** and apply the same handling as the webhook (paid → settle, expired → CANCELLED) |

## Environment variables (names follow the example)

```text
NODE_ENV, PORT, BACKEND_URL, FRONTEND_URL
DATABASE_URL
BCRYPT_SALT_ROUNDS
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRES_IN (15m), JWT_REFRESH_EXPIRES_IN (7d)
GOOGLE_CLIENT_ID
SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD
TESTER_OWNER_NAME, TESTER_OWNER_EMAIL, TESTER_OWNER_PASSWORD, TESTER_TENANT_NAME, TESTER_TENANT_EMAIL, TESTER_TENANT_PASSWORD
REDIS_USER, REDIS_PASSWORD, REDIS_HOST, REDIS_PORT
SMTP_USER, SMTP_PASSWORD, EMAIL_SENDER
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
APPLICATION_EXPIRY_DAYS
CRON_ENABLED
SWAGGER_ENABLED (optional; Swagger is always on outside production)
```
