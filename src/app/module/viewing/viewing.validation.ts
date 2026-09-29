import z from 'zod'
import { ViewingStatus } from '../../../generated/prisma/enums'
import { MAX_DAYS_AHEAD } from './viewing.constant'

const DAY_MS = 24 * 60 * 60 * 1000

const futureViewingTime = (field: string) =>
    z.iso
        .datetime({
            offset: true,
            error: `${field} Must Be An ISO Date-Time, e.g. 2026-11-05T16:00:00+06:00`,
        })
        .transform((value) => new Date(value))
        .refine((date) => date.getTime() > Date.now(), `${field} Must Be In The Future`)
        .refine(
            (date) => date.getTime() <= Date.now() + MAX_DAYS_AHEAD * DAY_MS,
            `${field} Must Be Within ${MAX_DAYS_AHEAD} Days`,
        )

const noteSchema = (field: string) =>
    z.string().trim().min(1).max(500, `${field} Must Be At Most 500 Characters Long`)

export const CreateViewingValidationZodSchema = z
    .object({
        propertyId: z.string('Property ID Is Required').trim().min(1, 'Property ID Is Required'),
        // Optional: view a specific room instead of the property in general
        roomId: z.string().trim().min(1).optional(),
        preferredAt: futureViewingTime('Preferred Time'),
        message: noteSchema('Message').optional(),
    })
    .strict()

/**
 * PATCH /viewing/:id/status — one endpoint, the body depends on the chosen status:
 * APPROVED {} · REJECTED { ownerNote? } · RESCHEDULED { scheduledAt, ownerNote? } · COMPLETED {} (owner/admin)
 * CANCELLED { reason? } (the tenant who asked)
 */
export const UpdateViewingStatusValidationZodSchema = z.discriminatedUnion(
    'status',
    [
        z.object({ status: z.literal(ViewingStatus.APPROVED) }).strict(),
        z
            .object({
                status: z.literal(ViewingStatus.REJECTED),
                ownerNote: noteSchema('Note').optional(),
            })
            .strict(),
        z
            .object({
                status: z.literal(ViewingStatus.RESCHEDULED),
                scheduledAt: futureViewingTime('New Time'),
                ownerNote: noteSchema('Note').optional(),
            })
            .strict(),
        z.object({ status: z.literal(ViewingStatus.COMPLETED) }).strict(),
        z
            .object({
                status: z.literal(ViewingStatus.CANCELLED),
                reason: noteSchema('Reason').optional(),
            })
            .strict(),
    ],
    { error: 'Status Must Be APPROVED, REJECTED, RESCHEDULED, COMPLETED Or CANCELLED' },
)

// GET /viewing filters (scope comes from the caller's role)
export const ViewingsQueryZodSchema = z.object({
    status: z.enum(ViewingStatus, 'Invalid Viewing Status').optional(),
    propertyId: z.string().trim().optional(),
    roomId: z.string().trim().optional(),
})
