import type z from 'zod'
import type {
    CreateAdminValidationZodSchema,
    DeleteUserValidationZodSchema,
    UpdateUserStatusValidationZodSchema,
    UpdateUserValidationZodSchema,
} from './user.validation'

export type IUpdateUserPayload = z.infer<typeof UpdateUserValidationZodSchema>
export type IDeleteUserPayload = z.infer<typeof DeleteUserValidationZodSchema>
export type IUpdateUserStatusPayload = z.infer<typeof UpdateUserStatusValidationZodSchema>
export type ICreateAdminPayload = z.infer<typeof CreateAdminValidationZodSchema>
