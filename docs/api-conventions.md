# API Conventions

Base path: `/api/v1`. Response, validation and list patterns are based on `example-backend/`, with the fixes noted below.

## Success response: `sendResponse` (unchanged from the example)

```json
{ "success": true, "statusCode": 200, "message": "Properties Retrieved Successfully",
  "data": [], "meta": { "page": 1, "limit": 10, "total": 57, "totalPages": 6 } }
```

Messages use Title Case, like the example ("Application Approved Successfully"). `meta` appears only on lists.

## Error response: `globalErrorHandler`

Keep the example's shape and Prisma error mapping, but fix its two bugs (see [example-backend.md](example-backend.md#deliberate-differences)):

```json
{ "success": false, "statusCode": 409, "name": "AppError", "message": "Room Is No Longer Available",
  "error": "<dev only>", "stack": "<dev only>" }
```

- The HTTP status must equal `statusCode`: `res.status(statusCode)`.
- `message` is always sent for `AppError` and other 4xx errors. Only 5xx messages become "Internal Server Error" in production.
- Map a `ZodError` (if one escapes) → 400. Map Prisma `P2002` → 409, `P2025` → 404 (the example uses 400 for both, so fix this).

| Situation | Status |
|---|---|
| Invalid input (`validateRequest`, the `safeParse` in multipart controllers) | 400 |
| Not logged in / bad token | 401 |
| Wrong role, not the owner, or BLOCKED | 403 |
| Missing resource | 404 |
| Duplicate / invalid status transition / room taken | 409 |
| Too many OTP attempts / resend cooldown | 429 |
| Stripe/Cloudinary failure | 502 (`BAD_GATEWAY`, as the example does for bKash) |

## Validation (example `validateRequest`)

- The schema validates `req.body` only: `validateRequest(CreatePropertyValidationZodSchema)`. On failure, throw
  `AppError(400, result.error.issues[0].message)`, and `req.body = result.data`.
- Write custom messages as the example does: `z.string().min(3, 'Title Must Be At Least 3 Characters')`.
- Multipart routes validate in the controller: `Schema.safeParse(JSON.parse(req.body.data))` (example `applyAsDoctor`).
- Never spread `req.body` into Prisma `data` for fields a client must not set (`status`, `ownerId`, `role`, `amount`).
  The Zod schema simply doesn't include them.

## Lists: search / filter / sort / paginate (idea from the example's `getAllDoctors`)

`req.query` is typed as `IQuery` (`src/app/interfaces/index.ts`). The example repeats the pagination math in every
service. Here it lives in `utils/paginationHelper.ts`, and each list service does this:

```ts
const { page, limit, skip, sortBy, sortOrder } = paginationHelper(query, PROPERTY_SORTABLE_FIELDS)

const andConditions: PropertyWhereInput[] = [{ isDeleted: false }, { status: PropertyStatus.PUBLISHED }]
if (query.searchTerm) andConditions.push({ OR: [{ title: { contains: query.searchTerm, mode: 'insensitive' } }, ...] })
if (query.city) andConditions.push({ city: { equals: query.city, mode: 'insensitive' } })
if (query.minRent || query.maxRent) andConditions.push({ rooms: { some: { monthlyRent: { gte: ..., lte: ... } } } })
if (query.amenities) andConditions.push({ amenities: { hasEvery: query.amenities.split(',') } })

const data = await prisma.property.findMany({ where: { AND: andConditions }, take: limit, skip, orderBy: { [sortBy]: sortOrder }, select/include })
const total = await prisma.property.count({ where: { AND: andConditions } })
return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }
```

`paginationHelper` defaults to page 1, limit 10 (max 100), `createdAt desc`, and only accepts a `sortBy` from the
allowed list passed to it (unknown fields make Prisma throw).

Public property search params: `searchTerm, city, area, propertyType, roomType, minRent, maxRent, occupants, amenities,
availableFrom, sortBy, sortOrder, page, limit`. Public endpoints use `select` to expose only safe fields
(example `getAllDoctorsListPublic`).

## Route map (singular mount, action-style kebab paths, `/:id` last)

Legend: 🌐 public · T tenant · O owner · A admin/super admin · ✱ any logged-in user

```text
/api/v1/auth          POST /register · /verify-email · /resend-otp · /login · /google · /refresh-token
                      POST /logout(✱) · /forgot-password · /reset-password · PATCH /change-password(✱) · GET /me(✱)
/api/v1/user          PATCH /profile-image(✱, multipart profileImage) · PATCH /update-my-profile(✱)
/api/v1/property      POST /create-property(O, multipart images + data) · GET /my-properties(O) · GET /all-properties(A)
                      GET /public/all-properties🌐 · GET /public/:propertyId🌐
                      PATCH /update-property/:propertyId(O) · PATCH /publish-property/:propertyId(O)
                      PATCH /disable-property/:propertyId(O) · PATCH /add-images/:propertyId(O, multipart)
                      PATCH /remove-image/:propertyId(O, body { publicId }) · PATCH /moderate-property/:propertyId(A)
                      DELETE /:propertyId(O, soft → ARCHIVED)
/api/v1/room          POST /create-room/:propertyId(O, multipart) · PATCH /update-room/:roomId(O)
                      PATCH /update-status/:roomId(O) · GET /public/available-rooms🌐 · GET /:roomId🌐
/api/v1/roommate      POST /create-profile(T) · GET /my-profile(T) · PATCH /update-my-profile(T)
                      PATCH /toggle-search(T) · GET /matches(T) · GET /:roommateProfileId(T)
/api/v1/viewing       POST /request-viewing(T) · GET /my-viewings(T) · PATCH /cancel-viewing/:viewingId(T)
                      GET /owner-viewings(O) · PATCH /update-status/:viewingId(O, body { status, scheduledAt?, ownerNote? })
                      GET /all-viewings(A) · GET /:viewingId(✱ owner-of)
/api/v1/application   POST /submit-application(T) · GET /my-applications(T) · PATCH /cancel-application/:applicationId(T)
                      GET /owner-applications(O) · PATCH /approve-application/:applicationId(O)
                      PATCH /reject-application/:applicationId(O, body { rejectionReason })
                      GET /all-applications(A) · GET /:applicationId(✱ owner-of)
/api/v1/rental        GET /my-rentals(T) · GET /owner-rentals(O) · GET /all-rentals(A)
                      PATCH /terminate-rental/:rentalId(O) · PATCH /complete-rental/:rentalId(O) · GET /:rentalId(✱ owner-of)
/api/v1/payment       POST /pay-rent/:paymentId(T) · POST /webhook(Stripe only) · GET /my-payments(T)
                      GET /owner-payments(O) · GET /all-payments(A) · GET /:paymentId(✱ owner-of)
/api/v1/notification  GET /my-notifications(✱) · GET /unread-count(✱) · PATCH /mark-all-as-read(✱)
                      PATCH /mark-as-read/:notificationId(✱)
/api/v1/admin         GET /all-users(A) · GET /user/:userId(A) · PATCH /update-user-status/:userId(A) · POST /create-admin(SUPER_ADMIN)
/api/v1/analytics     GET /admin-analytics(A) · GET /owner-analytics(O)
/api/v1/audit         GET /all-audit-logs(A)
```

"✱ owner-of" = the single-item ownership check from the example's `getSingleAppointment`: tenants and owners only see their own records, and admins see all.

## API documentation (Swagger)

Not in the example. It's added with `@asteasolutions/zod-to-openapi` + `swagger-ui-express`, generated from the same Zod schemas.

| URL | What |
|---|---|
| `GET /api/docs` | Swagger UI |
| `GET /api/docs.json` | OpenAPI JSON (importable into Postman, like the example's Postman collection) |

Mounted in `app.ts` only when `config.node_env !== 'production'` or `SWAGGER_ENABLED=true`.

```text
src/app/docs/
  zod.ts       # import z from 'zod'; extendZodWithOpenApi(z); export { z }. Only *.openapi.ts files import from here
  registry.ts  # OpenAPIRegistry, security schemes (cookieAuth: accessToken cookie, bearerAuth: JWT), helpers:
               # successResponse(schema), paginatedResponse(schema), errorResponses(400, 401, ...)
  index.ts     # imports every module's x.openapi.ts, generates the document once
src/app/module/<x>/x.openapi.ts
```

- `x.validation.ts` stays plain Zod (`import z from 'zod'`, no `.openapi()` calls). `x.openapi.ts`
  imports those schemas and registers them:

```ts
registry.registerPath({
    method: 'patch',
    path: '/application/approve-application/{applicationId}',
    tags: ['Application'],
    summary: 'Approve a pending application (OWNER)',
    description: 'Reserves the room, creates a PENDING rental and first payment, rejects competing applications.',
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    request: { params: z.object({ applicationId: z.string() }) },
    responses: { 200: successResponse(ApplicationSchema, 'Application Approved Successfully'), ...errorResponses(401, 403, 404, 409) },
})
```

- Body: `request: { body: { content: { 'application/json': { schema: CreatePropertyValidationZodSchema } } } }`.
- Multipart: `'multipart/form-data'` with `images` (`z.string().openapi({ format: 'binary' })`) and `data` (a JSON string).
- List endpoints document their `IQuery` params with a `z.object({...})` in `request.query`.
- Tags = module name (`Auth`, `Property`, `Room`…). Public routes set `security: []`. The Stripe webhook gets the tag
  `Payment (Stripe webhook)` and the note "Called by Stripe only".
- Response schemas never include `password`.
- A route isn't done until it's registered in `x.openapi.ts`.
