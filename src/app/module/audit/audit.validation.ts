import z from 'zod'
import { AuditAction, Role } from '../../../generated/prisma/enums'
import { AUDIT_RESOURCES } from './audit.constant'

// Query-string filters for GET /audit (page/limit/sort are handled by paginationHelper)
export const AuditLogsQueryZodSchema = z
    .object({
        action: z.enum(AuditAction, 'Invalid Audit Action').optional(),
        resource: z
            .enum(AUDIT_RESOURCES, `Resource Must Be One Of: ${AUDIT_RESOURCES.join(', ')}`)
            .optional(),
        resourceId: z.string().trim().optional(),
        // `actorId=system` → actions done by the cron jobs / Stripe webhook (no user)
        actorId: z.string().trim().optional(),
        actorRole: z.enum(Role, 'Invalid Role').optional(),
        from: z.iso.datetime({ offset: true, error: 'from Must Be An ISO Date' }).optional(),
        to: z.iso.datetime({ offset: true, error: 'to Must Be An ISO Date' }).optional(),
    })
    .refine((data) => !data.from || !data.to || new Date(data.from) <= new Date(data.to), {
        message: 'from Must Be Before to',
    })
