import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { ADMIN_ROLES } from '../../utils/roles'
import { AnalyticsController } from './analytics.controller'

const router = Router()

router.get('/', auth(...ADMIN_ROLES), AnalyticsController.getPlatformStats)
router.get('/owner', auth(Role.OWNER), AnalyticsController.getOwnerStats)

export const AnalyticsRoutes = router
