import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { ApplicationController } from './application.controller'
import {
    CreateApplicationValidationZodSchema,
    UpdateApplicationStatusValidationZodSchema,
} from './application.validation'

const router = Router()

const everyoneInvolved = auth(Role.TENANT, Role.OWNER, ...ADMIN_ROLES)

router.post(
    '/',
    auth(Role.TENANT),
    validateRequest(CreateApplicationValidationZodSchema),
    ApplicationController.createApplication,
)

// One endpoint for every status change; who may set which status is checked in the service:
// CANCELLED → the tenant who applied; APPROVED / REJECTED → the property owner or an admin
router.patch(
    '/:id/status',
    everyoneInvolved,
    validateRequest(UpdateApplicationStatusValidationZodSchema),
    ApplicationController.updateApplicationStatus,
)

// Scoped by role in the service
router.get('/', everyoneInvolved, ApplicationController.getApplications)
router.get('/:id', everyoneInvolved, ApplicationController.getApplicationById)

export const ApplicationRoutes = router
