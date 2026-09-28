import z from 'zod'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    optionalJsonBody,
    registry,
    successResponse,
} from '../../docs/registry'
import { UserSchema } from '../../docs/schemas'
import {
    ChangePasswordValidationZodSchema,
    ForgotPasswordValidationZodSchema,
    GoogleLoginValidationZodSchema,
    LoginValidationZodSchema,
    RefreshTokenValidationZodSchema,
    RegisterValidationZodSchema,
    ResendOtpValidationZodSchema,
    ResetPasswordValidationZodSchema,
    VerifyEmailValidationZodSchema,
} from './auth.validation'

const TAG = 'Auth'

const AuthTokensSchema = z.object({
    accessToken: z.string().meta({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
    refreshToken: z.string().meta({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
})

const AuthResultSchema = AuthTokensSchema.extend({ user: UserSchema })

// Docs-only view of RefreshTokenValidationZodSchema: same shape, explained, and `{}` as the default example
// so "Try it out" relies on the refreshToken cookie instead of sending a placeholder token
const OptionalRefreshTokenBodySchema = RefreshTokenValidationZodSchema.extend({
    refreshToken: z
        .string()
        .optional()
        .meta({
            description:
                'Only needed when the `refreshToken` cookie is not sent (Postman, mobile apps). ' +
                'Browsers and Swagger send the cookie automatically after /auth/login.',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        }),
}).meta({ example: {} })

const refreshTokenSourceNote =
    '**Where the refresh token comes from:**\n' +
    '- **Browser / Swagger:** send an empty body `{}`. The `refreshToken` cookie (set by /auth/login) is sent automatically.\n' +
    '- **Postman / mobile:** send `{ "refreshToken": "<token from login>" }`.\n' +
    'If both are present, the cookie wins.'

registry.registerPath({
    method: 'post',
    path: '/auth/register',
    tags: [TAG],
    summary: 'Start registration (public)',
    description:
        'Validates the data, stores it in Redis for 30 minutes and emails a 6-digit OTP (valid 5 minutes). ' +
        'The account is only created after /auth/verify-email. Role must be TENANT or OWNER.',
    security: [],
    request: {
        body: jsonBody(
            RegisterValidationZodSchema.meta({
                example: {
                    name: 'Rahim Uddin',
                    email: 'rahim@example.com',
                    phone: '01712345678',
                    password: 'Str0ng@Pass',
                    role: 'TENANT',
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Verification OTP Sent To Your Email'),
        ...errorResponses(400, 409, 429, 502),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/verify-email',
    tags: [TAG],
    summary: 'Verify the registration OTP and create the account (public)',
    description:
        'Creates the user and its Tenant/Owner profile, sets auth cookies and returns the tokens. ' +
        'After 5 wrong OTPs the code is invalidated (429).',
    security: [],
    request: {
        body: jsonBody(
            VerifyEmailValidationZodSchema.meta({
                example: { email: 'rahim@example.com', otp: '482913' },
            }),
        ),
    },
    responses: {
        201: successResponse('Email Verified And Account Created Successfully', AuthResultSchema),
        ...errorResponses(400, 404, 409, 429),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/resend-otp',
    tags: [TAG],
    summary: 'Resend the registration OTP (public)',
    description: 'Allowed once per minute per email.',
    security: [],
    request: { body: jsonBody(ResendOtpValidationZodSchema) },
    responses: {
        200: successResponse('A New Verification OTP Has Been Sent'),
        ...errorResponses(400, 404, 429, 502),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/login',
    tags: [TAG],
    summary: 'Log in with email and password (public)',
    description:
        'Sets `accessToken` and `refreshToken` httpOnly cookies and also returns the tokens.',
    security: [],
    request: {
        body: jsonBody(
            LoginValidationZodSchema.meta({
                example: { email: 'rahim@example.com', password: 'Str0ng@Pass' },
            }),
        ),
    },
    responses: {
        200: successResponse('User Logged In Successfully', AuthResultSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/google',
    tags: [TAG],
    summary: 'Log in or sign up with Google (public)',
    description:
        'Send the Google **ID token** (a JWT) that the frontend gets from Google Identity Services, ' +
        "not an access token. Its audience must be this API's `GOOGLE_CLIENT_ID`.\n\n" +
        '- Existing account (matched by Google ID, then email) → logged in (200); an email/password account gets Google linked.\n' +
        '- No account → a new one is created with `role` (TENANT by default) and a Tenant/Owner profile (201).\n' +
        '- The Google email must be verified by Google (403 otherwise).\n\n' +
        'Testing without a frontend: in the Google OAuth 2.0 Playground, use your own OAuth credentials, ' +
        'authorize the `openid email profile` scopes, exchange the code, and copy the `id_token`.',
    security: [],
    request: {
        body: jsonBody(
            GoogleLoginValidationZodSchema.meta({
                example: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...', role: 'TENANT' },
            }),
        ),
    },
    responses: {
        200: successResponse(
            'User Logged In With Google Successfully',
            AuthResultSchema.extend({ isNewUser: z.boolean() }),
        ),
        201: successResponse(
            'Account Created With Google Successfully',
            AuthResultSchema.extend({ isNewUser: z.boolean() }),
        ),
        ...errorResponses(400, 401, 403, 409),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/refresh-token',
    tags: [TAG],
    summary: 'Get a new token pair (public)',
    description:
        'Returns a new access + refresh token pair. Tokens are rotated: the old refresh token stops working, ' +
        'and replaying an old one later logs the user out everywhere. No access token needed.\n\n' +
        refreshTokenSourceNote,
    security: [],
    request: {
        body: optionalJsonBody(
            OptionalRefreshTokenBodySchema,
            'Optional: omit or send `{}` when the refreshToken cookie is present.',
        ),
    },
    responses: {
        200: successResponse('New Tokens Generated Successfully', AuthTokensSchema),
        ...errorResponses(401),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/logout',
    tags: [TAG],
    summary: 'Log out this device (public)',
    description:
        "Revokes this device's refresh token and clears both auth cookies. Other devices stay logged in. " +
        'No access token needed, so it works even after the access token has expired. ' +
        'Always returns 200, even if no (or an invalid) token was sent.\n\n' +
        refreshTokenSourceNote,
    security: [],
    request: {
        body: optionalJsonBody(
            OptionalRefreshTokenBodySchema,
            'Optional: omit or send `{}` when the refreshToken cookie is present.',
        ),
    },
    responses: {
        200: successResponse('User Logged Out Successfully'),
    },
})

registry.registerPath({
    method: 'get',
    path: '/auth/me',
    tags: [TAG],
    summary: 'Get the logged-in user (any role)',
    security: authSecurity,
    responses: {
        200: successResponse('User Profile Retrieved Successfully', UserSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/auth/change-password',
    tags: [TAG],
    summary: 'Change password (any role)',
    description: 'Logs out all other sessions and returns a fresh token pair.',
    security: authSecurity,
    request: { body: jsonBody(ChangePasswordValidationZodSchema) },
    responses: {
        200: successResponse('Password Changed Successfully', AuthTokensSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/forgot-password',
    tags: [TAG],
    summary: 'Email a password reset OTP (public)',
    security: [],
    request: { body: jsonBody(ForgotPasswordValidationZodSchema) },
    responses: {
        200: successResponse('Password Reset OTP Sent To Your Email'),
        ...errorResponses(400, 403, 404, 429, 502),
    },
})

registry.registerPath({
    method: 'post',
    path: '/auth/reset-password',
    tags: [TAG],
    summary: 'Reset password with the OTP (public)',
    description: 'Logs the user out of every device.',
    security: [],
    request: { body: jsonBody(ResetPasswordValidationZodSchema) },
    responses: {
        200: successResponse('Password Reset Successfully. Please Log In With Your New Password'),
        ...errorResponses(400, 403, 404, 429),
    },
})
