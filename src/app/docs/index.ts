import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { registry } from './registry'

// Each module's *.openapi.ts registers its routes on import
import '../module/auth/auth.openapi'
import '../module/notification/notification.openapi'
import '../module/property/property.openapi'
import '../module/room/room.openapi'
import '../module/roommate/roommate.openapi'
import '../module/user/user.openapi'
import '../module/viewing/viewing.openapi'

export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
        title: 'Housing & Roommate Platform API',
        version: '1.0.0',
        description:
            'Log in via /auth/login, then click "Authorize" and paste the `accessToken` as the bearer token.',
    },
    servers: [{ url: '/api/v1' }],
})
