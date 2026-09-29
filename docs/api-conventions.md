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
- Never spread `req.body` into Prisma `data` for fields a client must not set (`status`, `ownerId`, `role`, `amount`).
  The Zod schema simply doesn't include them.

## Lists: search / filter / sort / paginate

Reference implementation: `UserServices.getAllUsers` (`GET /api/v1/user`). Copy its shape for every list endpoint.

```ts
// x.constant.ts: one source for the service and the Swagger docs
export const PROPERTY_SEARCHABLE_FIELDS = ['title', 'city', 'area'] as const
export const PROPERTY_SORTABLE_FIELDS = ['createdAt', 'monthlyRent', 'availableFrom'] as const

// x.validation.ts: filters only; query values are strings ('true'/'false', enums)
export const GetAllPropertiesQueryZodSchema = z.object({ searchTerm: ..., city: ..., propertyType: z.enum(PropertyType).optional() })

// x.service.ts
const getAllProperties = async (query: IQuery) => {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(query, PROPERTY_SORTABLE_FIELDS, 'createdAt')
    const filters = GetAllPropertiesQueryZodSchema.parse(query) // bad filter value → ZodError → 400

    const andConditions: PropertyWhereInput[] = [{ isDeleted: false }]
    if (filters.searchTerm) andConditions.push({ OR: PROPERTY_SEARCHABLE_FIELDS.map((f) => ({ [f]: { contains: filters.searchTerm, mode: 'insensitive' } })) })
    if (filters.city) andConditions.push({ city: { equals: filters.city, mode: 'insensitive' } })

    const where = { AND: andConditions }
    const [data, total] = await prisma.$transaction([
        prisma.property.findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder }, select/include }),
        prisma.property.count({ where }),
    ])
    return { data, meta: buildPaginationMeta(page, limit, total) }
}

// x.controller.ts
const { data, meta } = await PropertyServices.getAllProperties(req.query as IQuery)
sendResponse(res, { statusCode: 200, success: true, message: 'Properties Retrieved Successfully', data, meta })
```

- `paginationHelper` (`utils/paginationHelper.ts`): page 1, limit 10 (max 100), `createdAt desc` by default. It's **lenient**:
  a bad `page`/`limit`/`sortBy` falls back to the default. `sortBy` is only taken from the whitelist (anything else would
  make Prisma throw).
- Filters are **strict**: they're parsed with the module's Zod query schema inside the service (Express 5's `req.query` is
  read-only, so `validateRequest` can't be used for queries). An invalid value (e.g. `role=KING`) → 400.
- `findMany` + `count` run in one `prisma.$transaction([...])`, so the page and the total come from the same snapshot.
- Always exclude soft-deleted rows by default; only admin lists may opt in with `isDeleted=true`.
- Swagger: `request.query` = the filters + `...paginationQueryParams(SORTABLE_FIELDS)`, and the response is
  `paginatedResponse(description, ItemSchema)` (both in `docs/registry.ts`).

Public property search params: `searchTerm, city, area, propertyType, roomType, minRent, maxRent, occupants, amenities,
availableFrom, sortBy, sortOrder, page, limit`. Public endpoints use `select` to expose only safe fields
(example `getAllDoctorsListPublic`).

## Route map (singular mount, action-style kebab paths, `/:id` last)

Legend: 🌐 public · T tenant · O owner · A admin/super admin · ✱ any logged-in user

```text
/api/v1/auth          POST /register · /verify-email · /resend-otp · /login · /google · /refresh-token
                      POST /logout · /forgot-password · /reset-password · PATCH /change-password(✱) · GET /me(✱)
/api/v1/user          GET /(A; search/filter/paginate) · GET /:id(self, or A: any account incl. soft-deleted)
                      PATCH /:id(self, or A per role rules) · DELETE /:id(self, or A per role rules; soft delete;
                      body { password } = caller's own)
                      PATCH /:id/profile-image(self or A; multipart `profileImage`) · DELETE /:id/profile-image(self or A)
/api/v1/property      (implemented; "O/A" = owner of the property, or any admin)
                      POST /(O for self, A with ownerId; JSON → DRAFT) · GET /(O → own listings, A → all)
                      GET /:id(O/A) · PATCH /:id(O/A) · PATCH /:id/publish(O/A) · PATCH /:id/disable(O/A)
                      POST /:id/images(O/A, multipart `images`, 1–10) · DELETE /:id/images/:imageId(O/A)
                      DELETE /:id(O/A, soft → ARCHIVED) · PATCH /:id/moderate(A only, { action, reason })
                      GET /public/all-properties🌐 · GET /public/:id🌐
/api/v1/room          (implemented; "O/A" = owner of the room's property, or any admin)
                      POST /(O/A, JSON with propertyId) · GET /(O → rooms of own properties, A → all) · GET /:id(O/A)
                      PATCH /:id(O/A) · PATCH /:id/status(O/A, AVAILABLE | UNAVAILABLE | MAINTENANCE)
                      POST /:id/images(O/A, multipart `images`, 1–10) · DELETE /:id/images/:imageId(O/A)
                      DELETE /:id(O/A, soft delete) · GET /public/available-rooms🌐 · GET /public/:id🌐
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

**Management lists are scoped by role on one route**, not split into `/my-x` + `/all-x`: e.g. `GET /property`
returns an owner's own listings and every listing for admins (same full shape). Public data always has its own
`/public/...` routes, so drafts and deleted records can't leak through role logic.

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
  registry.ts  # OpenAPIRegistry, security schemes (cookieAuth: accessToken cookie, bearerAuth: JWT) + helpers:
               # authSecurity, jsonBody(schema), successResponse(description, dataSchema?), errorResponses(400, 401, ...)
               # (add paginatedResponse(description, itemSchema) with the first list endpoint)
  index.ts     # imports every module's x.openapi.ts, generates the document once
src/app/module/<x>/x.openapi.ts
```

- **Use zod's `.meta()`, never `.openapi()` or `registry.register()`.** We don't call `extendZodWithOpenApi`, so
  `.openapi()` doesn't exist at runtime and `registry.register()` crashes on boot (it calls `.openapi()` internally).
  - Examples/format: `.meta({ example: 'rahim@example.com', format: 'email' })`
  - Named component (`#/components/schemas/User`): `.meta({ id: 'User' })`
- `x.validation.ts` stays plain Zod. `x.openapi.ts` imports those schemas and registers the paths
  (see `src/app/module/auth/auth.openapi.ts` for a complete example):

```ts
registry.registerPath({
    method: 'patch',
    path: '/application/approve-application/{applicationId}',
    tags: ['Application'],
    summary: 'Approve a pending application (OWNER)',
    description: 'Reserves the room, creates a PENDING rental and first payment, rejects competing applications.',
    security: authSecurity,
    request: { params: z.object({ applicationId: z.string() }) },
    responses: { 200: successResponse('Application Approved Successfully', ApplicationSchema), ...errorResponses(401, 403, 404, 409) },
})
```

- Body: `request: { body: jsonBody(CreatePropertyValidationZodSchema.meta({ example: {...} })) }`.
- Multipart: `multipartBody(z.object({ images: fileField('…') }))` from `docs/registry.ts` (Swagger shows a file picker).
- List endpoints document their `IQuery` params with a `z.object({...})` in `request.query`.
- Tags = module name (`Auth`, `Property`, `Room`…). Public routes set `security: []`. The Stripe webhook gets the tag
  `Payment (Stripe webhook)` and the note "Called by Stripe only".
- Response schemas never include `password`.
- A route isn't done until it's registered in `x.openapi.ts`.
