import { OAuth2Client } from 'google-auth-library'
import config from '../config'

// Only verifies ID tokens sent by the frontend (Google Identity Services), so no client secret is needed
export const googleClient = new OAuth2Client({
    client_id: config.google_client_id,
})
