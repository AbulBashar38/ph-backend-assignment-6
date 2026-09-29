import type z from 'zod'
import type {
    CreateViewingValidationZodSchema,
    UpdateViewingStatusValidationZodSchema,
} from './viewing.validation'

export type ICreateViewingPayload = z.infer<typeof CreateViewingValidationZodSchema>
export type IUpdateViewingStatusPayload = z.infer<typeof UpdateViewingStatusValidationZodSchema>
