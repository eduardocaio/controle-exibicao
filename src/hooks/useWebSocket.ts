import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

export function useWebSocket(role: 'control' | 'display') {
  const wsRef = useRef<WebSocket | null>(null);
  const store = useAppStore();

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://localhost:20777/ws?role=${role}`);
      
      ws.onopen = () => {
        console.log('WebSocket conectado');
        ws.send(JSON.stringify({ action: 'request_state' }));
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };

      ws.onclose = () => {
        console.log('WebSocket desconectado, tentando reconectar...');
        setTimeout(connect, 1000);
      };

      wsRef.current = ws;
    };

    const handleMessage = (message: any) => {
      switch (message.type) {
        case 'state_update':
          store.setPresentations(message.payload.presentations);
          store.setActivePresentation(message.payload.activePresentation);
          store.setCurrentSlide(message.payload.currentSlideIndex);
          store.setBlackout(message.payload.isBlackout);
          break;
        case 'display_update':
          store.setCurrentSlide(message.payload.currentSlideIndex);
          store.setBlackout(message.payload.isBlackout);
          break;
      }
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [role]);

  const sendCommand = (action: string, data?: any) => {
    wsRef.current?.send(JSON.stringify({ action, ...data }));
  };

  return { sendCommand };
}