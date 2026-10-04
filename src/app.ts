import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Application, type NextFunction, type Request, type Response } from 'express'
import httpStatus from 'http-status'
import config from './app/config'
import { openApiDocument, swaggerUiHtml } from './app/docs'
import { globalErrorHandler } from './app/middleware/globalErrorHandler'
import { notFound } from './app/middleware/notFound'
import { AnalyticsRoutes } from './app/module/analytics/analytics.route'
import { ApplicationRoutes } from './app/module/application/application.route'
import { AuditRoutes } from './app/module/audit/audit.route'
import { AuthRoutes } from './app/module/auth/auth.route'
import { NotificationRoutes } from './app/module/notification/notification.route'
import { PaymentRoutes } from './app/module/payment/payment.route'
import { PropertyRoutes } from './app/module/property/property.route'
import { RentalRoutes } from './app/module/rental/rental.route'
import { RoomRoutes } from './app/module/room/room.route'
import { RoommateRoutes } from './app/module/roommate/roommate.route'
import { UserRoutes } from './app/module/user/user.route'
import { ViewingRoutes } from './app/module/viewing/viewing.route'

const app: Application = express()

// Older Chrome (Private Network Access) asks in the preflight before a public page may call localhost
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
    next()
})

app.use(
    cors({
        origin: [config.frontend_url, ...config.cors_origins].filter(
            (origin): origin is string => !!origin,
        ),
        credentials: true,
    }),
)

// Stripe webhooks need the raw bytes to verify the signature. Parsed first, so express.json() skips this path.
app.use('/api/v1/payment/webhook', express.raw({ type: '*/*', limit: '1mb' }))

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }))

// Middleware to parse JSON bodies
app.use(express.json())
app.use(cookieParser())

// API docs: always on outside production, opt-in with SWAGGER_ENABLED=true in production
if (config.node_env !== 'production' || config.swagger_enabled === 'true') {
    app.get('/api/docs.json', (_req: Request, res: Response) => {
        res.json(openApiDocument)
    })
    app.get('/api/docs', (_req: Request, res: Response) => {
        res.type('html').send(swaggerUiHtml)
    })
}

app.use('/api/v1/auth', AuthRoutes)
app.use('/api/v1/user', UserRoutes)
app.use('/api/v1/property', PropertyRoutes)
app.use('/api/v1/room', RoomRoutes)
app.use('/api/v1/roommate', RoommateRoutes)
app.use('/api/v1/viewing', ViewingRoutes)
app.use('/api/v1/application', ApplicationRoutes)
app.use('/api/v1/rental', RentalRoutes)
app.use('/api/v1/payment', PaymentRoutes)
app.use('/api/v1/notification', NotificationRoutes)
app.use('/api/v1/audit', AuditRoutes)
app.use('/api/v1/analytics', AnalyticsRoutes)

// Basic route
app.get('/', (_req: Request, res: Response) => {
    res.status(httpStatus.OK).json({
        success: true,
        message: 'Welcome to Housing & Roommate Platform Backend',
    })
})

app.use(notFound)
app.use(globalErrorHandler)

export default app
