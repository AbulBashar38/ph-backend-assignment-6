# Housing & Roommate Platform — Backend

REST API for a housing + roommate marketplace: owners list properties/rooms, tenants search,
match with roommates, request viewings, apply, rent, and pay online; admins moderate everything.

- **Source of truth for features:** [Project Requirements.md](Project%20Requirements.md)

## Stack

| Need | Use | Not |
|---|---|---|
| Validation | `zod` v4 | Joi, Yup, class-validator |
| Redis | official `redis` SDK (`createClient`) | ioredis |
| Cron jobs | `node-cron` | BullMQ, Agenda |
| Email | `nodemailer` (Gmail) + `ejs` templates | SendGrid/Resend SDKs, inline HTML strings |
| File upload | `multer` (memory) + `cloudinary` v2 `upload_stream` | disk storage, multer-storage-cloudinary |
| Payments | `stripe` (Checkout Sessions + webhook) | bKash, SSLCommerz |
| Auth | `jsonwebtoken` + `bcryptjs`; Google via `google-auth-library` `verifyIdToken` | Passport |
| Dates / PDF | `date-fns`; `pdfkit` for the payment receipt | moment |
| API docs | `@asteasolutions/zod-to-openapi` + Swagger UI page loaded from CDN (`docs/index.ts`) | swagger-ui-express (its static files break on Vercel), hand-written YAML, swagger-jsdoc |

Also: Node (ESM), TypeScript (strict), Express 5, Prisma 7 + PostgreSQL (`@prisma/adapter-pg`), `http-status`, Biome.

## Commands

```bash
npm run dev                                  # tsx watch src/server.ts
npm run build                                # tsc — use as the type check
npm run check:fix                            # Biome lint + format + organize imports
npx prisma migrate dev --name <snake_name>   # after editing prisma/schema/*.prisma
npx prisma generate                          # regenerate src/generated/prisma
stripe listen --forward-to localhost:5000/api/v1/payment/webhook   # local Stripe webhooks
```

Swagger UI: <http://localhost:5000/api/docs> (raw spec: `/api/docs.json`).

**Definition of done:** `npm run build` passes, `npm run check:fix` is clean, the code follows the conventions below,
and every new or changed route is documented in its `x.openapi.ts`.

## Must-follow rules

- Module = `x.route.ts` / `x.controller.ts` / `x.service.ts` / `x.interface.ts` / `x.validation.ts` (+ `x.openapi.ts`,
  and `x.constant.ts` for searchable/sortable fields). List endpoints copy `UserServices.getAllUsers`.
  Exports: `XRoutes`, `XController`, `XServices` (plural; auth keeps `AuthService`). Mount each in `app.ts`
  at `/api/v1/<singular>`.
- **"Admin" always means `ADMIN` and `SUPER_ADMIN`.** `SUPER_ADMIN` has every permission an `ADMIN` has, plus more
  (e.g. managing other admins). Guard admin routes with `auth(...ADMIN_ROLES)` and check with `isAdminRole()`
  (`utils/roles.ts`); never write `auth(Role.ADMIN)` alone. The only thing no one can do is delete the SUPER_ADMIN account.
- All business logic and DB access is in services. Throw `new AppError(httpStatus.X, 'Message')` from `utils/AppError.ts`.
- Inside `prisma.$transaction(async (tx) => …)` use **only `tx`**. Payment-gateway calls and emails happen **after** commit.
- Contended status changes (room, application, payment) use a conditional `updateMany` and check `count === 0` → 409.
- **One `User` table for every role** (no Tenant/Owner profile tables). Every reference to a person is a **user ID**
  (`property.ownerId`, `application.tenantId`…). The database can't tell a tenant from an owner, so services must
  check the role (e.g. `findActiveOwner`) and ownership (`resource.ownerId === req.user.userId`). Role checks in routes
  aren't enough.
- State-changing actions in requirements §19 write an `AuditLog` via `createAuditLog(tx, …)` (`utils/auditLog.ts`), and
  events in §17 create a `Notification` via `createNotifications(tx, [...])` (`utils/notification.ts`), both in the
  same transaction. References: `PropertyServices` (audit), `ViewingServices` (notifications). Add new notification kinds
  to the `NotificationType` enum.
- **Never hard-delete. Every delete is a soft delete**, in every module and every case: set `isDeleted: true` + `deletedAt`
  (and a `DELETED`/`ARCHIVED` status where the model has one). No `prisma.x.delete()`/`deleteMany()` on business data.
  Every query for live data filters `isDeleted: false`. Applications, rentals, payments and audit logs only change status.
- File uploads: `imageUpload`/`documentUpload` from `lib/multer.ts` after `auth()`, and only the helpers in
  `utils/cloudinaryUpload.ts` (upload → DB write with rollback → delete old file).
- Never return `password` (`omit: { password: true }`). Read `process.env` only in `src/app/config/index.ts`.
- Formatting follows this repo's `biome.json` (4 spaces, single quotes, no semicolons).

## Don't

- Edit `src/generated/**` or existing migrations.
- Copy-paste the same block (cookies, emails, uploads, pagination…) into many services when a small shared helper would do.
- Let a client set a payment to `PAID`. Only Stripe decides: the signature-verified webhook, or the
  `reconcile-stale-payments` cron reading the session from Stripe's API (same code path, `settlePaidSession`).
- Add env vars without adding them to `.env.example` (placeholders only, never real secrets) and to `config/index.ts`.
