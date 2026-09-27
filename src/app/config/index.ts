import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '.env') })

export default {
    node_env: process.env.NODE_ENV,
    port: process.env.PORT,
    database_url: process.env.DATABASE_URL,
    backend_url: process.env.BACKEND_URL,
    frontend_url: process.env.FRONTEND_URL,
    bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
    jwt_access_secret: process.env.JWT_ACCESS_SECRET!,
    jwt_refresh_secret: process.env.JWT_REFRESH_SECRET!,
    jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN!,
    jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN!,
    super_admin_name: process.env.SUPER_ADMIN_NAME,
    super_admin_email: process.env.SUPER_ADMIN_EMAIL,
    super_admin_password: process.env.SUPER_ADMIN_PASSWORD,
    redis_user: process.env.REDIS_USER,
    redis_password: process.env.REDIS_PASSWORD,
    redis_host: process.env.REDIS_HOST!,
    redis_port: process.env.REDIS_PORT!,
    smtp_user: process.env.SMTP_USER!,
    smtp_password: process.env.SMTP_PASSWORD!,
    email_sender: process.env.EMAIL_SENDER!,
    swagger_enabled: process.env.SWAGGER_ENABLED,
}
