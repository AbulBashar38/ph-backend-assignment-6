import z from 'zod'
import { ApplicationStatus } from '../../../generated/prisma/enums'
import { MAX_MOVE_IN_DAYS_AHEAD } from './application.constant'

const DAY_MS = 24 * 60 * 60 * 1000

const startOfToday = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
}

const noteSchema = (field: string) =>
    z.string().trim().min(1).max(500, `${field} Must Be At Most 500 Characters Long`)

export const CreateApplicationValidationZodSchema = z
    .object({
        roomId: z.string('Room ID Is Required').trim().min(1, 'Room ID Is Required'),
        moveInDate: z.iso
            .datetime({
                offset: true,
                error: 'Move-In Date Must Be An ISO Date, e.g. 2026-11-01T00:00:00Z',
            })
            .transform((value) => new Date(value))
            .refine((date) => date >= startOfToday(), "Move-In Date Can't Be In The Past")
            .refine(
                (date) => date.getTime() <= Date.now() + MAX_MOVE_IN_DAYS_AHEAD * DAY_MS,
                `Move-In Date Must Be Within ${MAX_MOVE_IN_DAYS_AHEAD} Days`,
            ),
        message: noteSchema('Message').optional(),
    })
    .strict()

/**
 * PATCH /application/:id/status — one endpoint, the body depends on the status:
 * APPROVED {} · REJECTED { rejectionReason? } (property owner / admin) · CANCELLED { reason? } (the tenant)
 */
export const UpdateApplicationStatusValidationZodSchema = z.discriminatedUnion(
    'status',
    [
        z.object({ status: z.literal(ApplicationStatus.APPROVED) }).strict(),
        z
            .object({
                status: z.literal(ApplicationStatus.REJECTED),
                rejectionReason: noteSchema('Rejection Reason').optional(),
            })
            .strict(),
        z
            .object({
                status: z.literal(ApplicationStatus.CANCELLED),
                reason: noteSchema('Reason').optional(),
            })
            .strict(),
    ],
    { error: 'Status Must Be APPROVED, REJECTED Or CANCELLED' },
)

export const ApplicationsQueryZodSchema = z.object({
    status: z.enum(ApplicationStatus, 'Invalid Application Status').optional(),
    propertyId: z.string().trim().optional(),
    roomId: z.string().trim().optional(),
})
