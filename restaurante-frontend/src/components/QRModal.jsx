import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';

// ─── Sanitizar nombre para nombre de archivo ────────────────────────────────
const sanitizeFileName = (name) => {
  const base = (name || 'restaurante')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // eliminar tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `qr-${base || 'restaurante'}.png`;
};

// ─── Componente ──────────────────────────────────────────────────────────────
const QRModal = ({ restaurant, onClose }) => {
  const canvasRef = useRef(null);
  const [qrReady, setQrReady] = useState(false);
  const [feedback, setFeedback] = useState('');

  const restaurantName = restaurant?.name || 'Restaurante';
  const publicUrl = restaurant?.id
    ? `${window.location.origin}/public/reservar/${restaurant.id}`
    : '';

  // Generar QR al montar
  useEffect(() => {
    if (!canvasRef.current || !publicUrl) return;

    let cancelled = false;

    QRCode.toCanvas(canvasRef.current, publicUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#1e1e2a',
        light: '#ffffff',
      },
    })
      .then(() => {
        if (!cancelled) setQrReady(true);
      })
      .catch(() => {
        if (!cancelled) setQrReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  // ─── Copiar enlace ───────────────────────────────────────────────────
  const handleCopyLink = useCallback(() => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl)
      .then(() => {
        setFeedback('Enlace copiado correctamente');
        setTimeout(() => setFeedback(''), 2500);
      })
      .catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = publicUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setFeedback('Enlace copiado correctamente');
        setTimeout(() => setFeedback(''), 2500);
      });
  }, [publicUrl]);

  // ─── Descargar QR ────────────────────────────────────────────────────
  const handleDownloadQR = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = sanitizeFileName(restaurantName);
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setFeedback('QR descargado correctamente');
    setTimeout(() => setFeedback(''), 2500);
  }, [restaurantName]);

  // ─── Abrir página ────────────────────────────────────────────────────
  const handleOpenPage = useCallback(() => {
    if (!publicUrl) return;
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  }, [publicUrl]);

  return (
    <div
      className="modal d-block"
      tabIndex={-1}
      role="dialog"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered"
        style={{ maxWidth: '420px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Código QR</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
          </div>

          <div className="modal-body text-center py-4">
            {/* Nombre del restaurante */}
            <p
              className="fw-semibold mb-3"
              style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}
            >
              {restaurantName}
            </p>

            {/* QR Code */}
            <div
              className="qr-modal-canvas-wrapper"
              style={{
                display: 'inline-flex',
                padding: '0.75rem',
                background: '#ffffff',
                borderRadius: '12px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}
            >
              <canvas ref={canvasRef} width={280} height={280} />
            </div>

            {!qrReady && (
              <div className="mt-2">
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                  aria-hidden="true"
                />
                <span className="visually-hidden">Generando QR...</span>
              </div>
            )}

            {/* Enlace público */}
            <p
              className="mt-3 mb-0 small"
              style={{
                color: 'var(--text-muted)',
                wordBreak: 'break-all',
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: '0.7rem',
                lineHeight: 1.4,
              }}
            >
              {publicUrl}
            </p>

            {/* Feedback */}
            {feedback && (
              <div
                className="mt-2 small fw-medium"
                style={{
                  color: feedback.includes('error') ? 'var(--danger)' : 'var(--success)',
                }}
              >
                {feedback}
              </div>
            )}
          </div>

          <div className="modal-footer justify-content-center gap-2 flex-wrap">
            <button
              type="button"
              className="qr-modal-btn qr-modal-btn-copy"
              onClick={handleCopyLink}
              title="Copiar enlace"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copiar enlace
            </button>
            <button
              type="button"
              className="qr-modal-btn qr-modal-btn-download"
              onClick={handleDownloadQR}
              disabled={!qrReady}
              title="Descargar QR"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Descargar QR
            </button>
            <button
              type="button"
              className="qr-modal-btn qr-modal-btn-open"
              onClick={handleOpenPage}
              title="Abrir página pública"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Abrir p&aacute;gina
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRModal;
