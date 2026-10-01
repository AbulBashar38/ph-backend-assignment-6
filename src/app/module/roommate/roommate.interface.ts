import type z from 'zod'
import type {
    CreateRoommateProfileValidationZodSchema,
    CreateRoommateRequestValidationZodSchema,
    UpdateRoommateProfileStatusValidationZodSchema,
    UpdateRoommateProfileValidationZodSchema,
    UpdateRoommateRequestStatusValidationZodSchema,
} from './roommate.validation'

export type ICreateRoommateProfilePayload = z.infer<typeof CreateRoommateProfileValidationZodSchema>
export type IUpdateRoommateProfilePayload = z.infer<typeof UpdateRoommateProfileValidationZodSchema>
export type IUpdateRoommateProfileStatusPayload = z.infer<
    typeof UpdateRoommateProfileStatusValidationZodSchema
>
export type ICreateRoommateRequestPayload = z.infer<typeof CreateRoommateRequestValidationZodSchema>
export type IUpdateRoommateRequestStatusPayload = z.infer<
    typeof UpdateRoommateRequestStatusValidationZodSchema
>
