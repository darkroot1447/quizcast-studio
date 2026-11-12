import { z } from 'zod';

export const questionSchema = z
  .object({
    id: z.string().min(1).max(80),
    category: z.string().trim().min(2).max(40),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    text: z.string().trim().min(6).max(240),
    options: z
      .array(z.string().trim().min(1).max(100))
      .length(4)
      .refine(
        (options) => new Set(options.map((s) => s.toLocaleLowerCase('tr'))).size === 4,
        'Şıklar birbirinden farklı olmalı.',
      ),
    answer: z.number().int().min(0).max(3),
    explanation: z.string().trim().max(400),
  })
  .strict();

export const settingsSchema = z
  .object({
    title: z.string().trim().min(2).max(40),
    subtitle: z.string().trim().max(80),
    channel: z
      .string()
      .trim()
      .max(24)
      .regex(/^[a-zA-Z0-9_.]*$/, 'Kullanıcı adını @ olmadan yaz.'),
    questionSeconds: z.number().int().min(5).max(120),
    revealSeconds: z.number().int().min(3).max(30),
    sessionQuestions: z.number().int().min(1).max(100),
    basePoints: z.number().int().min(1).max(1000),
    speedBonus: z.number().int().min(0).max(500),
    category: z.string().trim().min(1).max(40),
    difficulty: z.enum(['all', 'easy', 'medium', 'hard']),
    autoAdvance: z.boolean(),
    shuffleOptions: z.boolean(),
    voiceEnabled: z.boolean(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export type Question = z.infer<typeof questionSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  title: 'Bilgi Arenası',
  subtitle: 'Cevabını sohbete yaz. Zirveye adını yazdır.',
  channel: '',
  questionSeconds: 20,
  revealSeconds: 7,
  sessionQuestions: 10,
  basePoints: 100,
  speedBonus: 50,
  category: 'Tümü',
  difficulty: 'all',
  autoAdvance: true,
  shuffleOptions: true,
  voiceEnabled: true,
  accent: '#c6f36b',
};

export type Player = {
  id: string;
  name: string;
  score: number;
  correct: number;
  answered: number;
  responseMs: number;
};
export type Activity = {
  id: string;
  kind: 'chat' | 'gift' | 'like' | 'follow' | 'system';
  name: string;
  text: string;
  at: number;
};
export type ConnectionState = {
  mode: 'demo' | 'tiktok';
  status: 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  message: string;
  retries: number;
};
export type PublicQuestion = Omit<Question, 'answer' | 'explanation'> & {
  answer?: number;
  explanation?: string;
};
export type Snapshot = {
  phase: 'idle' | 'question' | 'reveal' | 'finished';
  paused: boolean;
  pauseReason: string;
  sessionId: string | null;
  round: number;
  totalRounds: number;
  remainingMs: number;
  serverNow: number;
  question: PublicQuestion | null;
  settings: Settings;
  answers: number;
  distribution: number[] | null;
  leaderboard: Player[];
  participants: number;
  activity: Activity[];
  likes: number;
  gifts: number;
  followers: number;
  connection: ConnectionState;
};
export type SessionRecord = {
  id: string;
  startedAt: number;
  finishedAt: number;
  rounds: number;
  mode: 'demo' | 'tiktok';
  completed: boolean;
  players: Player[];
};
export type LicenseInfo = {
  status: 'development' | 'missing' | 'valid' | 'expired' | 'invalid';
  installationId: string;
  customer?: string;
  expiresAt?: string;
  message: string;
  liveAllowed: boolean;
};
export type AdminData = {
  snapshot: Snapshot;
  settings: Settings;
  questions: Question[];
  history: SessionRecord[];
  overlayToken: string;
  license: LicenseInfo;
  providerConfigured: boolean;
};
export const letters = ['A', 'B', 'C', 'D'] as const;
export const difficultyLabels = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };
