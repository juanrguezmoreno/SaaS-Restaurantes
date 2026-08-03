/**
 * Campos de datos de un restaurante.
 *
 * Los comparten el modal de "Nuevo restaurante" y el apartado Información de la
 * pantalla de configuración: así existe un único formulario y no dos copias que
 * se desincronicen. No tiene estado propio ni sabe guardar — el contenedor le
 * pasa los valores y recibe los cambios.
 *
 * Los dos usos nunca están montados a la vez (son pantallas distintas), así que
 * los ids de los campos pueden ser fijos.
 */
const RestaurantInfoForm = ({ formData, formErrors, onChange }) => (
  <div className="row g-3">
    {/* Nombre */}
    <div className="col-12 col-md-6">
      <label htmlFor="rest-name" className="form-label">
        Nombre <span className="text-danger">*</span>
      </label>
      <input
        id="rest-name"
        type="text"
        className={`form-control ${formErrors.name ? 'is-invalid' : ''}`}
        name="name"
        value={formData.name || ''}
        onChange={onChange}
        placeholder="Ej: Restaurante La Casa"
        required
      />
      {formErrors.name && <div className="invalid-feedback">{formErrors.name}</div>}
    </div>

    {/* Capacidad */}
    <div className="col-12 col-md-3">
      <label htmlFor="rest-capacity" className="form-label">Capacidad</label>
      <input
        id="rest-capacity"
        type="number"
        className={`form-control ${formErrors.capacity ? 'is-invalid' : ''}`}
        name="capacity"
        value={formData.capacity ?? ''}
        onChange={onChange}
        placeholder="Ej: 80"
        min="0"
        step="1"
      />
      {formErrors.capacity && <div className="invalid-feedback">{formErrors.capacity}</div>}
    </div>

    {/* Teléfono */}
    <div className="col-12 col-md-3">
      <label htmlFor="rest-phone" className="form-label">Teléfono</label>
      <input
        id="rest-phone"
        type="text"
        className="form-control"
        name="phone"
        value={formData.phone || ''}
        onChange={onChange}
        placeholder="Ej: 600123456"
      />
    </div>

    {/* Dirección */}
    <div className="col-12">
      <label htmlFor="rest-address" className="form-label">
        Dirección <span className="text-danger">*</span>
      </label>
      <input
        id="rest-address"
        type="text"
        className={`form-control ${formErrors.address ? 'is-invalid' : ''}`}
        name="address"
        value={formData.address || ''}
        onChange={onChange}
        placeholder="Ej: Calle Principal 123, Madrid"
        required
      />
      {formErrors.address && <div className="invalid-feedback">{formErrors.address}</div>}
    </div>

    {/* Email */}
    <div className="col-12 col-md-6">
      <label htmlFor="rest-email" className="form-label">Email</label>
      <input
        id="rest-email"
        type="email"
        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
        name="email"
        value={formData.email || ''}
        onChange={onChange}
        placeholder="Ej: contacto@restaurante.com"
      />
      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
    </div>

    {/* Apertura */}
    <div className="col-6 col-md-3">
      <label htmlFor="rest-opening" className="form-label">Hora Apertura</label>
      <input
        id="rest-opening"
        type="time"
        className="form-control"
        name="openingTime"
        value={formData.openingTime || ''}
        onChange={onChange}
      />
    </div>

    {/* Cierre */}
    <div className="col-6 col-md-3">
      <label htmlFor="rest-closing" className="form-label">Hora Cierre</label>
      <input
        id="rest-closing"
        type="time"
        className="form-control"
        name="closingTime"
        value={formData.closingTime || ''}
        onChange={onChange}
      />
    </div>

    {/* Duración de reserva */}
    <div className="col-6 col-md-3">
      <label htmlFor="rest-duration" className="form-label">Duración de reserva (min)</label>
      <input
        id="rest-duration"
        type="number"
        className={`form-control ${formErrors.defaultReservationDurationMinutes ? 'is-invalid' : ''}`}
        name="defaultReservationDurationMinutes"
        value={formData.defaultReservationDurationMinutes ?? ''}
        onChange={onChange}
        placeholder="Ej: 90"
        min="15"
        max="480"
        step="1"
      />
      {formErrors.defaultReservationDurationMinutes && (
        <div className="invalid-feedback">{formErrors.defaultReservationDurationMinutes}</div>
      )}
    </div>

    {/* Descripción */}
    <div className="col-12">
      <label htmlFor="rest-description" className="form-label">Descripción</label>
      <textarea
        id="rest-description"
        className="form-control"
        name="description"
        value={formData.description || ''}
        onChange={onChange}
        rows={3}
        placeholder="Breve descripción del restaurante..."
      />
    </div>
  </div>
);

export default RestaurantInfoForm;
