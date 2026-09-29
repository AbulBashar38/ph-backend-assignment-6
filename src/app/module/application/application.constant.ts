export const APPLICATION_SORTABLE_FIELDS = ['createdAt', 'moveInDate', 'expiresAt'] as const

// How far ahead a move-in date may be
export const MAX_MOVE_IN_DAYS_AHEAD = 180

// "tenantId:roomId" is unique among PENDING applications (enforced by a unique column)
export const pendingKeyFor = (tenantId: string, roomId: string) => `${tenantId}:${roomId}`
