import { useState } from 'react';
import { createCustomer } from '../services/customerService';

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', notes: '' };

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (err instanceof Error) return err.message;
  return 'Error al crear el cliente.';
};

const validate = (form) => {
  const errors = {};
  const firstName = (form.firstName || '').trim();
  const lastName = (form.lastName || '').trim();
  const email = (form.email || '').trim();
  const phone = (form.phone || '').trim();

  if (!firstName) errors.firstName = 'El nombre es obligatorio.';
  else if (firstName.length > 50) errors.firstName = 'Máximo 50 caracteres.';

  if (!lastName) errors.lastName = 'Los apellidos son obligatorios.';
  else if (lastName.length > 50) errors.lastName = 'Máximo 50 caracteres.';

  if (!email) errors.email = 'El email es obligatorio.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Correo electrónico no válido.';
  else if (email.length > 100) errors.email = 'Máximo 100 caracteres.';

  if (phone.length > 20) errors.phone = 'Máximo 20 caracteres.';

  return errors;
};

const QuickCustomerForm = ({ restaurantId, onCreated, onCancel }) => {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
        restaurantId: Number(restaurantId),
      };
      const created = await createCustomer(payload);
      onCreated(created);
    } catch (err) {
      setErrors({ submit: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 rounded-3 mb-3"
      style={{ background: 'var(--bg-body)', border: '1px solid var(--border)' }}
      noValidate
    >
      <h6 className="fw-semibold mb-3" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        NUEVO CLIENTE
      </h6>

      {errors.submit && (
        <div className="alert alert-danger py-2 small" role="alert">{errors.submit}</div>
      )}

      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label htmlFor="qc-firstName" className="form-label">
            Nombre <span className="text-danger">*</span>
          </label>
          <input
            id="qc-firstName"
            name="firstName"
            className={`form-control ${errors.firstName ? 'is-invalid' : ''}`}
            value={form.firstName}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.firstName && <div className="invalid-feedback">{errors.firstName}</div>}
        </div>

        <div className="col-12 col-md-6">
          <label htmlFor="qc-lastName" className="form-label">
            Apellidos <span className="text-danger">*</span>
          </label>
          <input
            id="qc-lastName"
            name="lastName"
            className={`form-control ${errors.lastName ? 'is-invalid' : ''}`}
            value={form.lastName}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.lastName && <div className="invalid-feedback">{errors.lastName}</div>}
        </div>

        <div className="col-12 col-md-6">
          <label htmlFor="qc-email" className="form-label">
            Email <span className="text-danger">*</span>
          </label>
          <input
            id="qc-email"
            name="email"
            type="email"
            className={`form-control ${errors.email ? 'is-invalid' : ''}`}
            value={form.email}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.email && <div className="invalid-feedback">{errors.email}</div>}
        </div>

        <div className="col-12 col-md-6">
          <label htmlFor="qc-phone" className="form-label">Teléfono</label>
          <input
            id="qc-phone"
            name="phone"
            className={`form-control ${errors.phone ? 'is-invalid' : ''}`}
            value={form.phone}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.phone && <div className="invalid-feedback">{errors.phone}</div>}
        </div>

        <div className="col-12">
          <label htmlFor="qc-notes" className="form-label">Notas</label>
          <textarea
            id="qc-notes"
            name="notes"
            className="form-control"
            rows="2"
            value={form.notes}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
              Guardando...
            </>
          ) : 'Guardar cliente'}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
};

export default QuickCustomerForm;
