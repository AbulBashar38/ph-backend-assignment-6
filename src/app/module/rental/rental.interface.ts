import type z from 'zod'
import type { UpdateRentalStatusValidationZodSchema } from './rental.validation'

export type IUpdateRentalStatusPayload = z.infer<typeof UpdateRentalStatusValidationZodSchema>
