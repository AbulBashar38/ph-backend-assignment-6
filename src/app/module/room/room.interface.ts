import type z from 'zod'
import type {
    CreateRoomValidationZodSchema,
    UpdateRoomStatusValidationZodSchema,
    UpdateRoomValidationZodSchema,
} from './room.validation'

export type ICreateRoomPayload = z.infer<typeof CreateRoomValidationZodSchema>
export type IUpdateRoomPayload = z.infer<typeof UpdateRoomValidationZodSchema>
export type IUpdateRoomStatusPayload = z.infer<typeof UpdateRoomStatusValidationZodSchema>
