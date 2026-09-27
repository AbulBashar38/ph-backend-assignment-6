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
                             # setAuthCookie.ts, authTokens.ts, otp.ts, sendEmail.ts, uploadToCloudinary.ts, paginationHelper.ts
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
| `roommate-matches:{tenantId}` | JSON | 10 min | roommate matching cache; delete when the profile changes |
| `payment-lock:{rentPaymentId}` | `1` | 30 s | stops double checkout creation |
| `rent-reminder-sent:{rentPaymentId}:{daysBefore}` | `1` | 7 d | reminder de-duplication |

## Email (`nodemailer` + `ejs`)

Same as the example: a Gmail transporter in `lib/nodemailer.ts` (`service: 'gmail'`, `SMTP_USER` / `SMTP_PASSWORD` app password),
and templates in a **flat** `src/app/templates/` folder rendered with
`ejs.renderFile(path.join(process.cwd(), 'src/app/templates/<name>.ejs'), data)`.

To avoid repeating those 10 lines in every service (as the example does), put them in one helper, `utils/sendEmail.ts`:

```ts
export const sendEmail = async ({ to, subject, templateName, templateData, attachments }: ISendEmailPayload) => {
    const html = await ejs.renderFile(path.join(process.cwd(), `src/app/templates/${templateName}.ejs`), templateData)
    await transporter.sendMail({ from: config.email_sender, to, subject, html, attachments })
}
```

- OTP emails are awaited: if sending fails, the request fails, because the user needs the code.
- Other emails are sent **after** the DB transaction, in `try/catch` that logs and continues, so a mail error doesn't fail a committed action.
- Templates follow `example-backend/src/app/templates/registration-user-otp.ejs` (full HTML doc, `<style>` in head,
  `.container` card, footer). Use `<%= %>` (escaped) for every value.

| Template | Data |
|---|---|
| `registration-user-otp.ejs` | `name, email, otp, expirationMinutes` |
| `forgot-password.ejs` | `name, otp, expirationMinutes` |
| `reset-password-success.ejs` | `name` |
| `welcome-email.ejs` | `name, role` |
| `viewing-status.ejs` | `name, propertyTitle, status, scheduledAt?` |
| `application-status.ejs` | `name, propertyTitle, roomName, status, reason?` |
| `payment-success.ejs` | `name, amount, period, reference, paidAt` (+ `pdfkit` receipt attached, as in the example's invoice) |
| `rent-reminder.ejs` | `name, amount, dueDate, daysLeft` |
| `account-status.ejs` | `name, status` |

## File upload (`multer` → `cloudinary`)

- `lib/multer.ts`: `multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })`, with a
  `fileFilter` that only allows `image/jpeg|png|webp` (an addition to the example).
- Routes: `upload.single('profileImage')`, `upload.array('images', 10)`, or `upload.fields([...])`, placed after `auth(...)`.
- Multipart JSON fields come as a string in `req.body.data`. As in `doctor.controller.ts` → `applyAsDoctor`, the controller
  does `Schema.safeParse(JSON.parse(req.body.data))` and throws `AppError(400, issues[0].message)` on failure.
- `utils/uploadToCloudinary.ts` wraps the example's `upload_stream` Promise pattern (`resource_type: 'auto'`) and returns
  `UploadApiResponse`. Multiple files → `Promise.all`.
- Always store `secure_url` **and** `public_id` (`imageUrl` / `imagePublicId`, or an image table). When replacing an image,
  `cloudinary.uploader.destroy(oldPublicId)` after the DB update succeeds (as in `user.service.ts` → `uploadProfileImage`).
  If the DB write fails, destroy the images that were just uploaded.

## Payments (`stripe`)

`lib/stripe.ts`: `export const stripe = new Stripe(config.stripe_secret_key)`. The flow is in [domain.md](domain.md#payments-stripe).

- The webhook needs the raw body. In `app.ts`, **before** `express.json()`:
  `app.post('/api/v1/payment/webhook', express.raw({ type: 'application/json' }), PaymentController.handleStripeWebhook)`
- Local dev: `stripe listen --forward-to localhost:5000/api/v1/payment/webhook` → copy the `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
  Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (declined).

## Cron (`node-cron`), as in `example-backend/src/app/lib/cron.ts`

One exported function per job in `lib/cron.ts`, each called from `main()` in `server.ts`:

```ts
export const expirePendingApplications = () => {
    cron.schedule('0 * * * *', async () => {
        try {
            const count = await ApplicationServices.expireStaleApplications()
            if (count > 0) console.log(`Cron: expired ${count} pending applications`)
        } catch (error) {
            console.log('Cron: failed to expire applications', error)
        }
    }, { timezone: 'Asia/Dhaka' })
}
```

Put the logic in a service method (so it's callable and testable), and keep the cron wrapper thin. Every job is idempotent.

| Function | Schedule | Does |
|---|---|---|
| `generateRentDues` | `0 1 * * *` | For each ACTIVE rental, create the next `RentPayment` when due within 7 days (`@@unique([rentalId, periodStart])`, `skipDuplicates`) |
| `sendRentReminders` | `0 9 * * *` | PENDING rent payments due in 3 days / 1 day → notification + `rent-reminder.ejs` (de-duplicated by the Redis key) |
| `expirePendingApplications` | `0 * * * *` | PENDING applications past `expiresAt` → EXPIRED + notify the tenant + audit |
| `expireListings` | `30 0 * * *` | PUBLISHED properties past `expiresAt` → INACTIVE |
| `reconcileStalePayments` | `*/15 * * * *` | Payments with an open Stripe session older than 40 min → retrieve the session and apply its real state |

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
SWAGGER_ENABLED (optional; Swagger is always on outside production)
```
