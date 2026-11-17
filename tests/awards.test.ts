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
import { DEFAULT_QUESTIONS } from '../src/data/awardsData.ts';
import { createAwardsDatabase } from '../src/db/database.ts';

interface SimulatedResponse {
  status: number;
  headers: Map<string, string>;
  json: <T = unknown>() => Promise<T>;
}

/**
 * Executa uma requisição diretamente no pipeline do Express em memória,
 * permitindo testar middlewares, body-parser, rotas, CORS e autenticação
 * sem depender de abertura de portas TCP de rede.
 */
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

  it('gera token determinístico de votante por IP + dispositivo', () => {
    const id1 = deriveAccessIdentity('192.168.1.10', 'HW-ABC123', 'v1');
    const id2 = deriveAccessIdentity('192.168.1.10', 'HW-ABC123', 'v1');
    const idDiffIp = deriveAccessIdentity('192.168.1.11', 'HW-ABC123', 'v1');

    assert.equal(id1.token, id2.token);
    assert.equal(id1.ipHash, id2.ipHash);
    assert.match(id1.token, /^PCA-[A-F0-9]{4}-[A-F0-9]{4}$/);
    assert.notEqual(id1.token, idDiffIp.token);
  });
});

describe('2. Testes Unitários — Persistência em Arquivo SQLite', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pca-sqlite-test-'));
  const dbFilePath = path.join(tmpDir, 'test-awards.db');

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('inicializa as questões padrão e persiste votos e questões entre reconexões ao arquivo SQLite', () => {
    const repo1 = createAwardsDatabase(dbFilePath);
    const initialQuestions = repo1.getQuestions();
    assert.equal(initialQuestions.length, DEFAULT_QUESTIONS.length);

    // Salva um rascunho de sessão
    repo1.upsertSession({
      token: 'PCA-1111-2222',
      ipHash: 'AABBCCDDEEFF',
      deviceSignature: 'HW-DEV1',
      selectedProfile: 'Outro',
      draftAnswers: { rodilindo_dor: 'Pedrin' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal(repo1.getActiveSessionsCount(), 1);

    // Registra um voto (deve remover a sessão automaticamente em transação)
    repo1.createVoteAndClearSession({
      id: 'vote-1',
      token: 'PCA-1111-2222',
      ipHash: 'AABBCCDDEEFF',
      deviceSignature: 'HW-DEV1',
      voterProfile: 'Outro',
      answers: { rodilindo_dor: 'Pedrin', beckham_dor: 'Victor' },
      submittedAt: new Date().toISOString(),
    });
    assert.equal(repo1.getActiveSessionsCount(), 0);
    repo1.close();

    // Reabre o banco SQLite do disco para comprovar persistência real
    const repo2 = createAwardsDatabase(dbFilePath);
    const persistedVotes = repo2.getVotes();
    assert.equal(persistedVotes.length, 1);
    assert.equal(persistedVotes[0].token, 'PCA-1111-2222');
    assert.equal(persistedVotes[0].answers.rodilindo_dor, 'Pedrin');
    repo2.close();
  });
});

describe('3. Testes de Integração da API — Autenticação Admin, Regras de Voto e Brute-Force', () => {
  let app: Application;
  let closeRepo: () => void;

  before(() => {
    const created = createApp({
      dbPath: ':memory:',
      adminPassword: TEST_ADMIN_PASSWORD,
      adminTokenSecret: 'test-secret-key-for-integration',
      frontendOrigins: ['https://meu-front.vercel.app'],
    });
    app = created.app;
    closeRepo = () => created.repo.close();
  });

  after(() => {
    closeRepo();
  });

  it('retorna healthcheck e headers de segurança e CORS', async () => {
    const res = await simulateRequest(app, 'GET', '/api/health', {
      headers: { Origin: 'https://meu-front.vercel.app' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://meu-front.vercel.app');
    const body = await res.json<{ ok: boolean; storage: string }>();
    assert.equal(body.ok, true);
    assert.equal(body.storage, 'sqlite');
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

    // 6ª tentativa do mesmo IP deve ser bloqueada com 429 Too Many Requests
    const blockedRes = await simulateRequest(app, 'POST', '/api/admin/login', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.99',
      },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(blockedRes.status, 429);
  });

  it('autentica com a senha correta configurada no ambiente e permite gerenciar questões no Admin', async () => {
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

    // Acessa dashboard autenticado
    const dashRes = await simulateRequest(app, 'GET', '/api/admin/dashboard', {
      headers: authHeaders,
    });
    assert.equal(dashRes.status, 200);

    // Cria nova questão
    const createRes = await simulateRequest(app, 'POST', '/api/admin/questions', {
      headers: authHeaders,
      body: JSON.stringify({
        title: 'CATEGORIA TESTE',
        subtitle: 'Subtítulo teste',
        type: 'choice',
        publicVisible: false,
        showPhotos: false,
        required: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json<{ question: { id: string } }>();

    // Deleta a questão criada
    const delRes = await simulateRequest(
      app,
      'DELETE',
      `/api/admin/questions/${created.question.id}`,
      { headers: authHeaders }
    );
    assert.equal(delRes.status, 200);
  });

  it('valida regras de votação: bloqueia auto-voto, candidato inválido, voto duplicado e perfil já usado', async () => {
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

    // 1. Tentativa de auto-voto (Pedrin votando em Pedrin) -> Deve retornar 400
    const selfVoteRes = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.1',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-PEDRIN',
        voterProfile: 'Pedrin',
        answers: { ...squadAnswers, ballon_dor: 'Pedrin' },
      }),
    });
    assert.equal(selfVoteRes.status, 400);

    // 2. Tentativa com candidato inexistente -> Deve retornar 400
    const fakeCandidateRes = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.1',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-PEDRIN',
        voterProfile: 'Pedrin',
        answers: { ...squadAnswers, ballon_dor: 'JogadorInexistente' },
      }),
    });
    assert.equal(fakeCandidateRes.status, 400);

    // 3. Voto válido de integrante do elenco (Pedrin) -> Deve retornar 201
    const validSquadRes = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.1',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-PEDRIN',
        voterProfile: 'Pedrin',
        answers: squadAnswers,
      }),
    });
    assert.equal(validSquadRes.status, 201);

    // 4. Tentativa de votar uma segunda vez com o mesmo dispositivo/IP -> Deve retornar 409
    const duplicateTokenRes = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.1',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-PEDRIN',
        voterProfile: 'Outro',
        answers: { rodilindo_dor: 'Victor', beckham_dor: 'Paulo' },
      }),
    });
    assert.equal(duplicateTokenRes.status, 409);

    // 5. Outro dispositivo tentando usar o perfil "Pedrin" que já votou -> Deve retornar 409
    const duplicateProfileRes = await simulateRequest(app, 'POST', '/api/votes/submit', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.2',
      },
      body: JSON.stringify({
        deviceSignature: 'DEV-OUTRO-PC',
        voterProfile: 'Pedrin',
        answers: squadAnswers,
      }),
    });
    assert.equal(duplicateProfileRes.status, 409);
  });
});
