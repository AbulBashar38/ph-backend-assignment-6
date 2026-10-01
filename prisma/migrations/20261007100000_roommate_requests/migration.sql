-- CreateEnum
CREATE TYPE "RoommateRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ROOMMATE_REQUEST_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'ROOMMATE_REQUEST_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'ROOMMATE_REQUEST_DECLINED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ROOMMATE_REQUEST_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'ROOMMATE_REQUEST_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOMMATE_REQUEST_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOMMATE_REQUEST_CANCELLED';

-- CreateTable
CREATE TABLE "roommate_requests" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "status" "RoommateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,

    CONSTRAINT "roommate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_roommateRequest_sender_status" ON "roommate_requests"("senderId", "status");

-- CreateIndex
CREATE INDEX "idx_roommateRequest_receiver_status" ON "roommate_requests"("receiverId", "status");

-- CreateIndex
CREATE INDEX "idx_roommateRequest_sender_createdAt" ON "roommate_requests"("senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "roommate_requests" ADD CONSTRAINT "roommate_requests_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roommate_requests" ADD CONSTRAINT "roommate_requests_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

