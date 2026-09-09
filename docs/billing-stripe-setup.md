# Puesta en marcha de Stripe Billing

Esta guía permite a alguien que no ha tocado este código poner en marcha el cobro de las
suscripciones NORMAL/PRO, en local y en producción. Da por hecho que el resto de la
aplicación (backend en Railway, frontend en Vercel) ya funciona.

## 1. Qué crear en el panel de Stripe (modo test)

Todo esto se hace en el [panel de Stripe](https://dashboard.stripe.com), con el interruptor
**modo test** activado (arriba a la derecha). Nunca en modo real hasta que se decida cobrar
de verdad.

1. **Productos y precios** — Catálogo de productos → Añadir producto:
   - `Restaurant Manager Normal` → un precio **recurrente, mensual, en EUR**.
   - `Restaurant Manager Pro` → un precio **recurrente, mensual, en EUR**.
   - Anota el identificador de **cada precio**, con forma `price_...` (por ejemplo
     `price_1AbCdEfGhIjKlMnO`). **No el identificador del producto** (`prod_...`): el
     backend sólo entiende `price_...`, son los valores de `STRIPE_PRICE_NORMAL_MONTHLY` y
     `STRIPE_PRICE_PRO_MONTHLY`.

2. **Clave secreta de test** — Desarrolladores → Claves de API → "Clave secreta" en la
   columna de test, con forma `sk_test_...`. Es el valor de `STRIPE_SECRET_KEY`. No se
   comparte, no se comitea, no se pega en un chat.

3. **Portal de cliente** — Configuración → Facturación → Portal de cliente:
   - Activar **cancelación de suscripción**.
   - Activar **cambio de plan** ("Update subscriptions"), y en la lista de precios
     permitidos añadir **los dos precios creados en el paso 1** (Normal y Pro). Sin esto,
     el botón "Gestionar suscripción" abre un portal donde no se puede cambiar de plan.

Con estos tres pasos, la cuenta de Stripe en modo test queda lista para el flujo completo de
checkout, cambio de plan y cancelación.

## 2. Variables de entorno por entorno

Ninguna de las variables de Stripe tiene valor por defecto en `application.yml` (bloque
`app.stripe`): si faltan, `StripeProperties.isEnabled()` devuelve `false` y los endpoints de
billing responden que el cobro no está configurado, en vez de fallar de forma confusa.

| Variable | Ejemplo / valor | Dónde se define |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (test) / `sk_live_...` (producción) | `.env` local · Railway |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | `.env` local · Railway — **valores distintos entre local y Railway**, ver §4 y §5 |
| `STRIPE_PRICE_NORMAL_MONTHLY` | `price_...` del producto Normal | `.env` local · Railway |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_...` del producto Pro | `.env` local · Railway |
| `STRIPE_TRIAL_DAYS` | `14` (también es el valor por defecto en código si se omite) | `.env` local · Railway (opcional) |
| `STRIPE_CONNECT_TIMEOUT_MS` | `5000` por defecto | `.env` local · Railway (opcional, rara vez hace falta tocarlo) |
| `STRIPE_READ_TIMEOUT_MS` | `15000` por defecto | `.env` local · Railway (opcional, rara vez hace falta tocarlo) |
| `FRONTEND_URL` | `http://localhost:5173` (local) / `https://<dominio-vercel>` (producción) | `.env` local · **Railway** — ver el aviso del §3 |

Notas sobre dónde va cada cosa:

- **`restaurante_manage/.env`** (local, ya en `.gitignore`): las cinco variables de Stripe
  más `FRONTEND_URL`. Verificar con `git status` que `.env` no aparece como fichero
  modificado/nuevo antes de seguir.
- **Railway** (backend): las mismas variables, con los valores de test (o los de producción
  real, más adelante) y `FRONTEND_URL` apuntando al dominio real del frontend en Vercel.
- **Vercel** (frontend): Stripe no se configura aquí. El frontend sólo necesita la URL del
  backend (`VITE_API_URL` si aplica); no lleva ninguna clave de Stripe.

`STRIPE_CONNECT_TIMEOUT_MS` y `STRIPE_READ_TIMEOUT_MS` no estaban en el encargo original de
esta guía, pero existen en `application.yml` (bloque `app.stripe`) con valores por defecto
razonables (5 s / 15 s) pensados para no retener la pool de conexiones de base de datos si
Stripe se degrada durante el procesado de un webhook. Normalmente no hace falta definirlas.

## 3. AVISO: `FRONTEND_URL` en Railway

Las URLs de éxito y cancelación del Checkout de Stripe se construyen a partir de
`app.frontend.base-url`, cuyo valor por defecto en `application.yml` es
`http://localhost:5173`.

**Si `FRONTEND_URL` no está definida en Railway, el cobro funciona igualmente** —a Stripe le
da igual el dominio— **pero el cliente que acaba de pagar es redirigido a `localhost:5173`**,
que en su navegador no existe. Es un fallo silencioso: nadie recibe un error, no hay logs
llamativos, y el único síntoma es un usuario confuso que "pagó y no pasó nada". Definir
`FRONTEND_URL` en Railway con el dominio real de Vercel es un paso obligatorio antes de
activar el cobro en producción, no opcional.

## 4. Webhooks en local

1. Instalar la [CLI de Stripe](https://docs.stripe.com/stripe-cli) y autenticarla:
   ```bash
   stripe login
   ```
2. Con el backend arrancado (`mvn spring-boot:run`, sin perfil, contra MySQL en el puerto
   3307), reenviar los webhooks:
   ```bash
   stripe listen --forward-to localhost:8080/api/v1/webhooks/stripe
   ```
3. La CLI imprime algo como:
   ```
   Ready! Your webhook signing secret is whsec_XXXXXXXXXXXXXXXXXXXXXXXX
   ```
   Ese `whsec_...` es el `STRIPE_WEBHOOK_SECRET` **de local**, y sólo vale mientras esa
   sesión de `stripe listen` esté abierta. **Es distinto del `whsec_...` que se genera al
   dar de alta el endpoint de producción en el panel** (§5). Confundir ambos es un error
   habitual: si se usa el secreto de producción en local (o viceversa), la verificación de
   firma falla siempre y el endpoint responde 400 a todo. Cada vez que se reinicia
   `stripe listen` sin el flag de secreto fijo, conviene revisar que el `.env` local sigue
   teniendo el valor correcto.

## 5. Webhooks en producción

En el panel de Stripe (modo test primero, modo real cuando se decida cobrar de verdad) →
Desarrolladores → Webhooks → Añadir endpoint:

- URL: `https://saas-restaurantes-production-ee67.up.railway.app/api/v1/webhooks/stripe`
- Eventos a escuchar — exactamente los que procesa `StripeWebhookService` (ver el `switch`
  de `procesar()`):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.trial_will_end` (se recibe y se registra en el log como aviso;
    hoy no dispara ninguna notificación al ADMIN, sólo evita que Stripe lo reintente como
    fallido)

  Cualquier otro evento que Stripe envíe a este endpoint se acepta con `200 OK` y se ignora
  sin error (rama `default` del `switch`), así que no pasa nada por suscribir eventos de más
  si el panel los agrupa por categoría.

- La versión de API de Stripe con la que está compilada la librería (`stripe-java` 33.4.1)
  es `2026-08-26.dahlia`. No hace falta fijarla a mano en el panel: el endpoint acepta el
  cuerpo crudo de cualquier versión y `stripe-java` se adapta, con una salvedad ya cubierta
  en el código (`StripeWebhookService.extraerSubscriptionId`): si la cuenta de Stripe está
  anclada a una versión de API distinta de la de la librería, el objeto tipado puede no
  deserializar y el código cae a leer el JSON crudo del evento.

Al confirmar el alta del endpoint, Stripe muestra el secreto de firma de **ese** endpoint,
`whsec_...`. Ese es el `STRIPE_WEBHOOK_SECRET` que va en Railway, y **no tiene nada que ver**
con el que imprime `stripe listen` en local (§4): son secretos de dos endpoints distintos,
aunque ambos empiecen por `whsec_`.

## 6. Probar el flujo completo

- **Pago con éxito**: tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha de caducidad
  futura, cualquier CVC de 3 dígitos. Stripe la trata como un pago siempre aceptado.
- **Pago rechazado**: con `stripe listen` en marcha,
  ```bash
  stripe trigger invoice.payment_failed
  ```
  simula el evento sin necesidad de esperar a un reintento real de Stripe; el estado de la
  suscripción del tenant afectado debería pasar a `PAST_DUE`.

## 7. Comportamiento que conviene conocer antes de vender

- **`PAST_DUE` no bloquea nada a propósito.** El acceso a la aplicación y el QR público de
  reservas siguen funcionando con la suscripción en `PAST_DUE`: un pago fallido suele ser una
  tarjeta caducada, no un cliente que se quiere ir, y Stripe reintenta el cobro solo durante
  varios días. El acceso sólo se cierra con `CANCELED` o `UNPAID`.
- **Bajar de plan no borra nada.** Si un tenant con más locales de los que permite NORMAL
  baja de PRO a NORMAL, los locales que sobran no se eliminan ni pierden datos: quedan en
  solo lectura (`activeUnderPlan = false`) y se reactivan automáticamente en cuanto el tenant
  vuelve a PRO.
- **Todos los tenants preexistentes ya tienen PRO de cortesía.** La migración `V9` les creó
  una fila en `subscriptions` con `plan_code = 'PRO'`, `status = 'ACTIVE'` y
  `legacy_grant = 1`, sin ningún dato de Stripe. Mientras `legacy_grant` sea `1`, ese tenant
  tiene PRO completo sin pagar y sin caducidad. Para convertir uno a un plan de pago real hay
  que ponerle `legacy_grant = 0` (y, en la práctica, hacerle pasar por el checkout para que
  quede enlazado a Stripe).

## 8. Asuntos abiertos que el equipo debe conocer

- **No hay reconciliación automática con Stripe.** El estado guardado en `subscriptions`
  cambia únicamente cuando llega un webhook con firma válida. Si Stripe deja de poder
  entregarlos (por ejemplo, deshabilita el endpoint tras varios días seguidos de fallos), el
  estado se queda congelado: un tenant que canceló seguiría con acceso, y uno que sí paga
  podría quedar bloqueado si el evento que lo reactivaba nunca llegó. Conviene vigilar
  periódicamente la pestaña de fallos del endpoint en el panel de Stripe. Para resincronizar
  un tenant concreto a mano ya existe `StripeGateway.fetchSubscription(subscriptionId)`, que
  relee el estado real desde Stripe; no hay todavía un endpoint ni un job que lo haga solo.

- **Un restaurante puede quedar sin tenant.** Un `SUPER_ADMIN` puede crear restaurantes sin
  asignarles un inquilino. Un restaurante así no pertenece a ninguna suscripción, así que las
  comprobaciones de plan lo tratarían como sin acceso y su página pública de reservas (QR)
  quedaría cerrada. Antes de desplegar o de activar el cobro conviene comprobarlo en la base
  de datos de producción:
  ```sql
  SELECT id, name FROM restaurants WHERE tenant_id IS NULL AND deleted = b'0';
  ```
  Si aparece alguna fila, hay que decidir con el usuario qué hacer con ese local antes de
  seguir; no se toca sin consultar.

- **La cuota de cuentas cuenta usuarios no borrados, no usuarios con acceso real.** Al
  eliminar un empleado con acceso al sistema, su `User` no se borra: sólo se deshabilita
  (`enabled = false`, `deleted` sigue en `false`). Hoy esto no se nota porque todos los
  tenants tienen PRO de cortesía (límite ilimitado), pero en cuanto se convierta el primero a
  NORMAL, ese tenant podría aparecer con más "cuentas" contadas de las que realmente usa, y
  chocar antes de lo esperado contra el límite de 5. Está pendiente decidir si la métrica de
  cuota debe ser cuentas vivas (`deleted = false`, criterio actual) o cuentas activas
  (`enabled = true` además).
