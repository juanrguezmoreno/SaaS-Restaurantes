# Selector de restaurantes con búsqueda — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que asignar restaurantes a un empleado funcione igual con cinco que con cinco mil, sustituyendo la rejilla de casillas por un buscador con etiquetas.

**Architecture:** el selector consulta `GET /admin/restaurants`, que ya pagina, busca y acota al tenant, y que solo admite `SUPER_ADMIN` y `ADMIN` — justo los roles que abren este formulario. El valor del selector lleva `{ id, name }` para que las etiquetas se pinten sin depender de la página de resultados. El backend solo gana un campo emparejado, porque los dos que hay hoy no se corresponden entre sí.

**Tech Stack:** Spring Boot 3.3 / Java 21 / Maven / H2 en tests · React 19 / Vite / Vitest / Testing Library / Bootstrap 5 (solo CSS).

Spec: [`docs/superpowers/specs/2026-08-24-selector-restaurantes-empleado-design.md`](../specs/2026-08-24-selector-restaurantes-empleado-design.md)

## Global Constraints

- Código, comentarios, mensajes de commit y texto visible **en español**.
- Conventional Commits: `feat(user): ...`, `fix(user): ...`, `test(user): ...`.
- **Prohibido**: `git push`, push forzado, pull request, merge remoto, publicar en GitHub, desplegar en Vercel o Railway, tocar ramas remotas. Permitido: `status`, `diff`, `log`, `add`, `commit`.
- **Prohibido** arrancar el backend con `-Dspring-boot.run.profiles=dev`: borra los datos reales del usuario.
- No inventar entidades ni campos. **No existen** grupos de restaurantes, etiquetas ni zonas geográficas.
- No desactivar comprobaciones para ocultar errores. No tocar variables de entorno ni exponer secretos.
- No borrar cambios locales ajenos a la tarea.
- Bootstrap aporta **solo CSS**: nada de `data-bs-toggle`. Los desplegables se hacen en React, como `ActionMenu`.
- Sin dependencias nuevas.
- El contrato con el backend al guardar **no cambia**: se sigue enviando `restaurantIds`.
- **No se añade validación nueva**: guardar un empleado sin restaurantes sigue siendo posible.
- Verificación final: `mvn -o test` verde, `pnpm lint` limpio, `pnpm test` verde y `pnpm build` correcto.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `user/dto/AssignedRestaurant.java` (nuevo) | Pareja `{ id, name }` de un restaurante asignado |
| `user/dto/AdminUserListItem.java` | + campo `assignedRestaurants` |
| `user/service/UserService.java` | Emparejar sin desincronizar, en la misma pasada |
| `components/RestaurantMultiSelect.jsx` (nuevo) | Elegir varios restaurantes con búsqueda |
| `index.css` | Estilos del selector, con los tokens que ya existen |
| `pages/Employees.jsx` | Sustituir la rejilla y añadir el aviso del vacío |

---

### Task 1: El backend devuelve las parejas bien hechas

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/user/dto/AssignedRestaurant.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/user/dto/AdminUserListItem.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/user/service/UserService.java:125-175`
- Test: `restaurante_manage/src/test/java/com/restaurante/user/service/UserServiceTest.java`

**Interfaces:**
- Produces: `AssignedRestaurant` (record con `Long id()`, `String name()`), y en `AdminUserListItem` los accesores `getAssignedRestaurants()` / `setAssignedRestaurants(List<AssignedRestaurant>)`. En JSON sale como `assignedRestaurants: [{ "id": 3, "name": "Sushi Master" }]`.
- Consumes: `UserRepository.findAssignedRestaurantsByUserIds(Set<Long>) -> List<Object[]>` con filas `[u.id, ar.id, ar.name]`, que ya existe.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `UserServiceTest`. El caso está construido para que el orden alfabético de los nombres **no** coincida con el orden de los identificadores: es lo que hoy desincroniza las dos listas.

```java
    @Test
    void lasParejasDeRestaurantesAsignadosSeCorresponden() {
        AdminUserListItem fila = new AdminUserListItem();
        fila.setId(7L);
        stubPageWith(fila);

        // El id 10 es «Sushi Master» y el 20 es «Bar Central»: por nombre van al
        // revés que por id. Emparejar dos listas ordenadas por separado daría
        // «Bar Central» al id 10, que es el fallo que esto previene.
        when(userRepository.findAssignedRestaurantsByUserIds(anySet()))
                .thenReturn(List.<Object[]>of(
                        new Object[]{7L, 10L, "Sushi Master"},
                        new Object[]{7L, 20L, "Bar Central"}));
        when(userRepository.findRoleNamesByUserIds(anySet())).thenReturn(List.of());

        AdminUserListItem resultado = userService
                .findAll(PageRequest.of(0, 25), null, null, null)
                .getContent()
                .get(0);

        assertThat(resultado.getAssignedRestaurants())
                .extracting(AssignedRestaurant::id, AssignedRestaurant::name)
                .containsExactly(
                        tuple(20L, "Bar Central"),
                        tuple(10L, "Sushi Master"));
    }

    @Test
    void sinAsignacionesLasParejasVienenVacias() {
        AdminUserListItem fila = new AdminUserListItem();
        fila.setId(7L);
        fila.setPrimaryRestaurantName("Restaurante principal");
        stubPageWith(fila);

        when(userRepository.findAssignedRestaurantsByUserIds(anySet())).thenReturn(List.of());
        when(userRepository.findRoleNamesByUserIds(anySet())).thenReturn(List.of());

        AdminUserListItem resultado = userService
                .findAll(PageRequest.of(0, 25), null, null, null)
                .getContent()
                .get(0);

        // restaurantNames sigue cayendo al principal para la tabla del listado,
        // pero las parejas reflejan la verdad: no hay asignaciones explícitas.
        assertThat(resultado.getRestaurantNames()).containsExactly("Restaurante principal");
        assertThat(resultado.getAssignedRestaurants()).isEmpty();
    }
```

Importar en el test: `com.restaurante.user.dto.AssignedRestaurant`, `static org.assertj.core.api.Assertions.tuple`, `static org.mockito.ArgumentMatchers.anySet`.

Si en `UserServiceTest` no existe ya una ayuda que devuelva una página con una fila, añadirla. `searchForAdmin` recibe nueve parámetros más el `Pageable`:

```java
    /** Deja el repositorio devolviendo una página con esas filas y alcance de SUPER_ADMIN. */
    private void stubPageWith(AdminUserListItem... filas) {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(userRepository.searchForAdmin(
                anyBoolean(),        // unrestricted
                any(),               // tenantId
                anyBoolean(),        // filterByRestaurants
                anySet(),            // restaurantIds
                anyBoolean(),        // filterByRole
                any(),               // role
                anyBoolean(),        // filterByEnabled
                anyBoolean(),        // enabled
                any(),               // search
                any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(filas)));
    }
```

Importar además `static org.mockito.ArgumentMatchers.anyBoolean`, `static org.mockito.ArgumentMatchers.any`, `org.springframework.data.domain.PageImpl`, `org.springframework.data.domain.PageRequest` y `org.springframework.data.domain.Pageable` si no están ya.

- [ ] **Step 2: Comprobar que falla**

Run: `cd restaurante_manage && mvn -o test -Dtest=UserServiceTest`
Expected: FAIL en compilación — no existe `AssignedRestaurant` ni `getAssignedRestaurants()`.

- [ ] **Step 3: Crear el record**

`AssignedRestaurant.java`:

```java
package com.restaurante.user.dto;

/**
 * Restaurante asignado a un usuario, con su identificador y su nombre juntos.
 *
 * <p>Existe porque {@code assignedRestaurantIds} y {@code restaurantNames} son
 * dos listas independientes que <strong>no</strong> se corresponden posición a
 * posición: los nombres se ordenan alfabéticamente y los identificadores no, y
 * cuando no hay asignaciones explícitas los nombres caen al restaurante
 * principal, que no está entre los identificadores. Emparejarlas fuera daría
 * etiquetas equivocadas.</p>
 */
public record AssignedRestaurant(Long id, String name) {
}
```

- [ ] **Step 4: Añadir el campo al DTO**

En `AdminUserListItem`, junto a `assignedRestaurantIds`:

```java
    /**
     * Restaurantes asignados con identificador y nombre emparejados. Lo usa el
     * formulario de empleado, que se abre con los datos de la fila y necesita
     * pintar el nombre de cada asignación.
     */
    private List<AssignedRestaurant> assignedRestaurants = new ArrayList<>();
```

Y en el constructor de la proyección, donde ya se inicializan las otras colecciones:

```java
        this.assignedRestaurants = new ArrayList<>();
```

- [ ] **Step 5: Emparejar en el servicio**

En `UserService.enrichWithRolesAndRestaurants`, sustituir los dos mapas sueltos por uno de parejas y derivar de él las dos listas que ya se publicaban:

```java
        List<Object[]> restaurantRows = userRepository.findAssignedRestaurantsByUserIds(ids);
        Map<Long, List<AssignedRestaurant>> assignedByUser = new HashMap<>();
        if (restaurantRows != null) {
            for (Object[] row : restaurantRows) {
                if (row == null || row.length < 3 || row[0] == null || row[1] == null) {
                    continue;
                }
                Long userId = ((Number) row[0]).longValue();
                Long restaurantId = ((Number) row[1]).longValue();
                String restaurantName = row[2] != null ? String.valueOf(row[2]) : null;
                assignedByUser.computeIfAbsent(userId, key -> new ArrayList<>())
                        .add(new AssignedRestaurant(restaurantId, restaurantName));
            }
        }
        // Se ordena por nombre COMO PAREJAS. Ordenar dos listas por separado era
        // lo que dejaba cada nombre junto al identificador de otro restaurante.
        assignedByUser.values().forEach(lista -> lista.sort(
                Comparator.comparing(AssignedRestaurant::name,
                        Comparator.nullsLast(String::compareToIgnoreCase))));

        page.getContent().forEach(item -> {
            item.setRoles(rolesByUser.getOrDefault(item.getId(), List.of()));

            List<AssignedRestaurant> asignados = assignedByUser.getOrDefault(item.getId(), List.of());
            item.setAssignedRestaurants(asignados);
            item.setAssignedRestaurantIds(asignados.stream()
                    .map(AssignedRestaurant::id)
                    .toList());

            List<String> nombres = asignados.stream()
                    .map(AssignedRestaurant::name)
                    .filter(Objects::nonNull)
                    .toList();
            if (!nombres.isEmpty()) {
                item.setRestaurantNames(nombres);
            } else if (item.getPrimaryRestaurantName() != null) {
                // Sin asignaciones explícitas se cae al restaurante principal, que
                // es lo que mostraba la tabla antes de este cambio.
                item.setRestaurantNames(List.of(item.getPrimaryRestaurantName()));
            } else {
                item.setRestaurantNames(List.of());
            }
        });
```

Importar `java.util.Comparator`. Retirar el import de `java.util.Collections` si deja de usarse en el fichero.

Nota del entorno: el procesador de Lombok del IDE está roto (`NoClassDefFoundError: lombok.javac.Javac`). Los errores de getters y builders en el panel de diagnósticos son ruido; **solo `mvn` decide**.

- [ ] **Step 6: Comprobar que pasan**

Run: `cd restaurante_manage && mvn -o test -Dtest=UserServiceTest`
Expected: PASS, incluidos los tests que ya existían.

- [ ] **Step 7: Batería completa**

Run: `cd restaurante_manage && mvn -o test`
Expected: BUILD SUCCESS, sin regresiones (392 tests antes de esta tarea).

- [ ] **Step 8: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/user/ \
        restaurante_manage/src/test/java/com/restaurante/user/
git commit -m "fix(user): emparejar los restaurantes asignados con su nombre"
```

---

### Task 2: El componente `RestaurantMultiSelect`

**Files:**
- Create: `restaurante-frontend/src/components/RestaurantMultiSelect.jsx`
- Modify: `restaurante-frontend/src/index.css` (añadir al final)
- Test: `restaurante-frontend/src/components/RestaurantMultiSelect.test.jsx`

**Interfaces:**
- Consumes: `getAdminRestaurants({ page, size, search, sort, direction })` de `services/adminRestaurantService.js`, que devuelve `{ content: [{ id, name, ... }], totalElements, ... }`.
- Produces: componente por defecto con props `value: Array<{id, name}>`, `onChange: (nuevaLista) => void`, `disabled?: boolean`, `id?: string`.

- [ ] **Step 1: Escribir los tests que fallan**

`RestaurantMultiSelect.test.jsx`. Temporizadores reales y `waitFor`: los falsos no accionan bien el retardo, como ya se comprobó en las pruebas de clientes.

```jsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, describe, it, expect } from 'vitest';

vi.mock('../services/adminRestaurantService', () => ({
  getAdminRestaurants: vi.fn(),
}));

import { getAdminRestaurants } from '../services/adminRestaurantService';
import RestaurantMultiSelect from './RestaurantMultiSelect';

const pagina = (content, totalElements = content.length) => ({
  content, page: 0, size: 10, totalElements,
  totalPages: Math.ceil(totalElements / 10),
  first: true, last: true, empty: content.length === 0,
});

const TRES = [
  { id: 1, name: 'La Casa del Chef' },
  { id: 2, name: 'La Parrilla del Norte' },
  { id: 3, name: 'Sushi Master' },
];

beforeEach(() => {
  vi.clearAllMocks();
  getAdminRestaurants.mockResolvedValue(pagina(TRES));
});

/** Renderiza el selector controlando su valor, como hace el formulario real. */
const montar = (valorInicial = []) => {
  const onChange = vi.fn();
  const utils = render(
    <RestaurantMultiSelect value={valorInicial} onChange={onChange} />
  );
  return { onChange, ...utils };
};

describe('RestaurantMultiSelect', () => {
  it('no consulta nada hasta que se abre', async () => {
    montar();
    expect(getAdminRestaurants).not.toHaveBeenCalled();
  });

  it('al abrir muestra los primeros restaurantes sin escribir nada', async () => {
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    expect(await screen.findByRole('option', { name: /la casa del chef/i })).toBeInTheDocument();
    expect(getAdminRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({ size: 10, sort: 'name', direction: 'asc' })
    );
  });

  it('busca con retardo y dispara una sola petición', async () => {
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));
    await waitFor(() => expect(getAdminRestaurants).toHaveBeenCalledTimes(1));

    getAdminRestaurants.mockClear();
    await userEvent.type(screen.getByLabelText(/buscar restaurante/i), 'sus');

    await waitFor(
      () => expect(getAdminRestaurants).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'sus' })
      ),
      { timeout: 2000 }
    );
    expect(getAdminRestaurants).toHaveBeenCalledTimes(1);
  });

  it('elegir uno lo comunica al formulario con su nombre', async () => {
    const { onChange } = montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));
    await userEvent.click(await screen.findByRole('option', { name: /sushi master/i }));

    expect(onChange).toHaveBeenCalledWith([{ id: 3, name: 'Sushi Master' }]);
  });

  it('los ya elegidos salen marcados y pulsarlos los quita', async () => {
    const { onChange } = montar([{ id: 3, name: 'Sushi Master' }]);
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    const opcion = await screen.findByRole('option', { name: /sushi master/i });
    expect(opcion).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(opcion);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('conserva la etiqueta de lo elegido aunque no esté en los resultados', async () => {
    // El caso de edición: el restaurante asignado no aparece al buscar otra cosa.
    montar([{ id: 99, name: 'El Rincón' }]);
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));
    await screen.findByRole('option', { name: /la casa del chef/i });

    expect(screen.getByText('El Rincón')).toBeInTheDocument();
  });

  it('la etiqueta se quita con su botón', async () => {
    const { onChange } = montar([
      { id: 1, name: 'La Casa del Chef' },
      { id: 3, name: 'Sushi Master' },
    ]);

    await userEvent.click(screen.getByRole('button', { name: /quitar sushi master/i }));

    expect(onChange).toHaveBeenCalledWith([{ id: 1, name: 'La Casa del Chef' }]);
  });

  it('avisa de cuántos resultados quedan fuera', async () => {
    getAdminRestaurants.mockResolvedValue(pagina(TRES, 27));
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    expect(await screen.findByText(/y 24 más, afina la búsqueda/i)).toBeInTheDocument();
  });

  it('dice cuando no hay resultados', async () => {
    getAdminRestaurants.mockResolvedValue(pagina([]));
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    expect(await screen.findByText(/ningún restaurante coincide/i)).toBeInTheDocument();
  });

  it('ofrece reintentar cuando la consulta falla', async () => {
    getAdminRestaurants.mockRejectedValueOnce(new Error('Error de conexión'));
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/no se pudieron cargar/i);

    getAdminRestaurants.mockResolvedValue(pagina(TRES));
    await userEvent.click(within(aviso).getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByRole('option', { name: /la casa del chef/i })).toBeInTheDocument();
  });

  it('se recorre y se elige con el teclado', async () => {
    const { onChange } = montar();
    const campo = screen.getByLabelText(/buscar restaurante/i);
    await userEvent.click(campo);
    await screen.findByRole('option', { name: /la casa del chef/i });

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith([{ id: 2, name: 'La Parrilla del Norte' }]);
  });

  it('Escape cierra la lista y devuelve el foco al campo', async () => {
    montar();
    const campo = screen.getByLabelText(/buscar restaurante/i);
    await userEvent.click(campo);
    await screen.findByRole('option', { name: /la casa del chef/i });

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(campo);
  });
});
```

Nota sobre el test del teclado: al abrir, el elemento activo es el índice 0 (`La Casa del Chef`), así que una sola flecha abajo lleva al 1 (`La Parrilla del Norte`).

- [ ] **Step 2: Comprobar que fallan**

Run: `cd restaurante-frontend && pnpm test src/components/RestaurantMultiSelect.test.jsx`
Expected: FAIL — no se puede resolver `./RestaurantMultiSelect`.

- [ ] **Step 3: Escribir el componente**

`RestaurantMultiSelect.jsx`:

```jsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getAdminRestaurants } from '../services/adminRestaurantService';

/** Cuántos resultados caben en la lista antes de pedir que se afine la búsqueda. */
const RESULTADOS = 10;

/** Retardo del buscador, el mismo que usan los listados. */
const RETARDO_MS = 350;

/**
 * Selector de varios restaurantes con búsqueda en el servidor.
 *
 * Sustituye a la rejilla de casillas que pintaba una por restaurante sobre un
 * catálogo completo de 500: con muchos restaurantes era intransitable. Aquí la
 * búsqueda la resuelve `GET /admin/restaurants`, que pagina y acota al tenant.
 *
 * El valor lleva el nombre además del identificador a propósito: así las
 * etiquetas de lo ya elegido se pintan siempre, aunque ese restaurante no
 * aparezca entre los resultados que se estén mostrando.
 *
 * Está hecho en React y no con el desplegable de Bootstrap porque el proyecto
 * solo carga su CSS, no su JavaScript; es el mismo motivo que en ActionMenu.
 *
 * @param {object} props
 * @param {Array<{id: number, name: string}>} props.value
 * @param {(seleccion: Array<{id: number, name: string}>) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.id] Identificador del campo de búsqueda.
 */
const RestaurantMultiSelect = ({ value = [], onChange, disabled = false, id }) => {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');        // lo que se teclea
  const [busqueda, setBusqueda] = useState('');  // lo que se consulta
  const [resultados, setResultados] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [activo, setActivo] = useState(-1);
  const [reintento, setReintento] = useState(0);

  const contenedorRef = useRef(null);
  const campoRef = useRef(null);
  const generado = useId();
  const campoId = id || `restaurant-select-${generado}`;
  const listaId = `${campoId}-lista`;

  const seleccion = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const idsElegidos = useMemo(
    () => new Set(seleccion.map((r) => Number(r.id))),
    [seleccion]
  );

  // Retardo del buscador: texto y consulta se separan para no pedir en cada tecla.
  useEffect(() => {
    const temporizador = setTimeout(() => setBusqueda(texto.trim()), RETARDO_MS);
    return () => clearTimeout(temporizador);
  }, [texto]);

  // Solo se consulta con la lista abierta: si nadie toca el selector, no se pide nada.
  useEffect(() => {
    if (!abierto) return undefined;
    let cancelado = false;

    const cargar = async () => {
      setCargando(true);
      setError(null);
      try {
        const pagina = await getAdminRestaurants({
          page: 0,
          size: RESULTADOS,
          search: busqueda,
          sort: 'name',
          direction: 'asc',
        });
        if (cancelado) return;
        setResultados(pagina.content);
        setTotal(pagina.totalElements);
        setActivo(pagina.content.length > 0 ? 0 : -1);
      } catch (err) {
        if (!cancelado) {
          setResultados([]);
          setTotal(0);
          setError(err?.message || 'Error al cargar los restaurantes.');
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    };

    cargar();
    return () => { cancelado = true; };
  }, [abierto, busqueda, reintento]);

  // Cierre por clic fuera, como en ActionMenu: sin esto la lista se queda abierta
  // por encima del resto del formulario.
  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsarFuera = (evento) => {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', alPulsarFuera);
    return () => document.removeEventListener('mousedown', alPulsarFuera);
  }, [abierto]);

  const alternar = (restaurante) => {
    const rid = Number(restaurante.id);
    if (idsElegidos.has(rid)) {
      onChange(seleccion.filter((r) => Number(r.id) !== rid));
    } else {
      onChange([...seleccion, { id: rid, name: restaurante.name }]);
    }
  };

  const quitar = (rid) => onChange(seleccion.filter((r) => Number(r.id) !== Number(rid)));

  const alTeclear = (evento) => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      setAbierto(false);
      campoRef.current?.focus();
      return;
    }
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      if (resultados.length === 0) return;
      const paso = evento.key === 'ArrowDown' ? 1 : -1;
      setActivo((actual) => {
        const siguiente = actual + paso;
        if (siguiente < 0) return resultados.length - 1;
        if (siguiente >= resultados.length) return 0;
        return siguiente;
      });
      return;
    }
    if (evento.key === 'Enter') {
      // El selector vive dentro de un formulario: sin esto, Enter lo enviaría.
      evento.preventDefault();
      if (abierto && activo >= 0 && resultados[activo]) {
        alternar(resultados[activo]);
      }
    }
  };

  const ocultos = Math.max(0, total - resultados.length);

  return (
    <div className="restaurant-select" ref={contenedorRef}>
      {seleccion.length > 0 && (
        <ul className="restaurant-select-chips">
          {seleccion.map((r) => (
            <li key={r.id} className="restaurant-select-chip">
              <span>{r.name || `Restaurante #${r.id}`}</span>
              <button
                type="button"
                onClick={() => quitar(r.id)}
                disabled={disabled}
                aria-label={`Quitar ${r.name || `restaurante ${r.id}`}`}
                title="Quitar"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={campoRef}
        id={campoId}
        type="text"
        className="form-control form-control-sm"
        placeholder="Buscar restaurante…"
        aria-label="Buscar restaurante"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={abierto ? listaId : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={texto}
        disabled={disabled}
        onFocus={() => setAbierto(true)}
        onClick={() => setAbierto(true)}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={alTeclear}
      />

      {abierto && (
        <div className="restaurant-select-panel">
          {cargando && (
            <div className="restaurant-select-message">Buscando…</div>
          )}

          {!cargando && error && (
            <div className="restaurant-select-message" role="alert">
              <span>No se pudieron cargar los restaurantes.</span>
              <button
                type="button"
                className="btn btn-sm btn-link"
                onClick={() => setReintento((n) => n + 1)}
              >
                Reintentar
              </button>
            </div>
          )}

          {!cargando && !error && resultados.length === 0 && (
            <div className="restaurant-select-message">
              Ningún restaurante coincide con la búsqueda.
            </div>
          )}

          {!cargando && !error && resultados.length > 0 && (
            <>
              <ul className="restaurant-select-options" id={listaId} role="listbox" aria-multiselectable="true">
                {resultados.map((r, indice) => {
                  const elegido = idsElegidos.has(Number(r.id));
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={elegido}
                        className={`restaurant-select-option${indice === activo ? ' is-active' : ''}${elegido ? ' is-selected' : ''}`}
                        onMouseEnter={() => setActivo(indice)}
                        onClick={() => alternar(r)}
                      >
                        <span className="restaurant-select-check" aria-hidden="true">
                          {elegido ? '✓' : ''}
                        </span>
                        {r.name || `Restaurante #${r.id}`}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {ocultos > 0 && (
                <div className="restaurant-select-message">
                  … y {ocultos} más, afina la búsqueda.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RestaurantMultiSelect;
```

- [ ] **Step 4: Añadir los estilos**

Al final de `src/index.css`, con los tokens que ya usa el resto:

```css
/* ─── Selector de restaurantes con búsqueda ──────────────────────────────── */

.restaurant-select {
  position: relative;
}

.restaurant-select-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin: 0 0 0.5rem;
  padding: 0;
  list-style: none;
}

.restaurant-select-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.25rem 0.125rem 0.5rem;
  font-size: 0.8125rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
}

.restaurant-select-chip button {
  border: none;
  background: none;
  cursor: pointer;
  line-height: 1;
  padding: 0 0.25rem;
  font-size: 1rem;
  color: var(--text-secondary);
}

.restaurant-select-chip button:hover:not(:disabled) {
  color: var(--danger);
}

.restaurant-select-chip button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.restaurant-select-panel {
  position: absolute;
  z-index: 1060; /* por encima del modal de Bootstrap, que usa 1050 */
  left: 0;
  right: 0;
  margin-top: 0.25rem;
  max-height: 15rem;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.restaurant-select-options {
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
}

.restaurant-select-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.375rem 0.75rem;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.8125rem;
  color: var(--text-primary);
  cursor: pointer;
}

.restaurant-select-option.is-active {
  background: var(--bg-hover);
}

.restaurant-select-option.is-selected {
  font-weight: 600;
}

.restaurant-select-check {
  display: inline-block;
  width: 1rem;
  color: var(--primary);
}

.restaurant-select-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
```

Comprobar que `--bg-hover` existe (`grep -n "\-\-bg-hover" src/index.css`). Si no, usar el token de hover que ya emplee `.action-menu-item`.

- [ ] **Step 5: Comprobar que pasan**

Run: `cd restaurante-frontend && pnpm test src/components/RestaurantMultiSelect.test.jsx`
Expected: PASS, 12 tests.

- [ ] **Step 6: Linter**

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores. Si salta `react-hooks/set-state-in-effect`, mover el `setState` dentro de la función asíncrona en vez de desactivar la regla — es lo que se hizo en `Reservations.jsx`.

- [ ] **Step 7: Commit**

```bash
git add restaurante-frontend/src/components/RestaurantMultiSelect.jsx \
        restaurante-frontend/src/components/RestaurantMultiSelect.test.jsx \
        restaurante-frontend/src/index.css
git commit -m "feat(frontend): selector de restaurantes con búsqueda en servidor"
```

---

### Task 3: Enchufarlo en el formulario de empleado

**Files:**
- Modify: `restaurante-frontend/src/pages/Employees.jsx`
- Test: `restaurante-frontend/src/pages/Employees.test.jsx` (crear si no existe)

**Interfaces:**
- Consumes: `RestaurantMultiSelect` con `value: Array<{id, name}>` y `onChange` (Task 2); el campo `assignedRestaurants` de cada fila (Task 1).

⚠️ Comprobar si el fichero usa CRLF antes de cualquier sustitución con guion (`s.includes('\r\n')`), como pasó con `Reservations.jsx`.

- [ ] **Step 1: Escribir los tests que fallan**

Si `Employees.test.jsx` no existe, crearlo con los mocks al estilo de `Reservations.test.jsx`: `userService`, `restaurantService`, `adminRestaurantService` y `AuthContext` con un usuario `ROLE_SUPER_ADMIN`. Antes de escribirlos, sacar los nombres reales de los campos con:

```
grep -n "htmlFor=" src/pages/Employees.jsx
```

Los casos:

```jsx
  it('el formulario de edición precarga los restaurantes asignados', async () => {
    // La fila trae parejas id+nombre, no dos listas sueltas.
    getUsers.mockResolvedValue(paginaCon([
      empleado(5, { assignedRestaurants: [{ id: 3, name: 'Sushi Master' }] }),
    ]));
    renderizar();

    await abrirFormularioDeEdicion();

    const dialogo = within(await screen.findByRole('dialog'));
    expect(dialogo.getByText('Sushi Master')).toBeInTheDocument();
    expect(dialogo.getByRole('button', { name: /quitar sushi master/i })).toBeInTheDocument();
  });

  it('al guardar sigue enviando restaurantIds', async () => {
    renderizar();
    await abrirFormularioDeAlta();

    const dialogo = within(screen.getByRole('dialog'));
    await rellenarCamposObligatorios(dialogo);
    await userEvent.click(dialogo.getByLabelText(/buscar restaurante/i));
    await userEvent.click(await screen.findByRole('option', { name: /sushi master/i }));
    await userEvent.click(dialogo.getByRole('button', { name: /crear empleado/i }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantIds: [3] })
    ));
  });

  it('el aviso del vacío cambia con el rol', async () => {
    renderizar();
    await abrirFormularioDeAlta();
    const dialogo = within(screen.getByRole('dialog'));

    await userEvent.selectOptions(dialogo.getByLabelText(/rol/i), 'ROLE_EMPLOYEE');
    expect(dialogo.getByText(/no podrá ver ningún restaurante/i)).toBeInTheDocument();

    await userEvent.selectOptions(dialogo.getByLabelText(/rol/i), 'ROLE_MANAGER');
    expect(dialogo.getByText(/verá todos los del tenant/i)).toBeInTheDocument();
  });

  it('el aviso desaparece al elegir un restaurante', async () => {
    renderizar();
    await abrirFormularioDeAlta();
    const dialogo = within(screen.getByRole('dialog'));

    await userEvent.selectOptions(dialogo.getByLabelText(/rol/i), 'ROLE_EMPLOYEE');
    await userEvent.click(dialogo.getByLabelText(/buscar restaurante/i));
    await userEvent.click(await screen.findByRole('option', { name: /sushi master/i }));

    expect(dialogo.queryByText(/no podrá ver ningún restaurante/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Comprobar que fallan**

Run: `cd restaurante-frontend && pnpm test src/pages/Employees.test.jsx`
Expected: FAIL — no hay campo «Buscar restaurante» ni aviso del vacío.

- [ ] **Step 3: Cambiar el estado del formulario**

En `Employees.jsx`, donde hoy hay `restaurantIds: []` en el estado inicial y en `handleOpenCreate`, pasa a `restaurants: []`. En `handleOpenEdit`, sustituir el bloque actual por:

```jsx
      // La fila trae las parejas ya emparejadas por el backend; assignedRestaurantIds
      // y restaurantNames son dos listas que no se corresponden entre sí.
      restaurants: Array.isArray(emp.assignedRestaurants) ? [...emp.assignedRestaurants] : [],
```

- [ ] **Step 4: Retirar la rama de casillas de `handleFormChange`**

Borrar entero el bloque `if (type === 'checkbox' && name === 'restaurantIds') { … }`: ya no hay casillas. Queda solo la rama genérica `setFormData((prev) => ({ ...prev, [name]: value }))`. Si `type` y `checked` dejan de usarse, quitarlos del destructurado.

- [ ] **Step 5: Mapear al enviar**

Donde el envío arma el cuerpo con `restaurantIds: formData.restaurantIds`:

```jsx
        // El backend sigue esperando identificadores; el nombre solo vive en la interfaz.
        restaurantIds: formData.restaurants.map((r) => Number(r.id)),
```

- [ ] **Step 6: Sustituir la rejilla por el selector**

Cambiar el bloque `<div className="row g-2 mb-3">` que contiene el `safeRestaurants.map` (con sus ramas de carga y de lista vacía) por:

```jsx
                  <div className="mb-3">
                    <label htmlFor="emp-restaurantes" className="form-label">
                      Restaurantes asignados
                    </label>
                    <RestaurantMultiSelect
                      id="emp-restaurantes"
                      value={formData.restaurants}
                      onChange={(seleccion) =>
                        setFormData((prev) => ({ ...prev, restaurants: seleccion }))
                      }
                      disabled={submitting}
                    />
                    {formData.restaurants.length === 0 && (
                      <div className="form-text">{avisoSinRestaurantes(formData.role)}</div>
                    )}
                  </div>
```

Importar el componente: `import RestaurantMultiSelect from '../components/RestaurantMultiSelect';`

- [ ] **Step 7: Añadir el aviso**

Junto a los otros ayudantes del módulo, fuera del componente:

```jsx
/**
 * Qué implica no asignar ningún restaurante. No es una advertencia inventada:
 * es la regla que aplica CurrentUserService.getVisibleRestaurantIds() y que el
 * formulario nunca había dicho en voz alta.
 */
const avisoSinRestaurantes = (rol) => {
  const normalizado = normalizeRole(rol);
  if (normalizado === ROLES.MANAGER) {
    return 'Sin restaurantes asignados verá todos los del tenant.';
  }
  if (normalizado === ROLES.EMPLOYEE) {
    return 'Sin restaurantes asignados no podrá ver ningún restaurante.';
  }
  return 'Un administrador ve todos los restaurantes de su tenant; la asignación no le afecta.';
};
```

`normalizeRole` y `ROLES` ya se importan en el fichero.

- [ ] **Step 8: Quitar la carga que sobra**

El `getRestaurants()` que alimentaba la rejilla deja de hacer falta **solo si no lo usa también el filtro de la cabecera**. Comprobarlo con `grep -n "safeRestaurants" src/pages/Employees.jsx`: si el filtro lo usa, se deja como está y no se toca nada; si no queda ningún uso, se retiran el estado `restaurants`, `loadingRestaurants` y su efecto de carga.

- [ ] **Step 9: Comprobar que pasan**

Run: `cd restaurante-frontend && pnpm test`
Expected: todos verdes, incluidos los 118 que ya había más los 12 de la Task 2.

- [ ] **Step 10: Linter y build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: sin errores; `✓ built`.

- [ ] **Step 11: Commit**

```bash
git add restaurante-frontend/src/pages/Employees.jsx \
        restaurante-frontend/src/pages/Employees.test.jsx
git commit -m "feat(frontend): buscar restaurantes al asignarlos a un empleado"
```

---

## Verificación final

```bash
cd restaurante_manage && mvn -o test
cd ../restaurante-frontend && pnpm lint && pnpm test && pnpm build
git log --oneline -4
git status
```

Los cuatro en verde, y `git status` sin cambios ajenos a la tarea perdidos.

## Riesgos anotados

- **La lista se dibuja dentro de un modal.** El panel usa `z-index: 1060` para quedar por encima del `1050` de Bootstrap. Si al probarlo queda recortado por el `overflow` del cuerpo del modal, la salida es dibujarlo hacia arriba cuando no haya sitio abajo, no subir más el `z-index`.
- **Enter dentro de un formulario.** El manejador de teclado hace `preventDefault()` en Enter para que elegir una opción no envíe el alta.
- **El selector solo funciona para `SUPER_ADMIN` y `ADMIN`**, porque `/admin/restaurants` no admite más roles. Coincide con quién puede abrir el formulario hoy (`MANAGE_EMPLOYEES`); si algún día se le diera esa capacidad a `MANAGER`, el selector se quedaría vacío y habría que ampliar el endpoint.
- **Los cuatro desplegables de selección única** siguen pidiendo `getRestaurants({ size: 500 })`. Fuera de esta tarea, por acuerdo explícito.
