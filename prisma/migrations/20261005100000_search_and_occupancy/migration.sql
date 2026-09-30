-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ROOM_AVAILABILITY_CHANGED';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "occupants" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "availableRoomCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earliestAvailableFrom" TIMESTAMP(3),
ADD COLUMN     "minAvailableRent" INTEGER;

-- AlterTable
ALTER TABLE "rentals" ADD COLUMN     "occupants" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "currentOccupants" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "idx_property_minAvailableRent" ON "properties"("minAvailableRent");

-- CreateIndex
CREATE INDEX "idx_property_earliestAvailableFrom" ON "properties"("earliestAvailableFrom");


-- ---------------------------------------------------------------------------------------------------------------
-- Search helpers on properties (hand-written). Recomputed by a trigger whenever a room is inserted or changes, so
-- every code path (owner edits, approvals, payments, rentals ending, soft deletes, cron) keeps them correct.
-- A room counts when it is live (not deleted) and AVAILABLE. Its availability date is availableFrom, or its
-- creation time when it has none (available right away).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_property_room_stats(target_property_id TEXT) RETURNS VOID AS $$
BEGIN
    UPDATE "properties" AS p
    SET "availableRoomCount"    = stats.room_count,
        "minAvailableRent"      = stats.min_rent,
        "earliestAvailableFrom" = stats.earliest
    FROM (
        SELECT COUNT(*)::int                                    AS room_count,
               MIN(r."monthlyRent")                             AS min_rent,
               MIN(COALESCE(r."availableFrom", r."createdAt"))  AS earliest
        FROM "rooms" AS r
        WHERE r."propertyId" = target_property_id
          AND r."isDeleted" = false
          AND r."status" = 'AVAILABLE'
    ) AS stats
    WHERE p."id" = target_property_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rooms_refresh_property_stats() RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_property_room_stats(NEW."propertyId");
    IF TG_OP = 'UPDATE' AND OLD."propertyId" IS DISTINCT FROM NEW."propertyId" THEN
        PERFORM refresh_property_room_stats(OLD."propertyId");
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rooms_refresh_property_stats"
AFTER INSERT OR UPDATE OF "status", "monthlyRent", "availableFrom", "isDeleted", "propertyId" ON "rooms"
FOR EACH ROW EXECUTE FUNCTION rooms_refresh_property_stats();

-- Backfill existing properties
SELECT refresh_property_room_stats("id") FROM "properties";
