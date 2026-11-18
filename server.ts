import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  type ActiveSessionDraft,
  type PlayerProfile,
  type VoteRecord,
  type VotingQuestion,
} from './src/data/awardsData.ts';
import {
  createDatabaseRepository,
  type AwardsRepository,
} from './src/db/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

export function getClientIp(req: Request): string {
  // In reverse proxy (Render + Vercel), x-forwarded-for contains client IP as first entry
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const firstIp = forwarded[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export function parseDeviceCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)pca_vid=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function deriveAccessIdentity(
  ip: string,
  deviceSignature: string,
  cookieVid: string | null,
  resetNonce: string
) {
  const ipHash = crypto
    .createHash('sha256')
    .update(`ip:${ip}:${resetNonce}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  // Primary hardware/device anchor
  const cleanDevice = (cookieVid || deviceSignature || 'default-device').trim().slice(0, 128);
  const combinedHash = crypto
    .createHash('sha256')
    .update(`pca-token:${ip}:${cleanDevice}:${resetNonce}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  const token = `PCA-${combinedHash.slice(0, 4)}-${combinedHash.slice(4, 8)}`;
  return { token, ipHash };
}

export function verifyPasswordConstantTime(inputPassword: string, expectedPassword: string): boolean {
  if (!inputPassword || !expectedPassword) return false;
  const inputHash = crypto.createHash('sha256').update(inputPassword, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expectedPassword, 'utf8').digest();
  return crypto.timingSafeEqual(inputHash, expectedHash);
}

export function createAdminToken(secret: string, ttlMs: number = ADMIN_TOKEN_TTL_MS): string {
  const payload = {
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + ttlMs,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyAdminToken(token: string, secret: string): boolean {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    if (decoded.role !== 'admin') return false;
    if (typeof decoded.exp !== 'number' || Date.now() > decoded.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidImageSource(url: string): boolean {
  if (!url || url.length > 1_800_000) return false;
  return (
    url.startsWith('/cards/') ||
    url.startsWith('https://') ||
    url.startsWith('http://') ||
    /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)
  );
}

export interface CreateAppOptions {
  repository?: AwardsRepository;
  databaseUrl?: string;
  sqlitePath?: string;
  adminPassword?: string;
  adminTokenSecret?: string;
  frontendOrigins?: string[];
}

export function createApp(options: CreateAppOptions = {}) {
  const repo =
    options.repository ||
    createDatabaseRepository({
      databaseUrl: options.databaseUrl,
      sqlitePath: options.sqlitePath,
    });

  const configuredAdminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '';
  const tokenSecret =
    options.adminTokenSecret ||
    process.env.ADMIN_TOKEN_SECRET ||
    crypto
      .createHash('sha256')
      .update(`pca-secret:${configuredAdminPassword}:${crypto.randomBytes(16).toString('hex')}`)
      .digest('hex');

  const rawOrigins =
    options.frontendOrigins ??
    (process.env.FRONTEND_ORIGIN
      ? process.env.FRONTEND_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
      : []);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Security Headers & CORS Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    const requestOrigin = req.headers.origin;
    if (requestOrigin) {
      const isAllowed =
        rawOrigins.includes('*') ||
        rawOrigins.includes(requestOrigin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin) ||
        /\.vercel\.app$/.test(requestOrigin);

      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 2mb limit supports Base64 compressed card images uploaded by Admin
  app.use(express.json({ limit: '2mb' }));

  // Helper to ensure persistent voter cookie is set
  const ensureVoterCookie = (req: Request, res: Response): string => {
    const existingVid = parseDeviceCookie(req.headers.cookie);
    if (existingVid) return existingVid;

    const newVid = crypto.randomBytes(16).toString('hex');
    const isProd = process.env.NODE_ENV === 'production';
    const sameSite = isProd ? 'None' : 'Lax';
    const secureFlag = isProd ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `pca_vid=${newVid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=${sameSite}${secureFlag}`
    );
    return newVid;
  };

  // Brute-force tracker per IP for admin login
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!verifyAdminToken(token, tokenSecret)) {
      res.status(401).json({
        error: 'Acesso negado. Faça login com a senha de administrador.',
      });
      return;
    }
    next();
  };

  // Healthcheck Route
  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      const questions = await repo.getQuestions();
      res.json({
        ok: true,
        status: 'healthy',
        database: process.env.DATABASE_URL ? 'supabase_postgresql' : 'sqlite',
        questionsCount: questions.length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        status: 'database_error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Admin Authentication Route
  app.post('/api/admin/login', (req: Request, res: Response) => {
    if (!configuredAdminPassword) {
      res.status(503).json({
        error: 'A senha de administrador (ADMIN_PASSWORD) não foi configurada no servidor.',
      });
      return;
    }

    const clientIp = getClientIp(req);
    const now = Date.now();
    const record = loginAttempts.get(clientIp);

    if (record && now < record.resetAt && record.count >= MAX_LOGIN_ATTEMPTS) {
      res.status(429).json({
        error: 'Muitas tentativas incorretas. Aguarde alguns minutos antes de tentar novamente.',
      });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const isValid = verifyPasswordConstantTime(password, configuredAdminPassword);

    if (!isValid) {
      const updatedCount = record && now < record.resetAt ? record.count + 1 : 1;
      loginAttempts.set(clientIp, {
        count: updatedCount,
        resetAt: now + LOGIN_WINDOW_MS,
      });
      res.status(401).json({
        error: 'Senha de administrador incorreta.',
      });
      return;
    }

    loginAttempts.delete(clientIp);
    const adminToken = createAdminToken(tokenSecret);
    res.json({
      ok: true,
      token: adminToken,
      expiresInMs: ADMIN_TOKEN_TTL_MS,
    });
  });

  // Initialize or resume user session with fixed token derived from IP + device signature + cookie
  app.post('/api/session/init', async (req: Request, res: Response) => {
    try {
      const clientIp = getClientIp(req);
      const cookieVid = ensureVoterCookie(req, res);
      const rawDeviceSig =
        typeof req.body?.deviceSignature === 'string' && req.body.deviceSignature.trim()
          ? req.body.deviceSignature.trim().slice(0, 128)
          : 'browser-default';
      const deviceSignature = cookieVid ? `${rawDeviceSig}-${cookieVid}` : rawDeviceSig;

      const resetNonce = await repo.getResetNonce();
      const { token, ipHash } = deriveAccessIdentity(clientIp, deviceSignature, cookieVid, resetNonce);

      const existingVote = await repo.findVoteByTokenOrIdentity(token, deviceSignature, ipHash);
      const votedProfiles = await repo.getVotedSquadProfiles();
      const sortedQuestions = await repo.getQuestions();
      const players = await repo.getPlayers();

      if (existingVote) {
        res.json({
          token: existingVote.token,
          ipHash,
          alreadyVoted: true,
          voteRecord: existingVote,
          draft: null,
          questions: sortedQuestions,
          players,
          votedProfiles,
        });
        return;
      }

      let draft = await repo.getSession(token);
      if (!draft) {
        const now = new Date().toISOString();
        draft = await repo.upsertSession({
          token,
          ipHash,
          deviceSignature,
          selectedProfile: null,
          draftAnswers: {},
          createdAt: now,
          updatedAt: now,
        });
      }

      res.json({
        token,
        ipHash,
        alreadyVoted: false,
        voteRecord: null,
        draft,
        questions: sortedQuestions,
        players,
        votedProfiles,
      });
    } catch (err) {
      console.error('Error on /api/session/init:', err);
      res.status(500).json({ error: 'Erro ao inicializar sessão no banco de dados.' });
    }
  });

  // Save in-progress draft so the fixed token keeps progress until voting is finished
  app.post('/api/session/draft', async (req: Request, res: Response) => {
    try {
      const clientIp = getClientIp(req);
      const cookieVid = ensureVoterCookie(req, res);
      const rawDeviceSig =
        typeof req.body?.deviceSignature === 'string' && req.body.deviceSignature.trim()
          ? req.body.deviceSignature.trim().slice(0, 128)
          : 'browser-default';
      const deviceSignature = cookieVid ? `${rawDeviceSig}-${cookieVid}` : rawDeviceSig;

      const resetNonce = await repo.getResetNonce();
      const { token, ipHash } = deriveAccessIdentity(clientIp, deviceSignature, cookieVid, resetNonce);

      const existingVote = await repo.findVoteByTokenOrIdentity(token, deviceSignature, ipHash);
      if (existingVote) {
        res.status(409).json({ error: 'Este token já concluiu a votação.' });
        return;
      }

      const players = await repo.getPlayers();
      const votedProfiles = await repo.getVotedSquadProfiles();
      const now = new Date().toISOString();
      const current: ActiveSessionDraft = (await repo.getSession(token)) || {
        token,
        ipHash,
        deviceSignature,
        selectedProfile: null,
        draftAnswers: {},
        createdAt: now,
        updatedAt: now,
      };

      if (req.body?.selectedProfile !== undefined) {
        const profile = req.body.selectedProfile;
        // Don't allow draft selection of a squad profile that has already voted
        if (profile !== null && profile !== 'Outro' && votedProfiles.includes(profile)) {
          res.status(409).json({ error: `O perfil "${profile}" já concluiu sua votação.` });
          return;
        }

        if (
          profile === null ||
          profile === 'Outro' ||
          players.some((p) => p.id === profile)
        ) {
          current.selectedProfile = profile;
        }
      }

      if (req.body?.draftAnswers && typeof req.body.draftAnswers === 'object') {
        const cleanedDraft: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.body.draftAnswers)) {
          if (typeof v === 'string') {
            cleanedDraft[k.slice(0, 64)] = v.slice(0, 2000);
          }
        }
        current.draftAnswers = cleanedDraft;
      }
      current.updatedAt = now;

      await repo.upsertSession(current);
      res.json({ ok: true, draft: current });
    } catch (err) {
      console.error('Error on /api/session/draft:', err);
      res.status(500).json({ error: 'Erro ao salvar rascunho da votação.' });
    }
  });

  // Submit final vote and lock the token
  app.post('/api/votes/submit', async (req: Request, res: Response) => {
    try {
      const clientIp = getClientIp(req);
      const cookieVid = ensureVoterCookie(req, res);
      const rawDeviceSig =
        typeof req.body?.deviceSignature === 'string' && req.body.deviceSignature.trim()
          ? req.body.deviceSignature.trim().slice(0, 128)
          : 'browser-default';
      const deviceSignature = cookieVid ? `${rawDeviceSig}-${cookieVid}` : rawDeviceSig;

      const resetNonce = await repo.getResetNonce();
      const { token, ipHash } = deriveAccessIdentity(clientIp, deviceSignature, cookieVid, resetNonce);

      const voterProfile =
        typeof req.body?.voterProfile === 'string' ? req.body.voterProfile.trim() : '';
      const answers =
        req.body?.answers && typeof req.body.answers === 'object'
          ? (req.body.answers as Record<string, string>)
          : {};

      if (!voterProfile) {
        res.status(400).json({ error: 'Selecione um perfil antes de enviar o voto.' });
        return;
      }

      const currentPlayers = await repo.getPlayers();
      const isSquadMember = currentPlayers.some((p) => p.id === voterProfile);
      if (!isSquadMember && voterProfile !== 'Outro') {
        res.status(400).json({ error: 'Perfil de votante inválido.' });
        return;
      }

      // 1. Validate unique token / access (strict: 1 vote per person, blocked forever once voted)
      const duplicateTokenVote = await repo.findVoteByTokenOrIdentity(token, deviceSignature, ipHash);
      if (duplicateTokenVote) {
        res.status(409).json({
          error:
            'Você já concluiu sua votação anteriormente. Cada participante tem direito a um único voto na plataforma.',
          voteRecord: duplicateTokenVote,
        });
        return;
      }

      // 2. If squad member profile selected, check if that profile already voted
      if (isSquadMember) {
        const profileAlreadyUsed = await repo.findVoteByProfile(voterProfile);
        if (profileAlreadyUsed) {
          res.status(409).json({
            error: `O perfil "${voterProfile}" já concluiu sua votação nesta rodada e está desativado.`,
          });
          return;
        }
      }

      // 3. Determine applicable questions for this profile
      const allQuestions = await repo.getQuestions();
      const activeQuestions = allQuestions
        .filter((q) => q.type !== 'stat_info')
        .filter((q) => (voterProfile === 'Outro' ? q.publicVisible : true))
        .sort((a, b) => a.order - b.order);

      // 4. Validate required questions, valid candidate IDs & anti-self-voting rule
      const sanitizedAnswers: Record<string, string> = {};
      for (const q of activeQuestions) {
        const rawVal = typeof answers[q.id] === 'string' ? answers[q.id].trim() : '';
        if (q.required && !rawVal) {
          res.status(400).json({
            error: `A questão "${q.title}" é obrigatória.`,
          });
          return;
        }
        if (!rawVal) continue;

        if (q.type === 'choice') {
          const isValidCandidate = currentPlayers.some((p) => p.id === rawVal);
          if (!isValidCandidate) {
            res.status(400).json({
              error: `Candidato inválido selecionado na categoria "${q.title}".`,
            });
            return;
          }
          if (isSquadMember && rawVal === voterProfile) {
            res.status(400).json({
              error: `Regra violada na categoria "${q.title}": Não é permitido votar em si mesmo (${voterProfile}).`,
            });
            return;
          }
        } else if (q.type === 'text' && rawVal.length > 2000) {
          res.status(400).json({
            error: `A resposta na categoria "${q.title}" excede o limite de 2000 caracteres.`,
          });
          return;
        }

        sanitizedAnswers[q.id] = rawVal;
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

      await repo.createVoteAndClearSession(newVote);

      res.status(201).json({
        ok: true,
        voteRecord: newVote,
      });
    } catch (err) {
      console.error('Error on /api/votes/submit:', err);
      res.status(500).json({ error: 'Erro ao registrar voto no banco de dados.' });
    }
  });

  // ============================================================================
  // PROTECTED ADMIN ROUTES (Require valid Bearer token)
  // ============================================================================

  // Admin Dashboard Data: questions, players, votes, tallies
  app.get('/api/admin/dashboard', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const sortedQuestions = await repo.getQuestions();
      const currentPlayers = await repo.getPlayers();
      const votes = await repo.getVotes();
      const activeSessionsCount = await repo.getActiveSessionsCount();

      const tallies: Record<
        string,
        {
          totalVotes: number;
          byCandidate: Record<string, { total: number; squadVotes: number; publicVotes: number }>;
          textResponses: Array<{
            voterProfile: string;
            token: string;
            text: string;
            submittedAt: string;
          }>;
        }
      > = {};

      for (const q of sortedQuestions) {
        const byCandidate: Record<
          string,
          { total: number; squadVotes: number; publicVotes: number }
        > = {};
        for (const p of currentPlayers) {
          byCandidate[p.id] = { total: 0, squadVotes: 0, publicVotes: 0 };
        }

        const textResponses: Array<{
          voterProfile: string;
          token: string;
          text: string;
          submittedAt: string;
        }> = [];
        let totalVotes = 0;

        for (const vote of votes) {
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
        players: currentPlayers,
        votes,
        activeSessionsCount,
        tallies,
      });
    } catch (err) {
      console.error('Error on /api/admin/dashboard:', err);
      res.status(500).json({ error: 'Erro ao consultar dados administrativos.' });
    }
  });

  // Admin: Delete all voting data (with reset of sessions)
  app.delete('/api/admin/votes', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const deletedCount = await repo.clearAllVotesAndSessions();
      res.json({
        ok: true,
        deletedCount,
        message: 'Todos os dados de votação foram excluídos com sucesso.',
      });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao excluir votos.' });
    }
  });

  // Admin: Create new Squad Member (Player)
  app.post('/api/admin/players', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
      const gamertag =
        typeof req.body?.gamertag === 'string' && req.body.gamertag.trim()
          ? req.body.gamertag.trim().slice(0, 60)
          : name;
      const archetype =
        typeof req.body?.archetype === 'string' && req.body.archetype.trim()
          ? req.body.archetype.trim().toUpperCase().slice(0, 40)
          : 'PRO PLAYER';
      const levelRaw = Number(req.body?.level);
      const level =
        !Number.isNaN(levelRaw) && levelRaw > 0 ? Math.min(999, Math.round(levelRaw)) : 100;
      const totalStatsRaw = Number(req.body?.totalStats);
      const totalStats =
        !Number.isNaN(totalStatsRaw) && totalStatsRaw > 0
          ? Math.min(9999, Math.round(totalStatsRaw))
          : 370;
      const statsSummary =
        typeof req.body?.statsSummary === 'string' && req.body.statsSummary.trim()
          ? req.body.statsSummary.trim().slice(0, 120)
          : 'FIN 90 · VIS 90 · DRI 90 · VEL 90';
      const nationality =
        typeof req.body?.nationality === 'string' && req.body.nationality.trim()
          ? req.body.nationality.trim().toUpperCase().slice(0, 8)
          : 'BR';
      const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';

      if (!name) {
        res.status(400).json({ error: 'O nome do integrante do elenco é obrigatório.' });
        return;
      }

      if (name.toLowerCase() === 'outro') {
        res.status(400).json({ error: 'O nome "Outro" é reservado para o perfil público.' });
        return;
      }

      if (!imageUrl || !isValidImageSource(imageUrl)) {
        res.status(400).json({
          error: 'Envie uma foto válida da carta (upload de imagem ou URL válida).',
        });
        return;
      }

      const id = name;
      const existing = await repo.getPlayerById(id);
      if (existing) {
        res.status(409).json({
          error: `Já existe um integrante cadastrado com o nome "${name}".`,
        });
        return;
      }

      const newPlayer: PlayerProfile = {
        id,
        name,
        gamertag,
        archetype,
        level,
        totalStats,
        statsSummary,
        imageUrl,
        nationality,
      };

      await repo.createPlayer(newPlayer);
      res.status(201).json({ ok: true, player: newPlayer });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao cadastrar integrante.' });
    }
  });

  // Admin: Edit existing Squad Member (Player)
  app.put('/api/admin/players/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await repo.getPlayerById(id);
      if (!existing) {
        res.status(404).json({ error: 'Integrante não encontrado no elenco.' });
        return;
      }

      const name =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim().slice(0, 60)
          : existing.name;
      const gamertag =
        typeof req.body?.gamertag === 'string' && req.body.gamertag.trim()
          ? req.body.gamertag.trim().slice(0, 60)
          : existing.gamertag;
      const archetype =
        typeof req.body?.archetype === 'string' && req.body.archetype.trim()
          ? req.body.archetype.trim().toUpperCase().slice(0, 40)
          : existing.archetype;
      const levelRaw = Number(req.body?.level);
      const level =
        req.body?.level !== undefined && !Number.isNaN(levelRaw) && levelRaw > 0
          ? Math.min(999, Math.round(levelRaw))
          : existing.level;
      const totalStatsRaw = Number(req.body?.totalStats);
      const totalStats =
        req.body?.totalStats !== undefined && !Number.isNaN(totalStatsRaw) && totalStatsRaw > 0
          ? Math.min(9999, Math.round(totalStatsRaw))
          : existing.totalStats;
      const statsSummary =
        typeof req.body?.statsSummary === 'string' && req.body.statsSummary.trim()
          ? req.body.statsSummary.trim().slice(0, 120)
          : existing.statsSummary;
      const nationality =
        typeof req.body?.nationality === 'string' && req.body.nationality.trim()
          ? req.body.nationality.trim().toUpperCase().slice(0, 8)
          : existing.nationality;
      const imageUrl =
        typeof req.body?.imageUrl === 'string' && req.body.imageUrl.trim()
          ? req.body.imageUrl.trim()
          : existing.imageUrl;

      if (!isValidImageSource(imageUrl)) {
        res.status(400).json({
          error: 'A foto informada para a carta não é válida.',
        });
        return;
      }

      const updated: PlayerProfile = {
        ...existing,
        name,
        gamertag,
        archetype,
        level,
        totalStats,
        statsSummary,
        imageUrl,
        nationality,
      };

      await repo.updatePlayer(updated);
      res.json({ ok: true, player: updated });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao atualizar integrante.' });
    }
  });

  // Admin: Delete Squad Member (Player)
  app.delete('/api/admin/players/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const currentPlayers = await repo.getPlayers();
      if (currentPlayers.length <= 2) {
        res.status(400).json({
          error: 'O elenco deve manter pelo menos 2 integrantes para a votação.',
        });
        return;
      }

      const removed = await repo.deletePlayer(id);
      if (!removed) {
        res.status(404).json({ error: 'Integrante não encontrado no elenco.' });
        return;
      }

      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao remover integrante.' });
    }
  });

  // Admin: Restore default squad members
  app.post('/api/admin/players/reset', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const players = await repo.resetDefaultPlayers();
      res.json({ ok: true, players });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao restaurar integrantes padrão.' });
    }
  });

  // Admin: Create new question
  app.post('/api/admin/questions', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 160) : '';
      const subtitle =
        typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim().slice(0, 300) : '';
      const type =
        req.body?.type === 'text' || req.body?.type === 'stat_info' ? req.body.type : 'choice';
      const publicVisible = Boolean(req.body?.publicVisible);
      const showPhotos = Boolean(req.body?.showPhotos);
      const required =
        req.body?.required !== undefined ? Boolean(req.body.required) : type !== 'stat_info';

      if (!title) {
        res.status(400).json({ error: 'O título da questão é obrigatório.' });
        return;
      }

      const existingQuestions = await repo.getQuestions();
      const maxOrder = existingQuestions.reduce((max, q) => Math.max(max, q.order), 0);
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

      await repo.createQuestion(newQuestion);
      res.status(201).json({ ok: true, question: newQuestion });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao criar questão.' });
    }
  });

  // Admin: Edit existing question
  app.put('/api/admin/questions/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await repo.getQuestionById(id);
      if (!existing) {
        res.status(404).json({ error: 'Questão não encontrada.' });
        return;
      }

      const title =
        typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 160) : existing.title;
      const subtitle =
        typeof req.body?.subtitle === 'string'
          ? req.body.subtitle.trim().slice(0, 300)
          : existing.subtitle;
      const type =
        req.body?.type === 'choice' || req.body?.type === 'text' || req.body?.type === 'stat_info'
          ? req.body.type
          : existing.type;
      const publicVisible =
        req.body?.publicVisible !== undefined
          ? Boolean(req.body.publicVisible)
          : existing.publicVisible;
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

      await repo.updateQuestion(updated);
      res.json({ ok: true, question: updated });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao atualizar questão.' });
    }
  });

  // Admin: Delete question
  app.delete('/api/admin/questions/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const removed = await repo.deleteQuestion(id);
      if (!removed) {
        res.status(404).json({ error: 'Questão não encontrada.' });
        return;
      }
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao remover questão.' });
    }
  });

  // Admin: Restore default questions from original Google Form
  app.post('/api/admin/questions/reset', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const questions = await repo.resetDefaultQuestions();
      res.json({ ok: true, questions });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao restaurar questões padrão.' });
    }
  });

  return { app, repo };
}

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const { app, repo } = createApp();

  // Initialize DB tables and seed data
  await repo.init();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    const indexPath = path.join(distPath, 'index.html');
    const hasDistBuild = fs.existsSync(indexPath);

    if (hasDistBuild) {
      app.use(express.static(distPath));
    }

    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Endpoint não encontrado.' });
        return;
      }

      if (hasDistBuild) {
        res.sendFile(indexPath);
      } else {
        res.json({
          service: 'Pro Clubs Awards API',
          status: 'online',
          message:
            'O backend e o banco de dados estão operacionais. O frontend desta aplicação está hospedado na Vercel.',
          healthcheck: '/api/health',
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pro Clubs Awards server running on http://0.0.0.0:${PORT}`);
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  startServer().catch((err) => {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  });
}
