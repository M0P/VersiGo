-- BugFix-24 (E824D00): Fehlende InsurancePolicyType-Enumwerte
-- ============================================================
-- Symptom (PostgreSQL):
--   ERROR: invalid input value for enum "InsurancePolicyType":
--          "RENTENVERSICHERUNG"
--   beim Anlegen bzw. Bearbeiten einer Versicherung.
--
-- Ursache:
--   Die Enumwerte RENTENVERSICHERUNG, KRANKENVERSICHERUNG und
--   KRANKENVERSICHERUNG_AUSLAND wurden spaeter ins Prisma-Schema
--   eingetragen (UI-Formulare und Kataloge bieten sie an), die
--   urspruengliche Migration
--   20260729120000_ap3_policy_registry/migration.sql legte das Enum
--   jedoch nur mit 9 Werten an. Es entstand kein Schemadrift-Schutz,
--   deshalb wurde der Fehler erst zur Laufzeit sichtbar.
--
-- Behebung (additiv, rueckwaertskompatibel):
--   ADD VALUE IF NOT EXISTS fuer genau die drei fehlenden Werte in der
--   Reihenfolge des Schemas. Bereits vorhandene Werte bleiben unberuehrt,
--   bestehende Datensaetze werden nicht migriert (keine No-Op-Wandlung).
--
-- PostgreSQL >= 12 (Projektbasis: 16.4): ALTER TYPE ... ADD VALUE laeuft
-- innerhalb der Transaktion der Migration; der neue Wert wird in derselben
-- Transaktion nicht weiter verwendet, was die einzige Restriktion ist.

ALTER TYPE "InsurancePolicyType" ADD VALUE IF NOT EXISTS 'RENTENVERSICHERUNG';
ALTER TYPE "InsurancePolicyType" ADD VALUE IF NOT EXISTS 'KRANKENVERSICHERUNG';
ALTER TYPE "InsurancePolicyType" ADD VALUE IF NOT EXISTS 'KRANKENVERSICHERUNG_AUSLAND';
