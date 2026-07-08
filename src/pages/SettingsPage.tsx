// src/pages/SettingsPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, Upload, Check, Image, RotateCcw, Clock, X, Plus, Video } from 'lucide-react';

interface SettingsPageProps {
  onBack: () => void;
}

function SettingsPage({ onBack }: SettingsPageProps) {
  const [currentImage, setCurrentImage] = useState<string>('');
  const [hasCustomImage, setHasCustomImage] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Estados do agendamento
  const [scheduleConfig, setScheduleConfig] = useState<any>(null);
  const [newTime, setNewTime] = useState({ hour: 19, minute: 30 });
  const [scheduleSuccess, setScheduleSuccess] = useState(false);

  const [zoomConfig, setZoomConfig] = useState({ meeting_id: '', passcode: '', bot_name: 'Congregação (Bot)' });
  const [zoomSaved, setZoomSaved] = useState(false);
  
  useEffect(() => {
    const loadZoomConfig = async () => {
      try {
        const config = JSON.parse(await invoke('zoom_get_config') as string);
        setZoomConfig(config);
      } catch (e) { /* ignore */ }
    };
    loadZoomConfig();
  }, []);

  const handleSaveZoomConfig = async () => {
    try {
      // 🔥 Remover espaços do ID da reunião
      const cleanedConfig = {
        ...zoomConfig,
        meeting_id: zoomConfig.meeting_id.replace(/\s/g, '')
      };
      setZoomConfig(cleanedConfig);
      await invoke('zoom_save_config', { configJson: JSON.stringify(cleanedConfig) });
      setZoomSaved(true);
      setTimeout(() => setZoomSaved(false), 3000);
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message);
    }
  };

  // 🔥 Limpar espaços automaticamente enquanto digita
  const handleMeetingIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/\s/g, '');
    setZoomConfig(prev => ({ ...prev, meeting_id: cleaned }));
  };

  useEffect(() => { 
    loadCurrentImage(); 
    loadScheduleConfig();
  }, []);

  const loadCurrentImage = async () => {
    try {
      const base64 = await invoke('get_default_image');
      setCurrentImage(base64 as string);
      const path = await invoke('get_texto_do_ano_path');
      setHasCustomImage(!!(path as string));
    } catch (e) { console.error('Erro:', e); }
  };

  const loadScheduleConfig = async () => {
    try {
      const config = JSON.parse(await invoke('get_schedule_config') as string);
      setScheduleConfig(config);
    } catch (e) {
      console.error('Erro ao carregar configuração de horários:', e);
    }
  };

  const handleChangeImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
      });
      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : (selected as any).path;
      await invoke('set_texto_do_ano', { filePath });
      setSuccess(true);
      setHasCustomImage(true);
      await loadCurrentImage();
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) { console.error('Erro:', e); }
  };

  const handleResetToDefault = async () => {
    if (!confirm('Restaurar imagem padrão?')) return;
    try {
      await invoke('reset_texto_do_ano');
      setHasCustomImage(false);
      await loadCurrentImage();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) { console.error('Erro:', e); }
  };

  const handleToggleDay = async (dayIndex: number) => {
    if (!scheduleConfig) return;
    const newConfig = { ...scheduleConfig };
    newConfig.days = [...newConfig.days];
    newConfig.days[dayIndex] = {
      ...newConfig.days[dayIndex],
      enabled: !newConfig.days[dayIndex].enabled
    };
    setScheduleConfig(newConfig);
    await invoke('save_schedule_config', { configJson: JSON.stringify(newConfig) });
    setScheduleSuccess(true);
    setTimeout(() => setScheduleSuccess(false), 2000);
  };

  const handleAddTime = async (dayIndex: number) => {
    if (!scheduleConfig) return;
    const newConfig = { ...scheduleConfig };
    newConfig.days = [...newConfig.days];
    const day = { ...newConfig.days[dayIndex] };
    day.times = [...day.times, {
      id: crypto.randomUUID(),
      hour: newTime.hour,
      minute: newTime.minute,
    }];
    day.times.sort((a: any, b: any) => 
      a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute
    );
    newConfig.days[dayIndex] = day;
    setScheduleConfig(newConfig);
    await invoke('save_schedule_config', { configJson: JSON.stringify(newConfig) });
    setScheduleSuccess(true);
    setTimeout(() => setScheduleSuccess(false), 2000);
  };

  const handleRemoveTime = async (dayIndex: number, timeId: string) => {
    if (!scheduleConfig) return;
    const newConfig = { ...scheduleConfig };
    newConfig.days = [...newConfig.days];
    const day = { ...newConfig.days[dayIndex] };
    day.times = day.times.filter((t: any) => t.id !== timeId);
    newConfig.days[dayIndex] = day;
    setScheduleConfig(newConfig);
    await invoke('save_schedule_config', { configJson: JSON.stringify(newConfig) });
    setScheduleSuccess(true);
    setTimeout(() => setScheduleSuccess(false), 2000);
  };

  return (
    <div style={{ 
      maxWidth: '640px', 
      margin: '0 auto', 
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      
      {/* Cabeçalho */}
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', 
        padding: '0.5rem 1rem',
        background: 'rgba(255,255,255,0.04)', 
        color: '#8b949e', 
        border: '1px solid rgba(255,255,255,0.06)', 
        borderRadius: '8px',
        cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', 
        marginBottom: '2rem',
        transition: 'all 0.15s'
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>
        <ChevronLeft size={16} />
        Voltar
      </button>

      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.3rem', color: '#e1e4e8', letterSpacing: '-0.3px' }}>
          Configurações
        </h1>
        <p style={{ color: '#8b949e', margin: 0, fontSize: '0.85rem' }}>
          Personalize a imagem exibida e configure os horários das reuniões
        </p>
      </div>

      {/* Seção: Texto do Ano */}
      <div style={{
        background: '#111820', 
        borderRadius: '14px', 
        padding: '1.5rem', 
        border: '1px solid rgba(255,255,255,0.04)',
        marginBottom: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(102,126,234,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Image size={20} color="#667eea" />
          </div>
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#e1e4e8' }}>
              Texto do Ano
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#8b949e', margin: '2px 0 0 0' }}>
              Imagem exibida quando nenhuma imagem está ativa no projetor
            </p>
          </div>
        </div>

        {/* Preview */}
        <div style={{
          width: '100%', height: '200px', borderRadius: '10px', overflow: 'hidden',
          background: '#080c10', display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '1.25rem', border: '1px solid rgba(255,255,255,0.05)'
        }}>
          {currentImage ? (
            <img src={currentImage} alt="Texto do Ano" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div style={{ 
                width: '40px', height: '40px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.03)', display: 'flex', 
                alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem' 
              }}>
                <Image size={20} color="rgba(255,255,255,0.15)" />
              </div>
              <p style={{ fontSize: '0.8rem', color: '#484f58' }}>Nenhuma imagem</p>
            </div>
          )}
        </div>

        {/* Status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem',
          padding: '0.5rem 0.75rem', borderRadius: '8px',
          background: hasCustomImage ? 'rgba(52,211,153,0.06)' : 'rgba(234,179,8,0.06)',
          border: hasCustomImage ? '1px solid rgba(52,211,153,0.15)' : '1px solid rgba(234,179,8,0.15)',
          fontSize: '0.78rem', 
          color: hasCustomImage ? '#34d399' : '#eab308'
        }}>
          <span style={{ 
            width: '6px', height: '6px', borderRadius: '50%', 
            background: hasCustomImage ? '#34d399' : '#eab308',
            display: 'inline-block' 
          }} />
          {hasCustomImage ? 'Imagem personalizada definida' : 'Usando imagem padrão do sistema'}
        </div>

        {/* Botões */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button onClick={handleChangeImage} style={{
            padding: '0.6rem 1.1rem', 
            background: success ? 'rgba(52,211,153,0.12)' : 'rgba(102,126,234,0.12)', 
            color: success ? '#34d399' : '#667eea',
            border: success ? '1px solid rgba(52,211,153,0.25)' : '1px solid rgba(102,126,234,0.25)',
            borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
            fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem', 
            transition: 'all 0.15s'
          }}
          onMouseEnter={e => { e.currentTarget.style.background = success ? 'rgba(52,211,153,0.18)' : 'rgba(102,126,234,0.18)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = success ? 'rgba(52,211,153,0.12)' : 'rgba(102,126,234,0.12)'; }}>
            {success ? <Check size={16} /> : <Upload size={16} />}
            {success ? 'Atualizada' : 'Escolher imagem'}
          </button>
          {hasCustomImage && (
            <button onClick={handleResetToDefault} style={{
              padding: '0.6rem 1.1rem', 
              background: 'rgba(255,255,255,0.03)', 
              color: '#8b949e',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
              fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
              transition: 'all 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#e1e4e8'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#8b949e'; }}>
              <RotateCcw size={16} />
              Restaurar padrão
            </button>
          )}
        </div>
      </div>

      {/* Seção: Agendamento de Reuniões */}
      <div style={{
        background: '#111820', 
        borderRadius: '14px', 
        padding: '1.5rem', 
        border: '1px solid rgba(255,255,255,0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(245,158,11,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Clock size={20} color="#f59e0b" />
          </div>
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#e1e4e8' }}>
              Agendamento de Reuniões
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#8b949e', margin: '2px 0 0 0' }}>
              Configure os horários para início automático do cronômetro regressivo (5 min antes)
            </p>
          </div>
        </div>

        {/* Status do salvamento */}
        {scheduleSuccess && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem',
            padding: '0.5rem 0.75rem', borderRadius: '8px',
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.15)',
            fontSize: '0.78rem', color: '#34d399'
          }}>
            <Check size={14} />
            Configuração salva com sucesso
          </div>
        )}

        {/* Adicionar novo horário */}
        <div style={{
          display: 'flex', gap: '0.5rem', alignItems: 'center',
          padding: '0.75rem', background: 'rgba(255,255,255,0.02)',
          borderRadius: '8px', marginBottom: '1rem', flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '0.78rem', color: '#8b949e' }}>Novo horário:</span>
          <input
            type="number"
            min={0}
            max={23}
            value={newTime.hour}
            onChange={(e) => setNewTime(prev => ({ ...prev, hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) }))}
            style={{
              width: '55px', padding: '0.4rem 0.3rem',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px', color: '#e1e4e8',
              textAlign: 'center', fontSize: '0.85rem', outline: 'none'
            }}
          />
          <span style={{ color: '#8b949e', fontWeight: 600 }}>:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={newTime.minute}
            onChange={(e) => setNewTime(prev => ({ ...prev, minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) }))}
            style={{
              width: '55px', padding: '0.4rem 0.3rem',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px', color: '#e1e4e8',
              textAlign: 'center', fontSize: '0.85rem', outline: 'none'
            }}
          />
          <span style={{ fontSize: '0.7rem', color: '#484f58' }}>
            (selecione o dia abaixo e clique em + Adicionar)
          </span>
        </div>

        {/* Lista de dias */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {scheduleConfig?.days.map((day: any, dayIndex: number) => (
            <div key={day.day} style={{
              padding: '0.75rem',
              background: day.enabled ? 'rgba(245,158,11,0.03)' : 'transparent',
              borderRadius: '8px',
              border: day.enabled ? '1px solid rgba(245,158,11,0.1)' : '1px solid rgba(255,255,255,0.03)',
              transition: 'all 0.15s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <button
                    onClick={() => handleToggleDay(dayIndex)}
                    style={{
                      width: '28px', height: '28px', borderRadius: '6px',
                      border: day.enabled ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.08)',
                      background: day.enabled ? '#f59e0b' : 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s', flexShrink: 0
                    }}
                    title={day.enabled ? 'Desabilitar' : 'Habilitar'}
                  >
                    {day.enabled && <Check size={13} color="#000" />}
                  </button>
                  <span style={{ 
                    fontSize: '0.82rem', fontWeight: 600,
                    color: day.enabled ? '#e1e4e8' : '#484f58'
                  }}>
                    {day.label}
                  </span>
                  {day.enabled && (
                    <span style={{
                      padding: '0.1rem 0.4rem', borderRadius: '10px',
                      background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
                      fontSize: '0.6rem', fontWeight: 600
                    }}>
                      {day.times.length} horário{day.times.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                
                <button
                  onClick={() => handleAddTime(dayIndex)}
                  disabled={!day.enabled}
                  style={{
                    padding: '0.3rem 0.65rem',
                    background: day.enabled ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                    color: day.enabled ? '#f59e0b' : '#484f58',
                    border: '1px solid ' + (day.enabled ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.04)'),
                    borderRadius: '6px', cursor: day.enabled ? 'pointer' : 'not-allowed',
                    fontSize: '0.7rem', fontWeight: 600,
                    opacity: day.enabled ? 1 : 0.5,
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => {
                    if (day.enabled) e.currentTarget.style.background = 'rgba(245,158,11,0.2)';
                  }}
                  onMouseLeave={e => {
                    if (day.enabled) e.currentTarget.style.background = 'rgba(245,158,11,0.1)';
                  }}
                >
                  <Plus size={12} />
                  Adicionar
                </button>
              </div>

              {/* Horários configurados */}
              {day.enabled && day.times.length > 0 && (
                <div style={{ 
                  display: 'flex', gap: '0.4rem', flexWrap: 'wrap', 
                  marginTop: '0.6rem', paddingLeft: '2.2rem'
                }}>
                  {day.times.map((time: any) => (
                    <div key={time.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.35rem',
                      padding: '0.3rem 0.55rem',
                      background: 'rgba(245,158,11,0.08)',
                      borderRadius: '6px',
                      fontSize: '0.78rem', color: '#fbbf24',
                      fontWeight: 600
                    }}>
                      <Clock size={11} />
                      <span>{String(time.hour).padStart(2, '0')}:{String(time.minute).padStart(2, '0')}</span>
                      <button
                        onClick={() => handleRemoveTime(dayIndex, time.id)}
                        style={{
                          background: 'none', border: 'none',
                          color: '#f87171', cursor: 'pointer',
                          padding: '1px', display: 'flex',
                          marginLeft: '2px'
                        }}
                        title="Remover horário"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {day.enabled && day.times.length === 0 && (
                <p style={{ fontSize: '0.7rem', color: '#484f58', marginTop: '0.5rem', paddingLeft: '2.2rem' }}>
                  Nenhum horário configurado para este dia
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Dica */}
        <div style={{
          marginTop: '1rem', padding: '0.6rem 0.75rem',
          background: 'rgba(59,130,246,0.04)',
          border: '1px solid rgba(59,130,246,0.08)',
          borderRadius: '8px',
          fontSize: '0.72rem', color: '#60a5fa',
          lineHeight: '1.4'
        }}>
          <strong>Como funciona:</strong> O sistema verificará automaticamente os horários configurados para o dia atual. 
          Faltando 5 minutos para o próximo horário, um cronômetro regressivo será iniciado. 
          Ao parar o cronômetro, o sistema alternará automaticamente para o JW Library.
        </div>
      </div>
      
      {/* Seção: Zoom Bot */}
      <div style={{
        background: '#111820', 
        borderRadius: '14px', 
        padding: '1.5rem', 
        border: '1px solid rgba(255,255,255,0.04)',
        marginTop: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(52,211,153,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Video size={20} color="#34d399" />
          </div>
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#e1e4e8' }}>
              Zoom Bot
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#8b949e', margin: '2px 0 0 0' }}>
              Configuração do bot para monitorar mãos levantadas na reunião Zoom
            </p>
          </div>
        </div>

        {zoomSaved && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem',
            padding: '0.5rem 0.75rem', borderRadius: '8px',
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.15)',
            fontSize: '0.78rem', color: '#34d399'
          }}>
            <Check size={14} />
            Configuração salva com sucesso
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8b949e', display: 'block', marginBottom: '0.3rem' }}>
              ID da Reunião
            </label>
            <input
              type="text"
              value={zoomConfig.meeting_id}
              onChange={handleMeetingIdChange}
              placeholder="Digite o ID da reunião (somente números)"
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                color: '#e1e4e8',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
            <p style={{ fontSize: '0.7rem', color: '#484f58', marginTop: '0.25rem' }}>
              O ID da reunião fica no link da reunião Zoom (ex: zoom.us/j/123456789)
            </p>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8b949e', display: 'block', marginBottom: '0.3rem' }}>
              Senha da Reunião
            </label>
            <input
              type="password"
              value={zoomConfig.passcode}
              onChange={(e) => setZoomConfig(prev => ({ ...prev, passcode: e.target.value }))}
              placeholder="Digite a senha da reunião (se houver)"
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                color: '#e1e4e8',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
            <p style={{ fontSize: '0.7rem', color: '#484f58', marginTop: '0.25rem' }}>
              A senha da reunião é fornecida pelo organizador
            </p>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8b949e', display: 'block', marginBottom: '0.3rem' }}>
              Nome do Bot
            </label>
            <input
              type="text"
              value={zoomConfig.bot_name}
              onChange={(e) => setZoomConfig(prev => ({ ...prev, bot_name: e.target.value }))}
              placeholder="Ex: Congregação Central (Bot)"
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                color: '#e1e4e8',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
            <p style={{ fontSize: '0.7rem', color: '#484f58', marginTop: '0.25rem' }}>
              Substitua "Congregação" pelo nome da sua congregação
            </p>
          </div>

          <button
            onClick={handleSaveZoomConfig}
            style={{
              padding: '0.6rem',
              background: 'rgba(52,211,153,0.12)',
              color: '#34d399',
              border: '1px solid rgba(52,211,153,0.2)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              transition: 'all 0.15s',
              marginTop: '0.5rem',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(52,211,153,0.2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(52,211,153,0.12)'}
          >
            Salvar Configuração
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;