import type z from 'zod'
import type { AuditLogsQueryZodSchema } from './audit.validation'

export type IAuditLogsQuery = z.infer<typeof AuditLogsQueryZodSchema>
