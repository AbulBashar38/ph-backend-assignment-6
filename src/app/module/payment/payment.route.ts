import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { ADMIN_ROLES } from '../../utils/roles'
import { PaymentController } from './payment.controller'

const router = Router()

const everyoneInvolved = auth(Role.TENANT, Role.OWNER, ...ADMIN_ROLES)

// Stripe only: no auth, verified by signature. Its raw body parser is mounted in app.ts before express.json().
router.post('/webhook', PaymentController.handleStripeWebhook)

// Bills are created by the system (approval, then monthly). There is no route that sets a payment's status.
router.get('/', everyoneInvolved, PaymentController.getPayments)
router.get('/session/:sessionId', everyoneInvolved, PaymentController.getPaymentBySessionId)
router.get('/:id', everyoneInvolved, PaymentController.getPaymentById)
router.get('/:id/receipt', everyoneInvolved, PaymentController.getPaymentReceipt)
router.post('/:id/checkout', auth(Role.TENANT), PaymentController.createCheckoutSession)

export const PaymentRoutes = router
