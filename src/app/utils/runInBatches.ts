export const JOB_BATCH_SIZE = 100

/**
 * For background jobs: walks the matching rows in id order (uuid v7 ids sort by creation), `JOB_BATCH_SIZE` at a
 * time, so a big backlog never loads into memory at once. `fetchBatch` must filter by `id > afterId` and order by id.
 * Returns the sum of what `handleBatch` reports (e.g. rows changed).
 */
export const runInBatches = async <T extends { id: string }>(
    fetchBatch: (afterId: string | undefined, take: number) => Promise<T[]>,
    handleBatch: (items: T[]) => Promise<number>,
) => {
    let total = 0
    let afterId: string | undefined

    for (;;) {
        const items = await fetchBatch(afterId, JOB_BATCH_SIZE)
        if (items.length === 0) return total

        total += await handleBatch(items)
        afterId = items[items.length - 1].id

        if (items.length < JOB_BATCH_SIZE) return total
    }
}

// `id > afterId` for the next batch (none on the first one)
export const afterIdFilter = (afterId: string | undefined) =>
    afterId ? { id: { gt: afterId } } : {}
