// src/pages/AdminPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Upload, Monitor, BookOpen, Trash2, Play, Square, Image } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import SettingsPage from './SettingsPage';

function AdminPage() {
  const [images, setImages] = useState<any[]>([]);
  const [monitors, setMonitors] = useState<string[]>([]);
  const [activeApp, setActiveApp] = useState<'sistema' | 'jw'>('sistema');
  const [showSettings, setShowSettings] = useState(false);
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({});
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [isBlackout, setIsBlackout] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => { (async () => { try { setMonitors(await invoke('get_monitors') as string[]); } catch (_) {} })(); }, []);
  useEffect(() => { loadImages(); checkDisplayState(); }, []);

  // Polling do estado de exibição
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
    try {
      const b64 = await invoke('get_image_base64', { filename, isThumb: true });
      setThumbCache(prev => ({ ...prev, [filename]: b64 as string }));
      return b64 as string;
    } catch (_) { return ''; }
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
        
        {/* Overlay hover */}
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

        {/* Overlay ativo */}
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