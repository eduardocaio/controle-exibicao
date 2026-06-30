// ControlPage.tsx
import { useState, useEffect, useRef } from 'react';
import { GlassWater, UserPlus, Check, AlertCircle, MessageSquare, Clock } from 'lucide-react';

function ControlPage() {
  const [slides, setSlides] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isBlackout, setIsBlackout] = useState(true);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Conectando...');
  const [showSentMessage, setShowSentMessage] = useState('');
  const [timerAccumulated, setTimerAccumulated] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth);
  const [operatorMessage, setOperatorMessage] = useState<any>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [activePresentationId, setActivePresentationId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Timer local para contagem contínua
  useEffect(() => {
    let interval: any = null;
    
    if (timerRunning) {
      interval = setInterval(() => {
        setTimerAccumulated(prev => prev + 1000);
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerRunning]);

  const getServerIp = () => window.location.hostname;

  const getThumbnailUrl = (filename: string) => {
    const ip = getServerIp();
    return `http://${ip}:20778/thumbnails/${filename}`;
  };

  const connect = () => {
    const ip = getServerIp();
    if (wsRef.current) { 
      wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.onmessage = null;
      wsRef.current.close(); 
    }
    setStatus('Conectando...');

    try {
      const ws = new WebSocket(`ws://${ip}:20777`);

      ws.onopen = () => { 
        setConnected(true); 
        setStatus('Conectado');
        console.log('✅ Conectado ao operador');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'state') {
            const newSlides = data.slides || [];
            setSlides(newSlides);
            setCurrentIndex(data.current_index || 0);
            setIsBlackout(data.is_blackout);
            setActivePresentationId(data.active_presentation_id || null);
            
            const urls: Record<string, string> = {};
            newSlides.forEach((slide: any) => {
              urls[slide.filename] = getThumbnailUrl(slide.filename);
            });
            setThumbnailUrls(urls);
          }
          
          if (data.type === 'timer_state') {
            setTimerAccumulated(data.accumulated);
            setTimerRunning(data.running);
          }
          
          if (data.type === 'water_request_sent') {
            setShowSentMessage('water');
            setTimeout(() => setShowSentMessage(''), 3000);
          }
          
          if (data.type === 'indicator_request_sent') {
            setShowSentMessage('indicator');
            setTimeout(() => setShowSentMessage(''), 3000);
          }
          
          if (data.type === 'indicator_request_pending') {
            setShowSentMessage('indicator_pending');
            setTimeout(() => setShowSentMessage(''), 3000);
          }

          if (data.type === 'operator_message') {
            setOperatorMessage({
                id: data.id,
                text: data.text,
                timestamp: data.timestamp,
            });
          }

          if (data.type === 'message_acknowledged') {
            setOperatorMessage(null);
          }
        } catch (e) { 
          console.error('Erro ao processar mensagem:', e); 
        }
      };

      ws.onclose = () => { 
        console.log('🔴 Desconectado do operador. Reconectando em 3s...');
        setConnected(false); 
        setTimeout(connect, 3000); 
      };
      
      ws.onerror = () => {
        console.error('❌ Erro na conexão WebSocket');
      };
      
      wsRef.current = ws;
    } catch (e) { 
      console.error('❌ Erro ao conectar:', e);
      setTimeout(connect, 5000); 
    }
  };

  useEffect(() => { 
    connect(); 
    return () => { 
      if (wsRef.current) { 
        wsRef.current.onclose = null; 
        wsRef.current.close(); 
      } 
    }; 
  }, []);

  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => sendCommand('refresh'), 2000);
    return () => clearInterval(interval);
  }, [connected]);

  const sendCommand = (action: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) { 
      wsRef.current.send(JSON.stringify({ action, ...data })); 
    }
  };

  const handleAcknowledgeMessage = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'acknowledge_message' }));
        setOperatorMessage(null);
    }
  };

  const handleRequestWater = () => {
    if (connected) sendCommand('request_water');
  };

  const handleRequestIndicator = () => {
    if (connected) sendCommand('request_indicator');
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

  const formatTime = (totalSeconds: number) => {
    const secs = Math.max(0, totalSeconds);
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const remainingSecs = secs % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (!timerRunning && timerAccumulated === 0) return '#6b7280';
    if (timerAccumulated < 300000) return '#34d399';
    if (timerAccumulated < 420000) return '#fbbf24';
    return '#ef4444';
  };

  const getTimerBg = () => {
    if (!timerRunning && timerAccumulated === 0) return 'rgba(255,255,255,0.04)';
    if (timerAccumulated < 300000) return 'rgba(52,211,153,0.15)';
    if (timerAccumulated < 420000) return 'rgba(251,191,36,0.15)';
    return 'rgba(239,68,68,0.15)';
  };

  const getTimerBorder = () => {
    if (!timerRunning && timerAccumulated === 0) return 'rgba(255,255,255,0.08)';
    if (timerAccumulated < 300000) return 'rgba(52,211,153,0.3)';
    if (timerAccumulated < 420000) return 'rgba(251,191,36,0.3)';
    return 'rgba(239,68,68,0.3)';
  };

  const count = slides.length;
  
  const getLayout = () => {
    if (count === 0) return { cols: 1, rows: 1 };
    if (isPortrait) {
      if (count === 1) return { cols: 1, rows: 1 };
      if (count === 2) return { cols: 1, rows: 2 };
      if (count === 3) return { cols: 2, rows: 2 };
      if (count === 4) return { cols: 2, rows: 2 };
      if (count <= 6) return { cols: 2, rows: 3 };
      if (count <= 9) return { cols: 3, rows: 3 };
      return { cols: 3, rows: Math.ceil(count / 3) };
    } else {
      if (count === 1) return { cols: 1, rows: 1 };
      if (count === 2) return { cols: 2, rows: 1 };
      if (count === 3) return { cols: 3, rows: 1 };
      if (count === 4) return { cols: 2, rows: 2 };
      if (count <= 6) return { cols: 3, rows: 2 };
      if (count <= 9) return { cols: 3, rows: 3 };
      if (count <= 12) return { cols: 4, rows: 3 };
      return { cols: 4, rows: Math.ceil(count / 4) };
    }
  };
  
  const layout = getLayout();

  return (
    <div style={{ 
      height: '100vh',
      width: '100vw',
      background: '#0b0e11',
      color: '#e1e4e8', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 
      userSelect: 'none', 
      WebkitUserSelect: 'none', 
      touchAction: 'manipulation',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'fixed',
      top: 0,
      left: 0,
    }}>
      {/* Header - Timer e Botões na mesma linha */}
      <div style={{ 
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1rem 1.5rem',
        background: 'linear-gradient(180deg, #111820 0%, #0f1419 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        gap: '0.75rem',
      }}>
        {/* Status e Título */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '14px', height: '14px', borderRadius: '50%',
              backgroundColor: connected ? '#34d399' : '#f87171',
              boxShadow: connected ? '0 0 12px rgba(52,211,153,0.5)' : '0 0 12px rgba(248,113,113,0.5)',
              animation: connected ? 'pulse 2s infinite' : 'none',
            }} />
            <div>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e1e4e8', letterSpacing: '0.5px' }}>
                Orador
              </span>
              {!connected && (
                <span style={{ fontSize: '0.8rem', color: '#f87171', fontWeight: 500, marginLeft: '0.5rem' }}>
                  ● Offline
                </span>
              )}
            </div>
          </div>
          
          {slides.length > 0 && (
            <div style={{
              padding: '0.35rem 0.75rem',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: '0.8rem',
              color: '#8b949e',
              fontWeight: 600,
            }}>
              {slides.length} slides
            </div>
          )}
        </div>
        
        {/* Timer + Botões na mesma linha - MAIORES */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.25rem',
          width: '100%',
          flexWrap: 'wrap',
        }}>
          {/* Timer - MAIOR */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem',
            background: 'linear-gradient(135deg, rgba(102,126,234,0.08) 0%, rgba(102,126,234,0.03) 100%)',
            borderRadius: '16px',
            padding: '0.75rem 2rem',
            border: '1.5px solid rgba(102,126,234,0.15)',
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: getTimerBg(),
              border: `2px solid ${getTimerBorder()}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease',
            }}>
              <Clock size={28} color={getTimerColor()} />
            </div>
            
            <span style={{
              fontWeight: 800,
              fontSize: '3.2rem',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              color: getTimerColor(),
              letterSpacing: '4px',
              minWidth: '140px',
              textAlign: 'center',
              lineHeight: '1',
              transition: 'color 0.3s ease',
            }}>
              {formatTime(Math.floor(timerAccumulated / 1000))}
            </span>

            <div style={{
              display: 'flex',
              gap: '0.5rem',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '10px',
              padding: '0.35rem',
            }}>
              {!timerRunning ? (
                <button
                  onClick={() => sendCommand('timer_control', { timer_action: 'start' })}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '10px',
                    border: 'none',
                    background: 'rgba(52,211,153,0.15)',
                    color: '#34d399',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(52,211,153,0.25)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(52,211,153,0.15)'}
                  title="Iniciar"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6,3 20,12 6,21" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => sendCommand('timer_control', { timer_action: 'pause' })}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '10px',
                    border: 'none',
                    background: 'rgba(251,191,36,0.15)',
                    color: '#fbbf24',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,0.25)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(251,191,36,0.15)'}
                  title="Pausar"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="3" width="4" height="18" rx="1" />
                    <rect x="14" y="3" width="4" height="18" rx="1" />
                  </svg>
                </button>
              )}
              
              {(timerAccumulated > 0) && (
                <button
                  onClick={() => sendCommand('timer_control', { timer_action: 'reset' })}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '10px',
                    border: 'none',
                    background: 'rgba(239,68,68,0.15)',
                    color: '#ef4444',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.25)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
                  title="Resetar"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Botões de Água e Indicador - MAIORES */}
          <div style={{
            display: 'flex',
            gap: '1rem',
          }}>
            <button onClick={handleRequestWater} style={{
              padding: '1.1rem 2rem',
              background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.06) 100%)',
              color: '#60a5fa',
              border: '2px solid rgba(59,130,246,0.2)',
              borderRadius: '14px',
              cursor: 'pointer',
              fontSize: '1.15rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              transition: 'all 0.2s ease',
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 4px 12px rgba(59,130,246,0.05)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0.12) 100%)';
              e.currentTarget.style.borderColor = 'rgba(59,130,246,0.4)';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(59,130,246,0.15)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.06) 100%)';
              e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(59,130,246,0.05)';
            }}
            >
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(59,130,246,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <GlassWater size={26} color="#60a5fa" />
              </div>
              <span style={{ letterSpacing: '0.5px' }}>Água</span>
            </button>
            
            <button onClick={handleRequestIndicator} style={{
              padding: '1.1rem 2rem',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.06) 100%)',
              color: '#fbbf24',
              border: '2px solid rgba(245,158,11,0.2)',
              borderRadius: '14px',
              cursor: 'pointer',
              fontSize: '1.15rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              transition: 'all 0.2s ease',
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 4px 12px rgba(245,158,11,0.05)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.12) 100%)';
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(245,158,11,0.15)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.06) 100%)';
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.2)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(245,158,11,0.05)';
            }}
            >
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(245,158,11,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <UserPlus size={26} color="#fbbf24" />
              </div>
              <span style={{ letterSpacing: '0.5px' }}>Indicador</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid de imagens */}
      <div style={{ flex: 1, padding: '0.6rem', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {connected && slides.length > 0 ? (
          <div style={{ 
            flex: 1, display: 'grid', 
            gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
            gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
            gap: '0.6rem', overflow: 'hidden',
          }}>
            {slides.map((slide: any, idx: number) => {
              const isActive = idx === currentIndex && !isBlackout;
              const thumbUrl = thumbnailUrls[slide.filename];
              
              return (
                <div key={slide.id} onClick={() => handleImageClick(idx)} style={{ 
                  position: 'relative', borderRadius: '10px', overflow: 'hidden',
                  cursor: 'pointer',
                  border: isActive ? '2.5px solid #ef4444' : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: isActive 
                    ? '0 0 0 2px rgba(239,68,68,0.3), 0 0 30px rgba(239,68,68,0.15), 0 8px 32px rgba(0,0,0,0.5)' 
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  background: isActive ? '#141010' : '#0f1419',
                  display: 'flex', flexDirection: 'column',
                  transition: 'all 0.2s ease', minHeight: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  <div style={{ 
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#080c10', overflow: 'hidden', position: 'relative', minHeight: 0
                  }}>
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={`${idx + 1}`}
                        loading="lazy"
                        style={{ 
                          width: '100%', height: '100%', 
                          objectFit: 'contain', padding: '6px',
                          filter: isActive ? 'brightness(1.05)' : 'brightness(0.85)'
                        }} />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: 0.5 }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="M21 15l-5-5L5 21" />
                        </svg>
                        <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>{idx + 1}</span>
                      </div>
                    )}
                    
                    {isActive && (
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(15,8,8,0.9)', backdropFilter: 'blur(3px)',
                        display: 'flex', flexDirection: 'column', 
                        alignItems: 'center', justifyContent: 'center', 
                        gap: '0.75rem', padding: '1rem',
                      }}>
                        <div style={{
                          width: '48px', height: '48px', borderRadius: '50%',
                          background: 'rgba(239,68,68,0.15)',
                          border: '2px solid rgba(239,68,68,0.5)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <div style={{ width: '16px', height: '16px', borderRadius: '3px', background: 'rgba(239,68,68,0.9)' }} />
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '1px', color: 'rgba(239,68,68,0.9)', textTransform: 'uppercase', lineHeight: '1.3' }}>
                            Toque para<br />encerrar
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{
                    padding: '0.4rem 0.6rem',
                    background: isActive ? 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.05) 100%)' : 'transparent',
                    borderTop: isActive ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(255,255,255,0.03)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
                  }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isActive ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.5)', letterSpacing: '0.5px' }}>
                      {idx + 1}
                    </span>
                    {isActive && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.6)' }} />}
                  </div>
                </div>
              );
            })}
          </div>
        ) : connected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#8b949e', margin: 0 }}>
                {activePresentationId ? 'Nenhuma imagem ativa' : 'Nenhuma apresentação ativa'}
              </p>
              <p style={{ fontSize: '0.8rem', color: '#484f58', marginTop: '4px' }}>
                Aguardando operador
              </p>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.06)', borderTopColor: '#8b949e', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#8b949e', margin: 0 }}>{status}</p>
            </div>
          </div>
        )}
      </div>

      {/* Mensagens de feedback */}
      {showSentMessage && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: showSentMessage === 'water' ? 'rgba(59,130,246,0.95)' : showSentMessage === 'indicator' ? 'rgba(245,158,11,0.95)' : 'rgba(239,68,68,0.95)',
          color: 'white', padding: '1.25rem 2.5rem', borderRadius: '14px',
          fontSize: '1rem', fontWeight: 700, zIndex: 1000,
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          animation: 'fadeInUp 0.3s ease', pointerEvents: 'none',
        }}>
          {showSentMessage === 'indicator_pending' ? <AlertCircle size={22} /> : <Check size={22} />}
          {showSentMessage === 'water' && 'Pedido de água enviado!'}
          {showSentMessage === 'indicator' && 'Pedido de indicador enviado!'}
          {showSentMessage === 'indicator_pending' && 'Já existe um pedido pendente'}
        </div>
      )}

      {/* Mensagem do operador */}
      {operatorMessage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000, animation: 'fadeIn 0.3s ease', padding: '2rem',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #111827 100%)',
            border: '2px solid rgba(147,51,234,0.5)', borderRadius: '20px',
            padding: '2.5rem 2rem', maxWidth: '500px', width: '100%',
            boxShadow: '0 0 60px rgba(147,51,234,0.3), 0 20px 40px rgba(0,0,0,0.5)',
            textAlign: 'center', animation: 'slideUp 0.4s ease',
          }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: 'rgba(147,51,234,0.15)', border: '2px solid rgba(147,51,234,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.5rem',
            }}>
              <MessageSquare size={40} color="#a855f7" />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#e1e4e8', margin: '0 0 0.5rem', letterSpacing: '0.5px' }}>
              Mensagem do Operador
            </h2>
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '12px',
              padding: '1.5rem', margin: '1.5rem 0',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <p style={{ fontSize: '1.3rem', fontWeight: 600, color: '#f0f0f0', margin: 0, lineHeight: '1.5', wordBreak: 'break-word' }}>
                {operatorMessage.text}
              </p>
            </div>
            <button onClick={handleAcknowledgeMessage} style={{
              width: '100%', padding: '1rem',
              background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
              color: '#fff', border: 'none', borderRadius: '12px',
              cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700,
              letterSpacing: '1px', transition: 'all 0.2s', marginTop: '0.5rem',
            }}>
              OK - ENTENDI
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translate(-50%, -40%); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}

export default ControlPage;