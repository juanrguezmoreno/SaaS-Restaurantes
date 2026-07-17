# Alta rápida de cliente desde el wizard de Nueva Reserva — Diseño

Fecha: 2026-07-17

## Objetivo

Permitir crear un cliente nuevo sin abandonar el wizard de "Nueva Reserva". Hoy, si el cliente no existe, hay que salir a la página Clientes, crearlo y volver a empezar la reserva. El flujo objetivo es: recepcionista → Nueva Reserva → cliente no existe → "+ Nuevo cliente" → crear → continuar la reserva, todo en la misma pantalla.

## Decisiones tomadas (validadas con el usuario)

1. **Email obligatorio**: el backend exige email obligatorio y único (`CustomerRequest`: `@NotBlank @Email`, entidad `nullable = false`). Se mantiene tal cual — cero cambios en backend, se reutilizan DTO, endpoint y validaciones existentes.
2. **Sección desplegable integrada** en el paso 5 del wizard (no modal apilado): al pulsar "+ Nuevo cliente" el mini-formulario se despliega bajo el selector de cliente.
3. **Componente nuevo `QuickCustomerForm`** en `src/components/`: `Reservations.jsx` ya tiene ~2.700 líneas; el formulario se aísla en un componente propio con una interfaz mínima.

## Alcance

- Solo frontend: un componente nuevo + integración en el paso 5 del wizard + habilitar "Nueva Reserva" cuando no hay clientes.
- Backend: **sin cambios**. Se usa `POST /api/v1/customers` a través del `createCustomer()` existente en `src/services/customerService.js`.
- No se toca el modal de edición de reserva, la página Clientes, ni ninguna otra funcionalidad de reservas.

## Frontend

### Nuevo componente `src/components/QuickCustomerForm.jsx`

Interfaz: `{ restaurantId, onCreated, onCancel }`.

- **Campos**: Nombre* (`firstName`), Apellidos* (`lastName`), Email* (`email`), Teléfono (`phone`, opcional), Notas (`notes`, opcional).
- **Validación en cliente** espejo de la del backend, para feedback inmediato: obligatorios, formato de email, longitudes máximas (50/50/100/20). La validación autoritativa sigue siendo la del backend.
- **Envío**: `createCustomer({ firstName, lastName, email, phone, notes, restaurantId: Number(restaurantId) })`. El backend ya valida y rechaza email duplicado (`DuplicateResourceException`).
- **Anti doble clic**: estado `submitting` deshabilita el botón "Guardar cliente" durante el envío.
- **Error** (validación, email duplicado, red): se muestra el mensaje del backend en un alert dentro de la propia sección; el formulario no se cierra y no se pierde ningún dato (ni del cliente ni de la reserva).
- **Éxito**: llama a `onCreated(clienteCreado)` con la respuesta del backend.
- Estilo Bootstrap 5 consistente con el resto de formularios (form-control, invalid-feedback), usando los tokens CSS reales del proyecto (`--border`, `--bg-card`, `--primary`...).

### Integración en `Reservations.jsx` (paso 5 del wizard)

- Estado nuevo: `showQuickCustomer` (visibilidad de la sección).
- Botón **"+ Nuevo cliente"** bajo el selector de cliente; alterna la sección desplegable.
- `restaurantId` se pasa desde `wizardData.restaurantId` (elegido en el paso 1); el usuario no lo introduce.
- `onCreated(customer)`:
  1. `await fetchCustomers()` — refresca el selector con la lista real del backend.
  2. `handleWizardChange('customerId', String(customer.id))` — autoselecciona el cliente recién creado.
  3. Cierra la sección y muestra "Cliente creado correctamente" dentro del paso.
- `onCancel`: cierra la sección y descarta el contenido del mini-formulario. Los datos de la reserva (`wizardData`) no se tocan en ningún caso.
- Al cerrar el wizard (`handleCloseWizard`) se restablece también `showQuickCustomer`.

### Cambio de comportamiento existente (aprobado)

Hoy el botón "Nueva Reserva" de la cabecera y el CTA del estado vacío se deshabilitan cuando no hay clientes (`noCustomers`), y hay una alerta que pide crear un cliente antes. Como el cliente ya puede crearse dentro del flujo:

- Se habilitan ambos botones siempre (si hay restaurantes).
- Se elimina la alerta bloqueante "No hay clientes disponibles. Cree un cliente antes de registrar una reserva.".
- El aviso del paso 5 "No hay clientes registrados. Crea un cliente primero." se sustituye por una invitación a usar "+ Nuevo cliente".
- El modal de **edición** de reserva no se toca (fuera de alcance).

## Verificación (manual — no existe infraestructura de tests frontend)

1. Crear una reserva completa con un cliente nuevo desde el wizard (flujo feliz).
2. El selector se refresca y el cliente nuevo queda autoseleccionado.
3. Tras un error (p. ej. email ya registrado), el mini-formulario muestra el mensaje y los datos de la reserva y del formulario persisten.
4. Doble clic en "Guardar cliente" no crea duplicados (botón deshabilitado + unicidad de email en backend).
5. Con cero clientes, "Nueva Reserva" está habilitado y el flujo completo funciona.
6. Roles MANAGER/EMPLOYEE pueden crear cliente desde el wizard (`POST /customers` ya lo permite para todos los roles autenticados).
7. Comprobar en ambos temas (claro/oscuro).

## Fuera de alcance

- Hacer el email opcional (requeriría cambios de DTO, entidad y BD).
- Alta rápida desde el modal de edición de reserva.
- Cambios en la página Clientes o en el backend.
- Tests automatizados de frontend.
