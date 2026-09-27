import type z from 'zod'
import type { Role } from '../../../generated/prisma/enums'
import type {
    ChangePasswordValidationZodSchema,
    ForgotPasswordValidationZodSchema,
    GoogleLoginValidationZodSchema,
    LoginValidationZodSchema,
    RegisterValidationZodSchema,
    ResendOtpValidationZodSchema,
    ResetPasswordValidationZodSchema,
    VerifyEmailValidationZodSchema,
} from './auth.validation'

export type IRegisterPayload = z.infer<typeof RegisterValidationZodSchema>
export type IVerifyEmailPayload = z.infer<typeof VerifyEmailValidationZodSchema>
export type IResendOtpPayload = z.infer<typeof ResendOtpValidationZodSchema>
export type ILoginPayload = z.infer<typeof LoginValidationZodSchema>
export type IGoogleLoginPayload = z.infer<typeof GoogleLoginValidationZodSchema>
export type IChangePasswordPayload = z.infer<typeof ChangePasswordValidationZodSchema>
export type IForgotPasswordPayload = z.infer<typeof ForgotPasswordValidationZodSchema>
export type IResetPasswordPayload = z.infer<typeof ResetPasswordValidationZodSchema>

// Stored in Redis between /register and /verify-email; the user row is only created after verification
export interface IPendingRegistration {
    name: string
    email: string
    phone: string
    password: string // already hashed
    role: typeof Role.TENANT | typeof Role.OWNER
}
