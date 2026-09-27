# Authentication & Authorization

Based on the approach in `example-backend/src/app/module/auth/auth.service.ts` (worth reading for the OTP and Google flows),
with the fixes and additions below.

## Roles, status, user model

- `Role`: `SUPER_ADMIN`, `ADMIN`, `OWNER`, `TENANT`. Users register as `TENANT` or `OWNER`.
  `SUPER_ADMIN` is seeded from env (`utils/seed.ts`, as in the example), and admins are created by the super admin.
- `UserStatus`: `ACTIVE`, `BLOCKED` (= "suspended" in the requirements), `DELETED`.
- `AuthProvider`: `CREDENTIAL`, `GOOGLE`.
- `User` fields (as in the example): `name, email @unique, phone? @unique, password?, googleId? @unique, authProvider,
  emailVerified, role, status, needPasswordChange, imageUrl, imagePublicId, isDeleted, deletedAt`.
- Role profile, 1–1 with `User` (like `Patient`/`Doctor`): `Tenant` (`occupation?`, `gender?`) or `Owner` (`address?`), both with
  `userId @unique`, `name`, `email`. The phone number lives on `User.phone`.
  It's created in the same nested `prisma.user.create` as the user.

## Tokens (same as the example, plus revocation)

- JWT payload: `{ userId, name, email, role }` (`RequestUser`). Created with `jwtUtils.createToken`.
- Cookies `accessToken` / `refreshToken` are set by `utils/setAuthCookie.ts` (`secure` in production, `sameSite: 'none'`
  only when secure, otherwise `'lax'`), and **also** returned in `data`, like the example.
- `auth(...roles)` reads the cookie or `Authorization` header, exactly like the example, but finds the user **by `id`**
  and rejects `BLOCKED`, `DELETED`, and `isDeleted`.
- **Addition (implemented in `utils/authTokens.ts`):** every refresh token has a `jti`, and Redis keeps
  `refresh-token:{userId}:{jti}` = `active` (TTL = refresh expiry). One key per token → several devices can be logged in.
  - `/refresh-token` claims the token atomically (`SET … XX KEEPTTL GET` → `used:<timestamp>`) and issues a new pair (rotation).
  - Replaying a used token **within 10 s** (two tabs refreshing at once) → 401 only. Replaying it **later** → treated as theft:
    every `refresh-token:{userId}:*` key is deleted.
  - `/logout` deletes that one key. Password change/reset (and, later, admin block) delete all of the user's keys.
- The refresh token is read from the `refreshToken` cookie (path `/api/v1/auth`) or `body.refreshToken` (Postman/mobile).

## Flows

### Register → OTP → verify (example pattern: pending data in Redis, user created only after verification)

```text
POST /auth/register { name, email, phone, password, role: TENANT|OWNER }
  → email is trimmed + lowercased by the Zod schema; 409 if a user with this email or phone exists
  → hash the password (config.bcrypt_salt_rounds)
  → otp = crypto.randomInt(100000, 1000000).toString()
  → SET otp-cooldown:user-registration:{email} NX EX 60 (429 if already set)
  → SET user-registration-otp:{email} otp EX 300
  → SET user-registration-data:{email} JSON(payload with hashed password) EX 1800 (outlives the OTP so resend works)
  → sendEmail('registration-user-otp', { name, email, otp, expirationMinutes: 5 }); on failure clear the OTP + cooldown → 502
  → 201 "Verification OTP Sent", data: null

POST /auth/verify-email { email, otp }
  → OTP missing → 400 "OTP expired"; wrong → INCR otp-attempts:user-registration:{email}; at 5, delete the OTP → 429
  → read the registration data (404 if missing) → prisma.user.create({ ..., emailVerified: true,
    tenant|owner: { create: {...} } }, omit password)
  → del the OTP + data keys → welcome email (non-blocking) → tokens + cookies → 201 { accessToken, refreshToken, user }

POST /auth/resend-otp { email }
  → 404 if there's no pending registration data; 429 if the cooldown key exists
  → new OTP, reset the data key's TTL to 30 min, send the email
```

### Login (example `loginUser`)

```text
POST /auth/login { email, password }
  → unknown/deleted user or wrong password → the same 401 "Invalid Email Or Password" (no account probing)
  → password null (Google-only account) → 400 "Continue With Google"
  → BLOCKED → 403 (checked after the password, so block status isn't revealed to strangers)
  → tokens + cookies, and returns { accessToken, refreshToken, user }
```

### Google (example `googleLogin`: the frontend sends a Google ID token)

```text
POST /auth/google { idToken, role?: TENANT|OWNER }      # role is used only when creating a new account; default TENANT
  → googleClient.verifyIdToken({ idToken, audience: config.google_client_id }) → 401 on failure
  → require payload.email and payload.name
  → user with this googleId → log in
  → else a CREDENTIAL user with this email → must be emailVerified and not blocked → link googleId
  → else create User(authProvider GOOGLE, emailVerified true, password null) + Tenant/Owner profile → welcome email
  → blocked/deleted checks → tokens + cookies
```

### Forgot / reset / change password (example pattern)

```text
POST /auth/forgot-password { email }
  → 404 / 403 checks like the example; Google-only account → 400
  → SET forgot-password-otp:{email} EX 300 (+ cooldown) → sendEmail('forgot-password', ...)
POST /auth/reset-password { email, otp, newPassword }
  → verify the OTP (+ attempt counter) → hash → update → revoke all refresh tokens
  → sendEmail('reset-password-success', ...)
PATCH /auth/change-password (auth) { oldPassword, newPassword }
  → compare the old password → update, needPasswordChange = false → revoke all refresh tokens → issue a fresh pair
POST /auth/logout (no auth needed) → delete this refresh token's key if valid, always clear cookies → 200
```

## Validation (in `auth.validation.ts`, same style as the example)

The password rule, copied from the example: min 8, at least 1 lowercase letter, 1 uppercase letter, 1 number, and 1 special character.
`otp: z.string().length(6)`. `email: z.email()`. `role: z.enum(['TENANT', 'OWNER'])`.
