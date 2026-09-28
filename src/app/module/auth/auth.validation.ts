import z from 'zod'
import { Role } from '../../../generated/prisma/enums'
import { emailSchema, nameSchema, passwordSchema, phoneSchema } from '../../utils/commonZodSchemas'

const otpSchema = z.string('OTP Is Required').regex(/^\d{6}$/, 'OTP Must Be 6 Digits')

export const RegisterValidationZodSchema = z.object({
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
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
