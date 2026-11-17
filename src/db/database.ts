import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_QUESTIONS,
  type ActiveSessionDraft,
  type QuestionType,
  type VoteRecord,
  type VotingQuestion,
} from '../data/awardsData.ts';

export interface AwardsRepository {
  getResetNonce(): string;
  getQuestions(): VotingQuestion[];
  getQuestionById(id: string): VotingQuestion | undefined;
  createQuestion(question: VotingQuestion): VotingQuestion;
  updateQuestion(question: VotingQuestion): VotingQuestion;
  deleteQuestion(id: string): VotingQuestion | undefined;
  resetDefaultQuestions(): VotingQuestion[];
  getVotes(): VoteRecord[];
  findVoteByTokenOrIdentity(
    token: string,
    deviceSignature: string,
    ipHash: string
  ): VoteRecord | undefined;
  findVoteByProfile(voterProfile: string): VoteRecord | undefined;
  getVotedSquadProfiles(): string[];
  createVoteAndClearSession(vote: VoteRecord): VoteRecord;
  clearAllVotesAndSessions(): number;
  getSession(token: string): ActiveSessionDraft | undefined;
  upsertSession(session: ActiveSessionDraft): ActiveSessionDraft;
  getActiveSessionsCount(): number;
  close(): void;
}

interface QuestionRow {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  public_visible: number;
  show_photos: number;
  required: number;
  sort_order: number;
}

interface VoteRow {
  id: string;
  token: string;
  ip_hash: string;
  device_signature: string;
  voter_profile: string;
  answers_json: string;
  submitted_at: string;
}

interface SessionRow {
  token: string;
  ip_hash: string;
  device_signature: string;
  selected_profile: string | null;
  draft_answers_json: string;
  created_at: string;
  updated_at: string;
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
  try {
    const parsed = JSON.parse(row.answers_json);
    if (parsed && typeof parsed === 'object') {
      answers = parsed as Record<string, string>;
    }
  } catch {
    answers = {};
  }
  return {
    id: row.id,
    token: row.token,
    ipHash: row.ip_hash,
    deviceSignature: row.device_signature,
    voterProfile: row.voter_profile,
    answers,
    submittedAt: row.submitted_at,
  };
}

function mapSessionRow(row: SessionRow): ActiveSessionDraft {
  let draftAnswers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.draft_answers_json);
    if (parsed && typeof parsed === 'object') {
      draftAnswers = parsed as Record<string, string>;
    }
  } catch {
    draftAnswers = {};
  }
  return {
    token: row.token,
    ipHash: row.ip_hash,
    deviceSignature: row.device_signature,
    selectedProfile: row.selected_profile,
    draftAnswers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAwardsDatabase(dbPath: string): AwardsRepository {
  if (dbPath !== ':memory:') {
    const resolvedDir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

  // Initialize resetNonce if not present
  const nonceRow = db
    .prepare('SELECT value FROM metadata WHERE key = ?')
    .get('resetNonce') as { value: string } | undefined;
  if (!nonceRow) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('resetNonce', 'v1');
  }

  // Seed default questions if table is empty
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM questions').get() as { cnt: number };
  if (Number(countRow.cnt) === 0) {
    const insertQ = db.prepare(`
      INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN');
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
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    getResetNonce(): string {
      const row = db
        .prepare('SELECT value FROM metadata WHERE key = ?')
        .get('resetNonce') as { value: string } | undefined;
      return row?.value || 'v1';
    },

    getQuestions(): VotingQuestion[] {
      const rows = db
        .prepare('SELECT * FROM questions ORDER BY sort_order ASC, id ASC')
        .all() as unknown as QuestionRow[];
      return rows.map(mapQuestionRow);
    },

    getQuestionById(id: string): VotingQuestion | undefined {
      const row = db
        .prepare('SELECT * FROM questions WHERE id = ?')
        .get(id) as unknown as QuestionRow | undefined;
      return row ? mapQuestionRow(row) : undefined;
    },

    createQuestion(q: VotingQuestion): VotingQuestion {
      db.prepare(`
        INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
    },

    updateQuestion(q: VotingQuestion): VotingQuestion {
      db.prepare(`
        UPDATE questions
        SET title = ?, subtitle = ?, type = ?, public_visible = ?, show_photos = ?, required = ?, sort_order = ?
        WHERE id = ?
      `).run(
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
    },

    deleteQuestion(id: string): VotingQuestion | undefined {
      const existing = this.getQuestionById(id);
      if (!existing) return undefined;
      db.prepare('DELETE FROM questions WHERE id = ?').run(id);
      return existing;
    },

    resetDefaultQuestions(): VotingQuestion[] {
      const insertQ = db.prepare(`
        INSERT INTO questions (id, title, subtitle, type, public_visible, show_photos, required, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM questions').run();
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
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return this.getQuestions();
    },

    getVotes(): VoteRecord[] {
      const rows = db
        .prepare('SELECT * FROM votes ORDER BY submitted_at DESC')
        .all() as unknown as VoteRow[];
      return rows.map(mapVoteRow);
    },

    findVoteByTokenOrIdentity(
      token: string,
      deviceSignature: string,
      ipHash: string
    ): VoteRecord | undefined {
      const row = db
        .prepare(
          'SELECT * FROM votes WHERE token = ? OR (device_signature = ? AND ip_hash = ?) LIMIT 1'
        )
        .get(token, deviceSignature, ipHash) as unknown as VoteRow | undefined;
      return row ? mapVoteRow(row) : undefined;
    },

    findVoteByProfile(voterProfile: string): VoteRecord | undefined {
      const row = db
        .prepare('SELECT * FROM votes WHERE voter_profile = ? LIMIT 1')
        .get(voterProfile) as unknown as VoteRow | undefined;
      return row ? mapVoteRow(row) : undefined;
    },

    getVotedSquadProfiles(): string[] {
      const rows = db
        .prepare("SELECT DISTINCT voter_profile FROM votes WHERE voter_profile != 'Outro'")
        .all() as unknown as Array<{ voter_profile: string }>;
      return rows.map((r) => r.voter_profile);
    },

    createVoteAndClearSession(vote: VoteRecord): VoteRecord {
      db.exec('BEGIN');
      try {
        db.prepare(`
          INSERT INTO votes (id, token, ip_hash, device_signature, voter_profile, answers_json, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          vote.id,
          vote.token,
          vote.ipHash,
          vote.deviceSignature,
          vote.voterProfile,
          JSON.stringify(vote.answers),
          vote.submittedAt
        );
        db.prepare('DELETE FROM sessions WHERE token = ?').run(vote.token);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return vote;
    },

    clearAllVotesAndSessions(): number {
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM votes').get() as { cnt: number };
      const deletedCount = Number(countRow.cnt);
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM votes').run();
        db.prepare('DELETE FROM sessions').run();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return deletedCount;
    },

    getSession(token: string): ActiveSessionDraft | undefined {
      const row = db
        .prepare('SELECT * FROM sessions WHERE token = ?')
        .get(token) as unknown as SessionRow | undefined;
      return row ? mapSessionRow(row) : undefined;
    },

    upsertSession(session: ActiveSessionDraft): ActiveSessionDraft {
      db.prepare(`
        INSERT INTO sessions (token, ip_hash, device_signature, selected_profile, draft_answers_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET
          selected_profile = excluded.selected_profile,
          draft_answers_json = excluded.draft_answers_json,
          updated_at = excluded.updated_at
      `).run(
        session.token,
        session.ipHash,
        session.deviceSignature,
        session.selectedProfile,
        JSON.stringify(session.draftAnswers),
        session.createdAt,
        session.updatedAt
      );
      return session;
    },

    getActiveSessionsCount(): number {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as { cnt: number };
      return Number(row.cnt);
    },

    close(): void {
      db.close();
    },
  };
}
