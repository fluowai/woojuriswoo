-- 069_saas_role_hierarchy.sql
-- Completa a hierarquia SaaS sem quebrar os papéis jurídicos existentes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'legal_role_enum') THEN
    ALTER TYPE legal_role_enum ADD VALUE IF NOT EXISTS 'reseller_admin';
    ALTER TYPE legal_role_enum ADD VALUE IF NOT EXISTS 'secretary';
  END IF;
END $$;
