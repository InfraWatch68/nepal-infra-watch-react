-- Add 'coadmin' as a fourth role between 'reviewer' and 'admin'.
-- Co-admins get reviewer-level moderation powers plus ad management,
-- but cannot grant or revoke roles (that stays admin-only).
--
-- Postgres requires ALTER TYPE ADD VALUE to be in its own transaction
-- separate from any DDL that uses the new value, so the helper functions
-- and policy rewrites that use 'coadmin' live in the next migration file.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'coadmin';
