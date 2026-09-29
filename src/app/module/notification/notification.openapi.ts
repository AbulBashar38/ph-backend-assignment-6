import z from 'zod'
import { NotificationType } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'

const TAG = 'Notification'

const NotificationSchema = z
    .object({
        id: z.string(),
        type: z.enum(NotificationType),
        title: z.string().meta({ example: 'Viewing Approved' }),
        message: z.string().meta({
            example:
                'Your viewing of "Sunny apartment in Mirpur 10" is confirmed for 5 Nov, 16:00.',
        }),
        data: z
            .record(z.string(), z.string().nullable())
            .nullable()
            .meta({
                description: 'Ids to link to',
                example: { viewingRequestId: '0199…', propertyId: '0199…' },
            }),
        isRead: z.boolean(),
        readAt: z.iso.datetime().nullable(),
        createdAt: z.iso.datetime(),
        userId: z.string(),
    })
    .meta({ id: 'Notification' })

registry.registerPath({
    method: 'get',
    path: '/notification',
    tags: [TAG],
    summary: 'My notifications, newest first (any logged-in user)',
    description: '`isRead=false` → only unread. Only your own notifications are ever returned.',
    security: authSecurity,
    request: {
        query: z.object({
            isRead: z.enum(['true', 'false']).optional(),
            ...paginationQueryParams(['createdAt'] as const),
        }),
    },
    responses: {
        200: paginatedResponse('Notifications Retrieved Successfully', NotificationSchema),
        ...errorResponses(400, 401),
    },
})

registry.registerPath({
    method: 'get',
    path: '/notification/unread-count',
    tags: [TAG],
    summary: 'Number of unread notifications (any logged-in user)',
    description: 'For the bell badge.',
    security: authSecurity,
    responses: {
        200: successResponse(
            'Unread Count Retrieved Successfully',
            z.object({ unreadCount: z.number().int().meta({ example: 3 }) }),
        ),
        ...errorResponses(401),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/notification/{id}/read',
    tags: [TAG],
    summary: 'Mark one notification as read (owner of it)',
    description: "Someone else's notification → 404. Already read → 200 (no change).",
    security: authSecurity,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: successResponse('Notification Marked As Read', NotificationSchema),
        ...errorResponses(401, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/notification/read-all',
    tags: [TAG],
    summary: 'Mark all my notifications as read',
    security: authSecurity,
    responses: {
        200: successResponse(
            'All Notifications Marked As Read',
            z.object({ markedAsRead: z.number().int().meta({ example: 3 }) }),
        ),
        ...errorResponses(401),
    },
})
