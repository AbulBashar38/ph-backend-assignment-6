# Housing & Roommate Platform — Backend

REST API for a housing + roommate marketplace: owners list properties/rooms, tenants search,
match with roommates, request viewings, apply, rent, and pay online; admins moderate everything.

- **Source of truth for features:** [Project Requirements.md](Project%20Requirements.md)
- **Reference for inspiration: [`example-backend/`](example-backend/).** It's a finished project on the same stack.
  When building something it already does (OTP, Google login, uploads, emails, cron, paginated lists…), look at how it
  solved the problem ([index](docs/example-backend.md)) and use the idea. **Don't copy it blindly.** Keep what's good,
  improve what's weak (duplication, bugs, missing checks), and adapt it to this domain. The rules in `CLAUDE.md` and `docs/`
  win over the example. `example-backend/` is read-only: never edit it or import from it.
- **Current state of `src/`:** it still holds the healthcare starter (`Patient`, `DOCTOR`/`PATIENT` roles,
  `registerPatient`). That's **legacy: replace it, never extend it.** See [docs/roadmap.md](docs/roadmap.md).

## Read before working on…

| Task touches | Read |
|---|---|
| **Anything** (patterns, naming, where things go) | [docs/example-backend.md](docs/example-backend.md) |
| Folder layout, stack, Redis, email, uploads, Stripe setup, cron, env vars | [docs/architecture.md](docs/architecture.md) |
| Register, OTP, login, Google, tokens, logout | [docs/auth.md](docs/auth.md) |
| Models, statuses, state machines, business rules, payments | [docs/domain.md](docs/domain.md) |
| Routes, responses, errors, pagination/filtering, Swagger | [docs/api-conventions.md](docs/api-conventions.md) |

## Stack

| Need | Use | Not |
|---|---|---|
| Validation | `zod` v4 | Joi, Yup, class-validator |
| Redis | official `redis` SDK (`createClient`) | ioredis |
| Cron jobs | `node-cron` | BullMQ, Agenda |
| Email | `nodemailer` (Gmail) + `ejs` templates | SendGrid/Resend SDKs, inline HTML strings |
| File upload | `multer` (memory) + `cloudinary` v2 `upload_stream` | disk storage, multer-storage-cloudinary |
| Payments | `stripe` (Checkout Sessions + webhook) | bKash (the example's gateway), SSLCommerz |
| Auth | `jsonwebtoken` + `bcryptjs`; Google via `google-auth-library` `verifyIdToken` | Passport |
| Dates / PDF | `date-fns`; `pdfkit` for the payment receipt | moment |
| API docs | `swagger-ui-express` + `@asteasolutions/zod-to-openapi` | hand-written YAML, swagger-jsdoc |

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

## Must-follow rules (details in the docs)

- Module = `x.route.ts` / `x.controller.ts` / `x.service.ts` / `x.interface.ts` / `x.validation.ts` (+ `x.openapi.ts`,
  and `x.constant.ts` for searchable/sortable fields). List endpoints copy `UserServices.getAllUsers`
  ([docs/api-conventions.md → Lists](docs/api-conventions.md#lists-search--filter--sort--paginate)).
  Exports: `XRoutes`, `XController`, `XServices` (plural; auth keeps `AuthService`). Mount each in `app.ts`
  at `/api/v1/<singular>`.
- **"Admin" always means `ADMIN` and `SUPER_ADMIN`.** `SUPER_ADMIN` has every permission an `ADMIN` has, plus more
  (e.g. managing other admins). Guard admin routes with `auth(...ADMIN_ROLES)` and check with `isAdminRole()`
  (`utils/roles.ts`); never write `auth(Role.ADMIN)` alone. The only thing no one can do is delete the SUPER_ADMIN account.
- All business logic and DB access is in services. Throw `new AppError(httpStatus.X, 'Message')` from `utils/AppError.ts`.
- Inside `prisma.$transaction(async (tx) => …)` use **only `tx`**. Payment-gateway calls and emails happen **after** commit.
- Contended status changes (room, application, payment) use a conditional `updateMany` and check `count === 0` → 409.
- Ownership: resolve the caller's `Tenant`/`Owner` profile by `userId`, then check that the resource belongs to it. Role checks in routes aren't enough.
- State-changing actions in requirements §19 write an `AuditLog`, and events in §17 create a `Notification`, both in the same transaction.
- **Never hard-delete. Every delete is a soft delete**, in every module and every case: set `isDeleted: true` + `deletedAt`
  (and a `DELETED`/`ARCHIVED` status where the model has one). No `prisma.x.delete()`/`deleteMany()` on business data.
  Every query for live data filters `isDeleted: false`. Applications, rentals, payments and audit logs only change status.
  Rules and checklist: [docs/domain.md → Soft delete](docs/domain.md#soft-delete-applies-to-every-delete).
- File uploads: `imageUpload`/`documentUpload` from `lib/multer.ts` after `auth()`, and only the helpers in
  `utils/cloudinaryUpload.ts` (upload → DB write with rollback → delete old file). See [docs/architecture.md → File upload](docs/architecture.md#file-upload-multer--cloudinary).
- Never return `password` (`omit: { password: true }`). Read `process.env` only in `src/app/config/index.ts`.
- Formatting follows this repo's `biome.json` (4 spaces, single quotes, no semicolons), not the example's tabs/double quotes.

## Don't

- Edit `example-backend/**`, `src/generated/**`, or existing migrations.
- Reproduce the example's known issues (listed in [docs/example-backend.md](docs/example-backend.md#known-issues-in-the-example)).
- Copy-paste the same block into many services when a small shared helper would do (the example repeats cookie,
  email, upload and pagination code in every file; we don't).
- Let a client set a payment to `PAID`. Only the signature-verified Stripe webhook can do that.
- Add env vars without adding them to `.env.example` (placeholders only, never real secrets) and to `config/index.ts`.
