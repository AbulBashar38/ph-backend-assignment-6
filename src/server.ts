import app from './app'
import config from './app/config'
import { transporter } from './app/lib/nodemailer'
import { prisma } from './app/lib/prisma'
import { redisClient } from './app/lib/redis'
import { seedSuperAdmin } from './app/utils/seed'

const PORT = config.port

const main = async () => {
    try {
        await prisma.$connect()
        console.log('Connected to the database successfully.')

        await redisClient.connect()
        console.log('Connected to Redis successfully.')

        // Email failures shouldn't stop the API from booting; OTP routes report them per request
        try {
            await transporter.verify()
            console.log('Nodemailer connected successfully.')
        } catch (error) {
            console.warn(
                'Nodemailer could not connect. Emails will fail until SMTP is fixed.',
                error,
            )
        }

        await seedSuperAdmin()

        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`)
        })
    } catch (error) {
        console.error('Error starting the server:', error)
        await prisma.$disconnect()
        if (redisClient.isOpen) {
            await redisClient.quit()
        }
        process.exit(1)
    }
}

main()
