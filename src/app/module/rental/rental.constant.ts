import { RentalStatus } from '../../../generated/prisma/enums'

export const RENTAL_SORTABLE_FIELDS = ['createdAt', 'startDate', 'monthlyRent'] as const

// A rental that still holds its room
export const LIVE_RENTAL_STATUSES: RentalStatus[] = [RentalStatus.PENDING, RentalStatus.ACTIVE]
