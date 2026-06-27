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

      ws.onopen = () => {
        console.log('✅ Conectado');
        setConnected(true);
        setStatus('✅ Conectado');
      };

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

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {};
      wsRef.current = ws;
    } catch (e) {
      setTimeout(connect, 5000);
    }
  };

  useEffect(() => { connect(); return () => { if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); } }; }, []);

  const sendCommand = (action: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) { wsRef.current.send(JSON.stringify({ action, ...data })); }
  };

  return (
    <div style={{ minHeight:'100vh', background:'#1a1a2e', color:'white', fontFamily:'Arial, sans-serif', padding:'1rem', userSelect:'none', WebkitUserSelect:'none', touchAction:'manipulation' }}>
      <div style={{ textAlign:'center', padding:'1rem', marginBottom:'1rem' }}>
        <h1 style={{ fontSize:'1.4rem', margin:0, fontWeight:700 }}>Controle de Exibição</h1>
        <div style={{ marginTop:'0.5rem', display:'flex', justifyContent:'center', alignItems:'center', gap:'0.5rem' }}>
          <span style={{ width:'10px', height:'10px', borderRadius:'50%', backgroundColor:connected?'#48bb78':'#e53e3e', display:'inline-block' }} />
          <span style={{ fontSize:'0.85rem', opacity:0.8 }}>{status}</span>
        </div>
      </div>

      {connected && slides.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:'0.75rem', padding:'0.5rem', paddingBottom:'5rem' }}>
          {slides.map((slide: any, idx: number) => {
            const isActive = idx === currentIndex && !isBlackout;
            return (
              <div key={slide.id} onClick={() => { setCurrentIndex(idx); sendCommand('set_slide', { index: idx }); }}
                style={{ background:isActive?'linear-gradient(135deg, #667eea 0%, #764ba2 100%)':'rgba(255,255,255,0.06)', borderRadius:'14px', padding:'1.25rem 0.75rem', cursor:'pointer', border:isActive?'2px solid #48bb78':'2px solid transparent', transition:'all 0.2s ease', textAlign:'center', minHeight:'100px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'0.5rem', fontSize:'0.95rem', fontWeight:isActive?700:400, boxShadow:isActive?'0 4px 20px rgba(72,187,120,0.3)':'none', transform:isActive?'scale(1.03)':'scale(1)' }}>
                <span style={{ fontSize:'1.5rem', fontWeight:700 }}>{idx + 1}</span>
                <span style={{ fontSize:'0.8rem', opacity:0.8 }}>Slide {idx + 1}</span>
                {isActive && <span style={{ fontSize:'0.7rem', color:'#48bb78' }}>● Em exibição</span>}
              </div>
            );
          })}
        </div>
      )}

      {connected && slides.length === 0 && (
        <div style={{ textAlign:'center', padding:'4rem 2rem', opacity:0.6 }}>
          <p style={{ fontSize:'1.2rem', marginBottom:'0.5rem' }}>📭 Nenhuma apresentação ativa</p>
          <p style={{ fontSize:'0.9rem' }}>Aguardando o operador...</p>
        </div>
      )}

      {!connected && (
        <div style={{ textAlign:'center', padding:'4rem 2rem', opacity:0.6 }}>
          <div style={{ width:'60px', height:'60px', borderRadius:'50%', border:'3px solid rgba(255,255,255,0.1)', borderTopColor:'#667eea', animation:'spin 1s linear infinite', margin:'0 auto 1.5rem' }} />
          <p style={{ fontSize:'1rem' }}>{status}</p>
        </div>
      )}

      {connected && slides.length > 0 && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, padding:'0.75rem', display:'flex', gap:'0.5rem', background:'rgba(26,26,46,0.97)', backdropFilter:'blur(10px)', borderTop:'1px solid rgba(255,255,255,0.08)', zIndex:100 }}>
          <button onClick={() => sendCommand('prev')} style={{ flex:1, padding:'0.9rem', background:'rgba(255,255,255,0.06)', color:'white', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px', fontSize:'1.3rem', cursor:'pointer', fontWeight:700 }}>←</button>
          <button onClick={() => { const ns = !isBlackout; setIsBlackout(ns); sendCommand(ns ? 'blackout' : 'show'); }} style={{ flex:2, padding:'0.9rem', background:isBlackout?'linear-gradient(135deg, #667eea 0%, #764ba2 100%)':'#e53e3e', color:'white', border:'none', borderRadius:'12px', fontSize:'1rem', cursor:'pointer', fontWeight:700 }}>{isBlackout ? '▶ Mostrar' : '⬛ Tela Preta'}</button>
          <button onClick={() => sendCommand('next')} style={{ flex:1, padding:'0.9rem', background:'rgba(255,255,255,0.06)', color:'white', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px', fontSize:'1.3rem', cursor:'pointer', fontWeight:700 }}>→</button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default ControlPage;