import type z from 'zod'
import type { PaymentsQueryZodSchema } from './payment.validation'

export type IPaymentsQuery = z.infer<typeof PaymentsQueryZodSchema>
