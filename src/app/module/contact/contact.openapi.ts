import { errorResponses, jsonBody, registry, successResponse } from '../../docs/registry'
import { ContactValidationZodSchema } from './contact.validation'

const TAG = 'Contact'

registry.registerPath({
    method: 'post',
    path: '/contact',
    tags: [TAG],
    summary: 'Send a message to the team (public)',
    description:
        'Emails the message to the team inbox (`CONTACT_EMAIL`, or the sending Gmail account if unset). ' +
        'Replying to that email goes straight to the sender.\n\n' +
        'Rate limits per hour: 3 messages per email address and 10 per IP (429 when exceeded).',
    security: [],
    request: {
        body: jsonBody(
            ContactValidationZodSchema.meta({
                example: {
                    name: 'Rahim Uddin',
                    email: 'rahim@example.com',
                    subject: 'Question about listing my flat',
                    message:
                        'Hi, I own a 3-bedroom flat in Dhanmondi. Can I list each room separately with its own rent?',
                },
            }),
        ),
    },
    responses: {
        200: successResponse('Message Sent. We Will Get Back To You Soon'),
        ...errorResponses(400, 429, 502),
    },
})
