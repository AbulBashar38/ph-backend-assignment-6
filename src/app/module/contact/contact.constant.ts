// Contact form rate limits (Redis counters per hour). Per email is the reliable one: every browser request
// reaches the API through the frontend's proxy, so the forwarded IP is only a secondary guard.
export const CONTACT_WINDOW_SECONDS = 60 * 60
export const MAX_MESSAGES_PER_EMAIL = 3
export const MAX_MESSAGES_PER_IP = 10

export const contactEmailKey = (email: string) => `contact-limit:email:${email}`
export const contactIpKey = (ip: string) => `contact-limit:ip:${ip}`
