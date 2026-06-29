-- Roles iniciales (sintaxis compatible con H2)
INSERT INTO roles (name, deleted) SELECT 'ROLE_SUPER_ADMIN', false WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_SUPER_ADMIN');
INSERT INTO roles (name, deleted) SELECT 'ROLE_ADMIN', false WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_ADMIN');
INSERT INTO roles (name, deleted) SELECT 'ROLE_MANAGER', false WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_MANAGER');
INSERT INTO roles (name, deleted) SELECT 'ROLE_EMPLOYEE', false WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_EMPLOYEE');
INSERT INTO roles (name, deleted) SELECT 'ROLE_CLIENT', false WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_CLIENT');

-- Mesas de prueba para Restaurante Principal (id=1)
INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, deleted, created_at, updated_at)
SELECT 1, 'Mesa 1', 2, 'Sala', 'AVAILABLE', false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM dining_tables WHERE restaurant_id = 1 AND table_number = 'Mesa 1' AND deleted = false);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, deleted, created_at, updated_at)
SELECT 1, 'Mesa 2', 4, 'Sala', 'AVAILABLE', false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM dining_tables WHERE restaurant_id = 1 AND table_number = 'Mesa 2' AND deleted = false);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, deleted, created_at, updated_at)
SELECT 1, 'Mesa 3', 6, 'Terraza', 'AVAILABLE', false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM dining_tables WHERE restaurant_id = 1 AND table_number = 'Mesa 3' AND deleted = false);

-- Mesas de prueba para Restaurante Secundario (id=2)
INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, deleted, created_at, updated_at)
SELECT 2, 'M1', 4, 'Terraza', 'AVAILABLE', false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM dining_tables WHERE restaurant_id = 2 AND table_number = 'M1' AND deleted = false);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, deleted, created_at, updated_at)
SELECT 2, 'M2', 2, 'Interior', 'AVAILABLE', false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM dining_tables WHERE restaurant_id = 2 AND table_number = 'M2' AND deleted = false);
