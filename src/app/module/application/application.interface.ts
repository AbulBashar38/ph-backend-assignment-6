import type z from 'zod'
import type {
    CreateApplicationValidationZodSchema,
    UpdateApplicationStatusValidationZodSchema,
} from './application.validation'

export type ICreateApplicationPayload = z.infer<typeof CreateApplicationValidationZodSchema>
export type IUpdateApplicationStatusPayload = z.infer<
    typeof UpdateApplicationStatusValidationZodSchema
>
