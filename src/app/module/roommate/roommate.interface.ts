import type z from 'zod'
import type {
    CreateRoommateProfileValidationZodSchema,
    UpdateRoommateProfileStatusValidationZodSchema,
    UpdateRoommateProfileValidationZodSchema,
} from './roommate.validation'

export type ICreateRoommateProfilePayload = z.infer<typeof CreateRoommateProfileValidationZodSchema>
export type IUpdateRoommateProfilePayload = z.infer<typeof UpdateRoommateProfileValidationZodSchema>
export type IUpdateRoommateProfileStatusPayload = z.infer<
    typeof UpdateRoommateProfileStatusValidationZodSchema
>
