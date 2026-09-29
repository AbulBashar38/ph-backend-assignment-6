import type { Prisma } from '../../../generated/prisma/client'
import { NotificationType, ViewingStatus } from '../../../generated/prisma/enums'
import type { ViewingRequestWhereInput } from '../../../generated/prisma/models'
import { createNotifications } from '../../utils/notification'
import { OPEN_VIEWING_STATUSES } from './viewing.constant'

/**
 * Cancels every open viewing matching `where` (inside the caller's transaction) and notifies the
 * other side. Used when a property or room is removed, or an account is deleted.
 * `notify`: 'tenant' when the owner's side went away, 'owner' when the tenant's side went away.
 */
export const cancelOpenViewings = async (
    tx: Prisma.TransactionClient,
    where: ViewingRequestWhereInput,
    reason: string,
    notify: 'tenant' | 'owner',
) => {
    const openViewings = await tx.viewingRequest.findMany({
        where: { ...where, status: { in: OPEN_VIEWING_STATUSES } },
        select: {
            id: true,
            tenantId: true,
            propertyId: true,
            property: { select: { title: true, ownerId: true } },
        },
    })

    if (openViewings.length === 0) {
        return 0
    }

    await tx.viewingRequest.updateMany({
        where: { id: { in: openViewings.map((viewing) => viewing.id) } },
        data: {
            status: ViewingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: reason,
        },
    })

    await createNotifications(
        tx,
        openViewings.map((viewing) => ({
            userId: notify === 'tenant' ? viewing.tenantId : viewing.property.ownerId,
            type: NotificationType.VIEWING_CANCELLED,
            title: 'Viewing Cancelled',
            message: `The viewing of "${viewing.property.title}" was cancelled: ${reason}.`,
            data: { viewingRequestId: viewing.id, propertyId: viewing.propertyId },
        })),
    )

    return openViewings.length
}
