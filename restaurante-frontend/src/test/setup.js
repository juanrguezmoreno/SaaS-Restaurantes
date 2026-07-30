import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Desmonta el árbol de React entre tests para que no se filtre estado.
afterEach(() => {
  cleanup();
});
