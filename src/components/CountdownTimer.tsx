// src/components/CountdownTimer.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Clock, Square } from 'lucide-react';

function CountdownTimer() {
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [targetTime, setTargetTime] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    const checkState = async () => {
      try {
        const state = JSON.parse(await invoke('get_countdown_state') as string);
        setRunning(state.running);
        setSecondsLeft(state.seconds_left);
        setTargetTime(state.target_time || '');
        setLabel(state.label);
      } catch (_) {}
    };
    
    checkState();
    const interval = setInterval(checkState, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unlistenUpdate = listen('countdown-update', (event: any) => {
      setRunning(event.payload.running);
      setSecondsLeft(event.payload.seconds_left);
      setTargetTime(event.payload.target_time);
      setLabel(event.payload.label);
    });

    const unlistenStop = listen('countdown-stop', () => {
      setRunning(false);
      setSecondsLeft(0);
      setTargetTime('');
      setLabel('');
    });

    return () => {
      unlistenUpdate.then(fn => fn());
      unlistenStop.then(fn => fn());
    };
  }, []);

  const handleStop = async () => {
    if (!confirm('Parar o cronômetro regressivo? O sistema alternará para o JW Library.')) return;
    try {
      await invoke('stop_countdown');
    } catch (e) {
      console.error('Erro ao parar cronômetro:', e);
    }
  };

  if (!running) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.06) 100%)',
      border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: '12px',
      padding: '0.55rem 0.9rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      animation: 'pulse 2s infinite'
    }}>
      <div style={{
        width: '30px', height: '30px',
        borderRadius: '7px',
        background: 'rgba(239,68,68,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0
      }}>
        <Clock size={16} color="#ef4444" />
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <div style={{ fontSize: '0.6rem', color: '#f87171', fontWeight: 500, letterSpacing: '0.3px' }}>
          {label} • {targetTime}
        </div>
        <div style={{ 
          fontSize: '1.1rem', fontWeight: 800, 
          color: '#fff', letterSpacing: '0.5px',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1
        }}>
          {formatTime(secondsLeft)}
        </div>
      </div>

      <button
        onClick={handleStop}
        style={{
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '6px',
          color: '#f87171',
          cursor: 'pointer',
          padding: '4px 6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
          flexShrink: 0
        }}
        title="Parar cronômetro e ir para JW Library"
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.25)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
      >
        <Square size={14} fill="currentColor" />
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}

export default CountdownTimer;