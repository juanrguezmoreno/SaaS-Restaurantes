const Employees = () => {
  return (
    <div>
      <div className="page-header">
        <h1>Empleados</h1>
        <p className="text-muted">Gestión de empleados del restaurante</p>
      </div>

      <div className="placeholder-page">
        <div className="icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h3>Módulo de Empleados</h3>
        <p>Próximamente podrás gestionar los empleados aquí.</p>
      </div>
    </div>
  );
};

export default Employees;
