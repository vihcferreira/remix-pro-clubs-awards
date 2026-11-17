import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Trophy,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Check,
  Lock,
  ZoomIn,
  UserCheck,
  Users,
  Sparkles,
  Settings,
  AlertCircle,
  CheckCircle2,
  BarChart2,
} from 'lucide-react';
import {
  PLAYERS,
  STATS_SPREADSHEET_URL,
  HEADER_BANNER_URL,
  type PlayerProfile,
  type VoteRecord,
  type VotingQuestion,
} from './data/awardsData';
import { getOrCreateDeviceSignature } from './utils/deviceIdentity';
import { CardLightboxModal } from './components/CardLightboxModal';
import { AdminModal } from './components/AdminModal';

interface SessionInitResponse {
  token: string;
  ipHash: string;
  alreadyVoted: boolean;
  voteRecord: VoteRecord | null;
  draft: {
    token: string;
    selectedProfile: string | null;
    draftAnswers: Record<string, string>;
  } | null;
  questions: VotingQuestion[];
  votedProfiles: string[];
}

export default function App() {
  const [deviceSignature] = useState<string>(() => getOrCreateDeviceSignature());
  const [loading, setLoading] = useState<boolean>(true);
  const [token, setToken] = useState<string>('...');
  const [ipHash, setIpHash] = useState<string>('');
  const [alreadyVoted, setAlreadyVoted] = useState<boolean>(false);
  const [voteRecord, setVoteRecord] = useState<VoteRecord | null>(null);
  const [questions, setQuestions] = useState<VotingQuestion[]>([]);
  const [votedProfiles, setVotedProfiles] = useState<string[]>([]);

  // Voting Flow State
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [step, setStep] = useState<'profile' | 'ballot' | 'done'>('profile');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'all' | 'step'>('all');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals
  const [lightboxData, setLightboxData] = useState<{
    player: PlayerProfile;
    questionId?: string;
    categoryTitle?: string;
  } | null>(null);
  const [adminOpen, setAdminOpen] = useState<boolean>(false);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceSignature }),
      });
      if (!res.ok) throw new Error('Falha ao inicializar sessão');
      const data = (await res.json()) as SessionInitResponse;

      setToken(data.token);
      setIpHash(data.ipHash);
      setQuestions(data.questions);
      setVotedProfiles(data.votedProfiles || []);

      if (data.alreadyVoted && data.voteRecord) {
        setAlreadyVoted(true);
        setVoteRecord(data.voteRecord);
        setSelectedProfile(data.voteRecord.voterProfile);
        setAnswers(data.voteRecord.answers || {});
        setStep('done');
      } else {
        setAlreadyVoted(false);
        setVoteRecord(null);
        const restoredProfile = data.draft?.selectedProfile || null;
        const restoredAnswers = data.draft?.draftAnswers || {};
        setSelectedProfile(restoredProfile);
        setAnswers(restoredAnswers);
        if (restoredProfile) {
          setStep('ballot');
        } else {
          setStep('profile');
        }
      }
    } catch {
      setErrorMessage('Erro ao conectar ao servidor de votação. Tente atualizar a página.');
    } finally {
      setLoading(false);
    }
  }, [deviceSignature]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Persist draft to server so token keeps state until voting is concluded
  const syncDraft = useCallback(
    async (nextProfile: string | null, nextAnswers: Record<string, string>) => {
      try {
        await fetch('/api/session/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceSignature,
            selectedProfile: nextProfile,
            draftAnswers: nextAnswers,
          }),
        });
      } catch {
        // non-blocking draft sync
      }
    },
    [deviceSignature]
  );

  // Filter questions based on selected profile ("Outro" sees ONLY the 2 public questions)
  const votableQuestions = useMemo(() => {
    const base = questions.filter((q) => q.type !== 'stat_info');
    if (selectedProfile === 'Outro') {
      return base.filter((q) => q.publicVisible);
    }
    return base;
  }, [questions, selectedProfile]);

  const statQuestions = useMemo(() => {
    if (selectedProfile === 'Outro') return [];
    return questions.filter((q) => q.type === 'stat_info');
  }, [questions, selectedProfile]);

  const answeredCount = useMemo(() => {
    return votableQuestions.filter((q) => {
      const val = answers[q.id];
      return typeof val === 'string' && val.trim().length > 0;
    }).length;
  }, [votableQuestions, answers]);

  const allRequiredAnswered = useMemo(() => {
    return votableQuestions.every((q) => {
      if (!q.required) return true;
      const val = answers[q.id];
      return typeof val === 'string' && val.trim().length > 0;
    });
  }, [votableQuestions, answers]);

  const handleSelectProfile = (profileId: string) => {
    setErrorMessage(null);
    // Clean any self-vote if switching to a player profile
    const cleanedAnswers = { ...answers };
    if (profileId !== 'Outro') {
      for (const q of questions) {
        if (q.type === 'choice' && cleanedAnswers[q.id] === profileId) {
          delete cleanedAnswers[q.id];
        }
      }
    }
    setSelectedProfile(profileId);
    setAnswers(cleanedAnswers);
    setCurrentQuestionIndex(0);
    setStep('ballot');
    syncDraft(profileId, cleanedAnswers);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeProfile = () => {
    setErrorMessage(null);
    setStep('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAnswerChange = (questionId: string, value: string) => {
    setErrorMessage(null);
    const updated = { ...answers, [questionId]: value };
    setAnswers(updated);
    syncDraft(selectedProfile, updated);
  };

  const handleSubmitBallot = async () => {
    if (!selectedProfile) {
      setErrorMessage('Selecione seu perfil antes de enviar o voto.');
      return;
    }

    for (let i = 0; i < votableQuestions.length; i++) {
      const q = votableQuestions[i];
      const val = (answers[q.id] || '').trim();
      if (q.required && !val) {
        setErrorMessage(`Por favor, responda a categoria obrigatória: "${q.title}".`);
        if (viewMode === 'step') {
          setCurrentQuestionIndex(i);
        } else {
          const el = document.getElementById(`question-card-${q.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/votes/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSignature,
          voterProfile: selectedProfile,
          answers,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Não foi possível registrar seu voto.');
        if (res.status === 409 && data.voteRecord) {
          setAlreadyVoted(true);
          setVoteRecord(data.voteRecord);
          setStep('done');
        }
        return;
      }

      setAlreadyVoted(true);
      setVoteRecord(data.voteRecord);
      setStep('done');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setErrorMessage('Falha de conexão ao enviar o voto. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderQuestionCard = (q: VotingQuestion, index: number, total: number) => {
    const currentAnswer = answers[q.id] || '';
    const isAnswered = currentAnswer.trim().length > 0;

    return (
      <section
        key={q.id}
        id={`question-card-${q.id}`}
        className="rounded-3xl bg-[#151C28] border border-white/10 p-5 sm:p-7 transition-colors"
      >
        {/* Question Header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-white/10">
          <div>
            <p className="text-xs font-mono tabular-nums text-amber-400">
              Categoria {String(index + 1).padStart(2, '0')} de {String(total).padStart(2, '0')}
              {q.publicVisible && (
                <>
                  {' '}
                  <span aria-hidden="true">·</span> Aberta ao Público
                </>
              )}
              {q.required && (
                <>
                  {' '}
                  <span aria-hidden="true">·</span> Obrigatória
                </>
              )}
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-white mt-1">
              {q.title}
            </h2>
            {q.subtitle && (
              <p className="text-sm text-slate-300 mt-1 leading-relaxed">{q.subtitle}</p>
            )}
          </div>

          {isAnswered && (
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1 shrink-0">
              <Check className="w-3.5 h-3.5" /> Respondida
            </span>
          )}
        </div>

        {/* Question Body: Choice with Full Player Cards (RODILINDO D'OR / BECKHAM D'OR) */}
        {q.type === 'choice' && q.showPhotos && (
          <div className="mt-5">
            <p className="text-xs text-slate-400 mb-4">
              Toque em uma carta para selecionar seu voto ou use o botão de lupa para ampliar a foto
              do boneco:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4">
              {PLAYERS.map((player) => {
                const isSelf = selectedProfile !== 'Outro' && selectedProfile === player.id;
                const isSelected = currentAnswer === player.id;

                return (
                  <div
                    key={player.id}
                    className={`group relative rounded-2xl overflow-hidden border transition-all flex flex-col ${
                      isSelf
                        ? 'bg-[#0B0F17]/60 border-white/5 opacity-55'
                        : isSelected
                          ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-500/10'
                          : 'bg-[#0B0F17] border-white/10 hover:border-white/25'
                    }`}
                  >
                    {/* Card Image Container */}
                    <div className="relative aspect-[3/4] w-full bg-slate-950 overflow-hidden">
                      <img
                        src={player.imageUrl}
                        alt={`Carta de ${player.name}`}
                        referrerPolicy="no-referrer"
                        onClick={() => {
                          if (!isSelf) {
                            handleAnswerChange(q.id, player.id);
                          }
                        }}
                        className={`w-full h-full object-contain p-1.5 transition-transform duration-200 ${
                          isSelf ? 'cursor-not-allowed grayscale' : 'cursor-pointer group-hover:scale-[1.02]'
                        }`}
                      />

                      {/* Zoom button (44x44px hitbox) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxData({
                            player,
                            questionId: q.id,
                            categoryTitle: q.title,
                          });
                        }}
                        className="absolute top-2 right-2 min-h-[40px] min-w-[40px] rounded-xl bg-black/75 backdrop-blur-sm border border-white/15 text-slate-200 hover:text-white hover:bg-black flex items-center justify-center transition-colors"
                        aria-label={`Ampliar carta de ${player.name}`}
                        title="Ampliar carta"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>

                      {isSelected && (
                        <div className="absolute top-2 left-2 h-8 px-2.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-md">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Voto</span>
                        </div>
                      )}
                    </div>

                    {/* Action Button Footer */}
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => handleAnswerChange(q.id, player.id)}
                      className={`w-full min-h-[52px] px-3 py-2.5 text-left border-t transition-colors flex items-center justify-between gap-2 ${
                        isSelf
                          ? 'border-white/5 cursor-not-allowed'
                          : isSelected
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                            : 'border-white/10 text-white hover:bg-white/5'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="block text-sm font-bold truncate">{player.name}</span>
                        <span
                          className={`block text-[11px] font-mono tabular-nums truncate ${
                            isSelected ? 'text-slate-900' : 'text-slate-400'
                          }`}
                        >
                          {isSelf ? 'Auto-voto bloqueado' : `Nível ${player.level} · ${player.archetype}`}
                        </span>
                      </div>

                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                          isSelf
                            ? 'border-white/15 text-slate-600'
                            : isSelected
                              ? 'bg-slate-950 border-slate-950 text-amber-400'
                              : 'border-white/25'
                        }`}
                      >
                        {isSelf ? (
                          <Lock className="w-3 h-3" />
                        ) : isSelected ? (
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        ) : null}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Question Body: Choice Standard (Compact Touch Rows/Cards) */}
        {q.type === 'choice' && !q.showPhotos && (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PLAYERS.map((player) => {
              const isSelf = selectedProfile !== 'Outro' && selectedProfile === player.id;
              const isSelected = currentAnswer === player.id;

              return (
                <button
                  key={player.id}
                  type="button"
                  disabled={isSelf}
                  onClick={() => handleAnswerChange(q.id, player.id)}
                  className={`min-h-[68px] p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 ${
                    isSelf
                      ? 'bg-[#0B0F17]/50 border-white/5 opacity-50 cursor-not-allowed'
                      : isSelected
                        ? 'bg-amber-500/15 border-amber-400 shadow-md'
                        : 'bg-[#0B0F17] border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={player.imageUrl}
                      alt={player.name}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-xl object-cover object-top bg-slate-900 border border-white/15 shrink-0"
                    />
                    <div className="min-w-0">
                      <span className="block text-sm font-bold text-white truncate">
                        {player.name}
                      </span>
                      <span className="block text-xs text-slate-400 font-mono tabular-nums truncate">
                        {isSelf
                          ? 'Você · Auto-voto bloqueado'
                          : `${player.gamertag} · Nível ${player.level}`}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                      isSelf
                        ? 'border-white/10 text-slate-600'
                        : isSelected
                          ? 'bg-amber-500 border-amber-500 text-slate-950'
                          : 'border-white/25'
                    }`}
                  >
                    {isSelf ? (
                      <Lock className="w-3 h-3" />
                    ) : isSelected ? (
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Question Body: Open Text (Gol Puskas) */}
        {q.type === 'text' && (
          <div className="mt-5">
            <textarea
              rows={4}
              value={currentAnswer}
              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
              placeholder="Descreva aqui qual foi o gol mais bonito das jogatinas de Pro Clubs e quem marcou..."
              className="w-full rounded-2xl bg-[#0B0F17] border border-white/15 p-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-xs text-slate-400 font-mono tabular-nums mt-2">
              {currentAnswer.trim().length} caracteres digitados
            </p>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      {/* 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-14 bg-[#0B0F17]/90 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Title */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="font-display text-xl font-bold tracking-wider text-amber-400 whitespace-nowrap shrink-0"
        >
          PRO CLUBS AWARDS
        </a>

        {/* Zone 2: Concise Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
          <a
            href="#regras"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Regras
          </a>
          <button
            type="button"
            onClick={() => {
              if (!alreadyVoted) setStep('profile');
            }}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Perfis
          </button>
          <a
            href={STATS_SPREADSHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Estatísticas do Elenco
          </a>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setAdminOpen(true)}
            className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Settings className="w-3.5 h-3.5 text-amber-400" />
            <span>Painel Admin</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main id="top" className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-28 space-y-6">
        {/* Hero Banner & Official Rules Card */}
        <section
          id="regras"
          className="rounded-3xl overflow-hidden bg-[#151C28] border border-white/10 shadow-xl"
        >
          <div className="relative h-36 sm:h-48 w-full bg-slate-950 overflow-hidden">
            <img
              src={HEADER_BANNER_URL}
              alt="Pro Clubs Awards Banner"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-65"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#151C28] via-[#151C28]/50 to-transparent" />
            <div className="absolute bottom-4 left-5 right-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-mono text-amber-400 tabular-nums">
                  Token Único de Acesso: {token} <span aria-hidden="true">·</span> 1 Voto por Pessoa
                </p>
                <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-wide text-white mt-0.5">
                  PRO CLUBS AWARDS
                </h1>
              </div>

              <a
                href={STATS_SPREADSHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-300 hover:bg-amber-500/25 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Planilha de Estatísticas</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-white/5">
            <p className="font-semibold text-white">
              Esta é uma votação SÉRIA com premiações SÉRIAS, os votos devem ser IMPARCIAIS.
            </p>
            <p>
              As premiações serão dadas de acordo com a votação, exceto para aquelas categorias que
              serão necessárias estatísticas do clube (PROPORCIONAL AOS JOGOS).
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-300 font-medium">
              <span>• Não é PERMITIDO votar em si mesmo (casos de auto-voto são NULOS)</span>
              <span aria-hidden="true">·</span>
              <span>• Só é permitido votar UMA vez, portanto, VOTE CONSCIENTE</span>
              <span aria-hidden="true">·</span>
              <span>• O POVO DECIDIRÁ O MELHOR DA CATEGORIA</span>
            </div>
          </div>
        </section>

        {/* Global Error Alert */}
        {errorMessage && (
          <div className="rounded-2xl bg-red-950/80 border border-red-500/40 p-4 flex items-start gap-3 text-red-200 text-xs sm:text-sm">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl bg-[#151C28] border border-white/10 p-12 text-center">
            <Trophy className="w-8 h-8 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-slate-300 font-medium">
              Validando seu token único de acesso...
            </p>
          </div>
        ) : null}

        {/* STEP 1: PROFILE SELECTION GATE */}
        {!loading && step === 'profile' && !alreadyVoted && (
          <section className="rounded-3xl bg-[#151C28] border border-white/10 p-5 sm:p-7 space-y-6">
            <div className="border-b border-white/10 pb-4">
              <p className="text-xs font-mono text-amber-400 tabular-nums">
                Etapa Inicial Obrigatória <span aria-hidden="true">·</span> Token Fixo {token}
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1">
                Selecione seu Perfil para Acessar a Votação
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                Integrantes do elenco acessam o formulário completo (com auto-voto bloqueado).
                Quem selecionar <strong className="text-white">"Outro"</strong> vota exclusivamente
                nas 2 categorias abertas ao público: <strong className="text-amber-300">RODILINDO D'OR</strong> e{' '}
                <strong className="text-amber-300">BECKHAM D'OR</strong>.
              </p>
            </div>

            {/* Public / Guest Option ("Outro") */}
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                Acesso Público / Convidados
              </h3>
              <button
                type="button"
                onClick={() => handleSelectProfile('Outro')}
                className="w-full min-h-[76px] p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/40 hover:border-amber-400 text-left transition-all flex items-center justify-between gap-4 group"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 shadow-md">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <span className="block font-display text-xl sm:text-2xl font-bold text-white">
                      Outro (Público / Convidado)
                    </span>
                    <span className="block text-xs sm:text-sm text-amber-200/90 mt-0.5">
                      Exibe apenas 2 questões: BECKHAM D'OR e RODILINDO D'OR com as fotos dos bonecos
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-amber-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
              </button>
            </div>

            {/* 6 Squad Participant Profiles */}
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                Participantes do Elenco (Formulário Completo)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {PLAYERS.map((player) => {
                  const hasAlreadyVoted = votedProfiles.includes(player.id);

                  return (
                    <button
                      key={player.id}
                      type="button"
                      disabled={hasAlreadyVoted}
                      onClick={() => handleSelectProfile(player.id)}
                      className={`min-h-[84px] p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 ${
                        hasAlreadyVoted
                          ? 'bg-[#0B0F17]/50 border-white/5 opacity-50 cursor-not-allowed'
                          : 'bg-[#0B0F17] border-white/10 hover:border-amber-500/50 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={player.imageUrl}
                          alt={player.name}
                          referrerPolicy="no-referrer"
                          className="w-13 h-16 rounded-xl object-cover object-top bg-slate-900 border border-amber-500/30 shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="block font-display text-xl font-bold text-white truncate">
                            {player.name}
                          </span>
                          <span className="block text-xs text-slate-400 font-mono tabular-nums truncate">
                            {player.gamertag} <span aria-hidden="true">·</span> Nível {player.level}
                          </span>
                          <span className="block text-[11px] text-amber-400/90 font-mono mt-0.5">
                            {hasAlreadyVoted
                              ? 'Voto já registrado'
                              : `${player.archetype} · TOT ${player.totalStats}`}
                          </span>
                        </div>
                      </div>

                      {hasAlreadyVoted ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* STEP 2: BALLOT VOTING VIEW */}
        {!loading && step === 'ballot' && selectedProfile && !alreadyVoted && (
          <div className="space-y-6">
            {/* Active Voter Profile Bar & View Mode Switcher */}
            <div className="rounded-2xl bg-[#151C28] border border-white/10 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      Perfil: {selectedProfile}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={handleChangeProfile}
                      className="text-xs text-amber-400 hover:underline font-medium"
                    >
                      Trocar perfil
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 font-mono tabular-nums">
                    {selectedProfile === 'Outro'
                      ? 'Exibindo apenas as 2 questões abertas ao público'
                      : `Auto-voto em ${selectedProfile} bloqueado automaticamente`}
                  </p>
                </div>
              </div>

              {/* Progress + View Mode Toggle */}
              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                <span className="text-xs font-mono tabular-nums text-slate-300">
                  Progresso: {answeredCount}/{votableQuestions.length}
                </span>

                <div className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setViewMode('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      viewMode === 'all'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Lista Completa
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('step')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      viewMode === 'step'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Passo a Passo
                  </button>
                </div>
              </div>
            </div>

            {/* Render Questions */}
            {votableQuestions.length === 0 ? (
              <div className="rounded-3xl bg-[#151C28] border border-white/10 p-8 text-center">
                <p className="text-sm text-slate-300">
                  Nenhuma questão disponível para este perfil no momento.
                </p>
              </div>
            ) : viewMode === 'all' ? (
              <div className="space-y-6">
                {votableQuestions.map((q, idx) =>
                  renderQuestionCard(q, idx, votableQuestions.length)
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {votableQuestions[currentQuestionIndex] &&
                  renderQuestionCard(
                    votableQuestions[currentQuestionIndex],
                    currentQuestionIndex,
                    votableQuestions.length
                  )}

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={currentQuestionIndex === 0}
                    onClick={() =>
                      setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))
                    }
                    className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#151C28] border border-white/10 text-slate-200 disabled:opacity-40 text-xs font-semibold flex items-center gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Questão Anterior</span>
                  </button>

                  {currentQuestionIndex < votableQuestions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentQuestionIndex((prev) =>
                          Math.min(votableQuestions.length - 1, prev + 1)
                        )
                      }
                      className="min-h-[48px] px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-bold flex items-center gap-2"
                    >
                      <span>Próxima Questão</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Statistical Categories Info Section (Only shown for Squad Members, matching original Google Form) */}
            {statQuestions.length > 0 && viewMode === 'all' && (
              <section className="rounded-3xl bg-[#151C28]/70 border border-white/10 p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div>
                    <h3 className="font-display text-xl font-bold text-white flex items-center gap-2">
                      <BarChart2 className="w-5 h-5 text-amber-400" />
                      <span>Categorias Decididas por Estatística (Não Responda)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Conforme o formulário oficial, estas categorias são calculadas diretamente
                      pelas estatísticas proporcionais aos jogos do clube.
                    </p>
                  </div>
                  <a
                    href={STATS_SPREADSHEET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>Ver Planilha</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {statQuestions.map((sq) => (
                    <div
                      key={sq.id}
                      className="rounded-2xl bg-[#0B0F17] border border-white/5 p-3.5"
                    >
                      <p className="font-display text-base font-bold text-slate-200">
                        {sq.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{sq.subtitle}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* STEP 3: COMPLETED VOTE RECEIPT */}
        {!loading && (step === 'done' || alreadyVoted) && voteRecord && (
          <section className="rounded-3xl bg-[#151C28] border border-emerald-500/30 p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-mono text-emerald-400 tabular-nums">
                    Voto Único Validado <span aria-hidden="true">·</span> Token {voteRecord.token}
                  </p>
                  <h2 className="font-display text-3xl font-bold text-white mt-0.5">
                    Votação Concluída com Sucesso!
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 mt-1">
                    Seu token único de acesso foi utilizado e bloqueado para garantir 1 único voto
                    por participante no <strong className="text-white">Pro Clubs Awards</strong>.
                  </p>
                </div>
              </div>

              <div className="text-left sm:text-right font-mono text-xs text-slate-400 tabular-nums shrink-0">
                <span className="block text-white font-semibold">
                  Perfil: {voteRecord.voterProfile}
                </span>
                <span>{new Date(voteRecord.submittedAt).toLocaleString('pt-BR')}</span>
              </div>
            </div>

            {/* Summary of the user's recorded choices */}
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                Resumo das Suas Escolhas Registradas
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {questions
                  .filter((q) => voteRecord.answers[q.id])
                  .map((q) => {
                    const ans = voteRecord.answers[q.id];
                    const chosenPlayer = PLAYERS.find((p) => p.id === ans);

                    return (
                      <div
                        key={q.id}
                        className="rounded-2xl bg-[#0B0F17] border border-white/10 p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400 truncate">{q.title}</p>
                          <p className="text-sm font-bold text-amber-400 mt-0.5 break-words">
                            {ans}
                          </p>
                        </div>
                        {chosenPlayer && (
                          <img
                            src={chosenPlayer.imageUrl}
                            alt={chosenPlayer.name}
                            referrerPolicy="no-referrer"
                            className="w-10 h-12 rounded-lg object-cover object-top bg-slate-900 border border-white/10 shrink-0"
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Sticky Bottom Action Bar in Mobile Natural Thumb Zone (Only during ballot step) */}
      {!loading && step === 'ballot' && selectedProfile && !alreadyVoted && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#0B0F17]/95 backdrop-blur-md border-t border-white/10 px-4 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div className="hidden sm:block">
              <p className="text-xs font-semibold text-white">
                Token Ativo: <span className="font-mono text-amber-400">{token}</span>
              </p>
              <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                {answeredCount} de {votableQuestions.length} categorias preenchidas
              </p>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmitBallot}
              className={`w-full sm:w-auto min-w-[240px] h-12 px-6 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
                allRequiredAnswered
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-amber-500/15'
                  : 'bg-white/10 text-slate-200 hover:bg-white/15'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {submitting
                  ? 'Validando Token e Enviando...'
                  : `Confirmar e Enviar Voto (${answeredCount}/${votableQuestions.length})`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Player Card Lightbox Modal */}
      <CardLightboxModal
        player={lightboxData?.player || null}
        onClose={() => setLightboxData(null)}
        categoryTitle={lightboxData?.categoryTitle}
        isSelected={
          lightboxData?.questionId
            ? answers[lightboxData.questionId] === lightboxData.player.id
            : false
        }
        isSelfBlocked={
          selectedProfile !== 'Outro' && selectedProfile === lightboxData?.player.id
        }
        onSelectPlayer={
          lightboxData?.questionId
            ? (playerId) => handleAnswerChange(lightboxData.questionId!, playerId)
            : undefined
        }
      />

      {/* Admin Dashboard Modal */}
      <AdminModal
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        onDataChanged={loadSession}
      />
    </div>
  );
}
