import httpStatus from 'http-status'
import type { AuditLog } from '../../../generated/prisma/client'
import type { AuditLogWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../utils/AppError'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { AUDIT_SORTABLE_FIELDS } from './audit.constant'
import { AuditLogsQueryZodSchema } from './audit.validation'

export const SYSTEM_ACTOR = 'system'

/**
 * `actorId` is deliberately not a relation (logs must outlive anything), so the actors of a page are looked up in one
 * query. A deleted account still shows (with isDeleted); null = a system action (cron job, Stripe webhook).
 */
const withActors = async (logs: AuditLog[]) => {
    const actorIds = [...new Set(logs.flatMap((log) => (log.actorId ? [log.actorId] : [])))]
    const actors = actorIds.length
        ? await prisma.user.findMany({
              where: { id: { in: actorIds } },
              select: { id: true, name: true, email: true, role: true, isDeleted: true },
          })
        : []
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]))

    return logs.map((log) => ({
        ...log,
        actor: log.actorId ? (actorsById.get(log.actorId) ?? null) : null,
    }))
}

// ADMIN / SUPER_ADMIN only (route). Requirement §19: "Administrators should be able to review these records."
const getAuditLogs = async (query: IQuery) => {
    const filters = AuditLogsQueryZodSchema.parse(query)
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        AUDIT_SORTABLE_FIELDS,
        'createdAt',
    )

    const where: AuditLogWhereInput = {
        AND: [
            ...(filters.action ? [{ action: filters.action }] : []),
            ...(filters.resource ? [{ resource: filters.resource }] : []),
            ...(filters.resourceId ? [{ resourceId: filters.resourceId }] : []),
            ...(filters.actorId
                ? [{ actorId: filters.actorId === SYSTEM_ACTOR ? null : filters.actorId }]
                : []),
            ...(filters.actorRole ? [{ actorRole: filters.actorRole }] : []),
            ...(filters.from || filters.to
                ? [
                      {
                          createdAt: {
                              ...(filters.from ? { gte: new Date(filters.from) } : {}),
                              ...(filters.to ? { lte: new Date(filters.to) } : {}),
                          },
                      },
                  ]
                : []),
        ],
    }

    const [logs, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        }),
        prisma.auditLog.count({ where }),
    ])

    return { data: await withActors(logs), meta: buildPaginationMeta(page, limit, total) }
}

const getAuditLogById = async (auditLogId: string) => {
    const log = await prisma.auditLog.findUnique({ where: { id: auditLogId } })

    if (!log) {
        throw new AppError(httpStatus.NOT_FOUND, 'Audit Log Not Found')
    }

    const [withActor] = await withActors([log])
    return withActor
}

export const AuditServices = {
    getAuditLogs,
    getAuditLogById,
}
