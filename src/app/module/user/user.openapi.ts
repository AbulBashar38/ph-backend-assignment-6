import z from 'zod'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    registry,
    successResponse,
} from '../../docs/registry'
import { UserSchema } from '../../docs/schemas'
import { DeleteUserValidationZodSchema, UpdateUserValidationZodSchema } from './user.validation'

const TAG = 'User'

const UserIdParams = z.object({
    id: z.string().meta({
        description: 'User ID. Your own ID is `data.id` from `GET /auth/me`.',
        example: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    }),
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
