import crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_QUESTIONS,
  PLAYERS,
  type ActiveSessionDraft,
  type VoteRecord,
  type VotingQuestion,
} from './src/data/awardsData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

interface DataStore {
  questions: VotingQuestion[];
  votes: VoteRecord[];
  sessions: Record<string, ActiveSessionDraft>;
  resetNonce: string;
}

function loadStore(): DataStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DataStore>;
      return {
        questions:
          Array.isArray(parsed.questions) && parsed.questions.length > 0
            ? parsed.questions
            : [...DEFAULT_QUESTIONS],
        votes: Array.isArray(parsed.votes) ? parsed.votes : [],
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        resetNonce: typeof parsed.resetNonce === 'string' ? parsed.resetNonce : 'v1',
      };
    }
  } catch (err) {
    console.error('Error reading store.json, initializing fresh store:', err);
  }
  const initial: DataStore = {
    questions: [...DEFAULT_QUESTIONS],
    votes: [],
    sessions: {},
    resetNonce: 'v1',
  };
  saveStore(initial);
  return initial;
}

function saveStore(store: DataStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving store.json:', err);
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function deriveAccessIdentity(ip: string, deviceSignature: string, resetNonce: string) {
  const ipHash = crypto.createHash('sha256').update(`ip:${ip}:${resetNonce}`).digest('hex').slice(0, 12).toUpperCase();
  const cleanDevice = (deviceSignature || 'default-device').trim();
  const combinedHash = crypto
    .createHash('sha256')
    .update(`pca-token:${ip}:${cleanDevice}:${resetNonce}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  const token = `PCA-${combinedHash.slice(0, 4)}-${combinedHash.slice(4, 8)}`;
  return { token, ipHash };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  const store = loadStore();

  // Initialize or resume user session with fixed token derived from IP + device signature
  app.post('/api/session/init', (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    const deviceSignature =
      typeof req.body?.deviceSignature === 'string' && req.body.deviceSignature.trim()
        ? req.body.deviceSignature.trim()
        : 'browser-default';

    const { token, ipHash } = deriveAccessIdentity(clientIp, deviceSignature, store.resetNonce);

    // Check if this token or device has already completed voting
    const existingVote = store.votes.find(
      (v) => v.token === token || (v.deviceSignature === deviceSignature && v.ipHash === ipHash)
    );

    const votedProfiles = Array.from(
      new Set(
        store.votes
          .filter((v) => v.voterProfile !== 'Outro')
          .map((v) => v.voterProfile)
      )
    );

    const sortedQuestions = [...store.questions].sort((a, b) => a.order - b.order);

    if (existingVote) {
      res.json({
        token: existingVote.token,
        ipHash,
        alreadyVoted: true,
        voteRecord: existingVote,
        draft: null,
        questions: sortedQuestions,
        votedProfiles,
      });
      return;
    }

    // Maintain fixed session draft until voting is concluded
    let draft = store.sessions[token];
    if (!draft) {
      const now = new Date().toISOString();
      draft = {
        token,
        ipHash,
        deviceSignature,
        selectedProfile: null,
        draftAnswers: {},
        createdAt: now,
        updatedAt: now,
      };
      store.sessions[token] = draft;
      saveStore(store);
    }

    res.json({
      token,
      ipHash,
      alreadyVoted: false,
      voteRecord: null,
      draft,
      questions: sortedQuestions,
      votedProfiles,
    });
  });

  // Save in-progress draft so the fixed token keeps progress until voting is finished
  app.post('/api/session/draft', (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    const deviceSignature =
      typeof req.body?.deviceSignature === 'string' ? req.body.deviceSignature.trim() : 'browser-default';
    const { token, ipHash } = deriveAccessIdentity(clientIp, deviceSignature, store.resetNonce);

    const existingVote = store.votes.find((v) => v.token === token);
    if (existingVote) {
      res.status(409).json({ error: 'Este token já concluiu a votação.' });
      return;
    }

    const now = new Date().toISOString();
    const current = store.sessions[token] || {
      token,
      ipHash,
      deviceSignature,
      selectedProfile: null,
      draftAnswers: {},
      createdAt: now,
      updatedAt: now,
    };

    if (req.body.selectedProfile !== undefined) {
      current.selectedProfile = req.body.selectedProfile;
    }
    if (req.body.draftAnswers && typeof req.body.draftAnswers === 'object') {
      current.draftAnswers = req.body.draftAnswers;
    }
    current.updatedAt = now;

    store.sessions[token] = current;
    saveStore(store);

    res.json({ ok: true, draft: current });
  });

  // Submit final vote and lock the token
  app.post('/api/votes/submit', (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    const deviceSignature =
      typeof req.body?.deviceSignature === 'string' ? req.body.deviceSignature.trim() : 'browser-default';
    const { token, ipHash } = deriveAccessIdentity(clientIp, deviceSignature, store.resetNonce);

    const voterProfile = typeof req.body?.voterProfile === 'string' ? req.body.voterProfile.trim() : '';
    const answers =
      req.body?.answers && typeof req.body.answers === 'object'
        ? (req.body.answers as Record<string, string>)
        : {};

    if (!voterProfile) {
      res.status(400).json({ error: 'Selecione um perfil antes de enviar o voto.' });
      return;
    }

    // 1. Validate unique token / access (only 1 vote per person)
    const duplicateTokenVote = store.votes.find(
      (v) => v.token === token || (v.deviceSignature === deviceSignature && v.ipHash === ipHash)
    );
    if (duplicateTokenVote) {
      res.status(409).json({
        error: 'Este token de acesso já registrou um voto. Só é permitido votar uma única vez.',
        voteRecord: duplicateTokenVote,
      });
      return;
    }

    // 2. If squad member profile selected, check if that profile already voted
    const isSquadMember = PLAYERS.some((p) => p.id === voterProfile);
    if (isSquadMember) {
      const profileAlreadyUsed = store.votes.find((v) => v.voterProfile === voterProfile);
      if (profileAlreadyUsed) {
        res.status(409).json({
          error: `O perfil "${voterProfile}" já realizou sua votação nesta rodada.`,
        });
        return;
      }
    }

    // 3. Determine applicable questions for this profile
    const activeQuestions = store.questions
      .filter((q) => q.type !== 'stat_info')
      .filter((q) => (voterProfile === 'Outro' ? q.publicVisible : true))
      .sort((a, b) => a.order - b.order);

    // 4. Validate required questions & anti-self-voting rule
    const sanitizedAnswers: Record<string, string> = {};
    for (const q of activeQuestions) {
      const rawVal = typeof answers[q.id] === 'string' ? answers[q.id].trim() : '';
      if (q.required && !rawVal) {
        res.status(400).json({
          error: `A questão "${q.title}" é obrigatória.`,
        });
        return;
      }
      if (q.type === 'choice' && isSquadMember && rawVal === voterProfile) {
        res.status(400).json({
          error: `Regra violada na categoria "${q.title}": Não é permitido votar em si mesmo (${voterProfile}).`,
        });
        return;
      }
      if (rawVal) {
        sanitizedAnswers[q.id] = rawVal;
      }
    }

    const newVote: VoteRecord = {
      id: crypto.randomUUID(),
      token,
      ipHash,
      deviceSignature,
      voterProfile,
      answers: sanitizedAnswers,
      submittedAt: new Date().toISOString(),
    };

    store.votes.push(newVote);
    delete store.sessions[token];
    saveStore(store);

    res.status(201).json({
      ok: true,
      voteRecord: newVote,
    });
  });

  // Admin Dashboard Data: questions, votes, tallies
  app.get('/api/admin/dashboard', (_req: Request, res: Response) => {
    const sortedQuestions = [...store.questions].sort((a, b) => a.order - b.order);

    const tallies: Record<
      string,
      {
        totalVotes: number;
        byCandidate: Record<string, { total: number; squadVotes: number; publicVotes: number }>;
        textResponses: Array<{ voterProfile: string; token: string; text: string; submittedAt: string }>;
      }
    > = {};

    for (const q of sortedQuestions) {
      const byCandidate: Record<string, { total: number; squadVotes: number; publicVotes: number }> = {};
      for (const p of PLAYERS) {
        byCandidate[p.id] = { total: 0, squadVotes: 0, publicVotes: 0 };
      }

      const textResponses: Array<{ voterProfile: string; token: string; text: string; submittedAt: string }> = [];
      let totalVotes = 0;

      for (const vote of store.votes) {
        const ans = vote.answers[q.id];
        if (!ans) continue;

        if (q.type === 'choice') {
          if (!byCandidate[ans]) {
            byCandidate[ans] = { total: 0, squadVotes: 0, publicVotes: 0 };
          }
          byCandidate[ans].total += 1;
          if (vote.voterProfile === 'Outro') {
            byCandidate[ans].publicVotes += 1;
          } else {
            byCandidate[ans].squadVotes += 1;
          }
          totalVotes += 1;
        } else if (q.type === 'text') {
          textResponses.push({
            voterProfile: vote.voterProfile,
            token: vote.token,
            text: ans,
            submittedAt: vote.submittedAt,
          });
          totalVotes += 1;
        }
      }

      tallies[q.id] = {
        totalVotes,
        byCandidate,
        textResponses,
      };
    }

    res.json({
      questions: sortedQuestions,
      votes: [...store.votes].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      activeSessionsCount: Object.keys(store.sessions).length,
      tallies,
    });
  });

  // Admin: Delete all voting data (with reset of sessions)
  app.delete('/api/admin/votes', (_req: Request, res: Response) => {
    const deletedCount = store.votes.length;
    store.votes = [];
    store.sessions = {};
    // Keep the deterministic token structure clean
    saveStore(store);

    res.json({
      ok: true,
      deletedCount,
      message: 'Todos os dados de votação foram excluídos com sucesso.',
    });
  });

  // Admin: Create new question
  app.post('/api/admin/questions', (req: Request, res: Response) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : '';
    const type =
      req.body?.type === 'text' || req.body?.type === 'stat_info' ? req.body.type : 'choice';
    const publicVisible = Boolean(req.body?.publicVisible);
    const showPhotos = Boolean(req.body?.showPhotos);
    const required = req.body?.required !== undefined ? Boolean(req.body.required) : type !== 'stat_info';

    if (!title) {
      res.status(400).json({ error: 'O título da questão é obrigatório.' });
      return;
    }

    const maxOrder = store.questions.reduce((max, q) => Math.max(max, q.order), 0);
    const slugBase = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 24);
    const id = `${slugBase || 'questao'}_${Date.now().toString(36)}`;

    const newQuestion: VotingQuestion = {
      id,
      title,
      subtitle,
      type,
      publicVisible: type === 'stat_info' ? false : publicVisible,
      showPhotos: type === 'choice' ? showPhotos : false,
      required: type === 'stat_info' ? false : required,
      order: maxOrder + 1,
    };

    store.questions.push(newQuestion);
    saveStore(store);

    res.status(201).json({ ok: true, question: newQuestion });
  });

  // Admin: Edit existing question
  app.put('/api/admin/questions/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const index = store.questions.findIndex((q) => q.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Questão não encontrada.' });
      return;
    }

    const existing = store.questions[index];
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : existing.title;
    const subtitle =
      typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : existing.subtitle;
    const type =
      req.body?.type === 'choice' || req.body?.type === 'text' || req.body?.type === 'stat_info'
        ? req.body.type
        : existing.type;
    const publicVisible =
      req.body?.publicVisible !== undefined ? Boolean(req.body.publicVisible) : existing.publicVisible;
    const showPhotos =
      req.body?.showPhotos !== undefined ? Boolean(req.body.showPhotos) : existing.showPhotos;
    const required =
      req.body?.required !== undefined ? Boolean(req.body.required) : existing.required;
    const order =
      typeof req.body?.order === 'number' && !Number.isNaN(req.body.order)
        ? req.body.order
        : existing.order;

    if (!title) {
      res.status(400).json({ error: 'O título da questão não pode ficar vazio.' });
      return;
    }

    const updated: VotingQuestion = {
      ...existing,
      title,
      subtitle,
      type,
      publicVisible: type === 'stat_info' ? false : publicVisible,
      showPhotos: type === 'choice' ? showPhotos : false,
      required: type === 'stat_info' ? false : required,
      order,
    };

    store.questions[index] = updated;
    saveStore(store);

    res.json({ ok: true, question: updated });
  });

  // Admin: Delete question
  app.delete('/api/admin/questions/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const index = store.questions.findIndex((q) => q.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Questão não encontrada.' });
      return;
    }

    const [removed] = store.questions.splice(index, 1);
    saveStore(store);

    res.json({ ok: true, removed });
  });

  // Admin: Restore default questions from original Google Form
  app.post('/api/admin/questions/reset', (_req: Request, res: Response) => {
    store.questions = [...DEFAULT_QUESTIONS];
    saveStore(store);
    res.json({ ok: true, questions: store.questions });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pro Clubs Awards server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
