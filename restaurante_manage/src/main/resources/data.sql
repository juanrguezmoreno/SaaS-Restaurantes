-- ============================================
-- SEED DATA PARA RESTAURANT MANAGER (DEMO)
-- ============================================
-- Compatible con H2 (dev) y MySQL (prod)
-- Se ejecuta en cada arranque con spring.sql.init.mode=always
-- Los WHERE NOT EXISTS garantizan idempotencia

-- ============================================
-- 1. ROLES
-- ============================================
INSERT INTO roles (name, deleted) SELECT 'ROLE_SUPER_ADMIN', FALSE WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_SUPER_ADMIN');
INSERT INTO roles (name, deleted) SELECT 'ROLE_ADMIN',       FALSE WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_ADMIN');
INSERT INTO roles (name, deleted) SELECT 'ROLE_MANAGER',     FALSE WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_MANAGER');
INSERT INTO roles (name, deleted) SELECT 'ROLE_EMPLOYEE',    FALSE WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_EMPLOYEE');
INSERT INTO roles (name, deleted) SELECT 'ROLE_CLIENT',      FALSE WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ROLE_CLIENT');

-- ============================================
-- 2. RESTAURANTES
-- ============================================
INSERT INTO restaurants (name, address, phone, email, description, opening_time, closing_time, capacity, public_booking_enabled, created_at, updated_at, deleted)
SELECT 'La Casa del Chef',
       'Av. Reforma 123, Col. Juárez, Ciudad de México',
       '555-100-2000',
       'contacto@lacasadelchef.com',
       'Cocina fusión mexicana e italiana con ingredientes locales. Terraza al aire libre, barra de cocktails y ambiente familiar.',
       '08:00', '23:00', 120, TRUE,
       NOW(), NOW(), FALSE
WHERE NOT EXISTS (SELECT 1 FROM restaurants WHERE name = 'La Casa del Chef');

INSERT INTO restaurants (name, address, phone, email, description, opening_time, closing_time, capacity, public_booking_enabled, created_at, updated_at, deleted)
SELECT 'Sushi Master',
       'Insurgentes Sur 456, Col. Del Valle, Ciudad de México',
       '555-300-4000',
       'info@sushi-master.com',
       'Auténtica cocina japonesa con pescado fresco importado. Ambiente tradicional con barra de sushi y salones privados.',
       '12:00', '22:00', 80, TRUE,
       NOW(), NOW(), FALSE
WHERE NOT EXISTS (SELECT 1 FROM restaurants WHERE name = 'Sushi Master');

INSERT INTO restaurants (name, address, phone, email, description, opening_time, closing_time, capacity, public_booking_enabled, created_at, updated_at, deleted)
SELECT 'El Rincón de la Abuela',
       'Calle de la Paz 789, Col. Roma, Ciudad de México',
       '555-500-6000',
       'reservaciones@rinconabuela.com',
       'Comida casera tradicional mexicana. Especialidad en moles, pozole y barbacoa. Ambiente rústico y acogedor.',
       '09:00', '22:00', 60, TRUE,
       NOW(), NOW(), FALSE
WHERE NOT EXISTS (SELECT 1 FROM restaurants WHERE name = 'El Rincón de la Abuela');

-- ============================================
-- 3. MESAS (DINING TABLES)
-- ============================================

-- La Casa del Chef (5 mesas)
INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 1, 2, 'Interior — Ventana', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'La Casa del Chef') AND dt.table_number = 1);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 2, 4, 'Interior — Centro', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'La Casa del Chef') AND dt.table_number = 2);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 3, 4, 'Terraza', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'La Casa del Chef') AND dt.table_number = 3);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 4, 6, 'Salón Privado', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'La Casa del Chef') AND dt.table_number = 4);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 5, 8, 'Terraza — VIP', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'La Casa del Chef') AND dt.table_number = 5);

-- Sushi Master (5 mesas)
INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 1, 2, 'Barra', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'Sushi Master') AND dt.table_number = 1);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 2, 4, 'Salón Principal', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'Sushi Master') AND dt.table_number = 2);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 3, 4, 'Salón Principal', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'Sushi Master') AND dt.table_number = 3);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 4, 6, 'Salón Privado', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'Sushi Master') AND dt.table_number = 4);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 5, 2, 'Barra — Ventana', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'Sushi Master') AND dt.table_number = 5);

-- El Rincón de la Abuela (4 mesas)
INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 1, 4, 'Interior — Chimenea', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'El Rincón de la Abuela'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'El Rincón de la Abuela') AND dt.table_number = 1);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 2, 4, 'Interior — Centro', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'El Rincón de la Abuela'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'El Rincón de la Abuela') AND dt.table_number = 2);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 3, 6, 'Jardín', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'El Rincón de la Abuela'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'El Rincón de la Abuela') AND dt.table_number = 3);

INSERT INTO dining_tables (restaurant_id, table_number, capacity, location, status, created_at, updated_at, deleted)
SELECT r.id, 4, 8, 'Salón de Eventos', 'AVAILABLE', NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'El Rincón de la Abuela'
AND NOT EXISTS (SELECT 1 FROM dining_tables dt WHERE dt.restaurant_id = (SELECT id FROM restaurants WHERE name = 'El Rincón de la Abuela') AND dt.table_number = 4);

-- ============================================
-- 4. CLIENTES
-- ============================================
INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'María', 'García', 'maria.garcia@email.com', '555-100-1001',
       'Cliente frecuente — prefiere mesa en terraza. Alergia al marisco.',
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'maria.garcia@email.com');

INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'Pedro', 'Hernández', 'pedro.hernandez@email.com', '555-100-1002',
       'Alergia al gluten. Prefiere mesas interiores.',
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'pedro.hernandez@email.com');

INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'Sofía', 'Ramírez', 'sofia.ramirez@email.com', '555-100-1003',
       'Cumpleaños 3 de agosto. Prefiere música ambiental baja.',
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'La Casa del Chef'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'sofia.ramirez@email.com');

INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'Laura', 'Sánchez', 'laura.sanchez@email.com', '555-100-1004',
       NULL,
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'laura.sanchez@email.com');

INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'Roberto', 'Díaz', 'roberto.diaz@email.com', '555-100-1005',
       'Cliente corporativo — factura fiscal. Solicita siempre menú ejecutivo.',
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'Sushi Master'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'roberto.diaz@email.com');

INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'Gabriela', 'Torres', 'gabriela.torres@email.com', '555-100-1006',
       'Vegetariana. Prefiere mesa en jardín.',
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'El Rincón de la Abuela'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'gabriela.torres@email.com');

INSERT INTO customers (restaurant_id, first_name, last_name, email, phone, notes, created_at, updated_at, deleted)
SELECT r.id, 'Fernando', 'Muñoz', 'fernando.munoz@email.com', '555-100-1007',
       NULL,
       NOW(), NOW(), FALSE
FROM restaurants r WHERE r.name = 'El Rincón de la Abuela'
AND NOT EXISTS (SELECT 1 FROM customers WHERE email = 'fernando.munoz@email.com');

-- ============================================
-- 5. RESERVAS
-- ============================================
-- Las fechas se expresan como literales para compatibilidad H2/MySQL.
-- Ajusta los valores de fecha según el día en que se ejecute la demo.

-- Reserva 1: María — La Casa del Chef — Hoy — Confirmada — Mesa 1 (ventana, 2p)
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, dt.id, r.id, CURRENT_DATE, '19:00:00', 2, 'CONFIRMED', 'Mesa junto a la ventana — aniversario', NOW(), NOW(), FALSE
FROM customers c, dining_tables dt, restaurants r
WHERE c.email = 'maria.garcia@email.com'
  AND dt.table_number = 1 AND dt.restaurant_id = r.id
  AND r.name = 'La Casa del Chef'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE
  );

-- Reserva 2: Pedro — La Casa del Chef — Mañana — Pendiente — Mesa 2 (centro, 4p)
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, dt.id, r.id, CURRENT_DATE + 1, '14:30:00', 4, 'PENDING', 'Comida de negocios — solicitar menú sin gluten', NOW(), NOW(), FALSE
FROM customers c, dining_tables dt, restaurants r
WHERE c.email = 'pedro.hernandez@email.com'
  AND dt.table_number = 2 AND dt.restaurant_id = r.id
  AND r.name = 'La Casa del Chef'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE + 1
  );

-- Reserva 3: Laura — Sushi Master — En 2 días — Confirmada — Mesa 2 (salón, 4p)
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, dt.id, r.id, CURRENT_DATE + 2, '20:30:00', 3, 'CONFIRMED', 'Menú vegetariano para 1 persona', NOW(), NOW(), FALSE
FROM customers c, dining_tables dt, restaurants r
WHERE c.email = 'laura.sanchez@email.com'
  AND dt.table_number = 2 AND dt.restaurant_id = r.id
  AND r.name = 'Sushi Master'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE + 2
  );

-- Reserva 4: Roberto — Sushi Master — En 3 días — Cancelada — Sin mesa asignada
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, NULL, r.id, CURRENT_DATE + 3, '18:00:00', 6, 'CANCELLED', 'Cancelado por el cliente — reprogramará para la próxima semana', NOW(), NOW(), FALSE
FROM customers c, restaurants r
WHERE c.email = 'roberto.diaz@email.com'
  AND r.name = 'Sushi Master'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE + 3
  );

-- Reserva 5: Sofía — La Casa del Chef — En 7 días — Pendiente — Mesa 5 (VIP, 8p)
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, dt.id, r.id, CURRENT_DATE + 7, '21:00:00', 5, 'PENDING', 'Celebración de aniversario — pastel sorpresa', NOW(), NOW(), FALSE
FROM customers c, dining_tables dt, restaurants r
WHERE c.email = 'sofia.ramirez@email.com'
  AND dt.table_number = 5 AND dt.restaurant_id = r.id
  AND r.name = 'La Casa del Chef'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE + 7
  );

-- Reserva 6: Gabriela — El Rincón de la Abuela — Hoy — Confirmada — Mesa 3 (jardín, 6p)
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, dt.id, r.id, CURRENT_DATE, '15:00:00', 2, 'CONFIRMED', 'Mesa en jardín — menú vegetariano', NOW(), NOW(), FALSE
FROM customers c, dining_tables dt, restaurants r
WHERE c.email = 'gabriela.torres@email.com'
  AND dt.table_number = 3 AND dt.restaurant_id = r.id
  AND r.name = 'El Rincón de la Abuela'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE
  );

-- Reserva 7: Fernando — El Rincón de la Abuela — Mañana — Pendiente — Sin mesa asignada aún
INSERT INTO reservations (customer_id, dining_table_id, restaurant_id, reservation_date, reservation_time, party_size, status, notes, created_at, updated_at, deleted)
SELECT c.id, NULL, r.id, CURRENT_DATE + 1, '14:00:00', 4, 'PENDING', NULL, NOW(), NOW(), FALSE
FROM customers c, restaurants r
WHERE c.email = 'fernando.munoz@email.com'
  AND r.name = 'El Rincón de la Abuela'
  AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.customer_id = c.id AND res.reservation_date = CURRENT_DATE + 1
  );
