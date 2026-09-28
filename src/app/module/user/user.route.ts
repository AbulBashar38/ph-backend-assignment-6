import { Router } from 'express'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { UserController } from './user.controller'
import { DeleteUserValidationZodSchema, UpdateUserValidationZodSchema } from './user.validation'

const router = Router()

router.get('/', auth(...ADMIN_ROLES), UserController.getAllUsers)

// Self or admin: the ownership/role rules live in UserServices
router.get('/:id', auth(), UserController.getUserById)
router.patch(
    '/:id',
    auth(),
    validateRequest(UpdateUserValidationZodSchema),
    UserController.updateUser,
)
router.delete(
    '/:id',
    auth(),
    validateRequest(DeleteUserValidationZodSchema),
    UserController.deleteUser,
)

export const UserRoutes = router
