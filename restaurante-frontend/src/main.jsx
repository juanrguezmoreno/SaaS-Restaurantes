import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import App from './App.jsx';
// Tipografías auto-alojadas (variable): sin peticiones a CDN externos y sin FOUT.
// Instrument Sans = interfaz y datos; Bricolage Grotesque = títulos y marca.
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/bricolage-grotesque';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
