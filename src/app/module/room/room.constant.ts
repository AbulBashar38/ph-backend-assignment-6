export const ROOM_SEARCHABLE_FIELDS = ['name', 'description'] as const

export const ROOM_SORTABLE_FIELDS = [
    'createdAt',
    'updatedAt',
    'monthlyRent',
    'availableFrom',
    'name',
] as const

export const MAX_IMAGES_PER_ROOM = 10

// Statuses the owner / an admin may set by hand. RESERVED and OCCUPIED belong to applications and rentals.
export const MANUAL_ROOM_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'MAINTENANCE'] as const
