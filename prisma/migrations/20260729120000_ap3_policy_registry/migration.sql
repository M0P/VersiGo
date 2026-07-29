-- AP-03: Policy-Registry (Versicherungsverwaltung)
-- Neue Datenmodelle fuer das Policy-Registry-Feature

-- CreateEnum
CREATE TYPE "InsurancePolicyType" AS ENUM ('HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ', 'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PolicySource" AS ENUM ('MANUAL', 'AI_EXTRACTED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "DocumentStorageType" AS ENUM ('INTERNAL', 'PAPERLESS_LINK');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR', 'DISABLED');

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "type" "InsurancePolicyType" NOT NULL,
    "insurerName" TEXT NOT NULL,
    "insurerPortalUrl" TEXT,
    "contractNumber" TEXT NOT NULL,
    "tariffName" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "noticePeriod" INTEGER,
    "paymentFrequency" "PaymentFrequency",
    "premiumAmount" DECIMAL(65,30),
    "deductibleAmount" DECIMAL(65,30),
    "coverageSummaryShort" TEXT,
    "source" "PolicySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "covered_persons" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),

    CONSTRAINT "covered_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_cost_entries" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "grossAmount" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30),
    "frequency" "PaymentFrequency" NOT NULL,
    "bookingSource" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "storageType" "DocumentStorageType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "checksum" TEXT,
    "storageRef" TEXT,
    "documentDate" TIMESTAMP(3),
    "category" TEXT,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_account_links" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "portalUrl" TEXT,
    "usernameHint" TEXT,
    "mailboxCapability" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_policies_householdId_idx" ON "insurance_policies"("householdId");

-- CreateIndex
CREATE INDEX "insurance_policies_ownerUserId_idx" ON "insurance_policies"("ownerUserId");

-- CreateIndex
CREATE INDEX "covered_persons_policyId_idx" ON "covered_persons"("policyId");

-- CreateIndex
CREATE INDEX "policy_cost_entries_policyId_idx" ON "policy_cost_entries"("policyId");

-- CreateIndex
CREATE INDEX "policy_documents_policyId_idx" ON "policy_documents"("policyId");

-- CreateIndex
CREATE INDEX "portal_account_links_policyId_idx" ON "portal_account_links"("policyId");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covered_persons" ADD CONSTRAINT "covered_persons_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_cost_entries" ADD CONSTRAINT "policy_cost_entries_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_account_links" ADD CONSTRAINT "portal_account_links_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
