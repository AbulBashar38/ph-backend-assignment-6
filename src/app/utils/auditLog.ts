import type { Prisma } from '../../generated/prisma/client'
import type { AuditAction } from '../../generated/prisma/enums'
import type { RequestUser } from '../middleware/checkAuth'

interface IAuditLogInput {
    // null for system actions (cron jobs)
    actor: Pick<RequestUser, 'userId' | 'role'> | null
    action: AuditAction
    resource: 'User' | 'Property' | 'Room'
    resourceId: string
    previousData?: unknown
    newData?: unknown
}

// Dates and other non-JSON values become plain JSON (dates → ISO strings)
const toJson = (value: unknown) =>
    value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue)

/**
 * Requirement §19: write this INSIDE the same transaction as the change it describes,
 * so a change is never saved without its log (or the other way round).
 */
export const createAuditLog = (tx: Prisma.TransactionClient, input: IAuditLogInput) =>
    tx.auditLog.create({
        data: {
            actorId: input.actor?.userId ?? null,
            actorRole: input.actor?.role ?? null,
            action: input.action,
            resource: input.resource,
            resourceId: input.resourceId,
            previousData: toJson(input.previousData),
            newData: toJson(input.newData),
        },
    })
