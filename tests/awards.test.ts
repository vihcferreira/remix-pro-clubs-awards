import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { describe, it, after, before } from 'node:test';
import type { Application } from 'express';
import {
  createAdminToken,
  createApp,
  deriveAccessIdentity,
  verifyAdminToken,
  verifyPasswordConstantTime,
} from '../server.ts';
import { DEFAULT_QUESTIONS, PLAYERS } from '../src/data/awardsData.ts';
import { sanitizeDatabaseUrl, SqliteAwardsRepository } from '../src/db/database.ts';

interface SimulatedResponse {
  status: number;
  headers: Map<string, string>;
  json: <T = unknown>() => Promise<T>;
}

function simulateRequest(
  app: Application,
  method: string,
  urlPath: string,
  options: {
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<SimulatedResponse> {
  return new Promise((resolve, reject) => {
    const mockSocket = Object.assign(
      new Duplex({
        read() {},
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      {
        remoteAddress: '127.0.0.1',
      }
    ) as unknown as net.Socket;

    const req = new http.IncomingMessage(mockSocket);
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.headers || {})) {
      lowerHeaders[k.toLowerCase()] = v;
    }
    const bodyBuf = options.body ? Buffer.from(options.body, 'utf8') : Buffer.alloc(0);
    if (options.body && !lowerHeaders['content-length']) {
      lowerHeaders['content-length'] = String(bodyBuf.length);
    }

    req.method = method.toUpperCase();
    req.url = urlPath;
    req.headers = lowerHeaders;

    const resHeaders = new Map<string, string>();
    const chunks: Buffer[] = [];
    const res = new EventEmitter() as unknown as Record<string, unknown> & EventEmitter;
    res.statusCode = 200;
    res.headersSent = false;

    res.setHeader = (name: string, value: string | string[]) => {
      resHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
      return res;
    };
    res.getHeader = (name: string) => resHeaders.get(name.toLowerCase());
    res.removeHeader = (name: string) => resHeaders.delete(name.toLowerCase());
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.writeHead = (code: number, headers?: Record<string, string>) => {
      res.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          resHeaders.set(k.toLowerCase(), String(v));
        }
      }
      res.headersSent = true;
      return res;
    };
    res.write = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
      return true;
    };
    res.end = (chunk?: Buffer | string) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
      }
      res.headersSent = true;
      const rawText = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: Number(res.statusCode),
        headers: {
          get: (name: string) => resHeaders.get(name.toLowerCase()) ?? null,
        } as unknown as Map<string, string>,
        json: async <T = unknown>() => (rawText ? (JSON.parse(rawText) as T) : ({} as T)),
      });
      return res;
    };
    res.json = (data: unknown) => {
      resHeaders.set('content-type', 'application/json; charset=utf-8');
      return (res.end as (c: string) => unknown)(JSON.stringify(data));
    };

    try {
      (app as unknown as (rq: unknown, rs: unknown, next: (err?: unknown) => void) => void)(
        req,
        res,
        (err?: unknown) => {
          if (err) reject(err);
        }
      );

      queueMicrotask(() => {
        if (bodyBuf.length > 0) {
          req.push(bodyBuf);
        }
        req.push(null);
      });
    } catch (err) {
      reject(err);
    }
  });
}

const TEST_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestAdminPass_2026!';

describe('1. Testes Unitários — Segurança, Senha e Tokens', () => {
  it('valida a senha do admin em tempo constante (timingSafeEqual)', () => {
    assert.equal(verifyPasswordConstantTime(TEST_ADMIN_PASSWORD, TEST_ADMIN_PASSWORD), true);
    assert.equal(
      verifyPasswordConstantTime(TEST_ADMIN_PASSWORD.toLowerCase(), TEST_ADMIN_PASSWORD),
      false
    );
    assert.equal(verifyPasswordConstantTime('senha-errada', TEST_ADMIN_PASSWORD), false);
    assert.equal(verifyPasswordConstantTime('', TEST_ADMIN_PASSWORD), false);
  });

  it('gera e valida tokens HMAC do Admin e rejeita tokens adulterados ou expirados', () => {
    const secret = 'segredo-teste-hmac-123456';
    const validToken = createAdminToken(secret, 60_000);
    assert.equal(verifyAdminToken(validToken, secret), true);
    assert.equal(verifyAdminToken(validToken, 'outro-segredo'), false);
    assert.equal(verifyAdminToken(`${validToken}x`, secret), false);

    const expiredToken = createAdminToken(secret, -5_000);
    assert.equal(verifyAdminToken(expiredToken, secret), false);
  });

  it('gera token determinístico de votante por IP + dispositivo + cookie', () => {
    const id1 = deriveAccessIdentity('192.168.1.10', 'HW-ABC123', 'cookie-vid-1', 'v1');
    const id2 = deriveAccessIdentity('192.168.1.10', 'HW-ABC123', 'cookie-vid-1', 'v1');
    const idDiffIp = deriveAccessIdentity('192.168.1.11', 'HW-ABC123', 'cookie-vid-1', 'v1');

    assert.equal(id1.token, id2.token);
    assert.equal(id1.ipHash, id2.ipHash);
    assert.match(id1.token, /^PCA-[A-F0-9]{4}-[A-F0-9]{4}$/);
    assert.notEqual(id1.token, idDiffIp.token);
  });

  it('codifica automaticamente caracteres especiais (@, #, colchetes) na senha do DATABASE_URL do Supabase', () => {
    const rawWithSpecialChars =
      'postgresql://postgres.projid:@TestPass123#@aws-0-us-west-2.pooler.supabase.com:6543/postgres';
    const rawWithBrackets =
      'postgresql://postgres.projid:[@TestPass123#]@aws-0-us-west-2.pooler.supabase.com:6543/postgres';
    const expected =
      'postgresql://postgres.projid:%40TestPass123%23@aws-0-us-west-2.pooler.supabase.com:6543/postgres';

    assert.equal(sanitizeDatabaseUrl(rawWithSpecialChars), expected);
    assert.equal(sanitizeDatabaseUrl(rawWithBrackets), expected);
    assert.equal(sanitizeDatabaseUrl(expected), expected);
  });
});

describe('2. Testes Unitários — Persistência e Multi-Votos', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pca-sqlite-test-'));
  const dbFilePath = path.join(tmpDir, 'test-awards.db');

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('persiste múltiplos votos no banco de dados e os mantém intactos para consulta do admin', async () => {
    const repo1 = new SqliteAwardsRepository(dbFilePath);
    await repo1.init();

    // Voto 1: Lourival
    await repo1.createVoteAndClearSession({
      id: 'vote-1',
      token: 'PCA-1111-1111',
      ipHash: 'IPHASH000001',
      deviceSignature: 'HW-DEV1',
      voterProfile: 'Lourival',
      answers: { rodilindo_dor: 'Pedrin', beckham_dor: 'Victor' },
      submittedAt: new Date().toISOString(),
    });

    // Voto 2: Pedrão
    await repo1.createVoteAndClearSession({
      id: 'vote-2',
      token: 'PCA-2222-2222',
      ipHash: 'IPHASH000002',
      deviceSignature: 'HW-DEV2',
      voterProfile: 'Pedrão',
      answers: { rodilindo_dor: 'Lourival', beckham_dor: 'Pedrin' },
      submittedAt: new Date().toISOString(),
    });

    // Voto 3: Outro
    await repo1.createVoteAndClearSession({
      id: 'vote-3',
      token: 'PCA-3333-3333',
      ipHash: 'IPHASH000003',
      deviceSignature: 'HW-DEV3',
      voterProfile: 'Outro',
      answers: { rodilindo_dor: 'Pedrão', beckham_dor: 'Victor' },
      submittedAt: new Date().toISOString(),
    });

    await repo1.close();

    // Reabre a conexão e verifica que todos os 3 votos estão 100% persistidos
    const repo2 = new SqliteAwardsRepository(dbFilePath);
    await repo2.init();

    const votes = await repo2.getVotes();
    assert.equal(votes.length, 3);
    const votedSquad = await repo2.getVotedSquadProfiles();
    assert.equal(votedSquad.includes('Lourival'), true);
    assert.equal(votedSquad.includes('Pedrão'), true);
    assert.equal(votedSquad.includes('Outro'), false);

    await repo2.close();
  });
});

describe('3. Testes de Integração da API — Autenticação, Travas Rígidas e Bloqueio de Perfil', () => {
  let app: Application;
  let closeRepo: () => Promise<void>;

  before(async () => {
    const repo = new SqliteAwardsRepository(':memory:');
    await repo.init();

    const created = createApp({
      repository: repo,
      adminPassword: TEST_ADMIN_PASSWORD,
      adminTokenSecret: 'test-secret-key-for-integration',
      frontendOrigins: ['https://meu-front.vercel.app'],
    });
    app = created.app;
    closeRepo = () => repo.close();
  });

  after(async () => {
    await closeRepo();
  });

  it('retorna healthcheck e headers de segurança e CORS', async () => {
    const res = await simulateRequest(app, 'GET', '/api/health', {
      headers: { Origin: 'https://meu-front.vercel.app' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://meu-front.vercel.app');
    const body = await res.json<{ ok: boolean; status: string }>();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'healthy');
  });

  it('bloqueia acesso não autenticado a todas as rotas /api/admin/*', async () => {
    const dashRes = await simulateRequest(app, 'GET', '/api/admin/dashboard');
    assert.equal(dashRes.status, 401);

    const createQRes = await simulateRequest(app, 'POST', '/api/admin/questions', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Invasão' }),
    });
    assert.equal(createQRes.status, 401);

    const deleteVotesRes = await simulateRequest(app, 'DELETE', '/api/admin/votes');
    assert.equal(deleteVotesRes.status, 401);
  });

  it('rejeita senha incorreta no login do Admin e aplica rate-limit contra brute-force', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await simulateRequest(app, 'POST', '/api/admin/login', {
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.99',
        },
        body: JSON.stringify({ password: `errada-${i}` }),
      });
      assert.equal(res.status, 401);
    }

    const blockedRes = await simulateRequest(app, 'POST', '/api/admin/login', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.99',
      },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(blockedRes.status, 429);
  });

  it('autentica com a senha correta e permite adicionar e listar integrantes', async () => {
    const loginRes = await simulateRequest(app, 'POST', '/api/admin/login', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.0.0.1',
      },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json<{ ok: boolean; token: string }>();
    assert.equal(loginData.ok, true);
    assert.ok(loginData.token);

    const authHeaders = {
      Authorization: `Bearer ${loginData.token}`,
      'Content-Type': 'application/json',
    };

    const addPlayerRes = await simulateRequest(app, 'POST', '/api/admin/players', {
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Carlos',
        gamertag: 'CarlosPro99',
        archetype: 'SPARK+',
        level: 100,
        totalStats: 380,
        statsSummary: 'VEL 95 · FIN 92 · DRI 94 · PAS 90',
        nationality: 'BR',
        imageUrl: '/cards/pedrin.jpg',
      }),
    });
    assert.equal(addPlayerRes.status, 201);

    const dashRes = await simulateRequest(app, 'GET', '/api/admin/dashboard', {
      headers: authHeaders,
    });
    assert.equal(dashRes.status, 200);
    const dashData = await dashRes.json<{ players: Array<{ id: string }> }>();
    assert.equal(dashData.players.some((p) => p.id === 'Carlos'), true);
  });

  it('valida regras rígidas de votação e desativação definitiva de perfil', async () => {
    const squadAnswers: Record<string, string> = {
      soldado: 'Pedrão',
      bagre_do_ano: 'Pedrão',
      morto_de_fome: 'Lourival',
      diraca_dor: 'Igor',
      rodilindo_dor: 'Victor',
      beckham_dor: 'Paulo',
      ragebait: 'Lourival',
      ballon_dor: 'Victor',
      gol_puskas: 'Gol de bicicleta do Victor aos 90 minutos',
    };

    // 1. Voto válido de integrante do elenco (Pedrin)
    const validSquadRes = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.1',
        Cookie: 'pca_vid=pedrin-cookie-id-12345',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-PEDRIN',
        voterProfile: 'Pedrin',
        answers: squadAnswers,
      }),
    });
    assert.equal(validSquadRes.status, 201);

    // 2. Mesma pessoa tentando votar novamente usando outro navegador/aba anônima no mesmo IP -> Deve bloquear com 409
    const secondVoteAttempt = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.1',
      },
      body: JSON.stringify({
        deviceSignature: 'ANONYMOUS-TAB-DIFFERENT-SIG',
        voterProfile: 'Outro',
        answers: { rodilindo_dor: 'Victor', beckham_dor: 'Paulo' },
      }),
    });
    assert.equal(secondVoteAttempt.status, 409);

    // 3. Outra pessoa de outro IP tentando usar o perfil "Pedrin" que já concluiu o voto -> Deve bloquear com 409 (Perfil desativado)
    const profileReuseAttempt = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.99',
        Cookie: 'pca_vid=other-person-vid-99',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-OTHER-PC',
        voterProfile: 'Pedrin',
        answers: squadAnswers,
      }),
    });
    assert.equal(profileReuseAttempt.status, 409);

    // 4. O perfil "Pedrin" deve aparecer na lista de perfis que já votaram em /api/session/init
    const initRes = await simulateRequest(app, 'POST', '/api/session/init', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.88',
      },
      body: JSON.stringify({ deviceSignature: 'DEV-NEW-GUEST' }),
    });
    assert.equal(initRes.status, 200);
    const initData = await initRes.json<{ votedProfiles: string[] }>();
    assert.equal(initData.votedProfiles.includes('Pedrin'), true);
  });
});
