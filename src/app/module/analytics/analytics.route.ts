import { Router } from 'express'
import { auth } from '../../middleware/checkAuth'
import { ADMIN_ROLES } from '../../utils/roles'
import { AnalyticsController } from './analytics.controller'

const router = Router()

router.get('/', auth(...ADMIN_ROLES), AnalyticsController.getPlatformStats)

export const AnalyticsRoutes = router
