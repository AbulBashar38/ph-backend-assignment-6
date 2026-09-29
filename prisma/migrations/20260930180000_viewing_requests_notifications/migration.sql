-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('PENDING', 'APPROVED', 'RESCHEDULED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('VIEWING_REQUESTED', 'VIEWING_APPROVED', 'VIEWING_REJECTED', 'VIEWING_RESCHEDULED', 'VIEWING_CANCELLED', 'VIEWING_COMPLETED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewing_requests" (
    "id" TEXT NOT NULL,
    "preferredAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "status" "ViewingStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "ownerNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT,

    CONSTRAINT "viewing_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notification_user_read_created" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "idx_viewing_tenant_status" ON "viewing_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "idx_viewing_property_status" ON "viewing_requests"("propertyId", "status");

-- CreateIndex
CREATE INDEX "idx_viewing_roomId" ON "viewing_requests"("roomId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

