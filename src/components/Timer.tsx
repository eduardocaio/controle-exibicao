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

  useEffect(() => {
    const unlisten = listen('timer-update', (event: any) => {
      const data = event.payload;
      setRunning(data.running);
      if (data.accumulated !== undefined) {
        const seconds = Math.floor(data.accumulated / 1000);
        setDisplaySeconds(seconds);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    if (externalSeconds !== undefined) {
      setDisplaySeconds(Math.floor(externalSeconds / 1000));
    }
  }, [externalSeconds]);

  useEffect(() => {
    if (externalRunning !== undefined) {
      setRunning(externalRunning);
    }
  }, [externalRunning]);

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
      if (localIntervalRef.current) clearInterval(localIntervalRef.current);
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
    if (!running && displaySeconds === 0) return '#6b7280';
    if (displaySeconds < 300) return '#34d399';
    if (displaySeconds < 420) return '#fbbf24';
    return '#ef4444';
  };

  const canReset = !running && displaySeconds > 0;

  if (isLarge) {
    // Versão GRANDE para o Admin
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1.25rem',
      }}>
        {/* Display do tempo */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: running ? `${getProgressColor()}20` : 'rgba(255,255,255,0.04)',
            border: `1.5px solid ${getProgressColor()}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Clock size={22} color={getProgressColor()} />
          </div>
          
          <span style={{
            fontWeight: 800,
            fontSize: '2.2rem',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            color: getProgressColor(),
            letterSpacing: '3px',
            minWidth: '110px',
            textAlign: 'center',
            lineHeight: '1',
          }}>
            {formatTime(displaySeconds)}
          </span>
        </div>

        {/* Botões de controle */}
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '10px',
          padding: '0.35rem',
        }}>
          {!running ? (
            <button
              onClick={() => onControl('start')}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(52,211,153,0.15)',
                color: '#34d399',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.25)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.15)'; }}
              title="Iniciar cronômetro"
            >
              <Play size={20} />
            </button>
          ) : (
            <button
              onClick={() => onControl('pause')}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(251,191,36,0.15)',
                color: '#fbbf24',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.25)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.15)'; }}
              title="Pausar cronômetro"
            >
              <Pause size={20} />
            </button>
          )}
          
          <button
            onClick={() => canReset && onControl('reset')}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: 'none',
              background: canReset ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
              color: canReset ? '#ef4444' : '#484f58',
              cursor: canReset ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              opacity: canReset ? 1 : 0.4,
            }}
            disabled={!canReset}
            onMouseEnter={e => { if (canReset) e.currentTarget.style.background = 'rgba(239,68,68,0.25)'; }}
            onMouseLeave={e => { if (canReset) e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; }}
            title={canReset ? "Resetar cronômetro" : "Pause para resetar"}
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </div>
    );
  }

  // Versão NORMAL para o ControlPage
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.5rem 0.75rem',
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.04)',
    }}>
      <Clock size={14} color="#8b949e" />
      <span style={{
        fontWeight: 700,
        fontSize: '0.95rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: '#e1e4e8',
        minWidth: '48px',
      }}>
        {formatTime(displaySeconds)}
      </span>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {!running ? (
          <button onClick={() => onControl('start')} style={{
            width: '28px', height: '28px', borderRadius: '6px', border: 'none',
            background: 'rgba(52,211,153,0.1)', color: '#34d399', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Play size={13} />
          </button>
        ) : (
          <button onClick={() => onControl('pause')} style={{
            width: '28px', height: '28px', borderRadius: '6px', border: 'none',
            background: 'rgba(251,191,36,0.1)', color: '#fbbf24', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Pause size={13} />
          </button>
        )}
        <button onClick={() => canReset && onControl('reset')} style={{
          width: '28px', height: '28px', borderRadius: '6px', border: 'none',
          background: canReset ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
          color: canReset ? '#ef4444' : '#484f58',
          cursor: canReset ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: canReset ? 1 : 0.3,
        }} disabled={!canReset}>
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}

export default Timer;