import z from 'zod'
import { Role } from '../../../generated/prisma/enums'

// Normalize first (trim + lowercase), then check the format, so " Rahim@Example.com " is accepted
const emailSchema = z
    .string('Email Is Required')
    .trim()
    .toLowerCase()
    .pipe(z.email('Invalid Email Address'))
    .meta({ format: 'email', example: 'rahim@example.com' })

const passwordSchema = z
    .string('Password Is Required')
    .min(8, 'Password Must Be At Least 8 Characters Long')
    .max(64, 'Password Must Be At Most 64 Characters Long')
    .regex(/[a-z]/, 'Password Must Contain At Least 1 Lowercase Letter')
    .regex(/[A-Z]/, 'Password Must Contain At Least 1 Uppercase Letter')
    .regex(/[0-9]/, 'Password Must Contain At Least 1 Number')
    .regex(/[^A-Za-z0-9]/, 'Password Must Contain At Least 1 Special Character')

const otpSchema = z.string('OTP Is Required').regex(/^\d{6}$/, 'OTP Must Be 6 Digits')

export const RegisterValidationZodSchema = z.object({
    name: z
        .string('Name Is Required')
        .trim()
        .min(2, 'Name Must Be At Least 2 Characters Long')
        .max(50, 'Name Must Be At Most 50 Characters Long'),
    email: emailSchema,
    phone: z
        .string('Phone Number Is Required')
        .trim()
        .regex(/^\+?[0-9]{10,15}$/, 'Phone Number Must Be 10-15 Digits'),
    password: passwordSchema,
    role: z.enum([Role.TENANT, Role.OWNER], 'Role Must Be Either TENANT Or OWNER'),
})

export const VerifyEmailValidationZodSchema = z.object({
    email: emailSchema,
    otp: otpSchema,
})

export const ResendOtpValidationZodSchema = z.object({
    email: emailSchema,
})

export const LoginValidationZodSchema = z.object({
    email: emailSchema,
    // No strength rules on login: only check that something was sent
    password: z.string('Password Is Required').min(1, 'Password Is Required'),
})

export const RefreshTokenValidationZodSchema = z.object({
    // Optional because browsers send it as a cookie; API clients may send it in the body
    refreshToken: z.string().optional(),
})

export const GoogleLoginValidationZodSchema = z.object({
    idToken: z.string('Google ID Token Is Required').min(1, 'Google ID Token Is Required'),
    // Only used when this Google login creates a new account; ignored for existing users
    role: z
        .enum([Role.TENANT, Role.OWNER], 'Role Must Be Either TENANT Or OWNER')
        .default(Role.TENANT),
})

export const ChangePasswordValidationZodSchema = z
    .object({
        oldPassword: z.string('Old Password Is Required').min(1, 'Old Password Is Required'),
        newPassword: passwordSchema,
    })
    .refine((data) => data.oldPassword !== data.newPassword, {
        message: 'New Password Must Be Different From The Old Password',
    })

export const ForgotPasswordValidationZodSchema = z.object({
    email: emailSchema,
})

export const ResetPasswordValidationZodSchema = z.object({
    email: emailSchema,
    otp: otpSchema,
    newPassword: passwordSchema,
})
