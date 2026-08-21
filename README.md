# 🍽️ Restaurant Manager SaaS

Aplicación web **full-stack para la gestión integral de restaurantes**, desarrollada como proyecto personal con el objetivo de construir una aplicación real, escalable y orientada a un entorno de producción.

Permite gestionar restaurantes, empleados, clientes, mesas y reservas desde una única plataforma, incorporando autenticación, roles y diferentes niveles de permisos.

## 🌐 Demo

🔗 **Aplicación:**
https://saa-s-restaurantes-lovat.vercel.app

> La aplicación se encuentra desplegada utilizando Vercel para el frontend y Railway para el backend.

---

## 🚀 Funcionalidades principales

* Gestión de restaurantes
* Gestión de clientes
* Gestión de empleados
* Gestión de mesas
* Gestión de reservas
* Plano visual de mesas
* Dashboard con métricas y actividad del restaurante
* Sistema de roles y permisos
* Autenticación mediante JWT
* Recuperación de contraseña mediante email
* Control de acceso según usuario y restaurante
* Gestión de múltiples restaurantes
* Diseño responsive
* Modo oscuro

---

## 👥 Roles

La aplicación cuenta con distintos niveles de acceso:

### Superadmin

Administración global de la plataforma y gestión de los restaurantes registrados.

### Administrador / Manager

Gestión completa de su restaurante, empleados, clientes, mesas y reservas.

### Encargado

Acceso limitado a determinadas funcionalidades dependiendo de sus permisos.

---

## 🛠️ Tecnologías utilizadas

### Frontend

* React
* JavaScript
* Vite
* HTML5
* CSS3

### Backend

* Java
* Spring Boot
* Spring Security
* Spring Data JPA / Hibernate
* API REST
* JWT

### Base de datos

* MySQL

### Herramientas y despliegue

* Git
* GitHub
* Maven
* Docker
* Railway
* Vercel
* Swagger / OpenAPI

---

## 🏗️ Arquitectura

La aplicación sigue una arquitectura cliente-servidor:

**React + Vite**

↓

**API REST**

↓

**Spring Boot**

↓

**JPA / Hibernate**

↓

**MySQL**

El frontend consume la API REST desarrollada con Spring Boot, mientras que el backend gestiona la lógica de negocio, autenticación, permisos y persistencia de datos.

---

## 🔐 Autenticación y seguridad

La aplicación implementa autenticación mediante **JSON Web Tokens (JWT)**.

Los usuarios reciben un token después de iniciar sesión que se utiliza para acceder a los diferentes endpoints protegidos de la API.

Además, se implementa:

* Control de acceso basado en roles
* Protección de endpoints
* Validación de datos
* Gestión de errores
* Separación de información entre restaurantes
* Recuperación de contraseña

---

## 📅 Sistema de reservas

El módulo de reservas permite gestionar el flujo principal de un restaurante:

* Crear reservas
* Confirmar reservas
* Cancelar reservas
* Asociar clientes
* Asignar mesas
* Consultar reservas próximas
* Consultar disponibilidad
* Evitar conflictos entre reservas

---

## 🪑 Gestión de mesas

La aplicación incluye un sistema visual para gestionar la distribución de las mesas del restaurante.

Cada restaurante puede organizar sus mesas y utilizarlas posteriormente dentro del sistema de reservas.

---

## 📊 Dashboard

El panel principal muestra información relevante del restaurante, como:

* Reservas del día
* Clientes
* Actividad reciente
* Información que requiere atención
* Métricas generales del restaurante

---

## 📁 Estructura del proyecto

```
.
├── restaurante-frontend/
│   └── Frontend React + Vite
│
├── restaurante_manage/
│   └── Backend Spring Boot
│
├── .gitignore
└── README.md
```

---

## 🎯 Objetivo del proyecto

Este proyecto nace con el objetivo de desarrollar una aplicación **full-stack completa**, trabajando aspectos habituales de un proyecto profesional:

* Diseño de APIs REST
* Desarrollo frontend y backend
* Modelado de bases de datos
* Autenticación y autorización
* Gestión de roles
* Integración frontend-backend
* Git y control de versiones
* Despliegue en producción
* Resolución de errores reales
* Diseño de una arquitectura escalable

---

## 👨‍💻 Autor

**Juan Rodríguez Moreno**

Desarrollador de Aplicaciones Multiplataforma — DAM

Proyecto desarrollado como parte de mi portfolio profesional.
