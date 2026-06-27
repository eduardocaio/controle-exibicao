// src/pages/DisplayPage.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

function DisplayPage() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [defaultImage, setDefaultImage] = useState<string>('');

  useEffect(() => {
    (async () => {
      try { setDefaultImage(await invoke('get_default_image') as string); } catch (_) {}
    })();

    const check = async () => {
      try {
        const s = JSON.parse(await invoke('get_display_state') as string);
        if (!s.is_blackout && s.current_filename) {
          setImageSrc(await invoke('get_image_base64', { filename: s.current_filename, isThumb: false }) as string);
        } else {
          setImageSrc('');
        }
      } catch (_) {}
    };
    check();
    const i = setInterval(check, 300);
    return () => clearInterval(i);
  }, []);

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