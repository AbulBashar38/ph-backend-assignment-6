import type { Prisma } from '../../../generated/prisma/client'
import { NotificationType, type RoomStatus } from '../../../generated/prisma/enums'
import { createNotifications } from '../../utils/notification'

const STATUS_LABELS: Record<RoomStatus, string> = {
    AVAILABLE: 'available for new tenants',
    RESERVED: 'reserved for an approved tenant',
    OCCUPIED: 'occupied',
    UNAVAILABLE: 'unavailable',
    MAINTENANCE: 'under maintenance',
}

/**
 * Requirement §17 (owner): "Room availability changed". Sent when a room's status changes and the OWNER didn't do it
 * themselves: an admin, the tenant (ending a rental), or the system (payment). Call inside the change's transaction.
 */
export const notifyRoomAvailabilityChanged = async (
    tx: Prisma.TransactionClient,
    input: {
        // Who made the change; null = the system (Stripe webhook, cron)
        actorId: string | null
        ownerId: string
        room: { id: string; name: string }
        property: { id: string; title: string }
        status: RoomStatus
        reason: string
    },
) => {
    if (input.actorId === input.ownerId) return

    await createNotifications(tx, [
        {
            userId: input.ownerId,
            type: NotificationType.ROOM_AVAILABILITY_CHANGED,
            title: 'Room Availability Changed',
            message: `${input.room.name} at "${input.property.title}" is now ${STATUS_LABELS[input.status]}: ${input.reason}.`,
            data: { roomId: input.room.id, propertyId: input.property.id, status: input.status },
        },
    ])
}
