// The `resource` values written by createAuditLog (utils/auditLog.ts)
export const AUDIT_RESOURCES = [
    'User',
    'Property',
    'Room',
    'Application',
    'Rental',
    'Payment',
] as const

// Newest first by default; the log only grows, so creation time is the one useful order
export const AUDIT_SORTABLE_FIELDS = ['createdAt'] as const
