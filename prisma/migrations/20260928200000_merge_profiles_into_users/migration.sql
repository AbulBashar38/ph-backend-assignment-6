-- Merge the Tenant / Owner profile tables into "users" (one table for every role).
-- Data is copied BEFORE the old tables are dropped, so nothing is lost.

-- 1. New profile columns on users
ALTER TABLE "users" ADD COLUMN     "address" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "occupation" TEXT;

-- 2. Copy profile details onto the user rows
UPDATE "users" AS u
SET "occupation" = t."occupation", "gender" = t."gender"
FROM "tenants" AS t
WHERE t."userId" = u."id";

UPDATE "users" AS u
SET "address" = o."address"
FROM "owners" AS o
WHERE o."userId" = u."id";

-- 3. Re-point properties from the owner PROFILE id to the owner's USER id
ALTER TABLE "properties" DROP CONSTRAINT "properties_ownerId_fkey";

UPDATE "properties" AS p
SET "ownerId" = o."userId"
FROM "owners" AS o
WHERE o."id" = p."ownerId";

ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Drop the old profile tables
ALTER TABLE "owners" DROP CONSTRAINT "owners_userId_fkey";
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_userId_fkey";
DROP TABLE "owners";
DROP TABLE "tenants";
