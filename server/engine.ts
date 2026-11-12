import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Activity,
  ConnectionState,
  Player,
  Question,
  SessionRecord,
  Settings,
  Snapshot,
} from '../shared/schema.js';

export function parseAnswer(comment: string): number | null {
  const clean = comment.trim().toUpperCase();
  if (/^[A-D]$/.test(clean)) return clean.charCodeAt(0) - 65;
  if (/^[1-4]$/.test(clean)) return Number(clean) - 1;
  return null;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class QuizEngine extends EventEmitter {
  phase: Snapshot['phase'] = 'idle';
  paused = false;
  pauseReason = '';
  connection: ConnectionState = {
    mode: 'demo',
    status: 'connected',
    message: 'Simülasyon hazır. Gerçek TikTok verisi kullanılmıyor.',
    retries: 0,
  };
  private settings: Settings;
  private deck: Question[] = [];
  private index = -1;
  private deadline = 0;
  private frozenMs = 0;
  private startedAt = 0;
  private sessionId: string | null = null;
  private roundAnswers = new Map<string, { choice: number; elapsedMs: number }>();
  private players = new Map<string, Player>();
  private seen = new Set<string>();
  private activity: Activity[] = [];
  private likes = 0;
  private gifts = 0;
  private followers = 0;
  private scoredRounds = 0;

  constructor(
    settings: Settings,
    private save: (r: SessionRecord) => void,
    private now = Date.now,
    private random = Math.random,
  ) {
    super();
    this.settings = { ...settings };
  }
  get active() {
    return this.phase === 'question' || this.phase === 'reveal';
  }
  get currentQuestion() {
    return this.deck[this.index] ?? null;
  }
  updateSettings(settings: Settings) {
    if (this.active) throw new Error('Ayarları değiştirmeden önce yarışmayı bitir.');
    this.settings = { ...settings };
    this.changed();
  }
  setConnection(state: ConnectionState) {
    this.connection = state;
    if (state.mode === 'tiktok' && state.status !== 'connected' && this.active && !this.paused)
      this.pause('Bağlantı kesildi. Bağlandıktan sonra devam et.');
    this.changed();
  }
  start(questions: Question[]) {
    if (this.active) throw new Error('Yarışma zaten devam ediyor.');
    if (this.connection.status !== 'connected')
      throw new Error('Önce yayın bağlantısını kur veya demo modunu seç.');
    const filtered = questions.filter(
      (q) =>
        (this.settings.category === 'Tümü' || q.category === this.settings.category) &&
        (this.settings.difficulty === 'all' || q.difficulty === this.settings.difficulty),
    );
    if (!filtered.length) throw new Error('Seçilen filtrelerde soru bulunamadı.');
    this.deck = shuffled(filtered, this.random)
      .slice(0, this.settings.sessionQuestions)
      .map((q) => {
        const order = this.settings.shuffleOptions ? shuffled([0, 1, 2, 3], this.random) : [0, 1, 2, 3];
        return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
      });
    this.index = -1;
    this.players.clear();
    this.activity = [];
    this.likes = 0;
    this.gifts = 0;
    this.followers = 0;
    this.scoredRounds = 0;
    this.startedAt = this.now();
    this.sessionId = randomUUID();
    this.paused = false;
    this.pauseReason = '';
    this.beginQuestion();
  }
  private beginQuestion() {
    this.index++;
    if (this.index >= this.deck.length) {
      this.index = this.deck.length - 1;
      this.finish(true);
      return;
    }
    this.roundAnswers.clear();
    this.phase = 'question';
    this.deadline = this.now() + this.settings.questionSeconds * 1000;
    this.changed();
  }
  pause(reason = 'Yayıncı tarafından duraklatıldı.') {
    if (!this.active || this.paused) return;
    this.frozenMs = Math.max(0, this.deadline - this.now());
    this.paused = true;
    this.pauseReason = reason;
    this.changed();
  }
  resume() {
    if (!this.paused) return;
    if (this.connection.status !== 'connected') throw new Error('Bağlantı henüz hazır değil.');
    this.deadline = this.now() + this.frozenMs;
    this.paused = false;
    this.pauseReason = '';
    this.changed();
  }
  tick() {
    if (!this.active || this.paused || this.now() < this.deadline) return;
    if (this.phase === 'question') this.reveal();
    else if (this.settings.autoAdvance) this.beginQuestion();
  }
  advance() {
    if (!this.active || this.paused) throw new Error('Önce yarışmayı başlat veya devam ettir.');
    if (this.phase === 'question') this.reveal();
    else this.beginQuestion();
  }
  stop() {
    if (this.active) this.finish(false);
  }
  private reveal() {
    const correct = this.currentQuestion!.answer;
    for (const [id, answer] of this.roundAnswers) {
      const player = this.players.get(id)!;
      player.answered++;
      if (answer.choice === correct) {
        player.correct++;
        player.responseMs += answer.elapsedMs;
        const speed = Math.max(0, 1 - answer.elapsedMs / (this.settings.questionSeconds * 1000));
        player.score += this.settings.basePoints + Math.floor(this.settings.speedBonus * speed);
      }
    }
    this.scoredRounds++;
    this.phase = 'reveal';
    this.deadline = this.now() + this.settings.revealSeconds * 1000;
    this.changed();
  }
  private finish(completed: boolean) {
    this.phase = 'finished';
    this.paused = false;
    this.pauseReason = '';
    if (this.sessionId)
      this.save({
        id: this.sessionId,
        startedAt: this.startedAt,
        finishedAt: this.now(),
        rounds: this.scoredRounds,
        mode: this.connection.mode,
        completed,
        players: this.rankings(),
      });
    this.changed();
  }
  private acceptEvent(id: string) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  chat(eventId: string, userId: string, name: string, text: string): boolean {
    if (!userId || !this.acceptEvent(eventId)) return false;
    this.log('chat', name, text);
    const choice = parseAnswer(text);
    if (
      choice === null ||
      this.phase !== 'question' ||
      this.paused ||
      this.now() >= this.deadline ||
      this.roundAnswers.has(userId)
    )
      return false;
    if (!this.players.has(userId)) {
      if (this.players.size >= 20000) return false;
      this.players.set(userId, {
        id: userId,
        name: name.slice(0, 40),
        score: 0,
        correct: 0,
        answered: 0,
        responseMs: 0,
      });
    }
    const elapsedMs = Math.max(0, this.settings.questionSeconds * 1000 - (this.deadline - this.now()));
    this.roundAnswers.set(userId, { choice, elapsedMs });
    this.changed();
    return true;
  }
  engagement(
    eventId: string,
    kind: 'gift' | 'like' | 'follow',
    name: string,
    count = 1,
    giftName = 'Hediye',
  ) {
    if (!this.acceptEvent(eventId)) return;
    const safeCount = Math.max(1, Math.min(100000, Math.floor(Number.isFinite(count) ? count : 1)));
    if (kind === 'gift') {
      this.gifts += safeCount;
      this.log(kind, name, `${safeCount} × ${giftName}`);
    }
    if (kind === 'like') this.likes += safeCount;
    if (kind === 'follow') {
      this.followers++;
      this.log(kind, name, 'yayını takip etmeye başladı');
    }
    this.changed();
  }
  private log(kind: Activity['kind'], name: string, text: string) {
    this.activity.unshift({
      id: randomUUID(),
      kind,
      name: name.slice(0, 40),
      text: text.slice(0, 160),
      at: this.now(),
    });
    this.activity = this.activity.slice(0, 60);
  }
  rankings() {
    return [...this.players.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.correct - a.correct ||
          a.responseMs - b.responseMs ||
          a.id.localeCompare(b.id),
      )
      .map((player) => ({ ...player }));
  }
  snapshot(): Snapshot {
    const q = this.currentQuestion;
    const revealed = this.phase === 'reveal' || this.phase === 'finished';
    // Never send the answer or explanation to the overlay before the reveal.
    const question = q
      ? {
          id: q.id,
          category: q.category,
          difficulty: q.difficulty,
          text: q.text,
          options: [...q.options],
          ...(revealed ? { answer: q.answer, explanation: q.explanation } : {}),
        }
      : null;
    const distribution = revealed
      ? [0, 1, 2, 3].map((i) => [...this.roundAnswers.values()].filter((a) => a.choice === i).length)
      : null;
    return {
      phase: this.phase,
      paused: this.paused,
      pauseReason: this.pauseReason,
      sessionId: this.sessionId,
      round: Math.max(0, this.index + 1),
      totalRounds: this.deck.length,
      remainingMs: this.active ? (this.paused ? this.frozenMs : Math.max(0, this.deadline - this.now())) : 0,
      serverNow: this.now(),
      question,
      settings: { ...this.settings },
      answers: this.roundAnswers.size,
      distribution,
      leaderboard: this.rankings().slice(0, 10),
      participants: this.players.size,
      activity: [...this.activity],
      likes: this.likes,
      gifts: this.gifts,
      followers: this.followers,
      connection: { ...this.connection },
    };
  }
  private changed() {
    this.emit('change');
  }
}
