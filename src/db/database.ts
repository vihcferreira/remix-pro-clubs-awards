import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import {
  DEFAULT_QUESTIONS,
  PLAYERS,
  type ActiveSessionDraft,
  type PlayerProfile,
  type QuestionType,
  type VoteRecord,
  type VotingQuestion,
} from '../data/awardsData.ts';

export interface AwardsRepository {
  init(): Promise<void>;
  getResetNonce(): Promise<string>;
  getPlayers(): Promise<PlayerProfile[]>;
  getPlayerById(id: string): Promise<PlayerProfile | undefined>;
  createPlayer(player: PlayerProfile): Promise<PlayerProfile>;
  updatePlayer(player: PlayerProfile): Promise<PlayerProfile>;
  deletePlayer(id: string): Promise<PlayerProfile | undefined>;
  resetDefaultPlayers(): Promise<PlayerProfile[]>;
  getQuestions(): Promise<VotingQuestion[]>;
  getQuestionById(id: string): Promise<VotingQuestion | undefined>;
  createQuestion(question: VotingQuestion): Promise<VotingQuestion>;
  updateQuestion(question: VotingQuestion): Promise<VotingQuestion>;
  deleteQuestion(id: string): Promise<VotingQuestion | undefined>;
  resetDefaultQuestions(): Promise<VotingQuestion[]>;
  getVotes(): Promise<VoteRecord[]>;
  findVoteByTokenOrIdentity(
    token: string,
    deviceSignature: string,
    ipHash: string
  ): Promise<VoteRecord | undefined>;
  findVoteByProfile(voterProfile: string): Promise<VoteRecord | undefined>;
  getVotedSquadProfiles(): Promise<string[]>;
  createVoteAndClearSession(vote: VoteRecord): Promise<VoteRecord>;
  clearAllVotesAndSessions(): Promise<number>;
  getSession(token: string): Promise<ActiveSessionDraft | undefined>;
  upsertSession(session: ActiveSessionDraft): Promise<ActiveSessionDraft>;
  getActiveSessionsCount(): Promise<number>;
  close(): Promise<void>;
}

interface PlayerRow {
  id: string;
  name: string;
  gamertag: string;
  archetype: string;
  level: number | string;
  total_stats: number | string;
  stats_summary: string;
  image_url: string;
  nationality: string;
  sort_order?: number | string;
}

interface QuestionRow {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  public_visible: number | boolean;
  show_photos: number | boolean;
  required: number | boolean;
  sort_order: number | string;
}

interface VoteRow {
  id: string;
  token: string;
  ip_hash: string;
  device_signature: string;
  voter_profile: string;
  answers_json: string | object;
  submitted_at: string | Date;
}

interface SessionRow {
  token: string;
  ip_hash: string;
  device_signature: string;
  selected_profile: string | null;
  draft_answers_json: string | object;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapPlayerRow(row: PlayerRow): PlayerProfile {
  return {
    id: row.id,
    name: row.name,
    gamertag: row.gamertag,
    archetype: row.archetype,
    level: Number(row.level),
    totalStats: Number(row.total_stats),
    statsSummary: row.stats_summary,
    imageUrl: row.image_url,
    nationality: row.nationality || 'BR',
  };
}

function mapQuestionRow(row: QuestionRow): VotingQuestion {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    type: row.type as QuestionType,
    publicVisible: Boolean(row.public_visible),
    showPhotos: Boolean(row.show_photos),
    required: Boolean(row.required),
    order: Number(row.sort_order),
  };
}

function mapVoteRow(row: VoteRow): VoteRecord {
  let answers: Record<string, string> = {};
  if (typeof row.answers_json === 'object' && row.answers_json !== null) {
    answers = row.answers_json as Record<string, string>;
  } else {
    try {
      const parsed = JSON.parse(String(row.answers_json));
      if (parsed && typeof parsed === 'object') {
        answers = parsed as Record<string, string>;
      }
    } catch {
      answers = {};
    }
  }

  const submittedAt =
    row.submitted_at instanceof Date
      ? row.submitted_at.toISOString()
      : String(row.submitted_at);

  return {
    id: row.id,
    token: row.token,
    ipHash: row.ip_hash,
    deviceSignature: row.device_signature,
    voterProfile: row.voter_profile,
    answers,
    submittedAt,
  };
}

function mapSessionRow(row: SessionRow): ActiveSessionDraft {
  let draftAnswers: Record<string, string> = {};
  if (typeof row.draft_answers_json === 'object' && row.draft_answers_json !== null) {
    draftAnswers = row.draft_answers_json as Record<string, string>;
  } else {
    try {
      const parsed = JSON.parse(String(row.draft_answers_json));
      if (parsed && typeof parsed === 'object') {
        draftAnswers = parsed as Record<string, string>;
      }
    } catch {
      draftAnswers = {};
    }
  }

  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const updatedAt =
    row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);

  return {
    token: row.token,
    ipHash: row.ip_hash,
    deviceSignature: row.device_signature,
    selectedProfile: row.selected_profile,
    draftAnswers,
    createdAt,
    updatedAt,
  };
}

// ============================================================================
// POSTGRESQL REPOSITORY (SUPABASE)
// ============================================================================
export class PostgresAwardsRepository implements AwardsRepository {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          gamertag TEXT NOT NULL,
          archetype TEXT NOT NULL,
          level INTEGER NOT NULL DEFAULT 100,
          total_stats INTEGER NOT NULL DEFAULT 360,
          stats_summary TEXT NOT NULL DEFAULT '',
          image_url TEXT NOT NULL,
          nationality TEXT NOT NULL DEFAULT 'BR',
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS questions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          subtitle TEXT NOT NULL,
          type TEXT NOT NULL,
          public_visible INTEGER NOT NULL DEFAULT 0,
          show_photos INTEGER NOT NULL DEFAULT 0,
          required INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS votes (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          ip_hash TEXT NOT NULL,
          device_signature TEXT NOT NULL,
          voter_profile TEXT NOT NULL,
          answers_json TEXT NOT NULL,
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_votes_identity ON votes (device_signature, ip_hash);
        CREATE INDEX IF NOT EXISTS idx_votes_profile ON votes (voter_profile);
        CREATE INDEX IF NOT EXISTS idx_votes_ip_hash ON votes (ip_hash);

        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          ip_hash TEXT NOT NULL,
          device_signature TEXT NOT NULL,
          selected_profile TEXT,
          draft_answers_json TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Initialize resetNonce
      const nonceRes = await client.query('SELECT value FROM metadata WHERE key = $1', [
        'resetNonce',
      ]);
      if (nonceRes.rows.length === 0) {
        await client.query('INSERT INTO metadata (key, value) VALUES ($1, $2)', [
          'resetNonce',
          'v1',
        ]);
      }

      // Seed default players if empty
      const pCountRes = await client.query('SELECT COUNT(*) as cnt FROM players');
      if (Number(pCountRes.rows[0].cnt) === 0) {
        for (let i = 0; i < PLAYERS.length; i++) {
          const p = PLAYERS[i];
          await client.query(
            `INSERT INTO players (id, name, gamertag, archetype, level, total_stats, stats_summary, image_url, nationality, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO NOTHING`,
            [
              p.id,
              p.name,
              p.gamertag,
              p.archetype,
              p.level,
              p.totalStats,
              p.statsSummary,
              p.imageUrl,
              p.nationality || 'BR',
              i + 1,
            ]
          );
        }
      }

      // Seed default questions if empty
      const qCountRes = await client.query('SELECT COUNT(*) as cnt FROM questions');
      if (Number(qCountRes.rows[0].cnt) === 0) {
        for (const q of DEFAULT_QUESTIONS) {
          await client.query(
            `INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [
              q.id,
              q.title,
              q.subtitle,
              q.type,
              q.publicVisible ? 1 : 0,
              q.showPhotos ? 1 : 0,
              q.required ? 1 : 0,
              q.order,
            ]
          );
        }
      }
    } finally {
      client.release();
    }
  }

  async getResetNonce(): Promise<string> {
    const res = await this.pool.query('SELECT value FROM metadata WHERE key = $1', ['resetNonce']);
    return res.rows[0]?.value || 'v1';
  }

  async getPlayers(): Promise<PlayerProfile[]> {
    const res = await this.pool.query('SELECT * FROM players ORDER BY sort_order ASC, name ASC');
    return res.rows.map(mapPlayerRow);
  }

  async getPlayerById(id: string): Promise<PlayerProfile | undefined> {
    const res = await this.pool.query('SELECT * FROM players WHERE id = $1', [id]);
    return res.rows[0] ? mapPlayerRow(res.rows[0]) : undefined;
  }

  async createPlayer(player: PlayerProfile): Promise<PlayerProfile> {
    const maxOrd = await this.pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) as max_ord FROM players'
    );
    const nextOrder = Number(maxOrd.rows[0].max_ord) + 1;

    await this.pool.query(
      `INSERT INTO players (id, name, gamertag, archetype, level, total_stats, stats_summary, image_url, nationality, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        player.id,
        player.name,
        player.gamertag,
        player.archetype,
        player.level,
        player.totalStats,
        player.statsSummary,
        player.imageUrl,
        player.nationality || 'BR',
        nextOrder,
      ]
    );
    return player;
  }

  async updatePlayer(player: PlayerProfile): Promise<PlayerProfile> {
    await this.pool.query(
      `UPDATE players
       SET name = $1, gamertag = $2, archetype = $3, level = $4, total_stats = $5, stats_summary = $6, image_url = $7, nationality = $8
       WHERE id = $9`,
      [
        player.name,
        player.gamertag,
        player.archetype,
        player.level,
        player.totalStats,
        player.statsSummary,
        player.imageUrl,
        player.nationality || 'BR',
        player.id,
      ]
    );
    return player;
  }

  async deletePlayer(id: string): Promise<PlayerProfile | undefined> {
    const existing = await this.getPlayerById(id);
    if (!existing) return undefined;
    await this.pool.query('DELETE FROM players WHERE id = $1', [id]);
    return existing;
  }

  async resetDefaultPlayers(): Promise<PlayerProfile[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM players');
      for (let i = 0; i < PLAYERS.length; i++) {
        const p = PLAYERS[i];
        await client.query(
          `INSERT INTO players (id, name, gamertag, archetype, level, total_stats, stats_summary, image_url, nationality, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            p.id,
            p.name,
            p.gamertag,
            p.archetype,
            p.level,
            p.totalStats,
            p.statsSummary,
            p.imageUrl,
            p.nationality || 'BR',
            i + 1,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getPlayers();
  }

  async getQuestions(): Promise<VotingQuestion[]> {
    const res = await this.pool.query(
      'SELECT * FROM questions ORDER BY sort_order ASC, id ASC'
    );
    return res.rows.map(mapQuestionRow);
  }

  async getQuestionById(id: string): Promise<VotingQuestion | undefined> {
    const res = await this.pool.query('SELECT * FROM questions WHERE id = $1', [id]);
    return res.rows[0] ? mapQuestionRow(res.rows[0]) : undefined;
  }

  async createQuestion(q: VotingQuestion): Promise<VotingQuestion> {
    await this.pool.query(
      `INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        q.id,
        q.title,
        q.subtitle,
        q.type,
        q.publicVisible ? 1 : 0,
        q.showPhotos ? 1 : 0,
        q.required ? 1 : 0,
        q.order,
      ]
    );
    return q;
  }

  async updateQuestion(q: VotingQuestion): Promise<VotingQuestion> {
    await this.pool.query(
      `UPDATE questions
       SET title = $1, subtitle = $2, type = $3, public_visible = $4, show_photos = $5, required = $6, sort_order = $7
       WHERE id = $8`,
      [
        q.title,
        q.subtitle,
        q.type,
        q.publicVisible ? 1 : 0,
        q.showPhotos ? 1 : 0,
        q.required ? 1 : 0,
        q.order,
        q.id,
      ]
    );
    return q;
  }

  async deleteQuestion(id: string): Promise<VotingQuestion | undefined> {
    const existing = await this.getQuestionById(id);
    if (!existing) return undefined;
    await this.pool.query('DELETE FROM questions WHERE id = $1', [id]);
    return existing;
  }

  async resetDefaultQuestions(): Promise<VotingQuestion[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM questions');
      for (const q of DEFAULT_QUESTIONS) {
        await client.query(
          `INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            q.id,
            q.title,
            q.subtitle,
            q.type,
            q.publicVisible ? 1 : 0,
            q.showPhotos ? 1 : 0,
            q.required ? 1 : 0,
            q.order,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getQuestions();
  }

  async getVotes(): Promise<VoteRecord[]> {
    const res = await this.pool.query('SELECT * FROM votes ORDER BY submitted_at DESC');
    return res.rows.map(mapVoteRow);
  }

  async findVoteByTokenOrIdentity(
    token: string,
    deviceSignature: string,
    ipHash: string
  ): Promise<VoteRecord | undefined> {
    const res = await this.pool.query(
      `SELECT * FROM votes
       WHERE token = $1
          OR (device_signature = $2 AND ip_hash = $3)
          OR ip_hash = $3
       LIMIT 1`,
      [token, deviceSignature, ipHash]
    );
    return res.rows[0] ? mapVoteRow(res.rows[0]) : undefined;
  }

  async findVoteByProfile(voterProfile: string): Promise<VoteRecord | undefined> {
    const res = await this.pool.query(
      'SELECT * FROM votes WHERE voter_profile = $1 LIMIT 1',
      [voterProfile]
    );
    return res.rows[0] ? mapVoteRow(res.rows[0]) : undefined;
  }

  async getVotedSquadProfiles(): Promise<string[]> {
    const res = await this.pool.query(
      "SELECT DISTINCT voter_profile FROM votes WHERE voter_profile != 'Outro'"
    );
    return res.rows.map((r: { voter_profile: string }) => r.voter_profile);
  }

  async createVoteAndClearSession(vote: VoteRecord): Promise<VoteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO votes (id, token, ip_hash, device_signature, voter_profile, answers_json, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          vote.id,
          vote.token,
          vote.ipHash,
          vote.deviceSignature,
          vote.voterProfile,
          JSON.stringify(vote.answers),
          vote.submittedAt,
        ]
      );
      await client.query('DELETE FROM sessions WHERE token = $1', [vote.token]);
      await client.query('COMMIT');
      return vote;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async clearAllVotesAndSessions(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const countRes = await client.query('SELECT COUNT(*) as cnt FROM votes');
      const deletedCount = Number(countRes.rows[0].cnt);
      await client.query('DELETE FROM votes');
      await client.query('DELETE FROM sessions');
      await client.query('COMMIT');
      return deletedCount;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSession(token: string): Promise<ActiveSessionDraft | undefined> {
    const res = await this.pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    return res.rows[0] ? mapSessionRow(res.rows[0]) : undefined;
  }

  async upsertSession(session: ActiveSessionDraft): Promise<ActiveSessionDraft> {
    await this.pool.query(
      `INSERT INTO sessions (token, ip_hash, device_signature, selected_profile, draft_answers_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (token) DO UPDATE SET
         selected_profile = EXCLUDED.selected_profile,
         draft_answers_json = EXCLUDED.draft_answers_json,
         updated_at = EXCLUDED.updated_at`,
      [
        session.token,
        session.ipHash,
        session.deviceSignature,
        session.selectedProfile,
        JSON.stringify(session.draftAnswers),
        session.createdAt,
        session.updatedAt,
      ]
    );
    return session;
  }

  async getActiveSessionsCount(): Promise<number> {
    const res = await this.pool.query('SELECT COUNT(*) as cnt FROM sessions');
    return Number(res.rows[0].cnt);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ============================================================================
// SQLITE REPOSITORY (FALLBACK LOCAL E TESTES)
// ============================================================================
export class SqliteAwardsRepository implements AwardsRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const resolvedDir = path.dirname(path.resolve(dbPath));
      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        gamertag TEXT NOT NULL,
        archetype TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 100,
        total_stats INTEGER NOT NULL DEFAULT 360,
        stats_summary TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL,
        nationality TEXT NOT NULL DEFAULT 'BR',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        type TEXT NOT NULL,
        public_visible INTEGER NOT NULL DEFAULT 0,
        show_photos INTEGER NOT NULL DEFAULT 0,
        required INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS votes (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        ip_hash TEXT NOT NULL,
        device_signature TEXT NOT NULL,
        voter_profile TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_votes_identity ON votes (device_signature, ip_hash);
      CREATE INDEX IF NOT EXISTS idx_votes_profile ON votes (voter_profile);
      CREATE INDEX IF NOT EXISTS idx_votes_ip_hash ON votes (ip_hash);

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        ip_hash TEXT NOT NULL,
        device_signature TEXT NOT NULL,
        selected_profile TEXT,
        draft_answers_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const nonceRow = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get('resetNonce') as { value: string } | undefined;
    if (!nonceRow) {
      this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('resetNonce', 'v1');
    }

    const pCountRow = this.db.prepare('SELECT COUNT(*) as cnt FROM players').get() as {
      cnt: number;
    };
    if (Number(pCountRow.cnt) === 0) {
      const insertP = this.db.prepare(`
        INSERT INTO players (id, name, gamertag, archetype, level, total_stats, stats_summary, image_url, nationality, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.db.exec('BEGIN');
      try {
        PLAYERS.forEach((p, idx) => {
          insertP.run(
            p.id,
            p.name,
            p.gamertag,
            p.archetype,
            p.level,
            p.totalStats,
            p.statsSummary,
            p.imageUrl,
            p.nationality || 'BR',
            idx + 1
          );
        });
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }

    const qCountRow = this.db.prepare('SELECT COUNT(*) as cnt FROM questions').get() as {
      cnt: number;
    };
    if (Number(qCountRow.cnt) === 0) {
      const insertQ = this.db.prepare(`
        INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.db.exec('BEGIN');
      try {
        for (const q of DEFAULT_QUESTIONS) {
          insertQ.run(
            q.id,
            q.title,
            q.subtitle,
            q.type,
            q.publicVisible ? 1 : 0,
            q.showPhotos ? 1 : 0,
            q.required ? 1 : 0,
            q.order
          );
        }
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  async getResetNonce(): Promise<string> {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get('resetNonce') as { value: string } | undefined;
    return row?.value || 'v1';
  }

  async getPlayers(): Promise<PlayerProfile[]> {
    const rows = this.db
      .prepare('SELECT * FROM players ORDER BY sort_order ASC, name ASC')
      .all() as unknown as PlayerRow[];
    return rows.map(mapPlayerRow);
  }

  async getPlayerById(id: string): Promise<PlayerProfile | undefined> {
    const row = this.db
      .prepare('SELECT * FROM players WHERE id = ?')
      .get(id) as unknown as PlayerRow | undefined;
    return row ? mapPlayerRow(row) : undefined;
  }

  async createPlayer(player: PlayerProfile): Promise<PlayerProfile> {
    const maxOrderRow = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) as max_ord FROM players')
      .get() as { max_ord: number };
    const nextOrder = Number(maxOrderRow.max_ord) + 1;

    this.db
      .prepare(
        `INSERT INTO players (id, name, gamertag, archetype, level, total_stats, stats_summary, image_url, nationality, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        player.id,
        player.name,
        player.gamertag,
        player.archetype,
        player.level,
        player.totalStats,
        player.statsSummary,
        player.imageUrl,
        player.nationality || 'BR',
        nextOrder
      );
    return player;
  }

  async updatePlayer(player: PlayerProfile): Promise<PlayerProfile> {
    this.db
      .prepare(
        `UPDATE players
         SET name = ?, gamertag = ?, archetype = ?, level = ?, total_stats = ?, stats_summary = ?, image_url = ?, nationality = ?
         WHERE id = ?`
      )
      .run(
        player.name,
        player.gamertag,
        player.archetype,
        player.level,
        player.totalStats,
        player.statsSummary,
        player.imageUrl,
        player.nationality || 'BR',
        player.id
      );
    return player;
  }

  async deletePlayer(id: string): Promise<PlayerProfile | undefined> {
    const existing = await this.getPlayerById(id);
    if (!existing) return undefined;
    this.db.prepare('DELETE FROM players WHERE id = ?').run(id);
    return existing;
  }

  async resetDefaultPlayers(): Promise<PlayerProfile[]> {
    const insertP = this.db.prepare(`
      INSERT INTO players (id, name, gamertag, archetype, level, total_stats, stats_summary, image_url, nationality, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM players').run();
      PLAYERS.forEach((p, idx) => {
        insertP.run(
          p.id,
          p.name,
          p.gamertag,
          p.archetype,
          p.level,
          p.totalStats,
          p.statsSummary,
          p.imageUrl,
          p.nationality || 'BR',
          idx + 1
        );
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.getPlayers();
  }

  async getQuestions(): Promise<VotingQuestion[]> {
    const rows = this.db
      .prepare('SELECT * FROM questions ORDER BY sort_order ASC, id ASC')
      .all() as unknown as QuestionRow[];
    return rows.map(mapQuestionRow);
  }

  async getQuestionById(id: string): Promise<VotingQuestion | undefined> {
    const row = this.db
      .prepare('SELECT * FROM questions WHERE id = ?')
      .get(id) as unknown as QuestionRow | undefined;
    return row ? mapQuestionRow(row) : undefined;
  }

  async createQuestion(q: VotingQuestion): Promise<VotingQuestion> {
    this.db
      .prepare(
        `INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        q.id,
        q.title,
        q.subtitle,
        q.type,
        q.publicVisible ? 1 : 0,
        q.showPhotos ? 1 : 0,
        q.required ? 1 : 0,
        q.order
      );
    return q;
  }

  async updateQuestion(q: VotingQuestion): Promise<VotingQuestion> {
    this.db
      .prepare(
        `UPDATE questions
         SET title = ?, subtitle = ?, type = ?, public_visible = ?, show_photos = ?, required = ?, sort_order = ?
         WHERE id = ?`
      )
      .run(
        q.title,
        q.subtitle,
        q.type,
        q.publicVisible ? 1 : 0,
        q.showPhotos ? 1 : 0,
        q.required ? 1 : 0,
        q.order,
        q.id
      );
    return q;
  }

  async deleteQuestion(id: string): Promise<VotingQuestion | undefined> {
    const existing = await this.getQuestionById(id);
    if (!existing) return undefined;
    this.db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    return existing;
  }

  async resetDefaultQuestions(): Promise<VotingQuestion[]> {
    const insertQ = this.db.prepare(`
      INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM questions').run();
      for (const q of DEFAULT_QUESTIONS) {
        insertQ.run(
          q.id,
          q.title,
          q.subtitle,
          q.type,
          q.publicVisible ? 1 : 0,
          q.showPhotos ? 1 : 0,
          q.required ? 1 : 0,
          q.order
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.getQuestions();
  }

  async getVotes(): Promise<VoteRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM votes ORDER BY submitted_at DESC')
      .all() as unknown as VoteRow[];
    return rows.map(mapVoteRow);
  }

  async findVoteByTokenOrIdentity(
    token: string,
    deviceSignature: string,
    ipHash: string
  ): Promise<VoteRecord | undefined> {
    const row = this.db
      .prepare(
        `SELECT * FROM votes
         WHERE token = ?
            OR (device_signature = ? AND ip_hash = ?)
            OR ip_hash = ?
         LIMIT 1`
      )
      .get(token, deviceSignature, ipHash, ipHash) as unknown as VoteRow | undefined;
    return row ? mapVoteRow(row) : undefined;
  }

  async findVoteByProfile(voterProfile: string): Promise<VoteRecord | undefined> {
    const row = this.db
      .prepare('SELECT * FROM votes WHERE voter_profile = ? LIMIT 1')
      .get(voterProfile) as unknown as VoteRow | undefined;
    return row ? mapVoteRow(row) : undefined;
  }

  async getVotedSquadProfiles(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT DISTINCT voter_profile FROM votes WHERE voter_profile != 'Outro'")
      .all() as unknown as Array<{ voter_profile: string }>;
    return rows.map((r) => r.voter_profile);
  }

  async createVoteAndClearSession(vote: VoteRecord): Promise<VoteRecord> {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO votes (id, token, ip_hash, device_signature, voter_profile, answers_json, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          vote.id,
          vote.token,
          vote.ipHash,
          vote.deviceSignature,
          vote.voterProfile,
          JSON.stringify(vote.answers),
          vote.submittedAt
        );
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(vote.token);
      this.db.exec('COMMIT');
      return vote;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async clearAllVotesAndSessions(): Promise<number> {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM votes').get() as { cnt: number };
    const deletedCount = Number(countRow.cnt);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM votes').run();
      this.db.prepare('DELETE FROM sessions').run();
      this.db.exec('COMMIT');
      return deletedCount;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async getSession(token: string): Promise<ActiveSessionDraft | undefined> {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token = ?')
      .get(token) as unknown as SessionRow | undefined;
    return row ? mapSessionRow(row) : undefined;
  }

  async upsertSession(session: ActiveSessionDraft): Promise<ActiveSessionDraft> {
    this.db
      .prepare(
        `INSERT INTO sessions (token, ip_hash, device_signature, selected_profile, draft_answers_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           selected_profile = excluded.selected_profile,
           draft_answers_json = excluded.draft_answers_json,
           updated_at = excluded.updated_at`
      )
      .run(
        session.token,
        session.ipHash,
        session.deviceSignature,
        session.selectedProfile,
        JSON.stringify(session.draftAnswers),
        session.createdAt,
        session.updatedAt
      );
    return session;
  }

  async getActiveSessionsCount(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as { cnt: number };
    return Number(row.cnt);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export function createDatabaseRepository(options: {
  databaseUrl?: string;
  sqlitePath?: string;
}): AwardsRepository {
  const dbUrl = options.databaseUrl || process.env.DATABASE_URL;
  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    return new PostgresAwardsRepository(dbUrl);
  }
  const sqlitePath =
    options.sqlitePath ||
    process.env.SQLITE_DB_PATH ||
    path.join(process.cwd(), 'data', 'awards.db');
  return new SqliteAwardsRepository(sqlitePath);
}
