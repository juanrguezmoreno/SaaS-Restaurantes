# 🏢 Restaurante Manage — Configuración de Agentes OpenCode

## Descripción del proyecto

Aplicación web moderna para la gestión integral de restaurantes.
Pendiente de definir stack tecnológico (frontend, backend y base de datos).

## Jerarquía de agentes

```
auditor (primary)
├── developer (subagent generalista)
│   ├── frontend (subagent especializado)
│   └── backend (subagent especializado)
```

## Reglas generales

1. **Seguridad ante todo** — Ningún agente ejecutará comandos destructivos sin confirmación explícita del usuario.
2. **Confirmación obligatoria** — Antes de cambios grandes (migraciones, refactors, cambios de stack), el agente debe preguntar al usuario.
3. **Idioma** — Toda interacción y documentación se realiza en español.
4. **Stack abierto** — No se asume un stack tecnológico concreto hasta que el usuario lo decida.
5. **Sin dependencias automáticas** — No instalar paquetes ni dependencias sin autorización.
6. **Traza de cambios** — Los agentes documentarán sus decisiones en los commits o en este archivo cuando sea relevante.

## Flujo de trabajo típico

1. El usuario asigna una tarea al `auditor`.
2. El `auditor` analiza, descompone y delega a los subagentes según corresponda.
3. Los subagentes `developer`, `frontend` y `backend` ejecutan el trabajo técnico.
4. El `auditor` revisa el resultado antes de darlo por finalizado.
