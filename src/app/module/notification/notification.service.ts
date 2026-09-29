import httpStatus from 'http-status'
import type { NotificationWhereInput } from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { MyNotificationsQueryZodSchema } from './notification.validation'

// Newest first; `isRead=false` for the unread list
const getMyNotifications = async (actor: RequestUser, query: IQuery) => {
    const { isRead } = MyNotificationsQueryZodSchema.parse(query)
    const { page, limit, skip } = paginationHelper(query, ['createdAt'] as const, 'createdAt')

    const where: NotificationWhereInput = {
        userId: actor.userId,
        ...(isRead !== undefined && { isRead }),
    }

    const [data, total] = await prisma.$transaction([
        prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
        prisma.notification.count({ where }),
    ])

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

const getUnreadCount = async (actor: RequestUser) => ({
    unreadCount: await prisma.notification.count({
        where: { userId: actor.userId, isRead: false },
    }),
})

const markAsRead = async (actor: RequestUser, notificationId: string) => {
    // Scoped to the caller: someone else's notification is simply "not found"
    const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId: actor.userId },
    })

    if (!notification) {
        throw new AppError(httpStatus.NOT_FOUND, 'Notification Not Found')
    }

    if (notification.isRead) {
        return notification
    }

    return prisma.notification.update({
        where: { id: notification.id },
        data: { isRead: true, readAt: new Date() },
    })
}

const markAllAsRead = async (actor: RequestUser) => {
    const { count } = await prisma.notification.updateMany({
        where: { userId: actor.userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
    })

    return { markedAsRead: count }
}

export const NotificationServices = {
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
}
