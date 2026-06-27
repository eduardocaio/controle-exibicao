// src/pages/SettingsPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, Image, Upload, Check, Camera } from 'lucide-react';

interface SettingsPageProps {
  onBack: () => void;
}

function SettingsPage({ onBack }: SettingsPageProps) {
  const [currentImage, setCurrentImage] = useState<string>('');
  const [hasCustomImage, setHasCustomImage] = useState(false);
  const [success, setSuccess] = useState(false);
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [pinSuccess, setPinSuccess] = useState(false);

  useEffect(() => {
    loadCurrentImage();
    loadPin();
  }, []);

  const loadCurrentImage = async () => {
    try {
      const base64 = await invoke('get_default_image');
      setCurrentImage(base64 as string);
      const path = await invoke('get_texto_do_ano_path');
      setHasCustomImage(!!(path as string));
    } catch (e) {
      console.error('Erro ao carregar imagem:', e);
    }
  };

  const loadPin = async () => {
    try {
      const savedPin = await invoke('get_pin');
      setCurrentPin(savedPin as string);
      setPin(savedPin as string);
    } catch (_) {}
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
    } catch (e) {
      console.error('Erro ao definir imagem:', e);
    }
  };

  const handleResetToDefault = async () => {
    if (!confirm('Voltar para a imagem padrão?')) return;
    try {
      await invoke('reset_texto_do_ano');
      setHasCustomImage(false);
      await loadCurrentImage();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      console.error('Erro ao restaurar:', e);
      alert('Erro ao restaurar imagem padrão.');
    }
  };

  const handleSavePin = async () => {
    try {
      await invoke('set_pin', { pin });
      setCurrentPin(pin);
      setPinSuccess(true);
      setTimeout(() => setPinSuccess(false), 3000);
    } catch (e) {
      console.error('Erro ao salvar PIN:', e);
    }
  };

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '2rem' }}>
      
      {/* Cabeçalho */}
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem',
        background: '#edf2f7', color: '#4a5568', border: 'none', borderRadius: '10px',
        cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', marginBottom: '2rem'
      }}>
        <ChevronLeft size={18} />
        Voltar
      </button>

      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.5rem', color: '#1a1a2e' }}>
        ⚙️ Configurações
      </h1>
      <p style={{ color: '#718096', marginBottom: '2rem', fontSize: '0.95rem' }}>
        Personalize as configurações do sistema
      </p>

      {/* Seção: Texto do Ano */}
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem',
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: '42px', height: '42px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Camera size={20} color="white" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#1a1a2e' }}>Texto do Ano</h2>
            <p style={{ fontSize: '0.85rem', color: '#718096', margin: '2px 0 0 0' }}>
              Imagem exibida quando nenhuma apresentação está ativa
            </p>
          </div>
        </div>

        {/* Preview */}
        <div style={{
          width: '100%', height: '200px', borderRadius: '12px', overflow: 'hidden',
          background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '1.25rem', border: '2px solid #e2e8f0'
        }}>
          {currentImage ? (
            <img src={currentImage} alt="Texto do Ano atual" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ textAlign: 'center', color: '#718096' }}>
              <Image size={48} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
              <p style={{ fontSize: '0.9rem' }}>Nenhuma imagem definida</p>
            </div>
          )}
        </div>

        {/* Status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem',
          padding: '0.5rem 0.75rem', borderRadius: '8px',
          background: hasCustomImage ? '#f0fff4' : '#fffbeb',
          fontSize: '0.85rem', color: hasCustomImage ? '#22543d' : '#744210'
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: hasCustomImage ? '#48bb78' : '#ecc94b', display: 'inline-block' }} />
          {hasCustomImage ? 'Imagem personalizada definida' : 'Usando imagem padrão do sistema'}
        </div>

        {/* Botões */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button onClick={handleChangeImage} style={{
            padding: '0.7rem 1.3rem', background: success ? '#48bb78' : '#667eea', color: 'white',
            border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 600,
            fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s'
          }}>
            {success ? <Check size={18} /> : <Upload size={18} />}
            {success ? 'Imagem atualizada!' : 'Escolher imagem...'}
          </button>
          {hasCustomImage && (
            <button onClick={handleResetToDefault} style={{
              padding: '0.7rem 1.3rem', background: '#edf2f7', color: '#4a5568',
              border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 600,
              fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}>
              Restaurar padrão
            </button>
          )}
        </div>
      </div>

      {/* Seção: PIN de Segurança */}
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '1.5rem',
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: '42px', height: '42px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            🔒
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#1a1a2e' }}>PIN de Segurança</h2>
            <p style={{ fontSize: '0.85rem', color: '#718096', margin: '2px 0 0 0' }}>
              Código para conectar o tablet ao sistema
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            placeholder="Novo PIN (deixe vazio para remover)" maxLength={6}
            style={{ padding: '0.7rem 1rem', borderRadius: '10px', border: '2px solid #e2e8f0', fontSize: '1rem', width: '200px', outline: 'none' }}
            onKeyPress={(e) => e.key === 'Enter' && handleSavePin()}
          />
          <button onClick={handleSavePin} style={{
            padding: '0.7rem 1.3rem', background: pinSuccess ? '#48bb78' : '#667eea', color: 'white',
            border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 600,
            fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s'
          }}>
            {pinSuccess ? <Check size={18} /> : '💾'}
            {pinSuccess ? 'Salvo!' : 'Salvar PIN'}
          </button>
        </div>

        {currentPin ? (
          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#718096' }}>
            PIN atual: {currentPin.replace(/./g, '•')}
          </p>
        ) : (
          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#ecc94b' }}>
            ⚠️ Nenhum PIN definido. O tablet pode conectar sem senha.
          </p>
        )}
      </div>

    </div>
  );
}

export default SettingsPage;