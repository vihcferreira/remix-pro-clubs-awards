# Pro Clubs Awards — Plataforma Oficial de Votação

Aplicação Full-Stack (React 19 + Vite + Tailwind CSS v4 + Express + SQLite) para a votação oficial do **Pro Clubs Awards**, com validação de voto único por dispositivo/IP, bloqueio de auto-voto para membros do elenco e Painel Administrativo protegido por senha e token HMAC.

---

## Como Executar Localmente

1. **Instale as dependências:**
   ```bash
   npm install
   ```

2. **Configure as variáveis de ambiente:**
   Copie o arquivo `.env.example` para `.env` e defina sua `ADMIN_PASSWORD`:
   ```bash
   cp .env.example .env
   ```

3. **Inicie o servidor de desenvolvimento (Frontend + API + SQLite):**
   ```bash
   npm run dev
   ```
   Acesse em: `http://localhost:3000`

---

## Comandos Disponíveis

- `npm run dev` — Inicia o servidor Express + Vite em modo de desenvolvimento (`http://localhost:3000`)
- `npm test` — Executa a suíte de testes unitários e de integração (Autenticação, SQLite e Regras da API)
- `npm run lint` — Verifica a tipagem TypeScript (`tsc --noEmit`)
- `npm run build` — Gera o bundle de produção do frontend na pasta `dist/`
- `npm start` — Inicia o servidor de produção Express + SQLite

---

## Segurança e Arquivos Ignorados pelo Git (`.gitignore`)

Nunca adicione ao GitHub:
- `.env` / `.env.*` (contém `ADMIN_PASSWORD` e `ADMIN_TOKEN_SECRET`)
- `data/*.db`, `data/*.db-wal`, `data/*.db-shm`, `data/store.json` (bancos de dados com hashes de IP, sessões e votos)
- `node_modules/` e `dist/`
