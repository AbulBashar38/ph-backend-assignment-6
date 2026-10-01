import type z from 'zod'
import type {
    CreatePropertyValidationZodSchema,
    UpdatePropertyStatusValidationZodSchema,
    UpdatePropertyValidationZodSchema,
} from './property.validation'

export type ICreatePropertyPayload = z.infer<typeof CreatePropertyValidationZodSchema>
export type IUpdatePropertyPayload = z.infer<typeof UpdatePropertyValidationZodSchema>
export type IUpdatePropertyStatusPayload = z.infer<typeof UpdatePropertyStatusValidationZodSchema>
