-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'HOSTEL', 'SUBLET', 'STUDIO');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Amenity" AS ENUM ('WIFI', 'AC', 'PARKING', 'LIFT', 'GENERATOR', 'GAS', 'CCTV', 'SECURITY_GUARD', 'FURNISHED', 'WATER_SUPPLY', 'KITCHEN', 'LAUNDRY', 'BALCONY', 'ROOFTOP', 'ATTACHED_BATHROOM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_UPDATED', 'USER_DELETED', 'PROPERTY_CREATED', 'PROPERTY_UPDATED', 'PROPERTY_PUBLISHED', 'PROPERTY_DISABLED', 'PROPERTY_ARCHIVED', 'PROPERTY_SUSPENDED', 'PROPERTY_RESTORED');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" "Role",

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "amenities" "Amenity"[],
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "moderationNote" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "property_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_auditLog_resource" ON "audit_logs"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "idx_auditLog_actorId" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "idx_auditLog_createdAt" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "idx_property_ownerId" ON "properties"("ownerId");

-- CreateIndex
CREATE INDEX "idx_property_status_isDeleted" ON "properties"("status", "isDeleted");

-- CreateIndex
CREATE INDEX "idx_property_city_area" ON "properties"("city", "area");

-- CreateIndex
CREATE INDEX "idx_propertyImage_propertyId" ON "property_images"("propertyId");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

