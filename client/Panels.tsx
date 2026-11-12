import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CheckIcon,
  FloppyDiskIcon,
  SlidersHorizontalIcon,
  PaletteIcon,
  SpeakerHighIcon,
  ShieldCheckIcon,
  UploadSimpleIcon,
  KeyIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  ArrowCounterClockwiseIcon,
} from '@phosphor-icons/react';
import {
  difficultyLabels,
  type AdminData,
  type Question,
  type SessionRecord,
  type Settings,
} from '../shared/schema.js';
import { api, readJson } from './api';
import type { RunAction } from './App';

export function SettingsPanel({
  settings,
  questions,
  locked,
  busy,
  run,
}: {
  settings: Settings;
  questions: Question[];
  locked: boolean;
  busy: boolean;
  run: RunAction;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    setDraft(settings);
  }, [settings]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const count = questions.filter(
    (q) =>
      (draft.category === 'Tümü' || q.category === draft.category) &&
      (draft.difficulty === 'all' || q.difficulty === draft.difficulty),
  ).length;
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(() => api('/api/admin/settings', 'PUT', draft), 'Yarışma ayarları kaydedildi.');
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YARIŞMA AYARLARI</p>
          <h1>Senin yayının. Senin kuralların.</h1>
          <p>Oyun temposunu, puanlamayı ve yayın ekranını kişiselleştir.</p>
        </div>
      </div>
      {locked && <div className="notice">Ayarları değiştirmeden önce devam eden yarışmayı bitir.</div>}
      <form onSubmit={save}>
        <fieldset disabled={locked || busy} className="settings-grid">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <SlidersHorizontalIcon /> Oyun kuralları
              </h2>
            </div>
            <div className="panel-body settings-fields">
              <div className="form-row">
                <label>
                  Soru süresi (sn)
                  <input
                    type="number"
                    min={5}
                    max={120}
                    required
                    value={draft.questionSeconds}
                    onChange={(e) => set('questionSeconds', Number(e.target.value))}
                  />
                </label>
                <label>
                  Cevap ekranı (sn)
                  <input
                    type="number"
                    min={3}
                    max={30}
                    required
                    value={draft.revealSeconds}
                    onChange={(e) => set('revealSeconds', Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Yarışmadaki soru sayısı
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={draft.sessionQuestions}
                    onChange={(e) => set('sessionQuestions', Number(e.target.value))}
                  />
                </label>
                <label>
                  Kategori
                  <select value={draft.category} onChange={(e) => set('category', e.target.value)}>
                    <option>Tümü</option>
                    {[...new Set(questions.map((q) => q.category))].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>
                  Temel doğru cevap puanı
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={draft.basePoints}
                    onChange={(e) => set('basePoints', Number(e.target.value))}
                  />
                </label>
                <label>
                  En yüksek hız bonusu
                  <input
                    type="number"
                    min={0}
                    max={500}
                    required
                    value={draft.speedBonus}
                    onChange={(e) => set('speedBonus', Number(e.target.value))}
                  />
                </label>
              </div>
              <label>
                Soru zorluğu
                <select
                  value={draft.difficulty}
                  onChange={(e) => set('difficulty', e.target.value as Settings['difficulty'])}
                >
                  <option value="all">Tüm zorluklar</option>
                  {Object.entries(difficultyLabels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className={`notice ${count ? '' : 'error'}`}>
                {count} uygun soru var. Bu yarışmada {Math.min(count, draft.sessionQuestions)} farklı soru
                kullanılacak.
              </div>
              <Toggle
                label="Otomatik soru geçişi"
                description="Cevap ekranının süresi bitince sıradaki soruya geç."
                checked={draft.autoAdvance}
                onChange={(value) => set('autoAdvance', value)}
              />
              <Toggle
                label="Şıkları karıştır"
                description="Her yarışmada şıkların sırası yeniden karıştırılır."
                checked={draft.shuffleOptions}
                onChange={(value) => set('shuffleOptions', value)}
              />
            </div>
          </section>
          <div className="settings-column">
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <PaletteIcon /> Yayın kimliği
                </h2>
              </div>
              <div className="panel-body settings-fields">
                <label>
                  Yarışma adı
                  <input
                    required
                    minLength={2}
                    maxLength={40}
                    value={draft.title}
                    onChange={(e) => set('title', e.target.value)}
                  />
                </label>
                <label>
                  Alt başlık
                  <input
                    maxLength={80}
                    value={draft.subtitle}
                    onChange={(e) => set('subtitle', e.target.value)}
                  />
                </label>
                <label>
                  TikTok kullanıcı adı
                  <input
                    maxLength={24}
                    pattern="[a-zA-Z0-9_.]*"
                    placeholder="kullaniciadi (@ olmadan)"
                    value={draft.channel}
                    onChange={(e) => set('channel', e.target.value)}
                  />
                </label>
                <div>
                  <span className="field-label">Vurgu rengi</span>
                  <div className="color-picker">
                    {[
                      ['#c6f36b', 'Limon yeşili'],
                      ['#8edcff', 'Gökyüzü'],
                      ['#ffd37c', 'Altın'],
                      ['#c9b3ff', 'Lavanta'],
                      ['#ffaac9', 'Pembe'],
                      ['#eeeeee', 'Beyaz'],
                    ].map(([color, label]) => (
                      <button
                        type="button"
                        key={color}
                        style={{ background: color }}
                        aria-label={label}
                        aria-pressed={draft.accent === color}
                        onClick={() => set('accent', color)}
                      >
                        {draft.accent === color && <CheckIcon weight="bold" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <SpeakerHighIcon /> Seslendirme
                </h2>
              </div>
              <div className="panel-body">
                <Toggle
                  label="Soruları ve cevabı seslendir"
                  description="Yalnızca ayrı yayın ekranında ses çıkar; panel önizlemesi sessizdir."
                  checked={draft.voiceEnabled}
                  onChange={(value) => set('voiceEnabled', value)}
                />
                <p className="hint">
                  Yayın ekranında “Sesi etkinleştir” düğmesine bir kez bas. Türkçe sesin bulunması, tarayıcı
                  ve işletim sistemine bağlıdır. Sorular uzunsa süreyi artır.
                </p>
              </div>
            </section>
          </div>
        </fieldset>
        <div className="save-bar">
          <span>Hediye ve beğeniler sıralama puanını değiştirmez.</span>
          <button className="btn primary" disabled={locked || busy || !count}>
            <FloppyDiskIcon />
            Ayarları kaydet
          </button>
        </div>
      </form>
    </>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        <small>{description}</small>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-visual" aria-hidden="true" />
    </label>
  );
}

export function HistoryPanel({ history }: { history: SessionRecord[] }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YAYIN GEÇMİŞİ</p>
          <h1>Her yarışmanın bir hikâyesi var.</h1>
          <p>Son 50 yarışma burada; veritabanında en fazla 200 yarışma saklanır.</p>
        </div>
      </div>
      <section className="panel">
        {!history.length ? (
          <div className="empty-state">
            <ClockCounterClockwiseIcon />
            <h2>Henüz tamamlanan bir yarışma yok.</h2>
            <p>Yarışmayı bitirdiğinde sonuçları burada bulabilirsin.</p>
          </div>
        ) : (
          <div className="history-list">
            {history.map((record) => (
              <details key={record.id} className="history-item">
                <summary>
                  <span className="history-icon">
                    <ClockCounterClockwiseIcon />
                  </span>
                  <div>
                    <b>{new Date(record.startedAt).toLocaleString('tr')}</b>
                    <span>
                      {record.rounds} puanlanan soru · {record.players.length} yarışmacı ·{' '}
                      {record.completed ? 'Tamamlandı' : 'Erken bitirildi'}
                    </span>
                  </div>
                  <span className={`pill ${record.mode === 'demo' ? 'amber' : 'green'}`}>
                    {record.mode === 'demo' ? 'DEMO' : 'TIKTOK'}
                  </span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>SIRA</th>
                        <th>YARIŞMACI</th>
                        <th>DOĞRU</th>
                        <th>PUAN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.players.slice(0, 100).map((player, i) => (
                        <tr key={player.id}>
                          <td>{i + 1}</td>
                          <td>{player.name}</td>
                          <td>{player.correct}</td>
                          <td className="score">{player.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!record.players.length && <p className="hint padded">Bu yarışmada geçerli cevap yok.</p>}
                  {record.players.length > 100 && (
                    <p className="hint padded">İlk 100 yarışmacı gösteriliyor.</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function LicensePanel({
  data,
  busy,
  run,
  overlayUrl,
}: {
  data: AdminData;
  busy: boolean;
  run: RunAction;
  overlayUrl: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LİSANS VE KURULUM</p>
          <h1>Stüdyonun anahtarı.</h1>
          <p>Kuruluma bağlı lisans, bağlantı durumu ve OBS ayarları.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <ShieldCheckIcon /> Studio lisansı
            </h2>
            <span className={`pill ${data.license.status === 'valid' ? 'green' : 'amber'}`}>
              {data.license.status === 'valid' ? 'AKTİF' : 'DEMO / KURULUM'}
            </span>
          </div>
          <div className="panel-body settings-fields">
            <p>{data.license.message}</p>
            {data.license.customer && (
              <div className="detail-pair">
                <span>Lisans sahibi</span>
                <b>{data.license.customer}</b>
              </div>
            )}
            {data.license.expiresAt && (
              <div className="detail-pair">
                <span>Bitiş tarihi</span>
                <b>{new Date(data.license.expiresAt).toLocaleDateString('tr')}</b>
              </div>
            )}
            <label>
              Kurulum kimliği
              <input readOnly value={data.license.installationId} />
            </label>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(data.license.installationId);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <CopyIcon />
              {copied ? 'Kopyalandı' : 'Kurulum kimliğini kopyala'}
            </button>
            <input
              hidden
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const element = e.currentTarget;
                const file = element.files?.[0];
                if (file)
                  void run(
                    async () => api('/api/admin/license', 'POST', await readJson(file)),
                    'Lisans etkinleştirildi.',
                  ).finally(() => {
                    element.value = '';
                  });
              }}
            />
            <button className="btn primary" disabled={busy} onClick={() => fileInput.current?.click()}>
              <UploadSimpleIcon />
              Lisans dosyası yükle
            </button>
            <p className="hint">
              Lisanslar satıcının özel anahtarıyla imzalanır. Özel anahtar müşterinin bilgisayarına konulmaz.
              Bu sürüm çevrimiçi ödeme veya merkezi lisans iptali içermez.
            </p>
          </div>
        </section>
        <div className="settings-column">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <KeyIcon /> TikTok sağlayıcısı
              </h2>
            </div>
            <div className="panel-body">
              <div className="detail-pair">
                <span>Euler API anahtarı</span>
                <span className={`pill ${data.providerConfigured ? 'green' : 'amber'}`}>
                  {data.providerConfigured ? 'YAPILANDIRILDI' : 'EKLENMEDİ'}
                </span>
              </div>
              <p className="hint">
                Anahtar yalnızca sunucunun .env dosyasındaki EULER_API_KEY alanında tutulur. Tarayıcıya
                iletilmez. Sağlayıcının hesabı, kota ve kullanım koşulları ayrıca geçerlidir.
              </p>
              <p className="hint">
                Adaptörün gerçek yayın testi, canlı bir hesap ve API anahtarıyla yapılmalıdır. Demo sonucu
                gerçek TikTok bağlantısının doğrulandığı anlamına gelmez.
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>OBS hızlı kurulumu</h2>
            </div>
            <div className="panel-body settings-fields">
              <ol className="steps">
                <li>Kaynaklar → Tarayıcı ekle.</li>
                <li>Aşağıdaki yayın ekranı adresini yapıştır.</li>
                <li>
                  Genişlik <b>1080</b>, yükseklik <b>1920</b> seç.
                </li>
                <li>Ses için kaynakta Etkileşim → Sesi etkinleştir.</li>
              </ol>
              <label>
                Salt okunur yayın ekranı
                <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} />
              </label>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (confirm('Eski OBS bağlantısı geçersiz olacak. Yeni bağlantı oluşturulsun mu?'))
                    void run(
                      () => api('/api/admin/overlay/rotate', 'POST'),
                      'Yayın bağlantısı yenilendi. OBS adresini güncelle.',
                    );
                }}
              >
                <ArrowCounterClockwiseIcon />
                Yayın bağlantısını yenile
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
