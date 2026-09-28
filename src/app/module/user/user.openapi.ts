import z from 'zod'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { UserSchema } from '../../docs/schemas'
import { USER_SEARCHABLE_FIELDS, USER_SORTABLE_FIELDS } from './user.constant'
import {
    DeleteUserValidationZodSchema,
    GetAllUsersQueryZodSchema,
    UpdateUserValidationZodSchema,
} from './user.validation'

const TAG = 'User'

const UserIdParams = z.object({
    id: z.string().meta({
        description: 'User ID. Your own ID is `data.id` from `GET /auth/me`.',
        example: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    }),
})

// Docs view of the query: the validated filters (as strings, like they arrive) + standard pagination params
const GetAllUsersQueryDocsSchema = z.object({
    searchTerm: z
        .string()
        .optional()
        .meta({
            description: `Case-insensitive match on ${USER_SEARCHABLE_FIELDS.join(', ')}`,
            example: 'rahim',
        }),
    role: GetAllUsersQueryZodSchema.shape.role,
    status: GetAllUsersQueryZodSchema.shape.status,
    authProvider: GetAllUsersQueryZodSchema.shape.authProvider,
    emailVerified: z.enum(['true', 'false']).optional(),
    isDeleted: z
        .enum(['true', 'false'])
        .optional()
        .meta({ description: 'Default `false`. `true` lists only soft-deleted accounts.' }),
    ...paginationQueryParams(USER_SORTABLE_FIELDS),
})

registry.registerPath({
    method: 'get',
    path: '/user',
    tags: [TAG],
    summary: 'List users with search, filters and pagination (ADMIN, SUPER_ADMIN)',
    description:
        'Returns `data` (users, without passwords, with their Tenant/Owner profile) and `meta` ' +
        '(`page`, `limit`, `total`, `totalPages`).\n\n' +
        '- Soft-deleted accounts are hidden unless `isDeleted=true`.\n' +
        '- Filters combine with AND. An invalid filter value (e.g. `role=KING`) → 400.\n' +
        '- Invalid `page`/`limit`/`sortBy` fall back to the defaults instead of failing.',
    security: authSecurity,
    request: { query: GetAllUsersQueryDocsSchema },
    responses: {
        200: paginatedResponse('Users Retrieved Successfully', UserSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/user/{id}',
    tags: [TAG],
    summary: 'Get user details (self or admin)',
    description:
        '- Any user → their **own** account (`id` = `data.id` from `GET /auth/me`).\n' +
        '- `ADMIN` / `SUPER_ADMIN` → any account, **including soft-deleted ones** (for support and restoring).\n' +
        'Anyone else → 403.',
    security: authSecurity,
    request: {
        params: z.object({
            id: z.string().meta({ example: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
        }),
    },
    responses: {
        200: successResponse('User Retrieved Successfully', UserSchema),
        ...errorResponses(401, 403, 404),
    },
})

const permissionsNote =
    '**Who can call it:**\n' +
    '- Any user → their **own** account.\n' +
    '- `ADMIN` → tenant and owner accounts (not other admins or the super admin).\n' +
    '- `SUPER_ADMIN` → any account.\n' +
    'Anyone else → 403.'

registry.registerPath({
    method: 'patch',
    path: '/user/{id}',
    tags: [TAG],
    summary: 'Update a user profile (self or admin)',
    description:
        `${permissionsNote}\n\n` +
        'Send only the fields you want to change (at least one).\n' +
        '- `name`, `phone` for every role (a phone used by another account → 409).\n' +
        "- The **target account's** role decides the profile fields: TENANT → `occupation`, `gender`; " +
        "OWNER → `address`. Another role's field → 400.\n" +
        '- `null` clears `occupation`, `gender` or `address`.\n' +
        "- Email, role, status and password can't be changed here (unknown fields → 400). " +
        'Use `/auth/change-password` for the password.',
    security: authSecurity,
    request: {
        params: UserIdParams,
        body: jsonBody(
            UpdateUserValidationZodSchema.meta({
                example: {
                    name: 'Rahim Uddin',
                    phone: '01712345678',
                    occupation: 'Software Engineer',
                },
            }),
        ),
    },
    responses: {
        200: successResponse('User Updated Successfully', UserSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'delete',
    path: '/user/{id}',
    tags: [TAG],
    summary: 'Delete a user account: soft delete (self or admin)',
    description:
        `${permissionsNote} The \`SUPER_ADMIN\` account can never be deleted.\n\n` +
        '**Soft delete**: the account is marked deleted (`isDeleted`, `deletedAt`, status `DELETED`) together with ' +
        'its Tenant/Owner profile; no data is removed. The deleted user is logged out on every device and can no ' +
        "longer log in; the email/phone can't be registered again (contact support to restore).\n\n" +
        '- Confirm with **your own** password in `password` (missing → 400, wrong → 401). Also when an admin deletes someone.\n' +
        '- Callers without a password (Google-only accounts) can send `{}`.\n' +
        '- Deleting your own account also clears your auth cookies; deleting someone else leaves your session alone.',
    security: authSecurity,
    request: {
        params: UserIdParams,
        body: jsonBody(
            DeleteUserValidationZodSchema.meta({ example: { password: 'Str0ng@Pass' } }),
        ),
    },
    responses: {
        200: successResponse('User Deleted Successfully'),
        ...errorResponses(400, 401, 403, 404),
    },
})
