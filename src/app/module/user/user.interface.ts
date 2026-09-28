import type z from 'zod'
import type {
    DeleteUserValidationZodSchema,
    UpdateUserValidationZodSchema,
} from './user.validation'

export type IUpdateUserPayload = z.infer<typeof UpdateUserValidationZodSchema>
export type IDeleteUserPayload = z.infer<typeof DeleteUserValidationZodSchema>
