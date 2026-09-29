import Stripe from 'stripe'
import config from '../config'

// The SDK sends the API version it was built for, so a Dashboard upgrade can't change response shapes
export const stripe = new Stripe(config.stripe_secret_key, {
    maxNetworkRetries: 2,
    timeout: 20_000,
})
