import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

function DisplayPage() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [defaultImage, setDefaultImage] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [countdownRunning, setCountdownRunning] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownTarget, setCountdownTarget] = useState('');

  // Função para lidar com o fim do vídeo
  const handleVideoEnded = async () => {
    console.log('🎬 Vídeo terminou, notificando backend');
    try {
      await invoke('video_finished');
    } catch (error) {
      console.error('Erro ao notificar fim do vídeo:', error);
    }
  };

  useEffect(() => {
    const unlisten = listen('texto-do-ano-atualizado', () => setRefreshKey(prev => prev + 1));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = listen('countdown-force-display', (event: any) => {
      setCountdownRunning(true);
      setCountdownTarget(event.payload);
    });
    
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Escutar comando de pausa/play do vídeo
  useEffect(() => {
    const unlisten = listen('video-playback-control', (event: any) => {
      const { paused } = event.payload;
      setIsPaused(paused);
      if (videoRef.current) {
        if (paused) {
          videoRef.current.pause();
        } else {
          videoRef.current.play().catch(() => {});
        }
      }
    });
    
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Timeout de segurança para forçar fim do vídeo se o evento onEnded falhar
  useEffect(() => {
    if (mediaType === 'video' && videoRef.current && videoSrc) {
      // Tentar obter a duração do vídeo
      const video = videoRef.current;
      
      const onLoadedMetadata = () => {
        const duration = video.duration;
        if (duration > 0) {
          // Adiciona 1 segundo de margem
          const timeoutMs = (duration + 1) * 1000;
          console.log(`⏰ Configurando timeout de segurança: ${timeoutMs}ms`);
          
          const timer = setTimeout(() => {
            if (videoRef.current && !videoRef.current.ended && !videoRef.current.paused) {
              console.log('⏰ Timeout: forçando fim do vídeo');
              handleVideoEnded();
            }
          }, timeoutMs);
          
          return () => clearTimeout(timer);
        }
      };
      
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      
      return () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
    }
  }, [videoSrc, mediaType]);

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
          const filename = s.current_filename;
          const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v|ogv|wmv|flv|3gp)$/i.test(filename);
          
          if (isVideo) {
            const ip = window.location.hostname;
            const videoUrl = `http://${ip}:20778/videos/${filename}`;
            setVideoSrc(videoUrl);
            setMediaType('video');
            setImageSrc('');
            // Reset pause state when video changes
            setIsPaused(false);
          } else {
            const imgBase64 = await invoke('get_image_base64', { filename, isThumb: false }) as string;
            setImageSrc(imgBase64);
            setMediaType('image');
            setVideoSrc('');
          }
        } else { 
          setImageSrc('');
          setVideoSrc('');
          setMediaType(null);
          setIsPaused(false);
          if (videoRef.current) {
            videoRef.current.pause();
          }
        }
      } catch (_) {}
    };
    check();
    const i = setInterval(check, 200);
    return () => clearInterval(i);
  }, [refreshKey]);

  useEffect(() => {
    if (mediaType === 'video' && videoRef.current && videoSrc) {
      videoRef.current.load();
      videoRef.current.play().catch(e => {
        console.log('Auto-play com áudio bloqueado:', e);
        const playVideo = () => {
          videoRef.current?.play().catch(() => {});
          document.removeEventListener('click', playVideo);
          document.removeEventListener('keydown', playVideo);
        };
        document.addEventListener('click', playVideo);
        document.addEventListener('keydown', playVideo);
      });
    }
  }, [videoSrc, mediaType]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = 1.0;
    }
  }, [videoSrc]);

  useEffect(() => {
    const checkCountdown = async () => {
      try {
        const state = JSON.parse(await invoke('get_countdown_state') as string);
        setCountdownRunning(state.running);
        setCountdownSeconds(state.seconds_left);
        setCountdownTarget(state.target_time || '');
      } catch (_) {}
    };

    checkCountdown();
    const interval = setInterval(checkCountdown, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unlistenUpdate = listen('countdown-update', (event: any) => {
      setCountdownRunning(event.payload.running);
      setCountdownSeconds(event.payload.seconds_left);
      setCountdownTarget(event.payload.target_time || '');
    });

    const unlistenStop = listen('countdown-stop', () => {
      setCountdownRunning(false);
      setCountdownSeconds(0);
      setCountdownTarget('');
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
      {/* Prioridade 1: Vídeo COM ÁUDIO */}
      {mediaType === 'video' && videoSrc ? (
        <>
          <video 
            ref={videoRef}
            src={videoSrc}
            autoPlay
            playsInline
            loop={false}  // 🔥 GARANTIR QUE NÃO REPETE
            onEnded={handleVideoEnded}  // 🔥 DETECTAR FIM DO VÍDEO
            style={{ 
              width: '100%', 
              height: '100%', 
              objectFit: 'contain',
              backgroundColor: '#000000'
            }} 
          />
          {/* Indicador de pausa */}
          {isPaused && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              zIndex: 10,
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid rgba(255,255,255,0.3)',
                backdropFilter: 'blur(4px)',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                  <rect x="6" y="3" width="4" height="18" rx="1" />
                  <rect x="14" y="3" width="4" height="18" rx="1" />
                </svg>
              </div>
            </div>
          )}
        </>
      ) : mediaType === 'image' && imageSrc ? (
        <img 
          src={imageSrc} 
          alt="" 
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'contain',
            pointerEvents: 'none',
            backgroundColor: '#000000'
          }} 
        />
      ) : countdownRunning && countdownSeconds > 0 ? (
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
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            opacity: 0.04,
            background: `radial-gradient(circle at 20% 50%, #4a90d9 0%, transparent 50%),
                        radial-gradient(circle at 80% 50%, #667eea 0%, transparent 50%),
                        radial-gradient(circle at 50% 80%, #4a90d9 0%, transparent 50%)`
          }} />

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

          <div style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(1.5rem, 4vh, 3rem)'
          }}>
      
            <div style={{
              fontSize: 'clamp(3rem, 3.5vw, 4.5rem)',
              color: 'rgba(255,255,255,0.85)',
              fontWeight: 600,
              letterSpacing: '4px',
              textTransform: 'uppercase',
              textAlign: 'center',
              textShadow: '0 2px 20px rgba(0,0,0,0.3)'
            }}>
              A reunião começará em
            </div>

            <div style={{
              fontSize: 'clamp(10rem, 22vw, 20rem)',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '1px',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              textShadow: '0 0 80px rgba(74,144,217,0.25), 0 0 120px rgba(74,144,217,0.15), 0 4px 30px rgba(0,0,0,0.3)'
            }}>
              {formatTime(countdownSeconds)}
            </div>

            {countdownTarget && (
              <div style={{
                fontSize: 'clamp(2rem, 3vw, 3.5rem)',
                color: 'rgba(255,255,255,0.85)',
                fontWeight: 700,
                letterSpacing: '3px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 15px rgba(0,0,0,0.2)'
              }}>
                <span style={{
                  width: '12px', 
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(74, 109, 167, 0.6)',
                  display: 'inline-block',
                  boxShadow: '0 0 20px rgba(74,144,217,0.4)'
                }} />
                Início às {countdownTarget}
              </div>
            )}
          </div>
        </div>
      ) : defaultImage ? (
        <img 
          src={defaultImage} 
          alt="Texto do Ano" 
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'contain', 
            pointerEvents: 'none',
            backgroundColor: '#000000'
          }} 
        />
      ) : (
        <div style={{ width:'100%', height:'100%', backgroundColor:'#000000' }} />
      )}
    </div>
  );
}

export default DisplayPage;