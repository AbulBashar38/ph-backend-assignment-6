import z from 'zod'

export const MyNotificationsQueryZodSchema = z.object({
    isRead: z
        .enum(['true', 'false'], 'isRead Must Be true Or false')
        .transform((value) => value === 'true')
        .optional(),
})
