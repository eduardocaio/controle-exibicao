// src/pages/SettingsPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, Upload, Check, Image, RotateCcw } from 'lucide-react';

interface SettingsPageProps {
  onBack: () => void;
}

function SettingsPage({ onBack }: SettingsPageProps) {
  const [currentImage, setCurrentImage] = useState<string>('');
  const [hasCustomImage, setHasCustomImage] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => { loadCurrentImage(); }, []);

  const loadCurrentImage = async () => {
    try {
      const base64 = await invoke('get_default_image');
      setCurrentImage(base64 as string);
      const path = await invoke('get_texto_do_ano_path');
      setHasCustomImage(!!(path as string));
    } catch (e) { console.error('Erro:', e); }
  };

  const handleChangeImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
      });
      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : selected.path;
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
          Personalize a imagem exibida na tela de exibição
        </p>
      </div>

      {/* Seção: Texto do Ano */}
      <div style={{
        background: '#111820', 
        borderRadius: '14px', 
        padding: '1.5rem', 
        border: '1px solid rgba(255,255,255,0.04)'
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
    </div>
  );
}

export default SettingsPage;