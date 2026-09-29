import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { imageUpload } from '../../lib/multer'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { RoomController } from './room.controller'
import {
    CreateRoomValidationZodSchema,
    UpdateRoomStatusValidationZodSchema,
    UpdateRoomValidationZodSchema,
} from './room.validation'

const router = Router()

const ownerOrAdmin = auth(Role.OWNER, ...ADMIN_ROLES)

// Public (no login)
router.get('/public/available-rooms', RoomController.getPublicRooms)
router.get('/public/:id', RoomController.getPublicRoomById)

// Owner of the property, or any admin (ownership is checked in the service)
router.post(
    '/',
    ownerOrAdmin,
    validateRequest(CreateRoomValidationZodSchema),
    RoomController.createRoom,
)
router.get('/', ownerOrAdmin, RoomController.getRooms)
router.get('/:id', ownerOrAdmin, RoomController.getRoomById)
router.patch(
    '/:id',
    ownerOrAdmin,
    validateRequest(UpdateRoomValidationZodSchema),
    RoomController.updateRoom,
)
router.patch(
    '/:id/status',
    ownerOrAdmin,
    validateRequest(UpdateRoomStatusValidationZodSchema),
    RoomController.updateRoomStatus,
)
router.post('/:id/images', ownerOrAdmin, imageUpload.array('images', 10), RoomController.addImages)
router.delete('/:id/images/:imageId', ownerOrAdmin, RoomController.removeImage)
router.delete('/:id', ownerOrAdmin, RoomController.archiveRoom)

export const RoomRoutes = router
