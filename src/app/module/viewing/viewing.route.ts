import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { ViewingController } from './viewing.controller'
import {
    CreateViewingValidationZodSchema,
    UpdateViewingStatusValidationZodSchema,
} from './viewing.validation'

const router = Router()

// Tenant
router.post(
    '/',
    auth(Role.TENANT),
    validateRequest(CreateViewingValidationZodSchema),
    ViewingController.createViewing,
)
// One endpoint for every status change. Who may set which status is checked in the service:
// CANCELLED → the tenant who asked; APPROVED / REJECTED / RESCHEDULED / COMPLETED → the property owner or an admin
router.patch(
    '/:id/status',
    auth(Role.TENANT, Role.OWNER, ...ADMIN_ROLES),
    validateRequest(UpdateViewingStatusValidationZodSchema),
    ViewingController.updateViewingStatus,
)

// Everyone involved: scoped by role in the service
router.get('/', auth(Role.TENANT, Role.OWNER, ...ADMIN_ROLES), ViewingController.getViewings)
router.get('/:id', auth(Role.TENANT, Role.OWNER, ...ADMIN_ROLES), ViewingController.getViewingById)

export const ViewingRoutes = router
