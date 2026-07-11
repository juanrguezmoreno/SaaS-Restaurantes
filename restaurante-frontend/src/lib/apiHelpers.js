/**
 * Extrae el array de datos de la respuesta del backend.
 * Soporta múltiples formatos:
 *   - Array directo:  [...]
 *   - Paginado:       { content: [...] }
 *   - Envoltorio:     { success: true, data: [...] }
 *   - Anidado:        { data: { content: [...] } }
 *   - Fallback:       []
 */
export const extractData = (response) => {
  if (!response || !response.data) {
    return [];
  }

  const body = response.data;

  if (Array.isArray(body)) {
    return body;
  }

  if (body && Array.isArray(body.content)) {
    return body.content;
  }

  if (body && body.success && Array.isArray(body.data)) {
    return body.data;
  }

  if (body && Array.isArray(body.data)) {
    return body.data;
  }

  if (body && body.data && Array.isArray(body.data.content)) {
    return body.data.content;
  }

  return [];
};

// Alias histórico: algunos módulos la llamaban extractArray.
export const extractArray = extractData;
