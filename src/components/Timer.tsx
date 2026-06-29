import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

interface TimerProps {
  onControl: (action: string) => void;
  isOperator?: boolean;
  currentSeconds?: number;
  isRunning?: boolean;
  size?: 'normal' | 'large';
}

function Timer({ onControl, currentSeconds: externalSeconds, isRunning: externalRunning, size = 'normal' }: TimerProps) {
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const localIntervalRef = useRef<any>(null);

  const isLarge = size === 'large';

  // Escutar atualizações do timer via eventos Tauri (Admin)
  useEffect(() => {
    const unlisten = listen('timer-update', (event: any) => {
      const data = event.payload;
      
      setRunning(data.running);
      
      if (data.accumulated !== undefined) {
        const seconds = Math.floor(data.accumulated / 1000);
        setDisplaySeconds(seconds);
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Sincronizar com props externas (para o ControlPage via WebSocket)
  useEffect(() => {
    if (externalSeconds !== undefined) {
      const seconds = Math.floor(externalSeconds / 1000);
      setDisplaySeconds(seconds);
    }
  }, [externalSeconds]);

  useEffect(() => {
    if (externalRunning !== undefined) {
      setRunning(externalRunning);
    }
  }, [externalRunning]);

  // Timer local para contagem suave
  useEffect(() => {
    if (localIntervalRef.current) {
      clearInterval(localIntervalRef.current);
      localIntervalRef.current = null;
    }

    if (!running) return;

    localIntervalRef.current = setInterval(() => {
      setDisplaySeconds(prev => prev + 1);
    }, 1000);

    return () => {
      if (localIntervalRef.current) {
        clearInterval(localIntervalRef.current);
      }
    };
  }, [running]);

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

  const getProgressColor = () => {
    if (!running && displaySeconds === 0) return '#484f58';
    if (displaySeconds < 300) return '#34d399';
    if (displaySeconds < 420) return '#fbbf24';
    return '#ef4444';
  };

  const getBackgroundColor = () => {
    if (!running && displaySeconds === 0) return 'rgba(255,255,255,0.02)';
    if (displaySeconds < 300) return 'rgba(52,211,153,0.08)';
    if (displaySeconds < 420) return 'rgba(251,191,36,0.08)';
    return 'rgba(239,68,68,0.08)';
  };

  const canReset = !running && displaySeconds > 0;

  // Estilos baseados no tamanho
  const containerStyle = isLarge ? {
    gap: '1rem',
    padding: '0.8rem 1.5rem',
  } : {
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
  };

  const iconContainerStyle = isLarge ? {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
  } : {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
  };

  const iconSize = isLarge ? 22 : 14;

  const timeFontStyle = isLarge ? {
    fontSize: '2rem',
    minWidth: displaySeconds >= 3600 ? '120px' : '90px',
    letterSpacing: '2px',
  } : {
    fontSize: '0.95rem',
    minWidth: displaySeconds >= 3600 ? '70px' : '48px',
    letterSpacing: '0.5px',
  };

  const buttonStyle = isLarge ? {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
  } : {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
  };

  const buttonIconSize = isLarge ? 20 : 13;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      background: getBackgroundColor(),
      borderRadius: isLarge ? '14px' : '10px',
      border: `1px solid ${getProgressColor()}20`,
      transition: 'all 0.3s ease',
      ...containerStyle,
    }}>
      <div style={{
        background: running ? `${getProgressColor()}15` : 'rgba(255,255,255,0.03)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...iconContainerStyle,
      }}>
        <Clock size={iconSize} color={getProgressColor()} />
      </div>
      
      <span style={{
        fontWeight: 800,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: getProgressColor(),
        textAlign: 'center',
        transition: 'color 0.3s ease',
        ...timeFontStyle,
      }}>
        {formatTime(displaySeconds)}
      </span>
      
      <div style={{ display: 'flex', gap: isLarge ? '0.5rem' : '0.25rem' }}>
        {!running ? (
          <button
            onClick={() => onControl('start')}
            style={{
              border: 'none',
              background: 'rgba(52,211,153,0.1)',
              color: '#34d399',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
              ...buttonStyle,
            }}
            title="Iniciar"
          >
            <Play size={buttonIconSize} />
          </button>
        ) : (
          <button
            onClick={() => onControl('pause')}
            style={{
              border: 'none',
              background: 'rgba(251,191,36,0.1)',
              color: '#fbbf24',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
              ...buttonStyle,
            }}
            title="Pausar"
          >
            <Pause size={buttonIconSize} />
          </button>
        )}
        
        <button
          onClick={() => canReset && onControl('reset')}
          style={{
            border: 'none',
            background: canReset ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
            color: canReset ? '#ef4444' : '#484f58',
            cursor: canReset ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
            opacity: canReset ? 1 : 0.3,
            ...buttonStyle,
          }}
          disabled={!canReset}
          title={canReset ? "Resetar" : "Pause o cronômetro para resetar"}
        >
          <RotateCcw size={buttonIconSize} />
        </button>
      </div>
    </div>
  );
}

export default Timer;