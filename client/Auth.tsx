import { useState, type FormEvent } from 'react';
import { LightningIcon, ArrowRightIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { api } from './api';

export function Auth({ setup, onLogin }: { setup: boolean; onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (setup && password !== confirm) {
      setError('Şifreler aynı olmalı.');
      return;
    }
    setBusy(true);
    try {
      await api(setup ? '/api/setup' : '/api/login', 'POST', { password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-art">
        <div className="brand">
          <span>
            <LightningIcon weight="fill" />
          </span>
          quizcast<span className="brand-suffix">STUDIO</span>
        </div>
        <div>
          <p className="eyebrow">İZLEYİCİDEN YARIŞMACIYA</p>
          <h1>
            Her yayın,
            <br />
            yeni bir
            <br />
            <em>meydan okuma.</em>
          </h1>
          <p>
            Sorular, heyecan ve zirve yarışı.
            <br />
            Hepsi senin kontrolünde.
          </p>
        </div>
        <span className="auth-foot">CANLI YAYIN YARIŞMA STÜDYOSU · v0.1</span>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="form-icon">
            <ShieldCheckIcon />
          </span>
          <p className="eyebrow">YAYINCI ALANI</p>
          <h2>{setup ? 'Stüdyonu hazırlayalım.' : 'Tekrar hoş geldin.'}</h2>
          <p>
            {setup
              ? 'Bu bilgisayardaki yönetim paneli için güçlü bir şifre oluştur. Hazır bir varsayılan şifre yok.'
              : 'Stüdyona girmek için yönetici şifreni yaz.'}
          </p>
          <label>
            Yönetici şifresi
            <input
              autoFocus
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete={setup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="En az 12 karakter"
            />
          </label>
          {setup && (
            <label>
              Şifreyi tekrar yaz
              <input
                required
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary full" disabled={busy}>
            {busy ? 'Hazırlanıyor…' : setup ? 'Stüdyoyu oluştur' : 'Stüdyoya gir'}
            <ArrowRightIcon />
          </button>
          <div className="auth-note">
            <span className="status-dot" /> Yerel kurulum · Verilerin bu bilgisayarda tutulur.
          </div>
        </form>
      </div>
    </main>
  );
}
