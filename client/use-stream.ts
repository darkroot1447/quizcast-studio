import { useEffect, useState } from 'react';
import type { Snapshot } from '../shared/schema.js';

export function useStream(initial: Snapshot, token?: string) {
  const [snapshot, setSnapshot] = useState(initial);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let lastEvent = 0;
    const stream = new EventSource(`/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    stream.onmessage = (event) => {
      try {
        setSnapshot(JSON.parse(event.data));
        lastEvent = Date.now();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    stream.onerror = () => setConnected(false);
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastEvent > 6000) setConnected(false);
    }, 1000);
    return () => {
      stream.close();
      clearInterval(watchdog);
    };
  }, [token]);
  return { snapshot, connected };
}
