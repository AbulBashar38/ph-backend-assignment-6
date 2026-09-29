import z from 'zod'
import { RentalStatus } from '../../../generated/prisma/enums'

/**
 * PATCH /rental/:id/status — end a rental (the tenant, the owner, or an admin):
 * COMPLETED {} → an ACTIVE rental ended normally (moved out)
 * TERMINATED { reason } → a PENDING or ACTIVE rental ended early
 */
export const UpdateRentalStatusValidationZodSchema = z.discriminatedUnion(
    'status',
    [
        z.object({ status: z.literal(RentalStatus.COMPLETED) }).strict(),
        z
            .object({
                status: z.literal(RentalStatus.TERMINATED),
                reason: z
                    .string('A Reason Is Required To Terminate A Rental')
                    .trim()
                    .min(3, 'A Reason Is Required To Terminate A Rental')
                    .max(500, 'Reason Must Be At Most 500 Characters Long'),
            })
            .strict(),
    ],
    { error: 'Status Must Be COMPLETED Or TERMINATED' },
)

export const RentalsQueryZodSchema = z.object({
    status: z.enum(RentalStatus, 'Invalid Rental Status').optional(),
    propertyId: z.string().trim().optional(),
    roomId: z.string().trim().optional(),
})
