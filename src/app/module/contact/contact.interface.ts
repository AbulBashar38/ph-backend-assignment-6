import type z from 'zod'
import type { ContactValidationZodSchema } from './contact.validation'

export type IContactPayload = z.infer<typeof ContactValidationZodSchema>
