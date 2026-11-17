export interface PlayerProfile {
  id: string;
  name: string;
  gamertag: string;
  archetype: string;
  level: number;
  totalStats: number;
  statsSummary: string;
  imageUrl: string;
  nationality: string;
}

export type QuestionType = 'choice' | 'text' | 'stat_info';

export interface VotingQuestion {
  id: string;
  title: string;
  subtitle: string;
  type: QuestionType;
  publicVisible: boolean;
  showPhotos: boolean;
  required: boolean;
  order: number;
}

export interface VoteRecord {
  id: string;
  token: string;
  ipHash: string;
  deviceSignature: string;
  voterProfile: string; // 'Pedrin' | 'Pedrão' | 'Lourival' | 'Igor' | 'Victor' | 'Paulo' | 'Outro'
  answers: Record<string, string>;
  submittedAt: string;
}

export interface ActiveSessionDraft {
  token: string;
  ipHash: string;
  deviceSignature: string;
  selectedProfile: string | null;
  draftAnswers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const STATS_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1de-zl6cWcxIDlCUaxw-mPmm26UaS9nSH7W5Ql0icmYg/edit?usp=sharing';

export const HEADER_BANNER_URL = '/cards/header.jpg';

export const PLAYERS: PlayerProfile[] = [
  {
    id: 'Pedrin',
    name: 'Pedrin',
    gamertag: 'Pedroh360xd',
    archetype: 'HUNTER',
    level: 100,
    totalStats: 369,
    statsSummary: 'REA 90 · FRI 93 · FIN 96 · VOL 90',
    imageUrl: '/cards/pedrin.jpg',
    nationality: 'BR',
  },
  {
    id: 'Pedrão',
    name: 'Pedrão',
    gamertag: '36105819',
    archetype: 'CREATOR+',
    level: 98,
    totalStats: 368,
    statsSummary: 'VIS 92 · PCU 92 · CHL 90 · CUR 94',
    imageUrl: '/cards/pedrao.jpg',
    nationality: 'BR',
  },
  {
    id: 'Lourival',
    name: 'Lourival',
    gamertag: 'BlackNight10101',
    archetype: 'HUNTER',
    level: 100,
    totalStats: 390,
    statsSummary: 'REA 99 · FRI 99 · FIN 93 · VOL 99',
    imageUrl: '/cards/lourival.jpg',
    nationality: 'BR',
  },
  {
    id: 'Igor',
    name: 'Igor',
    gamertag: 'BezerraB6042',
    archetype: 'HOTSHOT',
    level: 100,
    totalStats: 372,
    statsSummary: 'ACL 93 · EQB 94 · FIN 92 · CUR 93',
    imageUrl: '/cards/igor.jpg',
    nationality: 'BR',
  },
  {
    id: 'Victor',
    name: 'Victor',
    gamertag: 'OVITA01',
    archetype: 'SPARK+',
    level: 100,
    totalStats: 384,
    statsSummary: 'ACL 99 · AGI 95 · CBO 95 · CON 95',
    imageUrl: '/cards/victor.jpg',
    nationality: 'BR',
  },
  {
    id: 'Paulo',
    name: 'Paulo',
    gamertag: 'dalpipoca',
    archetype: 'MAGICIAN+',
    level: 100,
    totalStats: 364,
    statsSummary: 'ACL 90 · EQB 94 · FIN 90 · CUR 90',
    imageUrl: '/cards/paulo.jpg',
    nationality: 'JP',
  },
];

export const DEFAULT_QUESTIONS: VotingQuestion[] = [
  {
    id: 'soldado',
    title: 'SOLDADO (QUE RECEBE ORDEM)',
    subtitle: 'Mulher não deixa jogar',
    type: 'choice',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 1,
  },
  {
    id: 'bagre_do_ano',
    title: 'BAGRE DO ANO',
    subtitle: 'Pior jogador',
    type: 'choice',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 2,
  },
  {
    id: 'morto_de_fome',
    title: 'MORTO DE FOME',
    subtitle: 'Mais fominha',
    type: 'choice',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 3,
  },
  {
    id: 'diraca_dor',
    title: "DiRaça D'OR",
    subtitle: 'Jogador mais pitbull (melhor defesa)',
    type: 'choice',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 4,
  },
  {
    id: 'rodilindo_dor',
    title: "RODILINDO D'OR (Aberto ao público)",
    subtitle: 'Boneco mais feio kkkk',
    type: 'choice',
    publicVisible: true,
    showPhotos: true,
    required: true,
    order: 5,
  },
  {
    id: 'beckham_dor',
    title: "BECKHAM D'OR (Aberto ao Público)",
    subtitle: 'Boneco mais bonito',
    type: 'choice',
    publicVisible: true,
    showPhotos: true,
    required: true,
    order: 6,
  },
  {
    id: 'ragebait',
    title: 'RAGEBAIT',
    subtitle: 'Jogador mais reclamão',
    type: 'choice',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 7,
  },
  {
    id: 'ballon_dor',
    title: "BALLON D'OR",
    subtitle: 'Melhor jogador do ano (Na sua opinião)',
    type: 'choice',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 8,
  },
  {
    id: 'gol_puskas',
    title: 'Gol Puskas - Gol mais bonito',
    subtitle:
      'Descreva com suas palavras qual foi o gol mais bonito que lembra ter acontecido nas jogatinas de Pro Clubs e quem fez ele (Não invente)',
    type: 'text',
    publicVisible: false,
    showPhotos: false,
    required: true,
    order: 9,
  },
  {
    id: 'felipe_melo_dor',
    title: "Felipe Melo D'or - Mais expulsões (Estatística)",
    subtitle: 'Não responda — Definido pelas estatísticas proporcionais aos jogos',
    type: 'stat_info',
    publicVisible: false,
    showPhotos: false,
    required: false,
    order: 10,
  },
  {
    id: 'mais_jogos',
    title: 'Mais jogos (Estatística)',
    subtitle: 'Não responda — Definido pelas estatísticas do clube',
    type: 'stat_info',
    publicVisible: false,
    showPhotos: false,
    required: false,
    order: 11,
  },
  {
    id: 'chuteira_de_ouro',
    title: 'Chuteira de ouro - Mais gols (Estatística)',
    subtitle: 'Não responda — Definido pelas estatísticas proporcionais aos jogos',
    type: 'stat_info',
    publicVisible: false,
    showPhotos: false,
    required: false,
    order: 12,
  },
  {
    id: 'banco_do_ano',
    title: 'Banco do ano - Menos jogos disputados (Estatística)',
    subtitle: 'Não responda — Definido pelas estatísticas do clube',
    type: 'stat_info',
    publicVisible: false,
    showPhotos: false,
    required: false,
    order: 13,
  },
  {
    id: 'de_bruyne_dor',
    title: "De Bruyne D'or - Mais assistência (Estatística)",
    subtitle: 'Não responda — Definido pelas estatísticas proporcionais aos jogos',
    type: 'stat_info',
    publicVisible: false,
    showPhotos: false,
    required: false,
    order: 14,
  },
];
