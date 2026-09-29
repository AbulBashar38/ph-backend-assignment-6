import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Application, type Request, type Response } from 'express'
import httpStatus from 'http-status'
import swaggerUi from 'swagger-ui-express'
import config from './app/config'
import { openApiDocument } from './app/docs'
import { globalErrorHandler } from './app/middleware/globalErrorHandler'
import { notFound } from './app/middleware/notFound'
import { AuthRoutes } from './app/module/auth/auth.route'
import { PropertyRoutes } from './app/module/property/property.route'
import { RoomRoutes } from './app/module/room/room.route'
import { UserRoutes } from './app/module/user/user.route'

const app: Application = express()

app.use(
    cors({
        origin: config.frontend_url,
        credentials: true,
    }),
)

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
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
}

app.use('/api/v1/auth', AuthRoutes)
app.use('/api/v1/user', UserRoutes)
app.use('/api/v1/property', PropertyRoutes)
app.use('/api/v1/room', RoomRoutes)

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
