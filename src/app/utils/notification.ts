import type { Prisma } from '../../generated/prisma/client'
import type { NotificationType } from '../../generated/prisma/enums'

export interface INotificationInput {
    userId: string
    type: NotificationType
    title: string
    message: string
    // Ids the frontend links to, e.g. { viewingRequestId, propertyId }
    data?: Record<string, string | null>
}

/**
 * Requirement §17: create notifications INSIDE the same transaction as the event,
 * so a notification never exists for something that was rolled back (and vice versa).
 */
export const createNotifications = (tx: Prisma.TransactionClient, inputs: INotificationInput[]) =>
    tx.notification.createMany({ data: inputs })
