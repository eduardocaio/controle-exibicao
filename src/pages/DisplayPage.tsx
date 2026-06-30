// src/pages/DisplayPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

function DisplayPage() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [defaultImage, setDefaultImage] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Estados do cronômetro - apenas exibição, sem contagem local
  const [countdownRunning, setCountdownRunning] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownTarget, setCountdownTarget] = useState('');
  const [countdownLabel, setCountdownLabel] = useState('');

  useEffect(() => {
    const unlisten = listen('texto-do-ano-atualizado', () => setRefreshKey(prev => prev + 1));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
      const unlisten = listen('countdown-force-display', (event: any) => {
          // Forçar exibição da tela de contagem
          setShowCountdown(true);
          setCountdownData(event.payload);
      });
      
      return () => {
          unlisten.then(fn => fn());
      };
  }, []);

  useEffect(() => {
    (async () => { 
      try { 
        setDefaultImage(await invoke('get_default_image') as string); 
      } catch (_) {} 
    })();
    
    const check = async () => {
      try {
        const s = JSON.parse(await invoke('get_display_state') as string);
        if (!s.is_blackout && s.current_filename) {
          setImageSrc(await invoke('get_image_base64', { filename: s.current_filename, isThumb: false }) as string);
        } else { 
          setImageSrc(''); 
        }
      } catch (_) {}
    };
    check();
    const i = setInterval(check, 200);
    return () => clearInterval(i);
  }, [refreshKey]);

  // Monitorar estado do cronômetro via backend (sem contagem local)
  useEffect(() => {
    const checkCountdown = async () => {
      try {
        const state = JSON.parse(await invoke('get_countdown_state') as string);
        setCountdownRunning(state.running);
        setCountdownSeconds(state.seconds_left);
        setCountdownTarget(state.target_time || '');
        setCountdownLabel(state.label || '');
      } catch (_) {}
    };

    checkCountdown();
    const interval = setInterval(checkCountdown, 500); // Atualiza a cada 500ms
    return () => clearInterval(interval);
  }, []);

  // Escutar eventos do cronômetro em tempo real
  useEffect(() => {
    const unlistenUpdate = listen('countdown-update', (event: any) => {
      setCountdownRunning(event.payload.running);
      setCountdownSeconds(event.payload.seconds_left);
      setCountdownTarget(event.payload.target_time || '');
      setCountdownLabel(event.payload.label || '');
    });

    const unlistenStop = listen('countdown-stop', () => {
      setCountdownRunning(false);
      setCountdownSeconds(0);
      setCountdownTarget('');
      setCountdownLabel('');
    });

    return () => {
      unlistenUpdate.then(fn => fn());
      unlistenStop.then(fn => fn());
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      backgroundColor: '#000000', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      overflow: 'hidden', 
      cursor: 'none', 
      userSelect: 'none',
      position: 'relative',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Prioridade 1: Imagem ativa (transmissão) */}
      {imageSrc ? (
        <img src={imageSrc} alt="" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', pointerEvents:'none' }} />
      ) : countdownRunning && countdownSeconds > 0 ? (
        /* Prioridade 2: Cronômetro regressivo em tela cheia */
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0a0f 0%, #0d1117 30%, #0a1628 60%, #0a0a0f 100%)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Partículas de fundo decorativas */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            opacity: 0.04,
            background: `radial-gradient(circle at 20% 50%, #4a90d9 0%, transparent 50%),
                        radial-gradient(circle at 80% 50%, #667eea 0%, transparent 50%),
                        radial-gradient(circle at 50% 80%, #4a90d9 0%, transparent 50%)`
          }} />

          {/* Linhas decorativas sutis */}
          <div style={{
            position: 'absolute',
            top: '15%', left: '5%', right: '5%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(74,144,217,0.1), transparent)'
          }} />
          <div style={{
            position: 'absolute',
            bottom: '15%', left: '5%', right: '5%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(74,144,217,0.1), transparent)'
          }} />

          {/* Conteúdo do cronômetro */}
          <div style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(1.5rem, 4vh, 3rem)'
          }}>
      
            {/* Título */}
            <div style={{
              fontSize: 'clamp(2.5rem, 2vw, 1.6rem)',
              color: 'rgba(255,255,255,0.4)',
              fontWeight: 500,
              letterSpacing: '5px',
              textTransform: 'uppercase',
              textAlign: 'center'
            }}>
              A reunião começará em
            </div>

            {/* Timer - MAIOR E MAIS GROSSO */}
            <div style={{
              fontSize: 'clamp(8rem, 18vw, 16rem)',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '6px',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              textShadow: '0 0 80px rgba(74,144,217,0.2), 0 0 120px rgba(74,144,217,0.1)'
            }}>
              {formatTime(countdownSeconds)}
            </div>

            {/* Target time */}
            {countdownTarget && (
              <div style={{
                fontSize: 'clamp(1.5rem, 1.6vw, 1.3rem)',
                color: 'rgba(255,255,255,0.35)',
                fontWeight: 500,
                letterSpacing: '3px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem'
              }}>
                <span style={{
                  width: '8px', height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(74,144,217,0.4)',
                  display: 'inline-block',
                  boxShadow: '0 0 8px rgba(74,144,217,0.3)'
                }} />
                Início às {countdownTarget}
              </div>
            )}
          </div>
        </div>
      ) : defaultImage ? (
        /* Prioridade 3: Imagem padrão (Texto do Ano) */
        <img src={defaultImage} alt="Texto do Ano" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', pointerEvents:'none' }} />
      ) : (
        /* Prioridade 4: Tela preta */
        <div style={{ width:'100%', height:'100%', backgroundColor:'#000000' }} />
      )}
    </div>
  );
}

export default DisplayPage;