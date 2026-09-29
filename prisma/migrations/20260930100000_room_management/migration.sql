-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('SINGLE', 'SHARED', 'MASTER', 'STUDIO');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'UNAVAILABLE', 'MAINTENANCE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ROOM_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOM_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOM_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOM_ARCHIVED';

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "monthlyRent" INTEGER NOT NULL,
    "maxOccupants" INTEGER NOT NULL,
    "description" TEXT,
    "amenities" "Amenity"[],
    "availableFrom" TIMESTAMP(3),
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "room_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_room_propertyId" ON "rooms"("propertyId");

-- CreateIndex
CREATE INDEX "idx_room_status_isDeleted" ON "rooms"("status", "isDeleted");

-- CreateIndex
CREATE INDEX "idx_room_monthlyRent" ON "rooms"("monthlyRent");

-- CreateIndex
CREATE INDEX "idx_roomImage_roomId" ON "room_images"("roomId");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_images" ADD CONSTRAINT "room_images_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

