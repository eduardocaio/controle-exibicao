import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/useAppStore';
import { Plus, Edit2, Trash2, X, Check, Presentation, Image } from 'lucide-react';

function AdminPage() {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  const presentations = useAppStore((state) => state.presentations);
  const setPresentations = useAppStore((state) => state.setPresentations);
  const addPresentation = useAppStore((state) => state.addPresentation);
  const removePresentation = useAppStore((state) => state.removePresentation);
  const updatePresentationName = useAppStore((state) => state.updatePresentationName);

  const loadState = async () => {
    try {
      const stateStr = await invoke('get_app_state');
      const state = JSON.parse(stateStr as string);
      setPresentations(state.presentations);
    } catch (error) {
      console.error('Erro ao carregar estado:', error);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const result = await invoke('create_presentation', { name: newName });
      const presentation = JSON.parse(result as string);
      addPresentation(presentation);
      setNewName('');
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta apresentação?')) return;
    try {
      await invoke('delete_presentation', { id });
      removePresentation(id);
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handleStartEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await invoke('edit_presentation_name', { id: editingId, newName: editName });
      updatePresentationName(editingId, editName);
      setEditingId(null);
      setEditName('');
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent, action: 'create' | 'edit') => {
    if (e.key === 'Enter') {
      if (action === 'create') handleCreate();
      else handleSaveEdit();
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      padding: '2rem',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '900px',
        backgroundColor: 'white',
        borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '2rem',
          color: 'white'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Presentation size={32} />
            <div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: '700', margin: 0 }}>
                Controle de Exibição
              </h1>
              <p style={{ opacity: 0.9, marginTop: '0.3rem', fontSize: '0.95rem' }}>
                Gerencie suas apresentações de forma simples e rápida
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '2rem' }}>
          {/* Criar Nova Apresentação */}
          <div style={{
            backgroundColor: '#f8f9ff',
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '2rem',
            border: '2px dashed #667eea'
          }}>
            <h2 style={{
              fontSize: '1.1rem',
              fontWeight: '600',
              color: '#667eea',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <Plus size={20} />
              Nova Apresentação
            </h2>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyPress={(e) => handleKeyPress(e, 'create')}
                placeholder="Digite o nome da apresentação..."
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  fontSize: '1rem',
                  border: '2px solid #e0e0e0',
                  borderRadius: '12px',
                  outline: 'none',
                  transition: 'border-color 0.3s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#667eea'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
              />
              <button
                onClick={handleCreate}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'transform 0.2s, background-color 0.3s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.backgroundColor = '#5a67d8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '#667eea';
                }}
              >
                <Plus size={18} />
                Criar
              </button>
            </div>
          </div>

          {/* Lista de Apresentações */}
          <div>
            <h2 style={{
              fontSize: '1.1rem',
              fontWeight: '600',
              color: '#333',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <Image size={20} />
              Minhas Apresentações
              <span style={{
                backgroundColor: '#667eea',
                color: 'white',
                padding: '0.2rem 0.6rem',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: '500',
                marginLeft: '0.5rem'
              }}>
                {presentations.length}
              </span>
            </h2>

            {presentations.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '3rem 2rem',
                color: '#999'
              }}>
                <Presentation size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                <p style={{ fontSize: '1.1rem' }}>Nenhuma apresentação criada ainda</p>
                <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                  Crie sua primeira apresentação usando o campo acima
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {presentations.map((pres: any) => (
                  <div
                    key={pres.id}
                    style={{
                      backgroundColor: '#fafafa',
                      borderRadius: '12px',
                      padding: '1rem 1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      border: '1px solid #eee',
                      transition: 'box-shadow 0.3s, transform 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {editingId === pres.id ? (
                      <div style={{ display: 'flex', gap: '0.5rem', flex: 1, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyPress={(e) => handleKeyPress(e, 'edit')}
                          style={{
                            flex: 1,
                            padding: '0.6rem 0.75rem',
                            fontSize: '1rem',
                            border: '2px solid #667eea',
                            borderRadius: '8px',
                            outline: 'none'
                          }}
                          autoFocus
                        />
                        <button
                          onClick={handleSaveEdit}
                          style={{
                            padding: '0.6rem',
                            backgroundColor: '#48bb78',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Salvar"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: '0.6rem',
                            backgroundColor: '#a0aec0',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Cancelar"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{
                            backgroundColor: '#667eea',
                            borderRadius: '8px',
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Presentation size={20} color="white" />
                          </div>
                          <div>
                            <strong style={{ fontSize: '1.05rem', color: '#333' }}>
                              {pres.name}
                            </strong>
                            <div style={{ fontSize: '0.85rem', color: '#999', marginTop: '2px' }}>
                              {pres.slides.length} slide{pres.slides.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => handleStartEdit(pres.id, pres.name)}
                            style={{
                              padding: '0.5rem 0.75rem',
                              backgroundColor: '#edf2f7',
                              color: '#4a5568',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              fontSize: '0.9rem',
                              transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#edf2f7'}
                          >
                            <Edit2 size={16} />
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(pres.id)}
                            style={{
                              padding: '0.5rem 0.75rem',
                              backgroundColor: '#fff5f5',
                              color: '#fc8181',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              fontSize: '0.9rem',
                              transition: 'background-color 0.2s, color 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#fed7d7';
                              e.currentTarget.style.color = '#f56565';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#fff5f5';
                              e.currentTarget.style.color = '#fc8181';
                            }}
                          >
                            <Trash2 size={16} />
                            Excluir
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminPage;