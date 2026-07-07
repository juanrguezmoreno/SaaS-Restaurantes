-- ============================================================================
-- V2 — Roles del sistema (imprescindibles en cualquier entorno)
-- Los roles son datos de referencia requeridos por la lógica de negocio, no
-- datos de demostración; por eso viven en una migración y no en data-dev.sql.
-- ============================================================================

INSERT INTO roles (name, deleted) VALUES
    ('ROLE_SUPER_ADMIN', FALSE),
    ('ROLE_ADMIN',       FALSE),
    ('ROLE_MANAGER',     FALSE),
    ('ROLE_EMPLOYEE',    FALSE),
    ('ROLE_CLIENT',      FALSE);
