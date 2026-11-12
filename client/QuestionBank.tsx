import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  UploadSimpleIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
  StackIcon,
} from '@phosphor-icons/react';
import { difficultyLabels, letters, type Question } from '../shared/schema.js';
import { api, readJson } from './api';
import type { RunAction } from './App';

export function QuestionBank({
  questions,
  locked,
  busy,
  run,
}: {
  questions: Question[];
  locked: boolean;
  busy: boolean;
  run: RunAction;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Tümü');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const categories = [...new Set(questions.map((q) => q.category))].sort((a, b) => a.localeCompare(b, 'tr'));
  const filtered = questions.filter(
    (q) =>
      (category === 'Tümü' || q.category === category) &&
      q.text.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 12) - 1);
  const currentPage = Math.min(page, lastPage);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SORU KÜTÜPHANESİ</p>
          <h1>Merakla başlar, bilgiyle kazanılır.</h1>
          <p>
            {questions.length} soru, {categories.length} kategori. Kendi sorularını ekle, yarışmanı
            farklılaştır.
          </p>
        </div>
        <button className="btn primary" disabled={locked || busy} onClick={() => setEditing('new')}>
          <PlusIcon />
          Soru ekle
        </button>
      </div>
      {locked && (
        <div className="notice">
          Soruları düzenlemek için yarışmayı bitir. Devam eden yarışmanın soruları değişmez.
        </div>
      )}
      <section className="panel">
        <div className="question-toolbar">
          <label className="search-input">
            <MagnifyingGlassIcon />
            <input
              aria-label="Sorularda ara"
              placeholder="Sorularda ara…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <select
            aria-label="Kategori filtresi"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option>Tümü</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <div className="toolbar-actions">
            <input
              ref={input}
              hidden
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const element = e.currentTarget;
                const file = element.files?.[0];
                if (!file) return;
                void run(async () => {
                  const result = await api<{ added: number; skipped: number }>(
                    '/api/admin/questions/import',
                    'POST',
                    await readJson(file),
                  );
                  alert(`${result.added} soru eklendi, ${result.skipped} tekrar atlandı.`);
                }).finally(() => {
                  element.value = '';
                });
              }}
            />
            <button className="btn small" disabled={locked || busy} onClick={() => input.current?.click()}>
              <UploadSimpleIcon />
              İçe aktar
            </button>
            <a className="btn small" href="/api/admin/questions/export">
              <DownloadSimpleIcon />
              JSON indir
            </a>
          </div>
        </div>
        <div className="question-list">
          {filtered.slice(currentPage * 12, currentPage * 12 + 12).map((q, index) => (
            <article className="question-row" key={q.id}>
              <span className="question-number">{String(currentPage * 12 + index + 1).padStart(2, '0')}</span>
              <div className="question-details">
                <div className="question-tags">
                  <span>{q.category}</span>
                  <span className={`difficulty ${q.difficulty}`}>{difficultyLabels[q.difficulty]}</span>
                </div>
                <h2>{q.text}</h2>
                <div className="answer-summary">
                  {q.options.map((option, i) => (
                    <span className={i === q.answer ? 'is-correct' : ''} key={i}>
                      {letters[i]}. {option}
                      {i === q.answer ? ' ✓' : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="icon-button"
                  aria-label={`Soruyu düzenle: ${q.text}`}
                  disabled={locked || busy}
                  onClick={() => setEditing(q)}
                >
                  <PencilSimpleIcon />
                </button>
                <button
                  className="icon-button danger-text"
                  aria-label={`Soruyu sil: ${q.text}`}
                  disabled={locked || busy}
                  onClick={() => {
                    if (confirm('Bu soru havuzdan silinsin mi?'))
                      void run(
                        () => api(`/api/admin/questions/${encodeURIComponent(q.id)}`, 'DELETE'),
                        'Soru silindi.',
                      );
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <div className="empty-state">
              <StackIcon />
              <b>Bu aramada soru bulunamadı.</b>
              <p>Filtreni değiştir veya yeni bir soru ekle.</p>
            </div>
          )}
        </div>
        <div className="pagination">
          <span>
            {filtered.length} soru · Sayfa {currentPage + 1} / {lastPage + 1}
          </span>
          <div>
            <button
              className="btn small"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Önceki
            </button>
            <button
              className="btn small"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Sonraki
            </button>
          </div>
        </div>
      </section>
      {editing && (
        <QuestionEditor
          question={editing === 'new' ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (q) => {
            const ok = await run(
              () =>
                api(
                  editing === 'new'
                    ? '/api/admin/questions'
                    : `/api/admin/questions/${encodeURIComponent(q.id)}`,
                  editing === 'new' ? 'POST' : 'PUT',
                  q,
                ),
              'Soru kaydedildi.',
            );
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}
    </>
  );
}

function QuestionEditor({
  question,
  busy,
  onClose,
  onSave,
}: {
  question: Question | null;
  busy: boolean;
  onClose: () => void;
  onSave: (q: Question) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Question>(
    question ?? {
      id: crypto.randomUUID(),
      category: 'Genel Kültür',
      difficulty: 'easy',
      text: '',
      options: ['', '', '', ''],
      answer: 0,
      explanation: '',
    },
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const change = <K extends keyof Question>(key: K, value: Question[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailed(!(await onSave(draft)));
  }
  return (
    <dialog
      ref={dialog}
      className="editor-dialog"
      aria-labelledby="editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="panel-heading">
          <h2 id="editor-title">{question ? 'Soruyu düzenle' : 'Yeni soru ekle'}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Pencereyi kapat"
            disabled={busy}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>
        <div className="editor-content">
          <label>
            Soru
            <textarea
              aria-label="Soru"
              required
              minLength={6}
              maxLength={240}
              rows={3}
              value={draft.text}
              onChange={(e) => change('text', e.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              Kategori
              <input
                required
                minLength={2}
                maxLength={40}
                value={draft.category}
                onChange={(e) => change('category', e.target.value)}
              />
            </label>
            <label>
              Zorluk
              <select
                aria-label="Zorluk"
                value={draft.difficulty}
                onChange={(e) => change('difficulty', e.target.value as Question['difficulty'])}
              >
                {Object.entries(difficultyLabels).map(([key, value]) => (
                  <option value={key} key={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="options-editor">
            <legend>Şıklar · Doğru cevabın yanındaki düğmeyi seç</legend>
            {draft.options.map((option, i) => (
              <div className="option-editor" key={i}>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="correct"
                    value={i}
                    checked={draft.answer === i}
                    onChange={() => change('answer', i)}
                    aria-label={`${letters[i]} doğru cevap`}
                  />
                  <span>{letters[i]}</span>
                </label>
                <input
                  aria-label={`${letters[i]} şıkkı`}
                  required
                  maxLength={100}
                  value={option}
                  onChange={(e) =>
                    change(
                      'options',
                      draft.options.map((value, j) => (i === j ? e.target.value : value)),
                    )
                  }
                />
              </div>
            ))}
          </fieldset>
          <label>
            Cevap açıklaması
            <textarea
              aria-label="Cevap açıklaması"
              maxLength={400}
              rows={2}
              value={draft.explanation}
              onChange={(e) => change('explanation', e.target.value)}
            />
          </label>
          {failed && (
            <p className="notice error" role="alert">
              Kaydedilemedi. Şıkların farklı olduğunu ve alanların geçerli olduğunu kontrol et. Ayrıntı panel
              bildiriminde.
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Vazgeç
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Soruyu kaydet'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
