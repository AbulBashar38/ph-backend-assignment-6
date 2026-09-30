export const PROPERTY_SEARCHABLE_FIELDS = [
    'title',
    'description',
    'address',
    'city',
    'area',
] as const

export const PROPERTY_SORTABLE_FIELDS = [
    'createdAt',
    'updatedAt',
    'publishedAt',
    'title',
    // Requirement §6: sort by price / availability (columns kept up to date by a database trigger on rooms)
    'minAvailableRent',
    'earliestAvailableFrom',
] as const

// Friendly sortBy names for the frontend → columns
export const PROPERTY_SORT_ALIASES: Record<string, (typeof PROPERTY_SORTABLE_FIELDS)[number]> = {
    price: 'minAvailableRent',
    availability: 'earliestAvailableFrom',
    newest: 'publishedAt',
}

// Everything sortBy accepts (for the Swagger enum)
export const PROPERTY_SORT_OPTIONS = [
    'price',
    'availability',
    'newest',
    ...PROPERTY_SORTABLE_FIELDS,
] as const

// Nullable sort columns: properties without an available room (null) always go last
export const NULLS_LAST_SORT_FIELDS: readonly string[] = [
    'minAvailableRent',
    'earliestAvailableFrom',
]

export const MAX_IMAGES_PER_PROPERTY = 20
