import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  LightningIcon,
  TrophyIcon,
  UsersIcon,
  PauseIcon,
  CheckIcon,
  SpeakerHighIcon,
  GiftIcon,
} from '@phosphor-icons/react';
import { letters, type Snapshot } from '../shared/schema.js';
import { useStream } from './use-stream';

export function GameScreen({ state, connected = true }: { state: Snapshot; connected?: boolean }) {
  const question = state.question;
  const seconds = Math.ceil(state.remainingMs / 1000);
  const duration = state.phase === 'question' ? state.settings.questionSeconds : state.settings.revealSeconds;
  const revealed = question?.answer !== undefined;
  const winner = state.leaderboard[0];
  const gift = state.activity.find((item) => item.kind === 'gift' && state.serverNow - item.at < 6000);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const resize = () => {
      if (frame.current && canvas.current) {
        setScale(Math.min(1, frame.current.clientHeight / Math.max(1, canvas.current.offsetHeight)));
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame.current!);
    observer.observe(canvas.current!);
    resize();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="game-frame" ref={frame}>
      <section
        ref={canvas}
        className="game-screen"
        style={{ '--game-accent': state.settings.accent, '--fit': scale } as CSSProperties}
        aria-label="Yarışma yayın ekranı"
      >
        <div className="game-top">
          <span className="game-wordmark">
            <LightningIcon weight="fill" /> QUIZCAST
          </span>
          <span className="game-badge">
            <i />
            {state.connection.mode === 'demo' ? 'DEMO' : 'CANLI'}
          </span>
        </div>
        <div className="game-title">
          <span>CANLI BİLGİ YARIŞMASI</span>
          <h2>{state.settings.title}</h2>
          <p>{state.settings.subtitle}</p>
        </div>
        {!connected ? (
          <div className="game-notice">Sunucu bağlantısı kesildi. Yeniden bağlanılıyor…</div>
        ) : state.paused ? (
          <div className="game-notice">
            <PauseIcon weight="fill" /> Yarışma duraklatıldı
          </div>
        ) : null}
        {state.phase === 'idle' ? (
          <div className="game-welcome">
            <div className="welcome-mark">
              <LightningIcon weight="fill" />
            </div>
            <h3>
              Sahne senin.
              <br />
              Hazır mısın?
            </h3>
            <p>
              Soruyu bekle, cevabını sohbete yaz.
              <br />
              İlk geçerli cevabın sayılır.
            </p>
            <div className="example-letters">
              {letters.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
        ) : state.phase === 'finished' ? (
          <div className="game-welcome game-finished">
            <TrophyIcon weight="duotone" />
            <span>YARIŞMA TAMAMLANDI</span>
            <h3>{winner?.score ? winner.name : 'Teşekkürler!'}</h3>
            <p>
              {winner?.score
                ? `${winner.score.toLocaleString('tr')} puanla zirvede`
                : 'Yeni bir yarışmada görüşmek üzere.'}
            </p>
          </div>
        ) : (
          question && (
            <>
              <div className="game-round">
                <span>
                  SORU <b>{String(state.round).padStart(2, '0')}</b> /{' '}
                  {String(state.totalRounds).padStart(2, '0')}
                </span>
                <span>{question.category}</span>
              </div>
              <div className="game-question">
                <h3 className={question.text.length > 130 ? 'long-question' : ''}>{question.text}</h3>
              </div>
              <div className="game-options">
                {question.options.map((option, index) => (
                  <div
                    key={index}
                    className={`game-option ${revealed ? (question.answer === index ? 'correct' : 'dim') : ''}`}
                  >
                    <b>{letters[index]}</b>
                    <span>{option}</span>
                    {revealed && question.answer === index && (
                      <CheckIcon weight="bold" aria-label="Doğru cevap" />
                    )}
                  </div>
                ))}
              </div>
              <div className="game-countdown">
                <div>
                  <span>
                    {state.paused
                      ? 'DURAKLATILDI'
                      : revealed
                        ? state.settings.autoAdvance
                          ? 'SONRAKİ SORU'
                          : 'YAYINCI BEKLENİYOR'
                        : 'CEVABINI SOHBETE YAZ'}
                  </span>
                  <b>
                    {seconds}
                    <small> sn</small>
                  </b>
                </div>
                <div className="timer-track">
                  <i style={{ width: `${Math.min(100, state.remainingMs / (duration * 10))}%` }} />
                </div>
              </div>
              {revealed && <p className="game-explanation">{question.explanation}</p>}
            </>
          )
        )}
        <div className="game-leaders">
          <div className="game-leaders-title">
            <span>
              <TrophyIcon /> ZİRVENİN SAHİPLERİ
            </span>
            <span>
              <UsersIcon /> {state.participants}
            </span>
          </div>
          {state.leaderboard.length ? (
            state.leaderboard.slice(0, 3).map((player, i) => (
              <div className="game-player" key={player.id}>
                <span className={`rank rank-${i}`}>{i + 1}</span>
                <span>{player.name}</span>
                <b>
                  {player.score.toLocaleString('tr')}
                  <small> puan</small>
                </b>
              </div>
            ))
          ) : (
            <div className="game-empty">İlk doğru cevapla yerini al.</div>
          )}
        </div>
        <footer className="game-footer">
          {state.settings.channel ? `@${state.settings.channel}` : 'BİLGİNİ KONUŞTUR'}
          <span>A · B · C · D</span>
        </footer>
      </section>
      {gift && connected && (
        <div className="gift-toast" key={gift.id} role="status">
          <GiftIcon weight="duotone" />
          <div>
            <b>{gift.name}</b>
            <span>{gift.text}</span>
          </div>
          <span>TEŞEKKÜRLER!</span>
        </div>
      )}
    </div>
  );
}

export function Overlay({ initial, token }: { initial: Snapshot; token: string }) {
  const { snapshot, connected } = useStream(initial, token);
  const [audio, setAudio] = useState(false);
  const [audioError, setAudioError] = useState('');
  const spoken = useRef('');
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    if (
      !audio ||
      !connected ||
      snapshot.paused ||
      !snapshot.settings.voiceEnabled ||
      !['question', 'reveal'].includes(snapshot.phase)
    ) {
      speechSynthesis.cancel();
      return;
    }
    const key = `${snapshot.sessionId}:${snapshot.round}:${snapshot.phase}`;
    if (spoken.current === key || !snapshot.question || !['question', 'reveal'].includes(snapshot.phase))
      return;
    spoken.current = key;
    const q = snapshot.question;
    const phrase =
      snapshot.phase === 'question'
        ? `${q.text} ${q.options.map((option, i) => `${letters[i]}. ${option}`).join('. ')}`
        : `Doğru cevap ${letters[q.answer!]}. ${q.options[q.answer!]}.`;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(phrase);
    utterance.lang = 'tr-TR';
    utterance.rate = 1.04;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('tr'));
    if (voice) utterance.voice = voice;
    utterance.onerror = (e) => {
      if (!['interrupted', 'canceled'].includes(e.error)) {
        setAudio(false);
        setAudioError('Ses çalışmadı. Tarayıcı iznini ve Türkçe sistem sesini kontrol et.');
      }
    };
    speechSynthesis.speak(utterance);
  }, [audio, connected, snapshot]);
  useEffect(
    () => () => {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },
    [],
  );
  return (
    <main className="overlay-page">
      <GameScreen state={snapshot} connected={connected} />
      {!audio && snapshot.settings.voiceEnabled && (
        <button
          className="audio-toggle"
          onClick={() => {
            if (!('speechSynthesis' in window)) {
              setAudioError('Bu tarayıcı seslendirmeyi desteklemiyor.');
              return;
            }
            setAudioError('');
            spoken.current = '';
            setAudio(true);
          }}
        >
          <SpeakerHighIcon />
          {audioError || 'Sesi etkinleştir · OBS: Etkileşim'}
        </button>
      )}
    </main>
  );
}
