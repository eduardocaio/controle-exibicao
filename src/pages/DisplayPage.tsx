import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

function DisplayPage() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [defaultImage, setDefaultImage] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0); // Força recarregar

  // Escuta evento de atualização do texto do ano
  useEffect(() => {
    const unlisten = listen('texto-do-ano-atualizado', () => {
      setRefreshKey(prev => prev + 1);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const img = await invoke('get_default_image');
        setDefaultImage(img as string);
      } catch (_) {}
    })();

    const check = async () => {
      try {
        const s = JSON.parse(await invoke('get_display_state') as string);
        if (!s.is_blackout && s.current_filename) {
          const b64 = await invoke('get_image_base64', { filename: s.current_filename, isThumb: false });
          setImageSrc(b64 as string);
        } else {
          setImageSrc('');
        }
      } catch (_) {}
    };
    check();
    const i = setInterval(check, 300);
    return () => clearInterval(i);
  }, [refreshKey]);

  return (
    <div style={{ width:'100vw', height:'100vh', backgroundColor:'black', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', cursor:'none', userSelect:'none' }}>
      {imageSrc ? (
        <img src={imageSrc} alt="Slide" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', pointerEvents:'none' }} />
      ) : defaultImage ? (
        <img src={defaultImage} alt="Texto do Ano" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', pointerEvents:'none' }} />
      ) : (
        <div style={{ width:'100%', height:'100%', backgroundColor:'black' }} />
      )}
    </div>
  );
}

export default DisplayPage;