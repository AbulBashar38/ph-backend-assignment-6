import { Router } from 'express'
import { auth } from '../../middleware/checkAuth'
import { ADMIN_ROLES } from '../../utils/roles'
import { AuditController } from './audit.controller'

const router = Router()

// Read-only: audit logs are written by the services (createAuditLog) and never changed
router.get('/', auth(...ADMIN_ROLES), AuditController.getAuditLogs)
router.get('/:id', auth(...ADMIN_ROLES), AuditController.getAuditLogById)

export const AuditRoutes = router
