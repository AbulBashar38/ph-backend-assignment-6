-- CreateEnum
CREATE TYPE "Preference" AS ENUM ('YES', 'NO', 'NO_PREFERENCE');

-- CreateEnum
CREATE TYPE "SleepSchedule" AS ENUM ('EARLY_BIRD', 'NIGHT_OWL', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "LifestyleTag" AS ENUM ('QUIET', 'SOCIAL', 'CLEAN', 'STUDIOUS', 'WORK_FROM_HOME', 'FITNESS', 'COOKING', 'GAMING', 'MUSIC', 'VEGETARIAN', 'RELIGIOUS', 'PARTY');

-- CreateTable
CREATE TABLE "roommate_profiles" (
    "id" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "budgetMin" INTEGER NOT NULL,
    "budgetMax" INTEGER NOT NULL,
    "preferredCity" TEXT NOT NULL,
    "preferredArea" TEXT,
    "moveInDate" TIMESTAMP(3) NOT NULL,
    "smokingPreference" "Preference" NOT NULL DEFAULT 'NO_PREFERENCE',
    "petPreference" "Preference" NOT NULL DEFAULT 'NO_PREFERENCE',
    "sleepSchedule" "SleepSchedule" NOT NULL DEFAULT 'FLEXIBLE',
    "lifestyle" "LifestyleTag"[],
    "genderPreference" "Gender",
    "bio" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "roommate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roommate_profiles_tenantId_key" ON "roommate_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "idx_roommateProfile_active_city" ON "roommate_profiles"("isActive", "preferredCity");

-- AddForeignKey
ALTER TABLE "roommate_profiles" ADD CONSTRAINT "roommate_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

