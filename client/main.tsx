import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Auth } from './Auth';
import { Overlay } from './Overlay';
import { api } from './api';
import type { AdminData, Snapshot } from '../shared/schema.js';
import './styles.css';
import './overlay.css';
import './pages.css';
import './responsive.css';

function Root() {
  const [boot, setBoot] = useState<{ setupRequired: boolean; authenticated: boolean } | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [overlay, setOverlay] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const isOverlay = location.pathname === '/overlay';
  const load = useCallback(async () => {
    setError('');
    try {
      if (isOverlay) setOverlay(await api<Snapshot>(`/api/overlay/state?token=${encodeURIComponent(token)}`));
      else {
        const next = await api<{ setupRequired: boolean; authenticated: boolean }>('/api/bootstrap');
        setBoot(next);
        setData(next.authenticated ? await api<AdminData>('/api/admin/state') : null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [isOverlay, token]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <main className="loading-page">
        <h1>Bağlantıyı kontrol edelim.</h1>
        <p role="alert">{error}</p>
        <button className="btn primary" onClick={() => void load()}>
          Yeniden dene
        </button>
      </main>
    );
  if (isOverlay)
    return overlay ? (
      <Overlay initial={overlay} token={token} />
    ) : (
      <main className="loading-page">Yayın ekranı hazırlanıyor…</main>
    );
  if (!boot || (boot.authenticated && !data))
    return (
      <main className="loading-page">
        <div className="loader" />
        <p>Stüdyon hazırlanıyor…</p>
      </main>
    );
  if (!boot.authenticated) return <Auth setup={boot.setupRequired} onLogin={() => void load()} />;
  return <App initial={data!} onLogout={() => void load()} />;
}
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="loading-page">
        <h1>Ekran yüklenemedi.</h1>
        <p>Yarışma sunucuda çalışmaya devam edebilir.</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Sayfayı yenile
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>,
);
