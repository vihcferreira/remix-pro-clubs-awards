import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  Trophy,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Check,
  Users,
  UserPlus,
  Upload,
  FileText,
  BarChart3,
  Image as ImageIcon,
  Lock,
  LogOut,
  KeyRound,
  Download,
} from 'lucide-react';
import {
  PLAYERS,
  type PlayerProfile,
  type QuestionType,
  type VoteRecord,
  type VotingQuestion,
} from '../data/awardsData';
import {
  adminFetch,
  apiFetch,
  getStoredAdminToken,
  setStoredAdminToken,
} from '../utils/api';
import { downloadVotingPdfReport } from '../utils/pdfReport';

interface DashboardData {
  questions: VotingQuestion[];
  players?: PlayerProfile[];
  votes: VoteRecord[];
  activeSessionsCount: number;
  tallies: Record<
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
  >;
}

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged: () => void;
}

function compressImageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 540;
        const maxHeight = 720;
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('Falha ao processar a imagem selecionada.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.readAsDataURL(file);
  });
}

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  onDataChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'results' | 'squad' | 'questions' | 'voters'>(
    'results'
  );
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Admin authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() =>
    Boolean(getStoredAdminToken())
  );
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Confirmation modal state for deleting all votes
  const [confirmClearVotes, setConfirmClearVotes] = useState(false);
  const [clearingVotes, setClearingVotes] = useState(false);

  // Question CRUD state
  const [editingQuestion, setEditingQuestion] = useState<VotingQuestion | null>(null);
  const [isCreatingQuestion, setIsCreatingQuestion] = useState(false);
  const [questionToDelete, setQuestionToDelete] = useState<VotingQuestion | null>(null);
  const [confirmRestoreDefaults, setConfirmRestoreDefaults] = useState(false);

  // Form fields for create/edit question
  const [formTitle, setFormTitle] = useState('');
  const [formSubtitle, setFormSubtitle] = useState('');
  const [formType, setFormType] = useState<QuestionType>('choice');
  const [formPublicVisible, setFormPublicVisible] = useState(false);
  const [formShowPhotos, setFormShowPhotos] = useState(false);
  const [formRequired, setFormRequired] = useState(true);
  const [savingQuestion, setSavingQuestion] = useState(false);

  // Squad Player CRUD state
  const [editingPlayer, setEditingPlayer] = useState<PlayerProfile | null>(null);
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);
  const [playerToDelete, setPlayerToDelete] = useState<PlayerProfile | null>(null);
  const [confirmRestorePlayers, setConfirmRestorePlayers] = useState(false);

  // Form fields for create/edit player
  const [playerName, setPlayerName] = useState('');
  const [playerGamertag, setPlayerGamertag] = useState('');
  const [playerArchetype, setPlayerArchetype] = useState('HUNTER');
  const [playerLevel, setPlayerLevel] = useState<number>(100);
  const [playerTotalStats, setPlayerTotalStats] = useState<number>(375);
  const [playerStatsSummary, setPlayerStatsSummary] = useState('REA 92 · FRI 94 · FIN 95 · VOL 94');
  const [playerNationality, setPlayerNationality] = useState('BR');
  const [playerImageUrl, setPlayerImageUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);

  const handleLogout = useCallback(() => {
    setStoredAdminToken(null);
    setIsAuthenticated(false);
    setData(null);
    setPasswordInput('');
    setAuthError(null);
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (!getStoredAdminToken()) {
      setIsAuthenticated(false);
      return;
    }
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/dashboard');
      if (res.status === 401) {
        handleLogout();
        setAuthError('Sessão expirada ou não autorizada. Digite a senha novamente.');
        return;
      }
      if (res.ok) {
        const json = (await res.json()) as DashboardData;
        setData(json);
        setIsAuthenticated(true);
      } else {
        setStatusMessage({
          type: 'error',
          text: 'Não foi possível carregar os dados do painel administrativo.',
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Não foi possível carregar os dados do painel administrativo.',
      });
    } finally {
      setLoading(false);
    }
  }, [handleLogout]);

  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      setConfirmClearVotes(false);
      setAuthError(null);
      if (getStoredAdminToken()) {
        fetchDashboard();
      } else {
        setIsAuthenticated(false);
      }
    }
  }, [isOpen, fetchDashboard]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) {
      setAuthError('Digite a senha de administrador.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.token) {
        setAuthError(json.error || 'Senha incorreta. Acesso negado.');
        return;
      }

      setStoredAdminToken(json.token);
      setPasswordInput('');
      setIsAuthenticated(true);
      await fetchDashboard();
    } catch {
      setAuthError('Falha ao conectar ao servidor para validar a senha.');
    } finally {
      setAuthLoading(false);
    }
  };

  // ==========================================================================
  // SQUAD PLAYERS HANDLERS
  // ==========================================================================
  const openCreatePlayerForm = () => {
    setEditingPlayer(null);
    setIsCreatingPlayer(true);
    setPlayerName('');
    setPlayerGamertag('');
    setPlayerArchetype('HUNTER');
    setPlayerLevel(100);
    setPlayerTotalStats(375);
    setPlayerStatsSummary('REA 92 · FRI 94 · FIN 95 · VOL 94');
    setPlayerNationality('BR');
    setPlayerImageUrl('');
    setStatusMessage(null);
  };

  const openEditPlayerForm = (p: PlayerProfile) => {
    setIsCreatingPlayer(false);
    setEditingPlayer(p);
    setPlayerName(p.name);
    setPlayerGamertag(p.gamertag);
    setPlayerArchetype(p.archetype);
    setPlayerLevel(p.level);
    setPlayerTotalStats(p.totalStats);
    setPlayerStatsSummary(p.statsSummary);
    setPlayerNationality(p.nationality || 'BR');
    setPlayerImageUrl(p.imageUrl);
    setStatusMessage(null);
  };

  const closePlayerForm = () => {
    setIsCreatingPlayer(false);
    setEditingPlayer(null);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatusMessage({
        type: 'error',
        text: 'Selecione um arquivo de imagem válido (JPG, PNG ou WebP).',
      });
      return;
    }

    setUploadingPhoto(true);
    setStatusMessage(null);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setPlayerImageUrl(dataUrl);
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Não foi possível processar a foto selecionada.',
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSavePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) {
      setStatusMessage({ type: 'error', text: 'Informe o nome do integrante.' });
      return;
    }
    if (!playerImageUrl.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'Envie uma foto da carta do integrante ou informe a URL da imagem.',
      });
      return;
    }

    setSavingPlayer(true);
    try {
      const payload = {
        name: playerName.trim(),
        gamertag: playerGamertag.trim() || playerName.trim(),
        archetype: playerArchetype.trim().toUpperCase() || 'HUNTER',
        level: Number(playerLevel) || 100,
        totalStats: Number(playerTotalStats) || 370,
        statsSummary: playerStatsSummary.trim() || 'FIN 90 · VIS 90 · DRI 90 · VEL 90',
        nationality: playerNationality.trim().toUpperCase() || 'BR',
        imageUrl: playerImageUrl.trim(),
      };

      const url = editingPlayer
        ? `/api/admin/players/${encodeURIComponent(editingPlayer.id)}`
        : '/api/admin/players';
      const method = editingPlayer ? 'PUT' : 'POST';

      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        handleLogout();
        setAuthError('Sessão expirada. Faça login novamente.');
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao salvar integrante.' }));
        setStatusMessage({ type: 'error', text: err.error || 'Erro ao salvar integrante.' });
        return;
      }

      setStatusMessage({
        type: 'success',
        text: editingPlayer
          ? `Dados de "${playerName.trim()}" atualizados com sucesso.`
          : `Novo integrante "${playerName.trim()}" adicionado ao elenco!`,
      });
      closePlayerForm();
      await fetchDashboard();
      onDataChanged();
    } catch {
      setStatusMessage({ type: 'error', text: 'Falha de comunicação ao salvar o integrante.' });
    } finally {
      setSavingPlayer(false);
    }
  };

  const handleDeletePlayer = async (p: PlayerProfile) => {
    try {
      const res = await adminFetch(`/api/admin/players/${encodeURIComponent(p.id)}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        setStatusMessage({
          type: 'success',
          text: `Integrante "${p.name}" removido do elenco.`,
        });
        setPlayerToDelete(null);
        await fetchDashboard();
        onDataChanged();
      } else {
        const err = await res.json().catch(() => ({ error: 'Erro ao remover integrante.' }));
        setStatusMessage({ type: 'error', text: err.error || 'Erro ao remover integrante.' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Erro de conexão ao remover integrante.' });
    }
  };

  const handleRestoreDefaultPlayers = async () => {
    try {
      const res = await adminFetch('/api/admin/players/reset', { method: 'POST' });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        setStatusMessage({
          type: 'success',
          text: 'Elenco original de 6 jogadores restaurado com sucesso.',
        });
        setConfirmRestorePlayers(false);
        await fetchDashboard();
        onDataChanged();
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Falha ao restaurar elenco padrão.' });
    }
  };

  // ==========================================================================
  // QUESTIONS HANDLERS
  // ==========================================================================
  const openCreateForm = () => {
    setEditingQuestion(null);
    setIsCreatingQuestion(true);
    setFormTitle('');
    setFormSubtitle('');
    setFormType('choice');
    setFormPublicVisible(false);
    setFormShowPhotos(false);
    setFormRequired(true);
    setStatusMessage(null);
  };

  const openEditForm = (q: VotingQuestion) => {
    setIsCreatingQuestion(false);
    setEditingQuestion(q);
    setFormTitle(q.title);
    setFormSubtitle(q.subtitle);
    setFormType(q.type);
    setFormPublicVisible(q.publicVisible);
    setFormShowPhotos(q.showPhotos);
    setFormRequired(q.required);
    setStatusMessage(null);
  };

  const closeQuestionForm = () => {
    setIsCreatingQuestion(false);
    setEditingQuestion(null);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setStatusMessage({ type: 'error', text: 'Informe o título da questão.' });
      return;
    }

    setSavingQuestion(true);
    try {
      const payload = {
        title: formTitle.trim(),
        subtitle: formSubtitle.trim(),
        type: formType,
        publicVisible: formType === 'stat_info' ? false : formPublicVisible,
        showPhotos: formType === 'choice' ? formShowPhotos : false,
        required: formType === 'stat_info' ? false : formRequired,
      };

      const url = editingQuestion
        ? `/api/admin/questions/${editingQuestion.id}`
        : '/api/admin/questions';
      const method = editingQuestion ? 'PUT' : 'POST';

      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        handleLogout();
        setAuthError('Sessão expirada. Faça login novamente.');
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao salvar questão.' }));
        setStatusMessage({ type: 'error', text: err.error || 'Erro ao salvar questão.' });
        return;
      }

      setStatusMessage({
        type: 'success',
        text: editingQuestion
          ? 'Questão atualizada com sucesso.'
          : 'Nova questão adicionada ao formulário.',
      });
      closeQuestionForm();
      await fetchDashboard();
      onDataChanged();
    } catch {
      setStatusMessage({ type: 'error', text: 'Falha de comunicação ao salvar a questão.' });
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleDeleteQuestion = async (q: VotingQuestion) => {
    try {
      const res = await adminFetch(`/api/admin/questions/${q.id}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        setStatusMessage({
          type: 'success',
          text: `Questão "${q.title}" removida com sucesso.`,
        });
        setQuestionToDelete(null);
        await fetchDashboard();
        onDataChanged();
      } else {
        setStatusMessage({ type: 'error', text: 'Erro ao excluir a questão.' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Erro de conexão ao excluir a questão.' });
    }
  };

  const handleRestoreDefaultQuestions = async () => {
    try {
      const res = await adminFetch('/api/admin/questions/reset', { method: 'POST' });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        setStatusMessage({
          type: 'success',
          text: 'Questões originais do Google Forms restauradas com sucesso.',
        });
        setConfirmRestoreDefaults(false);
        await fetchDashboard();
        onDataChanged();
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Falha ao restaurar questões padrão.' });
    }
  };

  const handleClearAllVotes = async () => {
    setClearingVotes(true);
    try {
      const res = await adminFetch('/api/admin/votes', { method: 'DELETE' });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        setStatusMessage({
          type: 'success',
          text: 'Todos os dados de votação foram excluídos e os acessos foram liberados.',
        });
        setConfirmClearVotes(false);
        await fetchDashboard();
        onDataChanged();
      } else {
        setStatusMessage({ type: 'error', text: 'Não foi possível excluir os votos.' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Erro de rede ao tentar excluir os votos.' });
    } finally {
      setClearingVotes(false);
    }
  };

  const activePlayers = data?.players && data.players.length > 0 ? data.players : PLAYERS;
  const totalVotesCount = data?.votes.length || 0;
  const squadVotesCount = data?.votes.filter((v) => v.voterProfile !== 'Outro').length || 0;
  const publicVotesCount = data?.votes.filter((v) => v.voterProfile === 'Outro').length || 0;

  if (!isAuthenticated) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Autenticação do Painel Administrativo"
      >
        <div className="w-full max-w-md rounded-3xl bg-[#0F1521] border border-white/10 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10 bg-[#151C28]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold tracking-wide text-white">
                  Acesso Restrito ao Admin
                </h2>
                <p className="text-xs text-slate-400">
                  Digite a senha do organizador para continuar
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Fechar Login Admin"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
            {authError && (
              <div className="rounded-xl bg-red-950/70 border border-red-500/40 p-3 text-xs text-red-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="admin-password-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Senha do Administrador
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-password-input"
                  type="password"
                  autoFocus
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Digite a senha de acesso..."
                  className="w-full min-h-[46px] pl-10 pr-4 py-2.5 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={authLoading}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 text-xs font-bold flex items-center gap-2 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{authLoading ? 'Verificando...' : 'Entrar no Painel'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Painel Administrativo Pro Clubs Awards"
    >
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#0F1521] border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-white/10 bg-[#151C28]">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-wide text-white">
              Painel do Organizador
            </h2>
            <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              {totalVotesCount} votos registrados <span aria-hidden="true">·</span> {squadVotesCount}{' '}
              elenco <span aria-hidden="true">·</span> {publicVotesCount} público
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!data}
              onClick={() => {
                if (!data) return;
                downloadVotingPdfReport(data, activePlayers);
                setStatusMessage({
                  type: 'success',
                  text: 'Relatório oficial em PDF gerado e baixado com sucesso!',
                });
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 text-xs font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-md"
              title="Baixar relatório completo da apuração em PDF"
            >
              <Download className="w-4 h-4" />
              <span>Gerar Relatório PDF</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmClearVotes(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span>Excluir Dados de Votação</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              title="Bloquear Painel Admin"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Bloquear</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Fechar Painel Admin"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Confirmation Banner for Deleting All Voting Data */}
        {confirmClearVotes && (
          <div className="px-5 py-4 bg-red-950/80 border-b border-red-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Confirmar exclusão de todos os dados de votação?
                </h3>
                <p className="text-xs text-red-200 mt-0.5">
                  Esta ação apagará todos os {totalVotesCount} votos registrados e liberará todos os
                  tokens únicos e perfis para votarem novamente.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setConfirmClearVotes(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-white/10 text-slate-200 hover:bg-white/15 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={clearingVotes}
                onClick={handleClearAllVotes}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-500 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {clearingVotes ? 'Excluindo...' : 'Sim, Excluir Tudo'}
              </button>
            </div>
          </div>
        )}

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`px-5 py-3 text-xs font-medium flex items-center justify-between border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-200'
                : 'bg-red-950/60 border-red-500/30 text-red-200'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white ml-4"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-3 border-b border-white/10 bg-[#0B0F17] overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('results')}
            className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'results'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Apuração por Categoria</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('squad')}
            className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'squad'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>Elenco ({activePlayers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('questions')}
            className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'questions'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Questões da Votação ({data?.questions.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('voters')}
            className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'voters'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Tokens & Votos ({totalVotesCount})</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && !data ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Carregando dados da votação...
            </div>
          ) : null}

          {/* TAB 1: RESULTS */}
          {activeTab === 'results' && data && (
            <div className="space-y-5">
              {data.questions
                .filter((q) => q.type !== 'stat_info')
                .map((q) => {
                  const tally = data.tallies[q.id];
                  const totalCatVotes = tally?.totalVotes || 0;

                  if (q.type === 'text') {
                    return (
                      <div
                        key={q.id}
                        className="rounded-2xl bg-[#151C28] border border-white/10 p-5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-white/10">
                          <div>
                            <h3 className="font-display text-xl font-bold text-white">
                              {q.title}
                            </h3>
                            <p className="text-xs text-slate-400 mt-0.5">{q.subtitle}</p>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-amber-400">
                            {totalCatVotes} relatos enviados
                          </span>
                        </div>

                        {tally?.textResponses.length === 0 ? (
                          <p className="text-xs text-slate-500 pt-4">
                            Nenhuma resposta registrada ainda nesta categoria.
                          </p>
                        ) : (
                          <div className="mt-4 space-y-3">
                            {tally?.textResponses.map((item, idx) => (
                              <div
                                key={`${item.token}-${idx}`}
                                className="rounded-xl bg-[#0B0F17] border border-white/5 p-3.5"
                              >
                                <p className="text-sm text-slate-100 leading-relaxed">
                                  "{item.text}"
                                </p>
                                <p className="text-xs text-slate-400 font-mono tabular-nums mt-2">
                                  Enviado por {item.voterProfile} <span aria-hidden="true">·</span>{' '}
                                  Token {item.token}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Choice question ranking
                  const rankedPlayers = [...activePlayers].sort((a, b) => {
                    const countA = tally?.byCandidate[a.id]?.total || 0;
                    const countB = tally?.byCandidate[b.id]?.total || 0;
                    return countB - countA;
                  });

                  return (
                    <div
                      key={q.id}
                      className="rounded-2xl bg-[#151C28] border border-white/10 p-5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-white/10">
                        <div>
                          <h3 className="font-display text-xl font-bold text-white">{q.title}</h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {q.subtitle}{' '}
                            {q.publicVisible ? (
                              <>
                                <span aria-hidden="true">·</span>{' '}
                                <span className="text-amber-400">Aberto ao Público ("Outro")</span>
                              </>
                            ) : (
                              <>
                                <span aria-hidden="true">·</span>{' '}
                                <span>Exclusivo Elenco</span>
                              </>
                            )}
                          </p>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-slate-300">
                          Total: {totalCatVotes} votos
                        </span>
                      </div>

                      <div className="mt-4 space-y-2.5">
                        {rankedPlayers.map((player, index) => {
                          const stats = tally?.byCandidate[player.id] || {
                            total: 0,
                            squadVotes: 0,
                            publicVotes: 0,
                          };
                          const pct =
                            totalCatVotes > 0
                              ? Math.round((stats.total / totalCatVotes) * 100)
                              : 0;
                          const isLeader = index === 0 && stats.total > 0;

                          return (
                            <div
                              key={player.id}
                              className={`rounded-xl p-3 border transition-colors ${
                                isLeader
                                  ? 'bg-amber-500/10 border-amber-500/40'
                                  : 'bg-[#0B0F17] border-white/5'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span
                                    className={`w-6 text-center font-mono text-xs font-bold tabular-nums ${
                                      isLeader ? 'text-amber-400' : 'text-slate-500'
                                    }`}
                                  >
                                    {index + 1}º
                                  </span>
                                  <img
                                    src={player.imageUrl}
                                    alt={player.name}
                                    referrerPolicy="no-referrer"
                                    className="w-9 h-9 rounded-lg object-cover bg-slate-900 border border-white/10 shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-white truncate">
                                      {player.name}
                                    </p>
                                    <p className="text-xs text-slate-400 font-mono tabular-nums">
                                      {stats.squadVotes} elenco <span aria-hidden="true">·</span>{' '}
                                      {stats.publicVotes} público
                                    </p>
                                  </div>
                                </div>

                                <div className="text-right font-mono tabular-nums shrink-0">
                                  <span
                                    className={`text-sm font-bold ${
                                      isLeader ? 'text-amber-400' : 'text-white'
                                    }`}
                                  >
                                    {stats.total} {stats.total === 1 ? 'voto' : 'votos'}
                                  </span>
                                  <span className="block text-xs text-slate-400">{pct}%</span>
                                </div>
                              </div>

                              <div className="mt-2 w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all ${
                                    isLeader ? 'bg-amber-400' : 'bg-slate-500'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* TAB 2: MANAGE SQUAD MEMBERS (ELENCO) */}
          {activeTab === 'squad' && data && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Gerenciar Integrantes do Elenco
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Adicione novos jogadores com foto da carta oficial, arquétipo e atributos para
                    aparecerem nos perfis e nas categorias de votação.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRestorePlayers(true)}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar Elenco Padrão</span>
                  </button>

                  <button
                    type="button"
                    onClick={openCreatePlayerForm}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Novo Integrante</span>
                  </button>
                </div>
              </div>

              {confirmRestorePlayers && (
                <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <p className="text-xs text-amber-200">
                    Deseja restaurar a lista original com os 6 integrantes padrão do elenco?
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmRestorePlayers(false)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white/10 text-xs text-slate-200"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleRestoreDefaultPlayers}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold"
                    >
                      Confirmar Restauração
                    </button>
                  </div>
                </div>
              )}

              {/* Create / Edit Player Form Box */}
              {(isCreatingPlayer || editingPlayer) && (
                <form
                  onSubmit={handleSavePlayer}
                  className="rounded-2xl bg-[#151C28] border border-amber-500/40 p-5 space-y-5"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h4 className="font-display text-lg font-bold text-white">
                      {editingPlayer
                        ? `Editar Integrante: ${editingPlayer.name}`
                        : 'Adicionar Novo Integrante ao Elenco'}
                    </h4>
                    <button
                      type="button"
                      onClick={closePlayerForm}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Live Card Preview & Photo Upload */}
                    <div className="flex flex-col items-center justify-start space-y-3 bg-[#0B0F17] border border-white/10 rounded-2xl p-4">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                        Prévia da Carta Oficial
                      </span>

                      <div className="w-40 aspect-[3/4] rounded-2xl overflow-hidden bg-slate-950 border border-amber-500/30 flex items-center justify-center relative shadow-lg">
                        {playerImageUrl ? (
                          <img
                            src={playerImageUrl}
                            alt={playerName || 'Prévia'}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain p-1"
                          />
                        ) : (
                          <div className="text-center p-4 text-slate-500">
                            <ImageIcon className="w-8 h-8 mx-auto mb-1.5 opacity-60" />
                            <span className="text-[11px] block">Sem foto selecionada</span>
                          </div>
                        )}
                      </div>

                      <div className="text-center">
                        <p className="font-display text-lg font-bold text-white">
                          {playerName || 'Nome do Jogador'}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400">
                          Nível {playerLevel} · {playerArchetype || 'HUNTER'} · TOT{' '}
                          {playerTotalStats}
                        </p>
                      </div>

                      <label className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors">
                        <Upload className="w-4 h-4" />
                        <span>
                          {uploadingPhoto
                            ? 'Processando foto...'
                            : 'Enviar Foto / Carta do Dispositivo'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoFileChange}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Right 2 Columns: Player Attributes */}
                    <div className="lg:col-span-2 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Nome do Integrante *
                          </label>
                          <input
                            type="text"
                            required
                            disabled={Boolean(editingPlayer)}
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            placeholder="Ex: Gabriel"
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white disabled:opacity-60 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Gamertag / ID Online *
                          </label>
                          <input
                            type="text"
                            required
                            value={playerGamertag}
                            onChange={(e) => setPlayerGamertag(e.target.value)}
                            placeholder="Ex: GabrielPro10"
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Arquétipo da Carta
                          </label>
                          <input
                            type="text"
                            value={playerArchetype}
                            onChange={(e) => setPlayerArchetype(e.target.value)}
                            placeholder="Ex: HUNTER, CREATOR+, SPARK+"
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Nível (Level)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={playerLevel}
                            onChange={(e) => setPlayerLevel(Number(e.target.value))}
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Total de Stats (TOT)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={9999}
                            value={playerTotalStats}
                            onChange={(e) => setPlayerTotalStats(Number(e.target.value))}
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Resumo de Atributos da Carta
                          </label>
                          <input
                            type="text"
                            value={playerStatsSummary}
                            onChange={(e) => setPlayerStatsSummary(e.target.value)}
                            placeholder="Ex: REA 92 · FRI 94 · FIN 95 · VOL 94"
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1.5">
                            Nacionalidade (Sigla)
                          </label>
                          <input
                            type="text"
                            maxLength={4}
                            value={playerNationality}
                            onChange={(e) => setPlayerNationality(e.target.value)}
                            placeholder="BR"
                            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">
                          URL da Foto / Carta (preenchido automaticamente no upload ou cole um link) *
                        </label>
                        <input
                          type="text"
                          required
                          value={playerImageUrl}
                          onChange={(e) => setPlayerImageUrl(e.target.value)}
                          placeholder="Envie uma imagem no botão ao lado ou cole https://... ou /cards/..."
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={closePlayerForm}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-medium"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={savingPlayer || uploadingPhoto}
                          className="min-h-[42px] px-5 py-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5"
                        >
                          <Check className="w-4 h-4" />
                          <span>
                            {savingPlayer
                              ? 'Salvando...'
                              : editingPlayer
                                ? 'Salvar Alterações'
                                : 'Cadastrar Integrante'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              )}

              {/* Current Squad Members Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {activePlayers.map((player) => (
                  <div
                    key={player.id}
                    className="rounded-2xl bg-[#151C28] border border-white/10 p-4 flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-center gap-3.5">
                      <img
                        src={player.imageUrl}
                        alt={player.name}
                        referrerPolicy="no-referrer"
                        className="w-14 h-18 rounded-xl object-cover object-top bg-slate-950 border border-amber-500/30 shrink-0"
                      />
                      <div className="min-w-0">
                        <h4 className="font-display text-xl font-bold text-white truncate">
                          {player.name}
                        </h4>
                        <p className="text-xs font-mono text-slate-400 truncate">
                          {player.gamertag} · Nível {player.level}
                        </p>
                        <p className="text-[11px] font-mono text-amber-400 mt-0.5 truncate">
                          {player.archetype} · TOT {player.totalStats}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                          {player.statsSummary}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                      {playerToDelete?.id === player.id ? (
                        <div className="flex items-center gap-2 bg-red-950/70 border border-red-500/40 rounded-xl p-1.5 w-full justify-between">
                          <span className="text-xs text-red-200 px-2">Remover {player.name}?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDeletePlayer(player)}
                              className="min-h-[32px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500"
                            >
                              Sim
                            </button>
                            <button
                              type="button"
                              onClick={() => setPlayerToDelete(null)}
                              className="min-h-[32px] px-2.5 rounded-lg bg-white/10 text-slate-300 text-xs"
                            >
                              Não
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditPlayerForm(player)}
                            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPlayerToDelete(player)}
                            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20 text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remover</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: MANAGE QUESTIONS (CREATE, EDIT, DELETE) */}
          {activeTab === 'questions' && data && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Gerenciar Categorias e Questões da Votação
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Crie novas categorias, edite títulos, defina quais questões aparecem para o
                    perfil "Outro" ou exclua perguntas.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreDefaults(true)}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar Padrão</span>
                  </button>

                  <button
                    type="button"
                    onClick={openCreateForm}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nova Questão</span>
                  </button>
                </div>
              </div>

              {confirmRestoreDefaults && (
                <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <p className="text-xs text-amber-200">
                    Deseja restaurar a lista original de questões do formulário Pro Clubs Awards?
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmRestoreDefaults(false)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white/10 text-xs text-slate-200"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleRestoreDefaultQuestions}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold"
                    >
                      Confirmar Restauração
                    </button>
                  </div>
                </div>
              )}

              {/* Create / Edit Form Box */}
              {(isCreatingQuestion || editingQuestion) && (
                <form
                  onSubmit={handleSaveQuestion}
                  className="rounded-2xl bg-[#151C28] border border-amber-500/40 p-5 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h4 className="font-display text-lg font-bold text-white">
                      {editingQuestion
                        ? `Editar Questão: ${editingQuestion.title}`
                        : 'Criar Nova Questão de Votação'}
                    </h4>
                    <button
                      type="button"
                      onClick={closeQuestionForm}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Título da Categoria / Troféu *
                      </label>
                      <input
                        type="text"
                        required
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="Ex: LUVA DE OURO D'OR"
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Subtítulo / Descrição da Pergunta
                      </label>
                      <input
                        type="text"
                        value={formSubtitle}
                        onChange={(e) => setFormSubtitle(e.target.value)}
                        placeholder="Ex: Jogador mais decisivo nas finais"
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Tipo de Questão
                      </label>
                      <select
                        value={formType}
                        onChange={(e) => setFormType(e.target.value as QuestionType)}
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-500"
                      >
                        <option value="choice">Votação nos Jogadores (Múltipla Escolha)</option>
                        <option value="text">Resposta Escrita (Ex: Gol Puskas)</option>
                        <option value="stat_info">Apenas Informativa / Estatística</option>
                      </select>
                    </div>

                    {formType !== 'stat_info' && (
                      <label className="flex items-center gap-3 p-3 rounded-xl bg-[#0B0F17] border border-white/10 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formPublicVisible}
                          onChange={(e) => setFormPublicVisible(e.target.checked)}
                          className="w-4 h-4 accent-amber-500"
                        />
                        <div>
                          <span className="block text-xs font-semibold text-white">
                            Aberta ao Público ("Outro")
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            Exibir quando o usuário seleciona "Outro"
                          </span>
                        </div>
                      </label>
                    )}

                    {formType === 'choice' && (
                      <label className="flex items-center gap-3 p-3 rounded-xl bg-[#0B0F17] border border-white/10 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formShowPhotos}
                          onChange={(e) => setFormShowPhotos(e.target.checked)}
                          className="w-4 h-4 accent-amber-500"
                        />
                        <div>
                          <span className="block text-xs font-semibold text-white">
                            Exibir Cartas / Fotos
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            Destacar fotos dos bonecos na questão
                          </span>
                        </div>
                      </label>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeQuestionForm}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-medium"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingQuestion}
                      className="min-h-[42px] px-5 py-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>
                        {savingQuestion
                          ? 'Salvando...'
                          : editingQuestion
                            ? 'Salvar Alterações'
                            : 'Criar Questão'}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {/* Questions List */}
              <div className="space-y-2.5">
                {data.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="rounded-2xl bg-[#151C28] border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <h4 className="font-display text-lg font-bold text-white truncate">
                          {q.title}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5">{q.subtitle}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono mt-1.5">
                        <span>
                          {q.type === 'choice'
                            ? 'Múltipla Escolha'
                            : q.type === 'text'
                              ? 'Texto Aberto'
                              : 'Estatística (Não respondível)'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={q.publicVisible ? 'text-amber-400 font-semibold' : ''}>
                          {q.publicVisible ? 'Visível para "Outro" e Elenco' : 'Apenas Elenco'}
                        </span>
                        {q.showPhotos && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-400 flex items-center gap-1">
                              <ImageIcon className="w-3 h-3" /> Com Fotos das Cartas
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {questionToDelete?.id === q.id ? (
                        <div className="flex items-center gap-2 bg-red-950/70 border border-red-500/40 rounded-xl p-1.5">
                          <span className="text-xs text-red-200 px-2">Excluir?</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q)}
                            className="min-h-[34px] px-3 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuestionToDelete(null)}
                            className="min-h-[34px] px-2.5 rounded-lg bg-white/10 text-slate-300 text-xs"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditForm(q)}
                            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuestionToDelete(q)}
                            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20 text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Deletar</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: VOTERS & TOKENS LOG */}
          {activeTab === 'voters' && data && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">
                  Registro de Votos & Tokens Únicos Validados
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cada acesso recebe um token único determinístico vinculado ao seu IP e dispositivo
                  até a conclusão do voto.
                </p>
              </div>

              {data.votes.length === 0 ? (
                <div className="rounded-2xl bg-[#151C28] border border-white/10 p-8 text-center">
                  <Trophy className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-300 font-medium">
                    Nenhum voto foi concluído até o momento.
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Sessões ativas em preenchimento agora: {data.activeSessionsCount}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data.votes.map((vote) => (
                    <div
                      key={vote.id}
                      className="rounded-2xl bg-[#151C28] border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{vote.voterProfile}</span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="font-mono text-xs text-amber-400 tabular-nums">
                            {vote.token}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 font-mono tabular-nums mt-1">
                          IP Hash: {vote.ipHash} <span aria-hidden="true">·</span>{' '}
                          {Object.keys(vote.answers).length} questões respondidas
                        </p>
                      </div>
                      <div className="text-xs font-mono tabular-nums text-slate-400">
                        {new Date(vote.submittedAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
