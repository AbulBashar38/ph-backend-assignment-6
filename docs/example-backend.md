# Using `example-backend/` as a reference

`example-backend/` is a finished project (PH Healthcare: patients, doctors, appointments, bKash) built on the same
stack. It is git-ignored and **read-only**: never edit it or import from it.

**How to use it:** it's a source of **inspiration, not a template.** When you build something it already solved, read its
version first to see how the pieces fit (e.g. how the OTP is stored in Redis, how `upload_stream` is wrapped in a Promise,
how a list builds `andConditions`). Then write this project's version:

- Keep the parts that are sound, and match this repo's conventions ([CLAUDE.md](../CLAUDE.md) and the other docs win).
- Improve what's weak: extract repeated code into helpers, add missing checks, fix the [known issues](#known-issues-in-the-example).
- Adapt it to the housing domain. Don't carry over healthcare concepts or names.
- If a better approach clearly fits the requirements, use it. Mention it in your summary if it departs noticeably from the example.

## Where to look

| Need to build… | See how the example does it |
|---|---|
| New module (route/controller/service/interface/validation) | `example-backend/src/app/module/schedule/` (clean, complete CRUD) |
| Register → OTP email → verify (pending data in Redis) | `module/auth/auth.service.ts` → `registerPatient`, `verifyPatientEmail` |
| Forgot / reset password with OTP | `auth.service.ts` → `forgotPassword`, `resetPassword` |
| Google login (`idToken` from frontend) | `auth.service.ts` → `googleLogin`, `lib/googleAuth.ts` |
| Role guard | `middleware/checkAuth.ts` (`auth(...roles)`, `RequestUser`) |
| Body validation | `middleware/validateRequest.ts` + any `*.validation.ts` |
| Multipart upload + JSON `data` field | `module/doctor/doctor.controller.ts` → `applyAsDoctor`, `doctor.route.ts` (`upload.fields`) |
| Single image upload + replace old image | `module/user/user.service.ts` → `uploadProfileImage` |
| Cloudinary `upload_stream` wrapped in a Promise | `user.service.ts`, `doctor.service.ts` |
| Search / filter / sort / paginate a list | `doctor.service.ts` → `getAllDoctors`, `getAllDoctorsListPublic` |
| "My X" / "all X (admin)" / "single X with ownership check" | `appointment.service.ts` → `getMyAppointments`, `getAllAppointments`, `getSingleAppointment` |
| Status transitions with guard clauses | `appointment.service.ts` → `updateAppointmentStatus`; `doctor.service.ts` → `approveDoctor` |
| Multi-step write in a transaction | `appointment.service.ts` → `bookAppointment`, `cancelAppointment` (see the `tx` note below) |
| Payment redirect → callback → mark paid | `appointment.service.ts` → `bookAppointmentCallback` (we use Stripe instead, see [domain.md](domain.md#payments-stripe)) |
| PDF invoice attached to an email | `bookAppointmentCallback` (`pdfkit` → Buffer → `attachments`) |
| Email with EJS | any service: `ejs.renderFile(path.join(process.cwd(), 'src/app/templates/<name>.ejs'), data)` → `transporter.sendMail` |
| EJS template markup | `src/app/templates/registration-user-otp.ejs` |
| Cron job | `lib/cron.ts` + the call in `server.ts` |
| Redis client + `set` with expiry | `lib/redis.ts`, `auth.service.ts` |
| Seeding admin users from env | `utils/seed.ts` + the calls in `server.ts` |
| Admin statistics | `module/analytics/analytics.service.ts` |
| `IQuery` type for `req.query` | `src/app/interfaces/index.ts` |
| `AppError` | `utils/AppError.ts` |

## Conventions we adopted (inspired by the example)

These are this project's conventions. Most came from the example; some are adjusted.


- **Folders:** `src/app/{config,interfaces,lib,middleware,module,templates,utils}`. Third-party clients live in `lib/`
  (`prisma.ts`, `redis.ts`, `nodemailer.ts`, `cloudinary.ts`, `multer.ts`, `googleAuth.ts`, `cron.ts`, plus `stripe.ts`).
  `AppError`, `catchAsync`, `sendResponse`, `jwt`, `seed` live in `utils/`.
- **Module files:** `x.route.ts`, `x.controller.ts`, `x.service.ts`, `x.interface.ts`, `x.validation.ts`.
- **Export names:** `export const XController = {...}`, `export const XServices = {...}` (plural. Auth keeps
  `AuthService`), `export const XRoutes = router`.
- **Validation:** `import z from 'zod'`, one named export per schema, `CreatePropertyValidationZodSchema`.
  The schema describes **the body only**. It's applied with `validateRequest(Schema)`.
- **Interfaces:** `ICreatePropertyPayload`, `IUpdateRoomPayload`… in `x.interface.ts`. The logged-in user type is
  `RequestUser` from `middleware/checkAuth.ts`.
- **Controllers:** `catchAsync(async (req, res) => { ... sendResponse(res, { statusCode, success, message, data, meta }) })`.
  Read `req.user!`, `req.params.xId as string`, `req.query` (as `IQuery`), and `req.body`.
- **Services:** take `(payload, user)` or `(query, user)` or `(id, user)`. Throw `new AppError(httpStatus.X, 'Message')`.
  List functions return `{ data, meta: { page, limit, total, totalPages } }`.
- **Role profiles: deliberately NOT copied.** The example has `User` 1–1 `Patient`/`Doctor` tables (a Doctor has many fields of
  its own). Our tenants and owners differ by only 3 optional fields, so they live on `User`; references are user IDs.
- **List queries:** get `{ page, limit, skip, sortBy, sortOrder }` from `utils/paginationHelper.ts` (the example repeats these
  5 lines in every service), then build `andConditions: XWhereInput[]`
  (type imported from `generated/prisma/models`), `searchTerm` → `OR` of `contains` + `mode: 'insensitive'`, one `if` per
  filter, `findMany` + `count` with the same `where`.
- **Routes:** kebab-case, action-style paths, and `/:id` routes last:
  `/create-x`, `/my-xs`, `/all-xs` (admin), `/update-x/:xId`, `/update-status/:xId`, `/public/...` (no auth).
  Mounted in `app.ts` one by one: `app.use('/api/v1/<singular>', XRoutes)`.
- **Redis keys:** kebab-case purpose prefix + identifier, e.g. `tenant-registration-otp:${email}`,
  `tenant-registration-data:${email}`, `forgot-password-otp:${email}`. Always set an expiry:
  `redisClient.set(key, value, { expiration: { type: 'EX', value: seconds } })`.
- **Emails:** HTML from `src/app/templates/<kebab-name>.ejs` (flat folder), `from: config.email_sender`,
  Gmail transporter from `lib/nodemailer.ts`.
- **Cron:** functions in `lib/cron.ts` that call `cron.schedule(expr, async () => { try { ... } catch (error) { console.log(...) } })`,
  invoked from `main()` in `server.ts`.
- **Seeds:** idempotent `seedX()` functions in `utils/seed.ts` using `SUPER_ADMIN_*` style env vars, called in `main()`.
- **Boot order in `server.ts`:** `prisma.$connect()` → `redisClient.connect()` → `transporter.verify()` → seeds →
  cron → `app.listen`.
- **Config:** a plain object in `config/index.ts` reading `process.env` (with `!` for required values). Nothing else reads `process.env`.

## Known issues in the example

Things the example gets wrong, or that this project needs and the example doesn't cover. Don't reproduce them:

| Example does | We do instead | Why |
|---|---|---|
| Uses `prisma.` inside `prisma.$transaction(async (tx) => …)` | Use **only `tx.`** inside a transaction | Otherwise those writes aren't in the transaction |
| Calls the payment gateway and sends email **inside** the transaction | External calls and emails go **after** the transaction commits | Keeps transactions short, and emails aren't sent for rolled-back data |
| `globalErrorHandler` hides every message in production | Send `err.message` for `AppError`/4xx; hide only 5xx details | Clients need "Room is no longer available", etc. |
| Cookies `secure: false` + `sameSite: 'none'` (browsers drop them), repeated in every controller | One helper `utils/setAuthCookie.ts`: `secure: config.node_env === 'production'`, `sameSite: secure ? 'none' : 'lax'` | Cookies actually work; there's one place to change |
| `checkAuth` finds the user by `{ id, email, name, role }` and doesn't check `isDeleted` | Find by `id`; reject `BLOCKED`, `DELETED` and `isDeleted` users | Tokens survive profile edits; deleted users are locked out |
| `bcrypt.hash(password, 8)` in `registerPatient` | Always `Number(config.bcrypt_salt_rounds)` | The env value is ignored otherwise |
| `config.bak_url` reads `APP_URL` | `backend_url: process.env.BACKEND_URL` | Typo in the example |
| OTP has no attempt limit and no resend limit | Wrong-attempt counter (max 5) and a 60 s resend cooldown in Redis | Stops OTP brute force |
| No logout; refresh tokens can't be revoked | Per-token Redis entries with rotation + reuse detection; `/auth/logout` revokes one (see [auth.md](auth.md)) | Required: "Session/token management, Logout" |
| Status changes via repeated `if` checks | Same guard-clause style, **plus** a conditional `updateMany({ where: { id, status: <expected> } })` and a `count === 0` check for anything contended (room, application, payment) | Two tenants racing for one room (requirement §26) |
| bKash (`lib/bkash.ts`, `/payment/callback`) | Stripe Checkout + webhook (`lib/stripe.ts`) | Your chosen gateway |
| No API docs (Postman collection only) | Swagger at `/api/docs` (see [api-conventions.md](api-conventions.md#api-documentation-swagger)) | Your chosen doc tool |
| No audit log, no in-app notifications | `AuditLog` + `Notification` models, written inside the same transaction | Requirements §17, §19 |
| Unverified doctors are hard-deleted by cron | Never hard-delete business records; users/properties/rooms are soft-deleted | Requirement §24 |
| `console.log` of the raw error in `validateRequest` | Only throw `AppError(400, issues[0].message)` | Noise; can log passwords |

This list isn't exhaustive. If something in the example looks wrong, insecure, or duplicated, don't bring it over. Do it properly.
