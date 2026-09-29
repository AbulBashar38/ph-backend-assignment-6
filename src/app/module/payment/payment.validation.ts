import z from 'zod'
import { PaymentStatus } from '../../../generated/prisma/enums'

// There is no body to validate for payments: the amount always comes from the Payment row, never the client
export const PaymentsQueryZodSchema = z.object({
    status: z.enum(PaymentStatus, 'Invalid Payment Status').optional(),
    rentalId: z.string().trim().optional(),
    propertyId: z.string().trim().optional(),
    tenantId: z.string().trim().optional(),
})
