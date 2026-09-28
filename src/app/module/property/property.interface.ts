import type z from 'zod'
import type {
    CreatePropertyValidationZodSchema,
    ModeratePropertyValidationZodSchema,
    UpdatePropertyValidationZodSchema,
} from './property.validation'

export type ICreatePropertyPayload = z.infer<typeof CreatePropertyValidationZodSchema>
export type IUpdatePropertyPayload = z.infer<typeof UpdatePropertyValidationZodSchema>
export type IModeratePropertyPayload = z.infer<typeof ModeratePropertyValidationZodSchema>
