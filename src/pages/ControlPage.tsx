// src/pages/ControlPage.tsx
import { useState, useEffect, useRef } from 'react';

function ControlPage() {
  const [slides, setSlides] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isBlackout, setIsBlackout] = useState(true);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Conectando...');
  const wsRef = useRef<WebSocket | null>(null);

  const getServerIp = () => window.location.hostname;

  const connect = () => {
    const ip = getServerIp();
    if (wsRef.current) { 
      wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.onmessage = null;
      wsRef.current.close(); 
    }
    setStatus('Conectando...');

    try {
      const ws = new WebSocket(`ws://${ip}:20777`);

      ws.onopen = () => { setConnected(true); setStatus('Conectado'); };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'state') {
            setSlides(data.slides || []);
            setCurrentIndex(data.current_index || 0);
            setIsBlackout(data.is_blackout);
          }
        } catch (e) { console.error('Erro:', e); }
      };

      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
      ws.onerror = () => {};
      wsRef.current = ws;
    } catch (e) { setTimeout(connect, 5000); }
  };

  useEffect(() => { connect(); return () => { if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); } }; }, []);

  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => sendCommand('refresh'), 2000);
    return () => clearInterval(interval);
  }, [connected]);

  const sendCommand = (action: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) { wsRef.current.send(JSON.stringify({ action, ...data })); }
  };

  const handleImageClick = (idx: number) => {
    if (idx === currentIndex && !isBlackout) {
      setIsBlackout(true);
      sendCommand('blackout');
    } else {
      setCurrentIndex(idx);
      setIsBlackout(false);
      sendCommand('set_slide', { index: idx });
    }
  };

  const count = slides.length;
  const getLayout = () => {
    if (count === 0) return { cols: 1, rows: 1 };
    if (count === 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 2, rows: 1 };
    if (count === 3) return { cols: 3, rows: 1 };
    if (count === 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    if (count <= 12) return { cols: 4, rows: 3 };
    return { cols: 4, rows: Math.ceil(count / 4) };
  };
  const layout = getLayout();

  return (
    <div style={{ 
      height: '100vh',
      background: '#0b0e11',
      color: '#e1e4e8', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 
      padding: '0.6rem', 
      userSelect: 'none', 
      WebkitUserSelect: 'none', 
      touchAction: 'manipulation',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '0.4rem 0 0.5rem',
        flexShrink: 0
      }}>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%',
          backgroundColor: connected ? '#34d399' : '#f87171',
          boxShadow: connected ? '0 0 6px rgba(52,211,153,0.4)' : '0 0 6px rgba(248,113,113,0.4)',
        }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.4px', color: '#8b949e' }}>
          Controle de Exibição
        </span>
        {!connected && (
          <span style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 500 }}>● Offline</span>
        )}
      </div>

      {/* Grid */}
      {connected && slides.length > 0 && (
        <div style={{ 
          flex: 1,
          display: 'grid', 
          gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
          gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
          gap: '0.5rem', 
          overflow: 'hidden'
        }}>
          {slides.map((slide: any, idx: number) => {
            const isActive = idx === currentIndex && !isBlackout;
            
            return (
              <div 
                key={slide.id} 
                onClick={() => handleImageClick(idx)}
                style={{ 
                  position: 'relative',
                  borderRadius: '10px', 
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: isActive ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.05)',
                  boxShadow: isActive 
                    ? '0 0 0 1px rgba(239,68,68,0.25), 0 0 20px rgba(239,68,68,0.1), 0 8px 32px rgba(0,0,0,0.5)' 
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  transform: isActive ? 'scale(1.015)' : 'scale(1)',
                  background: isActive ? '#141010' : '#0f1419',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.2s ease',
                  minHeight: 0
                }}
              >
                {/* Miniatura */}
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  background: '#080c10',
                  overflow: 'hidden',
                  position: 'relative',
                  minHeight: 0
                }}>
                  {slide.thumbnail ? (
                    <img src={slide.thumbnail} alt={`Imagem ${idx + 1}`}
                      style={{ 
                        width: '100%', height: '100%', 
                        objectFit: 'contain', 
                        padding: '4px',
                        filter: isActive ? 'brightness(1.05)' : 'brightness(0.85)'
                      }} />
                  ) : (
                    <div style={{ 
                      width: '40px', height: '40px', 
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.03)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                  )}
                  
                  {/* Overlay de encerramento */}
                  {isActive && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      background: 'rgba(15,8,8,0.85)',
                      backdropFilter: 'blur(2px)',
                      display: 'flex', flexDirection: 'column', 
                      alignItems: 'center', justifyContent: 'center', 
                      gap: '0.5rem'
                    }}>
                      {/* Ícone de stop */}
                      <div style={{
                        width: '36px', height: '36px',
                        borderRadius: '50%',
                        background: 'rgba(239,68,68,0.12)',
                        border: '1.5px solid rgba(239,68,68,0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <div style={{
                          width: '12px', height: '12px',
                          borderRadius: '2px',
                          background: 'rgba(239,68,68,0.8)'
                        }} />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ 
                          fontSize: '0.65rem', fontWeight: 700, 
                          letterSpacing: '1px',
                          color: 'rgba(239,68,68,0.9)',
                          textTransform: 'uppercase'
                        }}>
                          Toque para
                        </span>
                        <br />
                        <span style={{ 
                          fontSize: '0.65rem', fontWeight: 700, 
                          letterSpacing: '1px',
                          color: 'rgba(239,68,68,0.9)',
                          textTransform: 'uppercase'
                        }}>
                          encerrar
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Label */}
                <div style={{
                  padding: '0.3rem 0.5rem',
                  background: isActive 
                    ? 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 100%)' 
                    : 'transparent',
                  borderTop: isActive ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(255,255,255,0.03)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexShrink: 0
                }}>
                  <span style={{ 
                    fontSize: '0.7rem', fontWeight: 600, 
                    color: isActive ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.45)',
                    letterSpacing: '0.3px'
                  }}>
                    Imagem {idx + 1}
                  </span>
                  {isActive && (
                    <div style={{ 
                      width: '5px', height: '5px',
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                      boxShadow: '0 0 6px rgba(239,68,68,0.5)'
                    }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Vazio */}
      {connected && slides.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '48px', height: '48px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.02)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 0.75rem',
              border: '1px solid rgba(255,255,255,0.05)'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <p style={{ fontSize: '0.8rem', fontWeight: 500, color: '#8b949e' }}>Nenhuma imagem</p>
            <p style={{ fontSize: '0.7rem', color: '#484f58', marginTop: '2px' }}>Aguardando operador</p>
          </div>
        </div>
      )}

      {/* Desconectado */}
      {!connected && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              width: '36px', height: '36px', 
              borderRadius: '50%', 
              border: '2px solid rgba(255,255,255,0.06)', 
              borderTopColor: '#8b949e', 
              animation: 'spin 1s linear infinite', 
              margin: '0 auto 0.75rem' 
            }} />
            <p style={{ fontSize: '0.75rem', fontWeight: 500, color: '#8b949e' }}>{status}</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default ControlPage;