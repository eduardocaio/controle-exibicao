import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Upload, Monitor, BookOpen, Trash2, Play, Square, Image, GlassWater, AlertTriangle, X, MessageSquare, Send, CheckCircle} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import SettingsPage from './SettingsPage';
import Timer from '../components/Timer';

function AdminPage() {
  const [images, setImages] = useState<any[]>([]);
  const [monitors, setMonitors] = useState<string[]>([]);
  const [activeApp, setActiveApp] = useState<'sistema' | 'jw'>('sistema');
  const [showSettings, setShowSettings] = useState(false);
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({});
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [isBlackout, setIsBlackout] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [waterAlerts, setWaterAlerts] = useState<any[]>([]);
  const [indicatorAlert, setIndicatorAlert] = useState<any>(null);
  const [messageText, setMessageText] = useState('');
  const [sentMessage, setSentMessage] = useState<any>(null);
  const [messageAcknowledged, setMessageAcknowledged] = useState(false);

  useEffect(() => { (async () => { try { setMonitors(await invoke('get_monitors') as string[]); } catch (_) {} })(); }, []);
  useEffect(() => { loadImages(); checkDisplayState(); }, []);

  useEffect(() => {
    const interval = setInterval(checkDisplayState, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unlisten = listen('switch-app', (event: any) => {
      setActiveApp(event.payload as 'sistema' | 'jw');
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    const unlistenWater = listen('water-request', (event: any) => {
      setWaterAlerts(prev => [...prev, { ...event.payload, id: event.payload.id }]);
    });
    
    const unlistenIndicator = listen('indicator-request', (event: any) => {
      setIndicatorAlert(event.payload);
    });

    const unlistenMessageAck = listen('operator-message-acknowledged', () => {
        setMessageAcknowledged(true);
        setSentMessage(null);
        setTimeout(() => setMessageAcknowledged(false), 5000);
    });
    
    return () => {
      unlistenWater.then(fn => fn());
      unlistenIndicator.then(fn => fn());
      unlistenMessageAck.then(fn => fn());
    };
  }, []);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    
    try {
        await invoke('send_operator_message', { text: messageText.trim() });
        setSentMessage({ text: messageText.trim() });
        setMessageText('');
        setMessageAcknowledged(false);
    } catch (e) {
        console.error('Erro ao enviar mensagem:', e);
    }
  };

  const checkDisplayState = async () => {
    try {
      const s = JSON.parse(await invoke('get_display_state') as string);
      setIsBlackout(s.is_blackout);
      if (!s.is_blackout && s.current_filename) {
        setActiveImageIndex(s.current_index);
      } else {
        setActiveImageIndex(null);
      }
    } catch (_) {}
  };

  const loadImages = async () => {
    try {
      const slides = await invoke('get_all_slides');
      setImages(JSON.parse(slides as string) || []);
    } catch (_) {}
  };

  const loadThumb = async (filename: string) => {
    if (thumbCache[filename]) return thumbCache[filename];
    
    // Usar URL HTTP direta em vez de base64
    const url = `http://localhost:20778/thumbnails/${filename}`;
    setThumbCache(prev => ({ ...prev, [filename]: url }));
    return url;
  };

  const handleUpload = async () => {
    const f = await open({ multiple: true, filters: [{ name: 'Imagens', extensions: ['jpg','jpeg','png','webp','gif','bmp'] }] });
    if (!f) return;
    const paths = (Array.isArray(f) ? f : [f]).map(x => typeof x === 'string' ? x : (x as any).path);
    await invoke('upload_images_direct', { filePaths: paths });
    await loadImages();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta imagem?')) return;
    await invoke('delete_slide', { slideId: id });
    await loadImages();
  };

  const handleShowImage = async (idx: number) => {
    await invoke('set_current_slide', { index: idx });
    await invoke('switch_to_sistema');
    setActiveImageIndex(idx);
    setIsBlackout(false);
    setActiveApp('sistema');
  };

  const handleHideImage = async () => {
    await invoke('set_blackout', { value: true });
    await invoke('switch_to_jw_library');
    setActiveImageIndex(null);
    setIsBlackout(true);
    setActiveApp('jw');
  };

  const handleSwitchToJW = async () => { await invoke('switch_to_jw_library'); setActiveApp('jw'); };
  const handleSwitchToSistema = async () => { await invoke('switch_to_sistema'); setActiveApp('sistema'); };

  const handleTimerControl = async (action: string) => {
    try {
      await invoke('timer_control', { action });
    } catch (e) {
      console.error('Erro no timer:', e);
    }
  };

  const handleAcknowledgeWater = async (requestId: string) => {
    await invoke('acknowledge_water_request', { requestId });
    setWaterAlerts(prev => prev.filter(w => w.id !== requestId));
  };

  const handleAcknowledgeIndicator = async () => {
    await invoke('acknowledge_indicator_request');
    setIndicatorAlert(null);
  };

  useEffect(() => {
    const init = async () => { try { await invoke('show_display_window'); } catch (_) {} };
    init();
  }, []);

  if (showSettings) {
    return <div style={{ minHeight:'100vh', padding:'2rem', background:'#0b0e11' }}><SettingsPage onBack={() => setShowSettings(false)} /></div>;
  }

  return (
    <div style={{ minHeight:'100vh', padding:'2rem', display:'flex', justifyContent:'center', background:'#0b0e11' }}>
      <div style={{ width:'100%', maxWidth:'1100px' }}>
        
        {/* Header */}
        <div style={{ 
          background:'#111820', 
          borderRadius:'16px', 
          padding:'1.5rem 2rem', 
          marginBottom:'1.5rem', 
          display:'flex', 
          justifyContent:'space-between', 
          alignItems:'center', 
          flexWrap:'wrap', 
          gap:'1rem',
          border:'1px solid rgba(255,255,255,0.04)'
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
            <div style={{ 
              width:'44px', height:'44px', 
              borderRadius:'12px', 
              background:'rgba(102,126,234,0.12)', 
              display:'flex', alignItems:'center', justifyContent:'center' 
            }}>
              <Image size={22} color="#667eea" />
            </div>
            <div>
              <h1 style={{ fontSize:'1.4rem', fontWeight:700, margin:0, color:'#e1e4e8', letterSpacing:'-0.3px' }}>Controle de Exibição</h1>
              <p style={{ opacity:0.5, margin:0, fontSize:'0.8rem', color:'#8b949e' }}>Gerencie suas imagens</p>
            </div>
          </div>
          
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
            {/* Timer */}
            <Timer onControl={handleTimerControl} isOperator={true}/>
            
            {/* Monitores */}
            {monitors.map((m,i) => (
              <span key={i} style={{ 
                padding:'0.35rem 0.7rem', borderRadius:'20px', fontSize:'0.75rem',
                background: i===1?'rgba(52,211,153,0.1)':'rgba(255,255,255,0.04)',
                color: i===1?'#34d399':'#8b949e',
                border: i===1?'1px solid rgba(52,211,153,0.2)':'1px solid rgba(255,255,255,0.05)',
                display:'flex', alignItems:'center', gap:'0.4rem'
              }}>
                <Monitor size={12} /> {m}
              </span>
            ))}

            {/* Switch */}
            <div style={{ display:'flex', background:'rgba(255,255,255,0.03)', borderRadius:'8px', padding:'3px' }}>
              <button onClick={handleSwitchToJW} style={{
                padding:'0.4rem 0.8rem', borderRadius:'6px', border:'none', cursor:'pointer',
                fontWeight:600, fontSize:'0.78rem',
                background: activeApp === 'jw' ? '#667eea' : 'transparent',
                color: activeApp === 'jw' ? '#fff' : '#8b949e',
                display:'flex', alignItems:'center', gap:'0.3rem', transition:'all 0.15s'
              }}>
                <BookOpen size={13} /> JW Library
              </button>
              <button onClick={handleSwitchToSistema} style={{
                padding:'0.4rem 0.8rem', borderRadius:'6px', border:'none', cursor:'pointer',
                fontWeight:600, fontSize:'0.78rem',
                background: activeApp === 'sistema' ? '#667eea' : 'transparent',
                color: activeApp === 'sistema' ? '#fff' : '#8b949e',
                display:'flex', alignItems:'center', gap:'0.3rem', transition:'all 0.15s'
              }}>
                <Image size={13} /> Imagens
              </button>
            </div>

            <button onClick={() => setShowSettings(true)} style={{ 
              width:'38px', height:'38px', borderRadius:'10px', 
              background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', 
              cursor:'pointer', color:'#8b949e', fontSize:'1rem', display:'flex', alignItems:'center', justifyContent:'center',
              transition:'all 0.15s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            title="Configurações">⚙️</button>
          </div>
        </div>

        {/* Painel de Mensagem para o Orador */}
        <div style={{ 
            background: 'linear-gradient(135deg, #111820 0%, #1a1f2e 100%)', 
            borderRadius: '16px', 
            padding: '1.25rem 1.5rem', 
            marginBottom: '1rem',
            border: '1px solid rgba(147,51,234,0.2)',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
        }}>
            <div style={{
                width: '40px', height: '40px',
                borderRadius: '10px',
                background: 'rgba(147,51,234,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
            }}>
                <MessageSquare size={20} color="#a855f7" />
            </div>
            
            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Digite uma mensagem para o orador..."
                        style={{
                            flex: 1,
                            padding: '0.65rem 0.85rem',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            color: '#e1e4e8',
                            fontSize: '0.85rem',
                            outline: 'none',
                        }}
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!messageText.trim()}
                        style={{
                            padding: '0.65rem 1rem',
                            background: messageText.trim() ? '#7c3aed' : 'rgba(124,58,237,0.3)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: messageText.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            transition: 'all 0.15s',
                            opacity: messageText.trim() ? 1 : 0.5,
                        }}
                    >
                        <Send size={14} />
                        Enviar
                    </button>
                </div>
                
                {sentMessage && !messageAcknowledged && (
                    <div style={{
                        marginTop: '0.5rem',
                        padding: '0.4rem 0.75rem',
                        background: 'rgba(147,51,234,0.08)',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        color: '#a855f7',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                    }}>
                        <div style={{
                            width: '6px', height: '6px',
                            borderRadius: '50%',
                            backgroundColor: '#a855f7',
                            animation: 'pulse 1.5s infinite',
                        }} />
                        Mensagem enviada: "{sentMessage.text}" - Aguardando confirmação...
                    </div>
                )}
                
                {messageAcknowledged && (
                    <div style={{
                        marginTop: '0.5rem',
                        padding: '0.4rem 0.75rem',
                        background: 'rgba(52,211,153,0.08)',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        color: '#34d399',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                    }}>
                        <CheckCircle size={14} />
                        Orador confirmou o recebimento da mensagem
                    </div>
                )}
            </div>
        </div>

        {/* Conteúdo */}
        <div style={{ background:'#111820', borderRadius:'16px', padding:'1.5rem', border:'1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
              <h2 style={{ fontSize:'1rem', fontWeight:700, color:'#e1e4e8', margin:0 }}>Imagens</h2>
              <span style={{ 
                background:'rgba(102,126,234,0.12)', color:'#667eea',
                padding:'0.15rem 0.5rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:600
              }}>{images.length}</span>
              {activeImageIndex !== null && (
                <span style={{ 
                  background:'rgba(239,68,68,0.1)', color:'#ef4444',
                  padding:'0.15rem 0.5rem', borderRadius:'20px', fontSize:'0.72rem', fontWeight:600,
                  display:'flex', alignItems:'center', gap:'0.3rem'
                }}>
                  <span style={{ width:'5px', height:'5px', borderRadius:'50%', backgroundColor:'#ef4444' }} />
                  Imagem {activeImageIndex + 1} ativa
                </span>
              )}
            </div>
            <button onClick={handleUpload} style={{ 
              padding:'0.55rem 1rem', background:'#667eea', color:'#fff', 
              border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:600, 
              fontSize:'0.82rem', display:'flex', alignItems:'center', gap:'0.4rem',
              transition:'all 0.15s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#5a6fd6'}
            onMouseLeave={e => e.currentTarget.style.background = '#667eea'}>
              <Upload size={15} /> Adicionar Imagens
            </button>
          </div>

          {images.length === 0 ? (
            <div onClick={handleUpload} style={{ 
              textAlign:'center', padding:'4rem 2rem', 
              background:'rgba(255,255,255,0.01)', borderRadius:'12px', 
              border:'2px dashed rgba(255,255,255,0.06)', cursor:'pointer',
              transition:'all 0.2s'
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(102,126,234,0.3)'; e.currentTarget.style.background = 'rgba(102,126,234,0.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = 'rgba(255,255,255,0.01)'; }}>
              <div style={{
                width:'56px', height:'56px', borderRadius:'14px',
                background:'rgba(102,126,234,0.08)', display:'flex', alignItems:'center', justifyContent:'center',
                margin:'0 auto 1rem'
              }}>
                <Upload size={24} color="#667eea" style={{ opacity:0.6 }} />
              </div>
              <p style={{ color:'#8b949e', fontWeight:500, margin:0, fontSize:'0.9rem' }}>Nenhuma imagem adicionada</p>
              <p style={{ color:'#484f58', fontSize:'0.78rem', marginTop:'4px' }}>Clique ou arraste para adicionar</p>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'0.75rem' }}>
              {images.map((img: any, idx: number) => (
                <ThumbCard 
                  key={img.id} 
                  img={img} 
                  idx={idx} 
                  loadThumb={loadThumb} 
                  thumbCache={thumbCache} 
                  onDelete={handleDelete}
                  onShow={handleShowImage}
                  onHide={handleHideImage}
                  isActive={activeImageIndex === idx && !isBlackout}
                  isHovered={hoveredId === img.id}
                  onHover={setHoveredId}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alertas */}
      {(waterAlerts.length > 0 || indicatorAlert) && (
        <div style={{
          position: 'fixed',
          bottom: '80px',
          right: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          zIndex: 1000,
          maxWidth: '380px',
        }}>
          {waterAlerts.filter(w => !w.acknowledged).map((alert) => (
            <div key={alert.id} style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: '14px',
              padding: '1rem 1.25rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,130,246,0.1)',
              animation: 'slideInRight 0.3s ease',
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{
                  width: '40px', height: '40px',
                  borderRadius: '10px',
                  background: 'rgba(59,130,246,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <GlassWater size={20} color="#3b82f6" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
                      Pedido de Água
                    </h4>
                    <button
                      onClick={() => handleAcknowledgeWater(alert.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        padding: '2px',
                        borderRadius: '4px',
                        display: 'flex',
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                    Orador solicitou água
                  </p>
                  <button
                    onClick={() => handleAcknowledgeWater(alert.id)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'rgba(59,130,246,0.15)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59,130,246,0.25)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(59,130,246,0.25)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(59,130,246,0.15)';
                    }}
                  >
                    OK - Entregue
                  </button>
                </div>
              </div>
            </div>
          ))}

          {indicatorAlert && (
            <div style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '14px',
              padding: '1rem 1.25rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(245,158,11,0.1)',
              animation: 'slideInRight 0.3s ease',
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{
                  width: '40px', height: '40px',
                  borderRadius: '10px',
                  background: 'rgba(245,158,11,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <AlertTriangle size={20} color="#f59e0b" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
                      Pedido de Indicador
                    </h4>
                    <button
                      onClick={handleAcknowledgeIndicator}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        padding: '2px',
                        borderRadius: '4px',
                        display: 'flex',
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                    Orador solicitou um indicador
                  </p>
                  <button
                    onClick={handleAcknowledgeIndicator}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'rgba(245,158,11,0.15)',
                      color: '#fbbf24',
                      border: '1px solid rgba(245,158,11,0.25)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(245,158,11,0.25)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(245,158,11,0.15)';
                    }}
                  >
                    OK - Providenciar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

function ThumbCard({ img, idx, loadThumb, thumbCache, onDelete, onShow, onHide, isActive, isHovered, onHover }: any) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const key = img.filename;
    if (thumbCache[key]) {
      setSrc(thumbCache[key]);
    } else {
      loadThumb(key).then((s: string) => { if (s) setSrc(s); });
    }
  }, [img.filename, thumbCache]);

  return (
    <div 
      onMouseEnter={() => onHover(img.id)}
      onMouseLeave={() => onHover(null)}
      style={{ 
        background: isActive ? '#141010' : '#0f1419', 
        borderRadius:'10px', 
        overflow:'hidden', 
        border: isActive ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(255,255,255,0.04)',
        boxShadow: isActive ? '0 0 20px rgba(239,68,68,0.08)' : 'none',
        transition:'all 0.2s ease'
      }}>
      <div style={{ 
        height:'130px', 
        background:'#080c10', 
        display:'flex', alignItems:'center', justifyContent:'center', 
        overflow:'hidden', position:'relative'
      }}>
        {src ? (
          <img src={src} alt={`Imagem ${idx+1}`} style={{ width:'100%', height:'100%', objectFit:'cover', filter: isActive ? 'brightness(1.05)' : 'brightness(0.85)' }} />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.3rem' }}>
            <div style={{ width:'32px', height:'32px', borderRadius:'8px', background:'rgba(255,255,255,0.03)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Image size={16} color="rgba(255,255,255,0.15)" />
            </div>
            <span style={{ fontSize:'0.7rem', color:'#484f58' }}>Imagem {idx+1}</span>
          </div>
        )}
        
        {isHovered && !isActive && (
          <div style={{
            position:'absolute', top:0, left:0, right:0, bottom:0,
            background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all 0.15s'
          }}>
            <button onClick={() => onShow(idx)} style={{
              padding:'0.5rem 0.8rem', background:'#667eea', color:'#fff',
              border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:600,
              fontSize:'0.75rem', display:'flex', alignItems:'center', gap:'0.3rem'
            }}>
              <Play size={13} /> Exibir
            </button>
          </div>
        )}

        {isActive && (
          <div style={{
            position:'absolute', top:0, left:0, right:0, bottom:0,
            background:'rgba(15,8,8,0.85)', backdropFilter:'blur(2px)',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'0.4rem'
          }}>
            <div style={{
              width:'32px', height:'32px', borderRadius:'50%',
              background:'rgba(239,68,68,0.12)', border:'1.5px solid rgba(239,68,68,0.4)',
              display:'flex', alignItems:'center', justifyContent:'center'
            }}>
              <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:'rgba(239,68,68,0.8)' }} />
            </div>
            <button onClick={() => onHide()} style={{
              padding:'0.35rem 0.7rem', background:'rgba(239,68,68,0.15)', color:'rgba(239,68,68,0.9)',
              border:'1px solid rgba(239,68,68,0.25)', borderRadius:'6px', cursor:'pointer',
              fontWeight:600, fontSize:'0.7rem', letterSpacing:'0.5px', textTransform:'uppercase'
            }}>
              <Square size={11} style={{ marginRight:'4px' }} />
              Encerrar
            </button>
          </div>
        )}
      </div>
      
      <div style={{ 
        padding:'0.4rem 0.6rem', 
        display:'flex', justifyContent:'space-between', alignItems:'center',
        borderTop:'1px solid rgba(255,255,255,0.03)',
        background: isActive ? 'rgba(239,68,68,0.04)' : 'transparent'
      }}>
        <span style={{ fontSize:'0.72rem', fontWeight:600, color: isActive ? 'rgba(239,68,68,0.85)' : '#8b949e' }}>
          Imagem {idx+1}
        </span>
        <button onClick={() => onDelete(img.id)} style={{ 
          background:'none', border:'none', color:'#484f58', cursor:'pointer', padding:'2px',
          transition:'color 0.15s'
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
        onMouseLeave={e => e.currentTarget.style.color = '#484f58'}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default AdminPage;