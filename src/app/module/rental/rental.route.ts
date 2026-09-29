import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { RentalController } from './rental.controller'
import { UpdateRentalStatusValidationZodSchema } from './rental.validation'

const router = Router()

const everyoneInvolved = auth(Role.TENANT, Role.OWNER, ...ADMIN_ROLES)

// Rentals are created by approving an application (PATCH /application/:id/status)
router.get('/', everyoneInvolved, RentalController.getRentals)
router.get('/:id', everyoneInvolved, RentalController.getRentalById)
router.patch(
    '/:id/status',
    everyoneInvolved,
    validateRequest(UpdateRentalStatusValidationZodSchema),
    RentalController.updateRentalStatus,
)

export const RentalRoutes = router
