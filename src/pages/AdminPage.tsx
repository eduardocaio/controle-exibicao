// src/pages/AdminPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/useAppStore';
import { Plus, Edit2, Trash2, Presentation, Image, Upload, ChevronLeft, Play, Square, Monitor, BookOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import SettingsPage from './SettingsPage';

function AdminPage() {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [selectedPresentation, setSelectedPresentation] = useState<string | null>(null);
  const [imageCache, setImageCache] = useState<Record<string, string>>({});
  const [monitors, setMonitors] = useState<string[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number | null>(null);
  const [activePresentationId, setActivePresentationId] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<'sistema' | 'jw'>('sistema');
  const [showSettings, setShowSettings] = useState(false);

  const presentations = useAppStore((s) => s.presentations);
  const setPresentations = useAppStore((s) => s.setPresentations);
  const addPresentation = useAppStore((s) => s.addPresentation);
  const removePresentation = useAppStore((s) => s.removePresentation);
  const updatePresentationName = useAppStore((s) => s.updatePresentationName);
  const setPresentationSlides = useAppStore((s) => s.setPresentationSlides);

  useEffect(() => { (async () => { try { setMonitors(await invoke('get_monitors') as string[]); } catch (_) {} })(); }, []);
  useEffect(() => { loadState(); }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const s = JSON.parse(await invoke('get_display_state') as string);
        if (!s.is_blackout && s.current_filename) {
          setActiveSlideIndex(s.current_index);
          const pres = presentations.find(p => p.slides.some((sl: any, i: number) => i === s.current_index && sl.filename === s.current_filename));
          if (pres) setActivePresentationId(pres.id);
        } else { setActiveSlideIndex(null); setActivePresentationId(null); }
      } catch (_) {}
    };
    const i = setInterval(check, 500);
    return () => clearInterval(i);
  }, [presentations]);

  const loadImage = async (filename: string, isThumb = true) => {
    const key = `${filename}_${isThumb}`;
    if (imageCache[key]) return imageCache[key];
    try {
      const b64 = await invoke('get_image_base64', { filename, isThumb });
      setImageCache(p => ({ ...p, [key]: b64 as string }));
      return b64 as string;
    } catch (_) { return ''; }
  };

  const loadState = async () => { try { const s = JSON.parse(await invoke('get_app_state') as string); setPresentations(s.presentations); } catch (_) {} };
  const handleCreate = async () => { if (!newName.trim()) return; const r = await invoke('create_presentation', { name: newName }); addPresentation(JSON.parse(r as string)); setNewName(''); };
  const handleDelete = async (id: string) => { if (!confirm('Excluir?')) return; await invoke('delete_presentation', { id }); removePresentation(id); if (selectedPresentation === id) setSelectedPresentation(null); };
  const handleSaveEdit = async () => { if (!editingId || !editName.trim()) return; await invoke('edit_presentation_name', { id: editingId, newName: editName }); updatePresentationName(editingId, editName); setEditingId(null); setEditName(''); };
  const handleUpload = async (pid: string) => { const f = await open({ multiple: true, filters: [{ name: 'Imagens', extensions: ['jpg','jpeg','png','webp','gif','bmp'] }] }); if (!f) return; const paths = (Array.isArray(f)?f:[f]).map(x => typeof x === 'string' ? x : x.path); const r = await invoke('upload_images', { presentationId: pid, filePaths: paths }); setPresentationSlides(pid, JSON.parse(r as string).slides); };
  const handleDeleteSlide = async (pid: string, sid: string) => { await invoke('delete_slide', { presentationId: pid, slideId: sid }); loadState(); };

  const handleShow = async (pid: string, idx: number) => {
    await invoke('set_active_presentation', { presentationId: pid });
    await invoke('set_current_slide', { index: idx });
    await invoke('switch_to_sistema');
    setActiveSlideIndex(idx);
    setActivePresentationId(pid);
    setActiveApp('sistema');
  };

  const handleHide = async () => {
    await invoke('set_blackout', { value: true });
    await invoke('lower_display_window');
    setActiveSlideIndex(null);
    setActivePresentationId(null);
  };

  const handleSwitchToJW = async () => {
    await invoke('switch_to_jw_library');
    setActiveApp('jw');
  };

  const handleSwitchToSistema = async () => {
    await invoke('switch_to_sistema');
    setActiveApp('sistema');
  };

  useEffect(() => {
    const init = async () => {
      try { await invoke('show_display_window'); } catch (_) {}
    };
    init();
  }, []);

  const handlePrev = async () => { await invoke('prev_slide'); };
  const handleNext = async () => { await invoke('next_slide'); };

  const selectedPres = presentations.find(p => p.id === selectedPresentation);

  const cardStyle = (isActive: boolean): React.CSSProperties => ({
    background: '#fff', borderRadius: '16px', overflow: 'hidden',
    border: isActive ? '2px solid #48bb78' : '1px solid #e2e8f0',
    boxShadow: isActive ? '0 0 0 3px rgba(72,187,120,0.2), 0 8px 32px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
    transform: isActive ? 'scale(1.01)' : 'scale(1)', transition: 'all 0.2s ease'
  });

  const btnPrimary: React.CSSProperties = { padding:'0.6rem 1.2rem', background:'#667eea', color:'#fff', border:'none', borderRadius:'10px', cursor:'pointer', fontWeight:600, fontSize:'0.9rem', display:'flex', alignItems:'center', gap:'0.4rem', transition:'all 0.2s' };
  const btnDanger: React.CSSProperties = { ...btnPrimary, background:'#e53e3e' };
  const btnGhost: React.CSSProperties = { ...btnPrimary, background:'#edf2f7', color:'#4a5568' };

  // ===== SE ESTIVER NAS CONFIGURAÇÕES =====
  if (showSettings) {
    return (
      <div style={{ minHeight:'100vh', padding:'2rem', background:'#f7fafc' }}>
        <SettingsPage onBack={() => setShowSettings(false)} />
      </div>
    );
  }

  // ===== TELA PRINCIPAL =====
  return (
    <div style={{ minHeight:'100vh', padding:'2rem', display:'flex', justifyContent:'center', background:'#f7fafc' }}>
      <div style={{ width:'100%', maxWidth:'1100px' }}>
        
        {/* Header */}
        <div style={{ background:'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', borderRadius:'20px', padding:'2rem 2.5rem', color:'#fff', marginBottom:'2rem', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'1rem', boxShadow:'0 10px 40px rgba(0,0,0,0.15)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
            <div style={{ width:'48px', height:'48px', borderRadius:'14px', background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center' }}><Presentation size={24} /></div>
            <div>
              <h1 style={{ fontSize:'1.6rem', fontWeight:700, margin:0 }}>Controle de Exibição</h1>
              <p style={{ opacity:0.7, margin:0, fontSize:'0.85rem', marginTop:'2px' }}>Gerencie suas apresentações</p>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '1.2rem',
                transition: 'background 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              title="Configurações"
            >
              ⚙️
            </button>
          </div>
          
          <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
            <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
              {monitors.map((m,i) => (
                <span key={i} style={{ padding:'0.4rem 0.8rem', borderRadius:'20px', fontSize:'0.8rem', background: i===1?'rgba(72,187,120,0.3)':'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  <Monitor size={14} /> {m} {i===1?'(Projetor)':'(Principal)'}
                </span>
              ))}
              {activeSlideIndex !== null && (
                <span style={{ padding:'0.4rem 0.8rem', borderRadius:'20px', fontSize:'0.8rem', background:'rgba(72,187,120,0.4)', display:'flex', alignItems:'center', gap:'0.4rem' }}>🟢 Em exibição</span>
              )}
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'rgba(255,255,255,0.08)', padding:'0.4rem', borderRadius:'10px' }}>
              <span style={{ fontSize:'0.8rem', opacity:0.8, paddingLeft:'0.5rem' }}>📺 Projetor:</span>
              <button
                onClick={handleSwitchToJW}
                style={{
                  padding:'0.45rem 0.9rem',
                  borderRadius:'8px',
                  border:'none',
                  cursor:'pointer',
                  fontWeight:600,
                  fontSize:'0.8rem',
                  background: activeApp === 'jw' ? '#48bb78' : 'rgba(255,255,255,0.1)',
                  color:'white',
                  transition:'all 0.2s',
                  display:'flex',
                  alignItems:'center',
                  gap:'0.3rem'
                }}
              >
                <BookOpen size={14} /> JW Library
                {activeApp === 'jw' && ' ✓'}
              </button>
              <button
                onClick={handleSwitchToSistema}
                style={{
                  padding:'0.45rem 0.9rem',
                  borderRadius:'8px',
                  border:'none',
                  cursor:'pointer',
                  fontWeight:600,
                  fontSize:'0.8rem',
                  background: activeApp === 'sistema' ? '#667eea' : 'rgba(255,255,255,0.1)',
                  color:'white',
                  transition:'all 0.2s',
                  display:'flex',
                  alignItems:'center',
                  gap:'0.3rem'
                }}
              >
                <Image size={14} /> Imagens
                {activeApp === 'sistema' && ' ✓'}
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ background:'#fff', borderRadius:'20px', padding:'2rem', boxShadow:'0 4px 24px rgba(0,0,0,0.04)' }}>
          {!selectedPresentation ? (
            <>
              <div style={{ background:'#f7fafc', borderRadius:'16px', padding:'1.5rem', marginBottom:'2rem', border:'2px dashed #cbd5e0' }}>
                <h2 style={{ fontSize:'1rem', fontWeight:600, color:'#4a5568', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}><Plus size={18} /> Nova Apresentação</h2>
                <div style={{ display:'flex', gap:'0.75rem' }}>
                  <input value={newName} onChange={e => setNewName(e.target.value)} onKeyPress={e => e.key==='Enter' && handleCreate()} placeholder="Nome da apresentação..." style={{ flex:1, padding:'0.75rem 1rem', fontSize:'1rem', border:'2px solid #e2e8f0', borderRadius:'12px', outline:'none' }} />
                  <button onClick={handleCreate} style={btnPrimary}><Plus size={18} /> Criar</button>
                </div>
              </div>
              <h2 style={{ fontSize:'1rem', fontWeight:600, color:'#4a5568', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                <Image size={18} /> Minhas Apresentações
                <span style={{ background:'#667eea', color:'#fff', padding:'0.15rem 0.6rem', borderRadius:'20px', fontSize:'0.8rem' }}>{presentations.length}</span>
              </h2>
              {presentations.length === 0 ? (
                <div style={{ textAlign:'center', padding:'3rem', color:'#a0aec0' }}>
                  <Presentation size={40} style={{ opacity:0.3, marginBottom:'1rem' }} />
                  <p>Nenhuma apresentação criada</p>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  {presentations.map((pres: any) => (
                    <div key={pres.id} onClick={() => setSelectedPresentation(pres.id)}
                      style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'1rem 1.25rem', borderRadius:'14px', cursor:'pointer', background:'#fafafa', border:'1px solid #eee', transition:'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background='#f0f0ff'; e.currentTarget.style.borderColor='#667eea'; }}
                      onMouseLeave={e => { e.currentTarget.style.background='#fafafa'; e.currentTarget.style.borderColor='#eee'; }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
                        <div style={{ width:'40px', height:'40px', borderRadius:'10px', background:'#667eea', display:'flex', alignItems:'center', justifyContent:'center' }}><Presentation size={18} color="white" /></div>
                        <div><strong>{pres.name}</strong><br/><span style={{ fontSize:'0.8rem', color:'#999' }}>{pres.slides.length} slides</span></div>
                      </div>
                      <div style={{ display:'flex', gap:'0.4rem' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditingId(pres.id); setEditName(pres.name); }} style={btnGhost}><Edit2 size={15} /></button>
                        <button onClick={() => handleDelete(pres.id)} style={{ ...btnGhost, color:'#e53e3e', background:'#fff5f5' }}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div>
              <button onClick={() => { setSelectedPresentation(null); setActiveSlideIndex(null); }} style={{ ...btnGhost, marginBottom:'1.5rem' }}><ChevronLeft size={18} /> Voltar</button>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem', flexWrap:'wrap', gap:'1rem' }}>
                <h2 style={{ fontSize:'1.4rem', fontWeight:700, margin:0 }}>{selectedPres?.name}</h2>
                <button onClick={() => handleUpload(selectedPresentation!)} style={btnPrimary}><Upload size={16} /> Adicionar Imagens</button>
              </div>
              {activeSlideIndex !== null && activePresentationId === selectedPresentation && (
                <div style={{ background:'#f0fff4', borderRadius:'14px', padding:'1rem 1.25rem', marginBottom:'1.5rem', border:'1px solid #c6f6d5', display:'flex', alignItems:'center', justifyContent:'center', gap:'1rem', flexWrap:'wrap' }}>
                  <span style={{ color:'#22543d', fontWeight:600, fontSize:'0.9rem' }}>🟢 Slide {activeSlideIndex+1} de {selectedPres?.slides.length}</span>
                  <button onClick={handlePrev} style={{ ...btnPrimary, background:'#48bb78' }}>← Anterior</button>
                  <button onClick={handleNext} style={{ ...btnPrimary, background:'#48bb78' }}>Próximo →</button>
                  <button onClick={handleHide} style={btnDanger}><Square size={14} /> Parar Exibição</button>
                </div>
              )}
              {!selectedPres?.slides.length ? (
                <div onClick={() => handleUpload(selectedPresentation!)} style={{ textAlign:'center', padding:'4rem', background:'#f7fafc', borderRadius:'16px', border:'2px dashed #cbd5e0', cursor:'pointer' }}>
                  <Upload size={48} style={{ opacity:0.3, marginBottom:'1rem', color:'#667eea' }} />
                  <p style={{ color:'#666', fontWeight:500 }}>Nenhuma imagem adicionada</p>
                  <p style={{ color:'#999', fontSize:'0.85rem' }}>Clique ou arraste imagens para adicionar</p>
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'1rem' }}>
                  {selectedPres.slides.map((slide: any, idx: number) => {
                    const isActive = activeSlideIndex === idx && activePresentationId === selectedPresentation;
                    return (
                      <div key={slide.id} style={cardStyle(isActive)}>
                        <SlideThumb filename={slide.filename} loadImage={loadImage} imageCache={imageCache} />
                        <div style={{ padding:'0.75rem 1rem' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
                            <span style={{ fontSize:'0.85rem', fontWeight:600, color: isActive ? '#22543d' : '#4a5568' }}>Slide {idx+1} {isActive && '🟢'}</span>
                            <button onClick={() => handleDeleteSlide(selectedPresentation!, slide.id)} style={{ background:'none', border:'none', color:'#cbd5e0', cursor:'pointer', padding:'2px' }}><Trash2 size={14} /></button>
                          </div>
                          <button onClick={() => isActive ? handleHide() : handleShow(selectedPresentation!, idx)}
                            style={{ ...(isActive ? btnDanger : btnPrimary), width:'100%', justifyContent:'center' }}>
                            {isActive ? <><Square size={14} /> Parar</> : <><Play size={14} /> Exibir no Projetor</>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SlideThumb({ filename, loadImage, imageCache }: any) {
  const [src, setSrc] = useState('');
  const key = `${filename}_true`;
  useEffect(() => { if (imageCache[key]) setSrc(imageCache[key]); else loadImage(filename, true).then(setSrc); }, [filename]);
  return (
    <div style={{ height:'130px', background:'#edf2f7', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
      {src ? <img src={src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <Image size={28} style={{ opacity:0.3, color:'#999' }} />}
    </div>
  );
}

export default AdminPage;