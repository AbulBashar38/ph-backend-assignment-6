// Fields a list request may search / sort by. Kept here so the service and the Swagger docs share one source.
export const USER_SEARCHABLE_FIELDS = ['name', 'email', 'phone'] as const

export const USER_SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'name', 'email'] as const
