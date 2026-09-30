import z from 'zod'
import { AuditAction, Role } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { AUDIT_RESOURCES, AUDIT_SORTABLE_FIELDS } from './audit.constant'

const TAG = 'Audit'

const AuditLogSchema = z
    .object({
        id: z.string(),
        action: z.enum(AuditAction),
        resource: z.enum(AUDIT_RESOURCES),
        resourceId: z.string(),
        previousData: z
            .record(z.string(), z.unknown())
            .nullable()
            .meta({
                description: 'Only the fields that changed, before',
                example: { status: 'PENDING' },
            }),
        newData: z
            .record(z.string(), z.unknown())
            .nullable()
            .meta({
                description: 'Only the fields that changed, after',
                example: { status: 'APPROVED' },
            }),
        createdAt: z.iso.datetime(),
        actorId: z
            .string()
            .nullable()
            .meta({ description: 'null = system (cron job or Stripe webhook)' }),
        actorRole: z.enum(Role).nullable(),
        actor: z
            .object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
                role: z.enum(Role),
                isDeleted: z.boolean(),
            })
            .nullable()
            .meta({ description: 'Who did it (as the account is now); null for system actions' }),
    })
    .meta({ id: 'AuditLog' })

registry.registerPath({
    method: 'get',
    path: '/audit',
    tags: [TAG],
    summary: 'List audit logs (ADMIN / SUPER_ADMIN)',
    description:
        'Requirement §19: who did what, to which record, when, and the state before/after. Newest first. ' +
        'Filters combine with AND. `actorId=system` lists the automatic actions (cron jobs, Stripe webhook). ' +
        'The full history of one record: `?resource=Rental&resourceId=…`. Read-only: logs are never changed or deleted.',
    security: authSecurity,
    request: {
        query: z.object({
            action: z.enum(AuditAction).optional(),
            resource: z.enum(AUDIT_RESOURCES).optional(),
            resourceId: z.string().optional(),
            actorId: z
                .string()
                .optional()
                .meta({ description: 'A user ID, or `system`', example: 'system' }),
            actorRole: z.enum(Role).optional(),
            from: z.iso.datetime().optional().meta({
                description: 'On or after (ISO date-time)',
                example: '2026-10-01T00:00:00+06:00',
            }),
            to: z.iso.datetime().optional().meta({
                description: 'On or before (ISO date-time)',
                example: '2026-10-31T23:59:59+06:00',
            }),
            ...paginationQueryParams(AUDIT_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Audit Logs Retrieved Successfully', AuditLogSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/audit/{id}',
    tags: [TAG],
    summary: 'Get one audit log (ADMIN / SUPER_ADMIN)',
    security: authSecurity,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: successResponse('Audit Log Retrieved Successfully', AuditLogSchema),
        ...errorResponses(401, 403, 404),
    },
})
