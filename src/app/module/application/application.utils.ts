import type { Prisma } from '../../../generated/prisma/client'
import { ApplicationStatus, NotificationType } from '../../../generated/prisma/enums'
import type { ApplicationWhereInput } from '../../../generated/prisma/models'
import { createNotifications } from '../../utils/notification'

/**
 * Cancels every PENDING application matching `where` (inside the caller's transaction) and notifies the
 * other side. Used when a room or property is removed, or an account is deleted.
 * `notify`: 'tenant' when the owner's side went away, 'owner' when the tenant's side went away.
 */
export const cancelPendingApplications = async (
    tx: Prisma.TransactionClient,
    where: ApplicationWhereInput,
    reason: string,
    notify: 'tenant' | 'owner',
) => {
    const pending = await tx.application.findMany({
        where: { ...where, status: ApplicationStatus.PENDING },
        select: {
            id: true,
            tenantId: true,
            propertyId: true,
            property: { select: { title: true, ownerId: true } },
        },
    })

    if (pending.length === 0) {
        return 0
    }

    await tx.application.updateMany({
        where: { id: { in: pending.map((application) => application.id) } },
        data: {
            status: ApplicationStatus.CANCELLED,
            pendingKey: null,
            cancelledAt: new Date(),
            cancellationReason: reason,
        },
    })

    await createNotifications(
        tx,
        pending.map((application) => ({
            userId: notify === 'tenant' ? application.tenantId : application.property.ownerId,
            type: NotificationType.APPLICATION_CANCELLED,
            title: 'Application Cancelled',
            message: `The rental application for "${application.property.title}" was cancelled: ${reason}.`,
            data: { applicationId: application.id, propertyId: application.propertyId },
        })),
    )

    return pending.length
}
