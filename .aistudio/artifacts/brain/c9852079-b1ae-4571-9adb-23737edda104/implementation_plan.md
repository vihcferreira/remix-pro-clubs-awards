# Pro Clubs Awards — Plataforma de Votação Interativa

Transformação do formulário oficial do **Pro Clubs Awards** em uma aplicação web mobile-first com estética de gala esportiva (*Ballon d'Or / EA FC Pro Clubs*), seleção prévia de perfil de votante, exibição condicional de categorias com as cartas oficiais do elenco, token único automático por acesso/dispositivo e painel administrativo completo.

## User Review & Critical Decisions

> [!IMPORTANT]
> O plano foi atualizado com todas as suas solicitações:

- **Token Único Automático por Acesso (Sem Geração Manual pelo Admin)**: Ao entrar no link, o sistema gera e vincula automaticamente um **Token Único de Acesso Fixo** para o usuário combinando o **IP de conexão + Assinatura de Dispositivo (Device Fingerprint) + Persistência Local**. Esse mesmo token é mantido durante toda a navegação até a conclusão da votação e fica bloqueado no servidor após o envio, impedindo que a mesma pessoa vote mais de uma vez. Além disso, cada perfil nominal do elenco (*Pedrin, Pedrão, Lourival, Igor, Victor, Paulo*) fica marcado como já votado após concluir sua participação.
- **Exclusão de Dados da Votação com Confirmação no Admin**: O Painel Admin terá um botão dedicado **"Zerar / Excluir Dados de Votação"** protegido por um modal de confirmação dupla para limpar todos os votos e liberar novamente os tokens/perfis caso necessário.
- **Gerenciamento Completo de Questões (Criar, Editar e Deletar)**: O Painel Admin contará com um editor dinâmico de questões onde é possível **criar novas categorias**, **editar títulos/descrições/regras de visibilidade** (ex.: definir se a questão aparece para o perfil *"Outro / Público"*, se exibe as fotos das cartas ou se é descritiva/estatística) e **excluir questões**.
- **Bloqueio de Auto-Votação & Fotos nas Questões Abertas**: Mantido o bloqueio automático do próprio nome quando um jogador do elenco vota e a exibição das 6 cartas oficiais nas questões abertas ao público (**RODILINDO D'OR** e **BECKHAM D'OR**).

---

## 1. Overview & Core Concept

- **O Que o Aplicativo Faz**: Uma plataforma de votação responsiva e otimizada para dispositivos móveis que identifica automaticamente a sessão do usuário com um token único fixo, apresenta a escolha de perfil e exibe as categorias dinâmicas do **Pro Clubs Awards**.
- **Público-Alvo & Perfis de Acesso**:
  1. **Elenco do Clube (6 Jogadores: Pedrin, Pedrão, Lourival, Igor, Victor e Paulo)**: Acessam o formulário completo com todas as categorias configuradas para o elenco, incluindo a questão descritiva (**Gol Puskas**) e as categorias informativas de estatísticas.
  2. **Público Externo / Convidados (Opção "Outro")**: Visualizam exclusivamente as questões marcadas como **Abertas ao Público** (por padrão, **BECKHAM D'OR — Boneco mais bonito** e **RODILINDO D'OR — Boneco mais feio kkkk**), ilustradas com as cartas e fotos dos 6 jogadores.
- **Valor Principal**: Garante 1 voto por pessoa de forma transparente e sem atrito (sem exigir que o organizador gere códigos manualmente), aplica automaticamente a regra contra auto-votação e oferece autonomia total ao administrador para gerenciar questões e zerar a votação.

---

## 2. User Experience & Visual Design

### Fluxo Principal do Usuário (Zero-State até a Conclusão)

1. **Identificação Automática & Boas-Vindas**:
   - Assim que o usuário abre o link, o app captura o identificador fixo de acesso (hash de IP + assinatura do aparelho/navegador) e gera seu **Token Único de Sessão** (exibido discretamente no rodapé/cabeçalho como garantia de autenticidade).
   - Se esse token/IP já concluiu a votação anteriormente, o app exibe imediatamente o comprovante de **"Voto Já Registrado"**, bloqueando novos envios.
   - Caso ainda não tenha votado, exibe o manifesto oficial do **PRO CLUBS AWARDS**, as regras de imparcialidade e o link para a planilha de estatísticas do elenco.
2. **Seleção de Perfil do Votante**:
   - Grade interativa com os **6 perfis do elenco** (*Pedrin, Pedrão, Lourival, Igor, Victor, Paulo* — exibindo nome, gamertag e miniatura da carta) + card destacado para **"Outro (Público / Convidado)"**.
   - Se o usuário começar a preencher e atualizar a página antes de enviar, seu token fixo e progresso são mantidos até que a votação seja concluída.
3. **Jornada de Votação Adaptativa**:
   - **Se "Outro" foi selecionado**: Exibe apenas as questões marcadas como abertas ao público (**RODILINDO D'OR** e **BECKHAM D'OR**), apresentando as cartas completas dos 6 jogadores em alta definição com opção de ampliar a foto do boneco antes de votar.
   - **Se um Jogador do Elenco foi selecionado**: Navegação fluida por todas as categorias ativas do prêmio, com destaque visual nas categorias com fotos, campo de texto para o **Gol Puskas** e bloqueio automático na opção do próprio jogador (*"Auto-voto bloqueado pelas regras"*).
4. **Revisão & Confirmação Definitiva**:
   - Resumo das escolhas antes de confirmar. Ao enviar, o voto é salvo e o token fixo do usuário (IP/dispositivo) passa para o status **Concluído**, impedindo novas submissões.
5. **Painel do Organizador (Admin)**:
   - **Aba 1 — Resultados & Apuração**: Ranking em tempo real de votos por categoria, relatos enviados para o *Gol Puskas* e lista de participações registradas (perfil, token hash, horário).
   - **Aba 2 — Gerenciar Questões (CRUD Completo)**: Lista de todas as questões com botões para **Nova Questão**, **Editar Questão** (título, subtítulo, tipo de resposta: múltipla escolha / texto livre / estatística informativa, visível para "Outro" sim/não, exibir fotos das cartas sim/não) e **Excluir Questão**.
   - **Aba 3 — Zona de Segurança (Reset da Votação)**: Botão **"Excluir Todos os Dados de Votação"** com modal de confirmação explícita (*"Tem certeza que deseja apagar todos os votos e liberar os acessos novamente?"*).

### Identidade Visual & Tema (Gala Esportiva & Touch-First)

- **Direção Estética**: *Ballon d'Or Gala meets EA FC Pro Clubs* — superfícies escuras sofisticadas com acabamento metálico dourado inspirado na moldura das cartas Nível 98–100 enviadas.
- **Paleta de Cores (Regra 60-30-10)**:
  - `60% Canvas Dominante`: Ardósia Noturna Profunda (`#0B0F17` / `slate-950`) para destacar o brilho dourado das cartas dos jogadores.
  - `30% Superfícies Estruturais`: Grafite Tático (`#151C28` / `slate-900`) com bordas finas (`1px solid rgba(255, 255, 255, 0.08)`) e tipografia secundária em prata suave (`#94A3B8`).
  - `10% Acento Principal`: Ouro Troféu (`#EAB308` / `#F59E0B`) reservado para estados selecionados, barra de progresso e ações principais; Verde Gramado (`#10B981`) para confirmação de voto e Vermelho Cartão (`#EF4444`) para exclusão/alertas.
- **Tipografia & Hierarquia (Regra 2+1 Fontes)**:
  - *Display / Títulos de Troféus*: **Barlow Condensed** (SemiBold/Bold) para títulos das categorias (*BALLON D'OR*, *BECKHAM D'OR*, *DIRAÇA D'OR*).
  - *Corpo & Interface*: **Plus Jakarta Sans** para leitura limpa em telas móveis.
  - *Dados, Níveis & Tokens*: **JetBrains Mono** com `tabular-nums` para o token único do usuário, níveis das cartas (98–100), atributos (`TOTAL 390`, `384`, `372`, etc.) e placar de votos.
- **Ergonomia Mobile & Layout Responsivo**:
  - **Touch Hitboxes $\ge 48\text{px}$**: Cards de candidatos, seletores de perfil e botões de confirmação dimensionados para uso confortável com o polegar no celular ($375\text{px}$–$430\text{px}$), expandindo para grade multi-colunas (`max-w-5xl`) no desktop.
  - **Cap de 15% em Elementos Fixos**: Barra superior enxuta e barra de ação inferior respeitando a área útil de leitura.

---

## 3. Key Product Decisions & Trade-Offs

- **Decisão 1: Token Fixo Determinístico por Usuário (IP + Device Fingerprint + Persistência)**
  - *Abordagem Escolhida*: Ao carregar a aplicação, o backend identifica o IP real da requisição (`x-forwarded-for` / `req.ip`) e combina com uma assinatura estável de hardware/navegador gerada no cliente, emitindo um token único determinístico (ex.: `PCA-8F3A9C12`). Enquanto o usuário não finalizar o envio, o token permanece em estado `em_andamento` (preservando sua sessão); assim que o voto é concluído, o token e o hash de IP/dispositivo são gravados como `votou` no servidor.
  - *Por Quê*: Atende ao requisito de não exigir geração manual pelo Admin, mantendo o mesmo token fixo até a conclusão da votação e barrando tentativas de votar repetidas vezes pelo mesmo acesso.
- **Decisão 2: Questões Dinâmicas Persistidas no Servidor com Semente Oficial do Google Forms**
  - *Abordagem Escolhida*: O banco de dados no servidor inicia pré-populado com todas as questões originais extraídas do formulário (`Soldado`, `Bagre do Ano`, `Morto de Fome`, `DiRaça D'Or`, `Rodilindo D'Or`, `Beckham D'Or`, `Ragebait`, `Ballon D'Or`, `Gol Puskas` e as 5 de estatísticas), permitindo ao Admin criar novas perguntas, editar textos/opções ou deletar qualquer questão em tempo real.
  - *Por Quê*: Permite ajustar categorias ou adicionar novas premiações direto pela interface sem tocar no código.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Diagrama de Arquitetura e Componentes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CLIENTE WEB (React 19 + Tailwind)                   │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Top App Bar (Logo Pro Clubs Awards · Token Ativo · Botão Admin)   │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
│                                    ▼                                    │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │ 1. Sessão Automática │  │ 2. Seletor de Perfil │  │ 3. Cédula de  │  │
│  │ • Token Fixo (IP/ID) │─▶│ • 6 Jogadores Elenco │─▶│    Votação    │  │
│  │ • Regras & Planilha  │  │   (c/ Bloqueio Self) │  │ • Modo Elenco │  │
│  │ • Check Voto Único   │  │ • Opção "Outro"      │  │ • Modo Outro  │  │
│  └──────────────────────┘  └──────────────────────┘  │   (2 Questões │  │
│                                                      │    c/ Cartas) │  │
│  ┌────────────────────────────────────────────────┐  │ • Zoom Carta  │  │
│  │ 4. Revisão, Envio & Recibo de Voto Concluído   │◀─┴───────────────┘  │
│  └────────────────────────────────────────────────┘                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 5. Painel Admin                                                   │  │
│  │ • Apuração de Resultados   • CRUD de Questões (Criar/Editar/Del)  │  │
│  │ • Botão Excluir Dados de Votação (c/ Modal de Confirmação)        │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │ REST API (/api/*)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     SERVIDOR BACKEND (Express server.ts)                │
├─────────────────────────────────────────────────────────────────────────┤
│  • POST   /api/session/init        ─▶ Gera/recupera token fixo (IP+FP)  │
│                                       e retorna status + questões       │
│  • POST   /api/votes/submit        ─▶ Valida token único e auto-voto,   │
│                                       salva resposta e trava o token    │
│  • GET    /api/admin/dashboard     ─▶ Retorna apuração e lista de votos │
│  • DELETE /api/admin/votes         ─▶ Exclui todos os dados de votação  │
│  • POST   /api/admin/questions     ─▶ Cria nova questão de votação      │
│  • PUT    /api/admin/questions/:id ─▶ Edita questão existente           │
│  • DELETE /api/admin/questions/:id ─▶ Deleta questão de votação         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Modelo de Dados & Entidades

- **Jogadores do Elenco (`PLAYERS`)**:
  1. **Pedrin** (`Pedroh360xd` · Hunter · Nível 100 · Total 369)
  2. **Pedrão** (`36105819` · Creator+ · Nível 98 · Total 368)
  3. **Lourival** (`BlackNight10101` · Hunter · Nível 100 · Total 390)
  4. **Igor** (`BezerraB6042` · Hotshot · Nível 100 · Total 372)
  5. **Victor** (`OVITA01` · Spark+ · Nível 100 · Total 384)
  6. **Paulo** (`dalpipoca` · Magician+ · Nível 100 · Total 364)
- **Estrutura de Questão (`Question`)**:
  - `id`: Identificador único da questão.
  - `title`: Nome do prêmio (ex.: `BECKHAM D'OR (Aberto ao Público)`).
  - `subtitle`: Descrição da categoria (ex.: `Boneco mais bonito`).
  - `type`: `'choice'` (voto nos jogadores do elenco) | `'text'` (resposta escrita como Gol Puskas) | `'stat_info'` (apenas informativa/estatística).
  - `publicVisible`: Booleano que define se a questão é exibida para quem seleciona o perfil **"Outro"** (ativado por padrão apenas para **RODILINDO D'OR** e **BECKHAM D'OR**).
  - `showPhotos`: Booleano que ativa a exibição em destaque das cartas/fotos dos bonecos nas opções de resposta (ativado para **RODILINDO D'OR** e **BECKHAM D'OR**).
  - `required`: Booleano indicando obrigatoriedade.
- **Sessão & Registro de Voto (`VoterSession` / `VoteRecord`)**:
  - `token`: Código único fixo derivado do acesso do usuário (IP + identificador do dispositivo), mantido inalterado enquanto a votação estiver em andamento e travado após a conclusão.
  - `voterProfile`: Nome do jogador selecionado ou `"Outro"`.
  - `answers`: Mapa `{ [questionId]: candidateId | textAnswer }`.
  - `submittedAt`: Data e hora da conclusão do voto.

### Mapeamento de Interações e Estados

- **Persistência do Token até a Conclusão**: Ao entrar no app, `POST /api/session/init` recebe a assinatura do navegador e lê o IP do cliente, retornando o `token` fixo daquele usuário. O rascunho de perfil e respostas fica sincronizado com esse token até que o botão **"Confirmar e Enviar Voto"** seja acionado.
- **Gerenciamento de Questões no Admin**: O administrador pode abrir o modal **"Nova Questão"** ou clicar em **"Editar"** em qualquer categoria existente para alterar título, subtítulo, tipo, obrigatoriedade, visibilidade para o perfil *"Outro"* e exibição das fotos das cartas, ou clicar em **"Excluir"** com confirmação.
- **Exclusão Segura dos Dados de Votação**: Ao clicar em **"Excluir Dados de Votação"** no Painel Admin, abre-se um modal de confirmação exigindo confirmação explícita; ao confirmar, `DELETE /api/admin/votes` apaga todos os votos computados e libera os tokens de IP/dispositivo para uma nova rodada de votação.
