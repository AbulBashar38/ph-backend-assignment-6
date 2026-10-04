# 🏠 Housing & Roommate Platform — Backend

A REST API for a **housing and roommate marketplace**. Property owners list properties and rooms, tenants search for a
place, find compatible roommates, book viewings, apply, rent and pay rent online. Admins moderate the whole platform.

It covers the full rental journey:

**Property listing → Room discovery → Roommate matching → Viewing → Application → Approval → Rental → Payment**

🌐 **Live API:** <https://ph-backend-assignment-6.vercel.app>

📄 **Requirements:** [Project Requirements.md](Project%20Requirements.md)

---

## 🛠️ Tech Stack

<p align="center">
  <img src="https://skillicons.dev/icons?i=nodejs,ts,express,prisma,postgres,redis&perline=6" alt="Node.js, TypeScript, Express, Prisma, PostgreSQL, Redis" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Prisma_7-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <br />
  <img src="https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white" alt="Stripe" />
  <img src="https://img.shields.io/badge/Cloudinary-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white" alt="Cloudinary" />
  <img src="https://img.shields.io/badge/Multer-FF6600?style=for-the-badge&logo=files&logoColor=white" alt="Multer" />
  <img src="https://img.shields.io/badge/Nodemailer-22B573?style=for-the-badge&logo=gmail&logoColor=white" alt="Nodemailer" />
  <img src="https://img.shields.io/badge/EJS-B4CA65?style=for-the-badge&logo=ejs&logoColor=black" alt="EJS" />
  <img src="https://img.shields.io/badge/node--cron-5A29E4?style=for-the-badge&logo=clockify&logoColor=white" alt="node-cron" />
  <br />
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT" />
  <img src="https://img.shields.io/badge/Google_OAuth-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google OAuth" />
  <img src="https://img.shields.io/badge/Zod_v4-3E67B1?style=for-the-badge&logo=zod&logoColor=white" alt="Zod" />
  <img src="https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=black" alt="Swagger" />
  <img src="https://img.shields.io/badge/PDFKit-EC1C24?style=for-the-badge&logo=adobeacrobatreader&logoColor=white" alt="PDFKit" />
  <img src="https://img.shields.io/badge/Biome-60A5FA?style=for-the-badge&logo=biome&logoColor=white" alt="Biome" />
</p>

| Area | Technology | What it does here |
|---|---|---|
| Runtime & language | **Node.js** (ESM) + **TypeScript** (strict) | Type-safe server code |
| Web framework | **Express 5** | Routing, middleware, error handling |
| Database & ORM | **PostgreSQL** + **Prisma 7** (`@prisma/adapter-pg`) | Data model, migrations, transactions |
| Cache & locks | **Redis** (official `redis` client) | OTP codes, refresh-token sessions, checkout locks, cron locks |
| Background jobs | **node-cron** | Monthly rent bills, reminders, expiring applications/listings, payment reconciliation |
| Email | **Nodemailer** (Gmail SMTP) + **EJS** templates | OTP, welcome, password reset, rent reminders, payment receipts |
| File upload | **Multer** (memory) + **Cloudinary** v2 | Profile, property and room images |
| Payments | **Stripe** Checkout + signed webhooks | Online rent payment |
| Auth | **JWT** (access + refresh) + **bcryptjs** + **Google Sign-In** | Login, token rotation, role-based access |
| Validation | **Zod v4** | Request body / query validation |
| API docs | **Swagger UI** + `zod-to-openapi` | Interactive docs generated from the Zod schemas |
| PDF | **PDFKit** | Downloadable payment receipts |
| Dates | **date-fns** | Billing periods, expiry dates |
| Code quality | **Biome** | Lint + format |

---

## ✨ Features

### 👤 Roles

There is one `User` table with four roles: **TENANT**, **OWNER**, **ADMIN** and **SUPER_ADMIN**. `SUPER_ADMIN` can do
everything an `ADMIN` can, and can also create other admins.

### 🔐 Authentication & Accounts
- Register with email + password, verified by a **6-digit OTP sent by email** (stored in Redis with a TTL and attempt limit)
- Login with email/password or **Google Sign-In**
- **Access + refresh tokens** in HTTP-only cookies; refresh tokens are rotated and reuse is detected (Redis)
- Change password, forgot password / reset password by email
- Logout from the current device
- Profile update and **profile image upload** (Cloudinary)
- A super admin account is created automatically on first boot

### 🏢 Property & Room Management (Owner)
- Create, update, publish, disable and soft-delete properties
- Upload / remove property images
- Add rooms to a property with price, type, capacity and amenities; upload room images
- Set room availability (`AVAILABLE`, `UNAVAILABLE`, `MAINTENANCE`); `RESERVED` / `OCCUPIED` are set by the system
- Track occupied and available rooms

### 🔎 Search (Public)
- Browse published properties and available rooms
- **Search, filter, sort and paginate**: by city/area, price range, property/room type, amenities, availability date and more

### 🤝 Roommate Matching (Tenant)
- Create and manage a roommate profile (budget, location, lifestyle, smoking, pets, etc.)
- Get a list of **compatible roommates with a 0–100 compatibility score** and a per-factor breakdown
- **Send a roommate request** to a match with a short message; the other tenant gets a notification and an email
- **Contact details stay private until both agree**: when the request is accepted, both tenants get each other's
  email and phone (in the app and by email)
- Anti-spam: one open request per pair, at most 20 requests a day, and a 30-day wait after being declined

### 📅 Viewings
- Tenants request a viewing; owners accept, reject or reschedule; both sides get notified

### 📝 Rental Applications
- Tenants apply for a room; owners approve or reject
- Business rules: no duplicate applications, no applying for an unavailable room, approving one application
  **reserves the room and rejects competing applications** (race-safe with conditional updates)
- Pending applications **expire automatically** after a set number of days

### 💳 Rentals & Payments
- A rental is created from an approved application
- Monthly rent bills are generated automatically
- Tenants pay through **Stripe Checkout**; only the **signature-verified Stripe webhook** can mark a payment as paid
- A cron job reconciles payments whose webhook was missed
- Payment confirmation email and **PDF receipt download**
- Full rental and payment history for tenants, owners and admins

### 🔔 Notifications
- In-app notifications for every important event (application status, viewing updates, payment success, rent reminders…)
- Unread count, mark one / mark all as read

### 🛡️ Administration
- List, search and filter all users; block / unblock / soft-delete accounts
- Create new admins (super admin only)
- Moderate properties (suspend / restore)
- View all applications, rentals and payments
- **Platform analytics**: users, listings, occupancy, revenue
- **Audit log** of every important state change (who did what, when)

### ⏰ Automated Jobs (node-cron)

Every job is idempotent and protected by a Redis lock, so only one server instance runs it at a time.

| Job | Schedule (Asia/Dhaka) | Purpose |
|---|---|---|
| `generate-rent-dues` | daily 01:00 | Create the monthly rent bill for each active rental |
| `send-rent-reminders` | daily 09:00 | Email + notify tenants about upcoming/overdue rent |
| `expire-pending-applications` | hourly | Expire applications nobody reviewed in time |
| `expire-listings` | daily 00:30 | Deactivate expired property listings |
| `reconcile-stale-payments` | every 15 min | Check Stripe for payments whose webhook never arrived |

### 🧱 Data Safety
- **Soft delete everywhere**: nothing is hard-deleted, and deleted records are hidden from every query
- Multi-step changes run inside **database transactions**; emails and Stripe calls happen only after commit
- Passwords are never returned in any response

---

## 📚 API Overview

| Environment | Base URL |
|---|---|
| Live | `https://ph-backend-assignment-6.vercel.app/api/v1` |
| Local | `http://localhost:5050/api/v1` |

| Module | Path | Main endpoints |
|---|---|---|
| Auth | `/auth` | register, verify-email, resend-otp, login, google, refresh-token, logout, me, change/forgot/reset-password |
| User | `/user` | list users, create admin, get/update profile, profile image, change status, delete |
| Property | `/property` | public list & details, CRUD, status (publish / take offline / suspend), images |
| Room | `/room` | public available rooms & details, CRUD, status, images |
| Roommate | `/roommate` | create/update profile, profile status, matches, view profile, send / accept / decline / cancel requests, connections |
| Viewing | `/viewing` | request, update status, list, details |
| Application | `/application` | apply, update status, list, details |
| Rental | `/rental` | list, details, update status |
| Payment | `/payment` | checkout, Stripe webhook, list, details, session lookup, PDF receipt |
| Notification | `/notification` | list, unread count, mark read, mark all read |
| Audit | `/audit` | audit log list & details (admin) |
| Analytics | `/analytics` | platform statistics (admin) |

📖 **Full interactive docs (Swagger):** <http://localhost:5050/api/docs>. The raw OpenAPI spec is at `/api/docs.json`.

---

## 🚀 Setup Guide

### 1. Prerequisites

- **Node.js** 20.19 or newer, and npm
- **PostgreSQL** (local or hosted)
- **Redis** (local or Redis Cloud)
- A **Cloudinary** account (image uploads)
- A **Gmail** account with an [App Password](https://myaccount.google.com/apppasswords) (sending emails)
- A **Stripe** account in test mode + the [Stripe CLI](https://docs.stripe.com/stripe-cli) (payments)
- A **Google OAuth Client ID** (only needed for Google login)

### 2. Clone and install

```bash
git clone https://github.com/AbulBashar38/ph-backend-assignment-6.git
cd ph-backend-assignment-6
npm install
```

### 3. Environment variables

```bash
cp .env.example .env
```

Fill in `.env`. Every variable is explained in [.env.example](.env.example). The main ones:

| Variable | Description |
|---|---|
| `PORT` | API port (the examples in this README use `5050`) |
| `FRONTEND_URL` | Frontend origin allowed by CORS (also used for links in emails and Stripe redirects) |
| `CORS_ORIGINS` | Extra allowed CORS origins, comma-separated (e.g. the live Swagger page calling your local server) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Two different random secrets |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | Super admin account created on first boot |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USER`, `REDIS_PASSWORD` | Redis connection |
| `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_SENDER` | Gmail SMTP for Nodemailer |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary credentials |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe test key and webhook signing secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `CRON_ENABLED` | `true` to run the background jobs |

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Database

```bash
npx prisma migrate dev     # create the tables
npx prisma generate        # generate the Prisma client
```

### 5. Run

```bash
npm run dev                # development (auto-reload)
```

or for production:

```bash
npm run build
npm start
```

The API runs at `http://localhost:5050`, and the Swagger docs are at `http://localhost:5050/api/docs`.

### 6. Stripe webhooks (local)

In a second terminal, forward Stripe events to the API:

```bash
stripe listen --forward-to localhost:5050/api/v1/payment/webhook
```

Copy the `whsec_…` secret it prints into `STRIPE_WEBHOOK_SECRET` and restart the server.
Test card: `4242 4242 4242 4242`, any future date, any CVC.

### 7. Calling your local API from the live Swagger page (optional)

The live docs (`https://ph-backend-assignment-6.vercel.app/api/docs`) can send requests to your local server
when you pick **Local** in the server dropdown. Two things must allow it:

1. **CORS:** keep `CORS_ORIGINS=https://ph-backend-assignment-6.vercel.app` in `.env` and restart the server.
2. **Chrome's local network permission:** Chrome blocks public sites from calling `localhost` until you allow it.
   If you see *"Permission was denied for this request to access the `loopback` address space"*, click the icon
   left of the address bar → **Site settings** → **Local network access** → **Allow**, then reload.

Simpler alternative: use the local docs at <http://localhost:5050/api/docs>. They call the same origin, so neither step is needed.

### 📜 Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server with auto-reload (`tsx watch`) |
| `npm run build` | Compile TypeScript (also the type check) |
| `npm start` | Run the compiled server |
| `npm run check:fix` | Biome lint + format + organize imports |

---

## 📁 Project Structure

```
prisma/
  schema/              # Prisma models, one file per model
  migrations/
src/
  server.ts            # Boot: DB, Redis, mailer, cron, HTTP server
  app.ts               # Express app and route mounting
  app/
    config/            # All environment variables (the only place reading process.env)
    lib/               # prisma, redis, nodemailer, cloudinary, multer, stripe, cron
    middleware/        # auth, validation, error handling
    module/            # Feature modules: route / controller / service / validation / openapi
      auth/ user/ property/ room/ roommate/ viewing/
      application/ rental/ payment/ notification/ audit/ analytics/
    templates/         # EJS email templates
    utils/             # AppError, pagination, audit log, notifications, uploads…
    docs/              # Swagger / OpenAPI setup
```
