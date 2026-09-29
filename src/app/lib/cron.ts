import { randomUUID } from 'node:crypto'
import cron from 'node-cron'
import { ApplicationServices } from '../module/application/application.service'
import { PaymentServices } from '../module/payment/payment.service'
import { PropertyServices } from '../module/property/property.service'
import { redisClient } from './redis'

interface ICronJob {
    name: string
    // Bangladesh time
    schedule: string
    // Returns how many records it changed/sent (for the log)
    run: () => Promise<number>
    // Upper bound on one run; the cross-instance lock expires after it even if the process dies mid-run
    lockSeconds: number
}

/**
 * Requirement §20. The logic lives in the services (callable and testable on its own); this file only schedules.
 * Every job is idempotent: running it twice, or after downtime, is safe.
 */
export const CRON_JOBS: ICronJob[] = [
    {
        name: 'generate-rent-dues',
        schedule: '0 1 * * *', // 01:00 daily
        run: PaymentServices.generateRentDues,
        lockSeconds: 30 * 60,
    },
    {
        name: 'send-rent-reminders',
        schedule: '0 9 * * *', // 09:00 daily, after the bills exist
        run: PaymentServices.sendRentReminders,
        lockSeconds: 30 * 60,
    },
    {
        name: 'expire-pending-applications',
        schedule: '0 * * * *', // hourly
        run: ApplicationServices.expireStaleApplications,
        lockSeconds: 10 * 60,
    },
    {
        name: 'expire-listings',
        schedule: '30 0 * * *', // 00:30 daily
        run: PropertyServices.expireListings,
        lockSeconds: 10 * 60,
    },
    {
        name: 'reconcile-stale-payments',
        schedule: '*/15 * * * *', // every 15 minutes
        run: PaymentServices.reconcileStalePayments,
        lockSeconds: 10 * 60,
    },
]

const cronLockKey = (name: string) => `cron-lock:${name}`

/**
 * Runs one job now. With several API instances, a Redis lock makes sure only one of them runs each tick.
 * Never throws: a failing job is logged and tried again on its next tick.
 */
export const runCronJob = async (job: ICronJob) => {
    const lockKey = cronLockKey(job.name)
    const lockToken = randomUUID()

    try {
        const locked = await redisClient.set(lockKey, lockToken, {
            condition: 'NX',
            expiration: { type: 'EX', value: job.lockSeconds },
        })
        if (locked !== 'OK') return

        const startedAt = Date.now()
        const count = await job.run()

        if (count > 0) {
            console.log(`Cron ${job.name}: ${count} record(s) in ${Date.now() - startedAt} ms`)
        }
    } catch (error) {
        console.error(`Cron ${job.name} failed:`, error)
    } finally {
        // Release only our own lock
        try {
            if ((await redisClient.get(lockKey)) === lockToken) {
                await redisClient.del(lockKey)
            }
        } catch {
            // Redis is down: the lock expires on its own
        }
    }
}

export const startCronJobs = () => {
    for (const job of CRON_JOBS) {
        cron.schedule(job.schedule, () => runCronJob(job), {
            name: job.name,
            timezone: 'Asia/Dhaka',
            // A slow run is never started again while it's still going (in this process)
            noOverlap: true,
        })
    }

    console.log(`Cron jobs scheduled: ${CRON_JOBS.map((job) => job.name).join(', ')}`)
}
