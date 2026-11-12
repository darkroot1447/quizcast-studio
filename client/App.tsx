import { useCallback, useEffect, useState } from 'react';
import {
  LightningIcon,
  SquaresFourIcon,
  StackIcon,
  SlidersHorizontalIcon,
  ClockCounterClockwiseIcon,
  ShieldCheckIcon,
  ArrowUpRightIcon,
  SignOutIcon,
  CopyIcon,
  PlayIcon,
  PauseIcon,
  SkipForwardIcon,
  StopIcon,
  UsersIcon,
  ChatCircleDotsIcon,
  HeartIcon,
  TrophyIcon,
  BroadcastIcon,
  FlaskIcon,
  DownloadSimpleIcon,
  GiftIcon,
} from '@phosphor-icons/react';
import type { AdminData, Snapshot } from '../shared/schema.js';
import { api } from './api';
import { useStream } from './use-stream';
import { GameScreen } from './Overlay';
import { QuestionBank } from './QuestionBank';
import { SettingsPanel, HistoryPanel, LicensePanel } from './Panels';

export type RunAction = (work: () => Promise<unknown>, success?: string) => Promise<boolean>;
type Page = 'studio' | 'questions' | 'settings' | 'history' | 'license';
const pages = [
  { id: 'studio' as const, title: 'Yayın stüdyosu', icon: SquaresFourIcon },
  { id: 'questions' as const, title: 'Soru kütüphanesi', icon: StackIcon },
  { id: 'settings' as const, title: 'Yarışma ayarları', icon: SlidersHorizontalIcon },
  { id: 'history' as const, title: 'Yayın geçmişi', icon: ClockCounterClockwiseIcon },
  { id: 'license' as const, title: 'Lisans ve kurulum', icon: ShieldCheckIcon },
];

export function App({ initial, onLogout }: { initial: AdminData; onLogout: () => void }) {
  const [data, setData] = useState(initial);
  const [page, setPage] = useState<Page>('studio');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const { snapshot, connected } = useStream(initial.snapshot);
  const overlayUrl = `${location.origin}/overlay?token=${data.overlayToken}`;
  const reload = useCallback(async () => setData(await api<AdminData>('/api/admin/state')), []);
  useEffect(() => {
    if (snapshot.phase === 'finished')
      void reload().catch((error: Error) => setNotice({ message: error.message, error: true }));
  }, [snapshot.phase, reload]);
  useEffect(() => {
    const expired = () => onLogout();
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [onLogout]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run: RunAction = async (work, success) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await reload();
      if (success) setNotice({ message: success, error: false });
      return true;
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function copyOverlay() {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setNotice({ message: 'OBS bağlantısı kopyalandı. Tarayıcı Kaynağı: 1080 × 1920.', error: false });
    } catch {
      setNotice({
        message: 'Kopyalama izni yok. Yayın ekranını açıp adres çubuğundaki bağlantıyı kopyala.',
        error: true,
      });
    }
  }
  const active = snapshot.phase === 'question' || snapshot.phase === 'reveal';
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        İçeriğe geç
      </a>
      <aside className="sidebar">
        <a className="brand" href="/">
          <span>
            <LightningIcon weight="fill" />
          </span>
          quizcast
        </a>
        <span className="edition">
          STUDIO EDITION <b>0.1</b>
        </span>
        <div className="nav-label">ÇALIŞMA ALANI</div>
        <nav aria-label="Ana menü">
          {pages.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? 'nav-item selected' : 'nav-item'}
              aria-current={page === p.id ? 'page' : undefined}
              onClick={() => setPage(p.id)}
            >
              <p.icon weight={page === p.id ? 'fill' : 'regular'} />
              {p.title}
              {p.id === 'questions' && <span>{data.questions.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className={`status-dot ${connected ? '' : 'offline'}`} />
            <div>
              <b>{connected ? 'Stüdyo çevrimiçi' : 'Sunucuya bağlanılıyor'}</b>
              <span>Bu bilgisayarda çalışıyor</span>
            </div>
          </div>
          <div className="profile">
            <div className="avatar">Y</div>
            <div>
              <b>Yayıncı hesabı</b>
              <span>{data.license.status === 'valid' ? 'Studio lisansı aktif' : 'Demo / geliştirme'}</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Çalışma alanı <span>/</span>
            <b>{pages.find((p) => p.id === page)?.title}</b>
          </div>
          <div className="top-actions">
            <a className="btn small" href={overlayUrl} target="_blank" rel="noreferrer">
              Yayın ekranı <ArrowUpRightIcon />
            </a>
            <button
              className="icon-button"
              aria-label="Çıkış yap"
              onClick={async () => {
                try {
                  await api('/api/logout', 'POST');
                  onLogout();
                } catch (e) {
                  setNotice({ message: (e as Error).message, error: true });
                }
              }}
            >
              <SignOutIcon />
            </button>
          </div>
        </header>
        <main id="main" className="main-content">
          {!connected && (
            <div className="notice error" role="alert">
              Canlı veri akışı kesildi. Son alınan veriler gösteriliyor; kontroller geçici olarak kapalı.
            </div>
          )}
          {notice && (
            <div
              className={`notice ${notice.error ? 'error' : 'success'}`}
              role={notice.error ? 'alert' : 'status'}
            >
              <span>{notice.message}</span>
              <button aria-label="Bildirimi kapat" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
          {page === 'studio' && (
            <Studio
              state={snapshot}
              data={data}
              disabled={busy || !connected}
              run={run}
              overlayUrl={overlayUrl}
              copyOverlay={copyOverlay}
              goSettings={() => setPage('settings')}
            />
          )}
          {page === 'questions' && (
            <QuestionBank questions={data.questions} run={run} locked={active} busy={busy} />
          )}
          {page === 'settings' && (
            <SettingsPanel
              settings={data.settings}
              questions={data.questions}
              locked={active}
              busy={busy}
              run={run}
            />
          )}
          {page === 'history' && <HistoryPanel history={data.history} />}
          {page === 'license' && <LicensePanel data={data} busy={busy} run={run} overlayUrl={overlayUrl} />}
        </main>
        <footer className="app-footer">
          <span>QuizCast Studio · Yerel yayın kontrol merkezi</span>
          <span>TikTok ile bağlantılı veya TikTok tarafından onaylanmış değildir.</span>
        </footer>
      </div>
    </div>
  );
}

function Studio({
  state,
  data,
  disabled,
  run,
  overlayUrl,
  copyOverlay,
  goSettings,
}: {
  state: Snapshot;
  data: AdminData;
  disabled: boolean;
  run: RunAction;
  overlayUrl: string;
  copyOverlay: () => void;
  goSettings: () => void;
}) {
  const [name, setName] = useState('Test izleyicisi');
  const [answer, setAnswer] = useState('A');
  const active = state.phase === 'question' || state.phase === 'reveal';
  const demo = state.connection.mode === 'demo';
  const command = (action: string) => void run(() => api(`/api/admin/game/${action}`, 'POST'));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YAYIN STÜDYOSU</p>
          <h1>Kontrol sende. Sahne hazır.</h1>
          <p>İzleyicilerini yarışmaya davet et, heyecanı birlikte büyütün.</p>
        </div>
        <span className={`pill ${demo ? 'amber' : 'green'}`}>
          <span className="status-dot" />
          {demo
            ? 'DEMO MODU'
            : state.connection.status === 'connected'
              ? 'TIKTOK BAĞLI'
              : 'TIKTOK BAĞLI DEĞİL'}
        </span>
      </div>
      <div className="stats-grid">
        <Stat
          icon={StackIcon}
          label="Soru havuzu"
          value={data.questions.length}
          note={`${new Set(data.questions.map((q) => q.category)).size} farklı kategori`}
        />
        <Stat icon={UsersIcon} label="Yarışmacı" value={state.participants} note="En az bir geçerli cevap" />
        <Stat
          icon={ChatCircleDotsIcon}
          label="Bu sorudaki cevap"
          value={state.answers}
          note="Kişi başına tek cevap"
        />
        <Stat
          icon={HeartIcon}
          label="Beğeni"
          value={state.likes}
          note={demo ? 'Simülasyon verisi' : 'Bağlantıdan alınan beğeniler'}
        />
      </div>
      <div className="studio-grid">
        <section className="panel preview-panel">
          <div className="panel-heading">
            <h2>
              <BroadcastIcon /> Yayın önizlemesi
            </h2>
            <span className="subtle-label">9:16 · 1080 × 1920</span>
          </div>
          <div className="preview-stage">
            <div className="preview-screen">
              <GameScreen state={state} />
            </div>
          </div>
          <div className="preview-footer">
            <span>
              <span className="status-dot" /> OBS ile aynı görüntü · Önizleme sessiz
            </span>
            <button className="text-button" onClick={copyOverlay}>
              <CopyIcon />
              Bağlantıyı kopyala
            </button>
          </div>
        </section>
        <div className="studio-right">
          <section className="panel">
            <div className="panel-heading">
              <h2>Yarışma kontrolü</h2>
              <span className="mono">
                {String(state.round).padStart(2, '0')} /{' '}
                {String(state.totalRounds || data.settings.sessionQuestions).padStart(2, '0')}
              </span>
            </div>
            <div className="panel-body">
              <div className="round-status">
                <span className={`status-symbol ${active && !state.paused ? 'running' : ''}`}>
                  <LightningIcon weight="fill" />
                </span>
                <div>
                  <b>
                    {state.paused
                      ? 'Yarışma duraklatıldı'
                      : state.phase === 'question'
                        ? 'Cevaplar toplanıyor'
                        : state.phase === 'reveal'
                          ? 'Doğru cevap açıklanıyor'
                          : state.phase === 'finished'
                            ? 'Yarışma tamamlandı'
                            : 'Yeni bir yarışmaya hazır'}
                  </b>
                  <p>
                    {state.paused
                      ? state.pauseReason
                      : active
                        ? `${Math.ceil(state.remainingMs / 1000)} saniye · ${state.question?.category}`
                        : `${data.settings.questionSeconds} sn / soru · ${data.settings.basePoints} temel puan`}
                  </p>
                </div>
              </div>
              <div className="control-buttons">
                <button
                  className="btn primary"
                  disabled={disabled || (!active && state.connection.status !== 'connected')}
                  onClick={() => command(!active ? 'start' : state.paused ? 'resume' : 'pause')}
                >
                  {!active ? (
                    <PlayIcon weight="fill" />
                  ) : state.paused ? (
                    <PlayIcon weight="fill" />
                  ) : (
                    <PauseIcon weight="fill" />
                  )}
                  {!active ? 'Yarışmayı başlat' : state.paused ? 'Devam et' : 'Duraklat'}
                </button>
                <button
                  className="btn"
                  aria-label={state.phase === 'question' ? 'Cevabı açıkla' : 'Sonraki soru'}
                  title={state.phase === 'question' ? 'Cevabı açıkla' : 'Sonraki soru'}
                  disabled={disabled || !active || state.paused}
                  onClick={() => command('next')}
                >
                  <SkipForwardIcon weight="fill" />
                </button>
                <button
                  className="btn danger-outline"
                  aria-label="Yarışmayı bitir"
                  disabled={disabled || !active}
                  onClick={() => {
                    if (confirm('Yarışma bitirilsin mi? Tamamlanan soruların puanları kaydedilecek.'))
                      command('stop');
                  }}
                >
                  <StopIcon weight="fill" />
                </button>
              </div>
              <div className="rule-line">
                <ShieldCheckIcon /> İlk cevap geçerli. Hediyeler puanı etkilemez.
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Yayın bağlantısı</h2>
              <button className="text-button" onClick={goSettings}>
                Ayarlar <ArrowUpRightIcon />
              </button>
            </div>
            <div className="panel-body">
              <div className="source-select">
                <button
                  className={demo ? 'chosen' : ''}
                  disabled={disabled || active}
                  onClick={() => void run(() => api('/api/admin/source', 'POST', { mode: 'demo' }))}
                >
                  <FlaskIcon />
                  Demo
                </button>
                <button
                  className={!demo ? 'chosen' : ''}
                  disabled={
                    disabled || (active && demo) || !data.providerConfigured || !data.license.liveAllowed
                  }
                  onClick={() => void run(() => api('/api/admin/source', 'POST', { mode: 'tiktok' }))}
                >
                  <BroadcastIcon />
                  TikTok LIVE
                </button>
              </div>
              <p className="connection-message">{state.connection.message}</p>
              {!data.providerConfigured && (
                <p className="hint">
                  Gerçek bağlantı için sunucuda Euler API anahtarı gerekli. Demo ücretsiz ve çevrimdışı
                  çalışır.
                </p>
              )}
              {!demo && (
                <button
                  className="text-button danger-text"
                  disabled={disabled}
                  onClick={() => void run(() => api('/api/admin/source', 'POST', { mode: 'disconnect' }))}
                >
                  Bağlantıyı kes
                </button>
              )}
            </div>
          </section>
          {demo && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <FlaskIcon /> Cevap simülatörü
                </h2>
                <span className="subtle-label">SADECE DEMO</span>
              </div>
              <form
                className="panel-body demo-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const result = await api<{ accepted: boolean; message: string }>(
                      '/api/admin/demo',
                      'POST',
                      { name, answer },
                    );
                    if (!result.accepted) throw new Error(result.message);
                  }, 'Test cevabı alındı.');
                }}
              >
                <label>
                  İzleyici adı
                  <input value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
                </label>
                <div className="form-row">
                  <label>
                    Cevap
                    <select aria-label="Cevap" value={answer} onChange={(e) => setAnswer(e.target.value)}>
                      {['A', 'B', 'C', 'D'].map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <button className="btn" disabled={disabled || state.phase !== 'question' || state.paused}>
                    Cevap gönder <ArrowUpRightIcon />
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className="panel activity-panel">
            <div className="panel-heading">
              <h2>Yayın akışı</h2>
              <span className="subtle-label">{demo ? 'SİMÜLASYON' : 'BAĞLANTI VERİSİ'}</span>
            </div>
            <div className="activity-list">
              {state.activity.length ? (
                state.activity.slice(0, 6).map((item) => (
                  <div className="activity-row" key={item.id}>
                    <span className={`activity-icon ${item.kind}`}>
                      {item.kind === 'gift' ? <GiftIcon /> : <ChatCircleDotsIcon />}
                    </span>
                    <div>
                      <b>{item.name}</b>
                      <span>{item.text}</span>
                    </div>
                    <time>
                      {new Date(item.at).toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                ))
              ) : (
                <div className="empty-state small-empty">
                  <ChatCircleDotsIcon />
                  <p>Yarışma başladığında etkileşimler burada görünecek.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <section className="panel leaderboard-panel">
        <div className="panel-heading">
          <h2>
            <TrophyIcon /> Yayın sıralaması
          </h2>
          <a className="text-button" href="/api/admin/results/export">
            <DownloadSimpleIcon />
            CSV indir
          </a>
        </div>
        {state.leaderboard.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>SIRA</th>
                  <th>YARIŞMACI</th>
                  <th>DOĞRU / CEVAP</th>
                  <th>TOPLAM PUAN</th>
                </tr>
              </thead>
              <tbody>
                {state.leaderboard.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <span className={`rank rank-${i}`}>{i + 1}</span>
                    </td>
                    <td>
                      <span className="player-name">
                        <span className="avatar tiny">{p.name[0]}</span>
                        {p.name}
                      </span>
                    </td>
                    <td>
                      {p.correct} / {p.answered}
                    </td>
                    <td className="score">{p.score.toLocaleString('tr')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state horizontal">
            <TrophyIcon />
            <div>
              <b>Zirvede ilk yer senin olabilir.</b>
              <p>İlk geçerli cevap geldiğinde yarışmacılar burada listelenir.</p>
            </div>
            <a className="btn small" href={overlayUrl} target="_blank" rel="noreferrer">
              Yayın ekranını aç <ArrowUpRightIcon />
            </a>
          </div>
        )}
      </section>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof UsersIcon;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        <Icon />
      </div>
      <b>{value.toLocaleString('tr')}</b>
      <p>{note}</p>
    </div>
  );
}
