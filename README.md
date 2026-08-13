# Trilha de Aprovação

PWA de controle e análise de desempenho em questões de concursos públicos. Funciona 100% offline — todos os dados ficam no IndexedDB do navegador, com sincronização opcional via nuvem.

---

## Funcionalidades

### Controle de Questões
Registre tentativas por disciplina, assunto, banca e concurso. Acompanhe acertos, erros e taxa de aproveitamento ao longo do tempo.

### Ciclo de Estudos
Monte um ciclo semanal com tempo planejado por disciplina. O widget na topbar cronometra cada sessão e registra o tempo estudado automaticamente.

### Edital (Bússola)
Crie um edital com as disciplinas e tópicos do seu concurso. Os dados de desempenho das tentativas são vinculados automaticamente — sem configuração manual — usando os mesmos nomes que você já usa ao registrar questões.

- **Criar em branco** e adicionar disciplinas a partir das suas tentativas reais
- **Sincronizar tópicos** para popular automaticamente os assuntos registrados
- Progresso por disciplina com taxa de acerto, tempo no ciclo e dias sem revisar

### Revisão do Dia
Fila de revisão automática baseada em desempenho, tempo sem revisar e peso no edital. Inclui geração de resumo teórico via IA (Gemini).

### Caderno de Resumos
Resumos gerados pela IA ou escritos manualmente, organizados por disciplina e tópico. Integração com TTS (text-to-speech) para ouvir os resumos.

### Diagnóstico de Erros
Identifica padrões de erro nas suas tentativas e gera recomendações de estudo personalizadas via IA.

### Mentor da Trilha
Coach inteligente que analisa seu histórico completo e gera orientações personalizadas. Inclui:
- Índice de Aprovação (0–100) com pesos dinâmicos por fase da preparação (pré-edital / pós-edital / reta final)
- DNA do Estudante: melhor dia, consistência, ritmo, cobertura, lacunas urgentes
- Diário do Mentor: histórico de análises com snapshot de desempenho por data
- Coach pós-sessão: feedback automático após cada sessão do ciclo

### Estatísticas
Análise por disciplina, assunto, banca e concurso. Filtros por período (hoje / 7 dias / 30 dias / tudo).

### Simulados
Registro e acompanhamento de simulados com comparativo de desempenho.

### Sincronização na Nuvem
Login com Google para sincronizar os dados entre dispositivos. Backend em Cloudflare Workers + D1 (SQLite). Backup automático antes de cada sobrescrita.

---

## Arquitetura

```
Trilha de Aprovação
├── Frontend
│   ├── Vanilla JS — sem frameworks, sem bundler
│   ├── PWA — Service Worker com cache-first + fallback de rede
│   ├── IndexedDB (via database.js) — armazenamento local, offline-first
│   └── Cloudflare Pages — hospedagem estática
│
├── Backend de Sincronização
│   ├── Cloudflare Workers (worker.js)
│   ├── Cloudflare D1 (SQLite) — tabelas: app_dados, backups_historico
│   └── Firebase Auth — autenticação com Google (token RS256)
│
└── IA
    ├── Google Gemini (Firebase AI Logic) — resumos, diagnósticos, Mentor
    └── learning-engine.js (window.IE) — Motor de Inteligência local
```

### Banco de Dados Local (IndexedDB v12)

| Store | Descrição |
|---|---|
| `tentativas` | Registros de questões respondidas |
| `editais` | Editais com disciplinas e tópicos |
| `ciclos` | Ciclos de estudo semanais |
| `cicloMaterias` | Matérias do ciclo com tempo planejado |
| `cicloSessoes` | Sessões cronometradas por matéria |
| `resumos` | Caderno de resumos |
| `revisoes` | Histórico da fila de revisão |
| `simulados` | Registros de simulados |
| `perfis` | Perfis de usuário (multi-perfil) |
| `errosQuestoes` | Erros individuais para diagnóstico |
| `diagnosticosErro` | Diagnósticos gerados pela IA |
| `learningProfile` | Perfil do aluno para o Mentor da Trilha |

Todos os stores (exceto `perfis`) são escopados por `perfilId` — os dados são isolados por perfil automaticamente.

---

## Estrutura de Arquivos

```
├── index.html               # Shell do app, ordem de carregamento dos scripts
├── app.js                   # Roteamento, estado global (state), reloadState
├── database.js              # Abstração do IndexedDB, migrações por versão
├── style.css                # Estilos globais
│
├── editais.js               # Bússola do edital, vínculo com ciclo e tentativas
├── estatisticas.js          # Estatísticas + renderEditais (lista de editais)
├── ciclo.js                 # Ciclo de estudos + widget da topbar
├── revisao.js               # Revisão do dia + geração de resumo via IA
├── caderno.js               # Caderno de resumos + TTS
├── analise-erros.js         # Diagnóstico de erros + recomendações IA
│
├── learning-engine.js       # Motor de Inteligência (window.IE) — cálculos puros
├── mentor-ia.js             # Tela do Mentor da Trilha + coach pós-sessão
│
├── simulados.js             # Registro e histórico de simulados
├── charts.js                # Gráficos (Chart.js)
├── ia-gemini.js             # Integração com Google Gemini (módulo ES)
├── cloud-sync.js            # Sincronização com Cloudflare D1 via Firebase Auth
│
├── perfis.js                # Gerenciamento de perfis
├── configuracoes.js         # Configurações gerais
├── importar-historico.js    # Importação de histórico via planilha
├── migrar-historico.js      # Migração de dados legados
│
├── service-worker.js        # Cache offline (estratégia cache-first)
├── manifest.json            # Manifesto PWA
│
├── tts-modulo.js            # Text-to-Speech
├── tts-caderno-integracao.js# Integração TTS + Caderno
│
└── worker.js                # Cloudflare Worker (backend de sincronização)
```

---

## Instalação e Deploy

### Pré-requisitos
- Conta no [Cloudflare](https://cloudflare.com) (Pages + Workers + D1)
- Projeto no [Firebase](https://firebase.google.com) com Google Auth habilitado
- Chave de API do Google Gemini

### Cloudflare Pages (frontend)
1. Faça fork deste repositório
2. Conecte ao Cloudflare Pages
3. Build command: *(vazio — arquivos estáticos)*
4. Output directory: `/`

### Cloudflare D1 (banco de dados)
```sql
CREATE TABLE app_dados (
  uid TEXT PRIMARY KEY,
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE backups_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  motivo TEXT,
  dados TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
```

### Cloudflare Worker (backend)
1. Crie um Worker e cole o conteúdo de `worker.js`
2. Vincule o binding D1: nome `DB`, banco `trilha-aprovacao-db`
3. Atualize `PROJECT_ID` no topo do `worker.js` com o ID do seu projeto Firebase
4. Adicione o domínio do seu Pages em `ORIGENS_PERMITIDAS`

### Firebase
1. Crie um projeto Firebase e habilite autenticação com Google
2. Atualize as configurações em `ia-gemini.js` com as credenciais do projeto

---

## Convenções de Desenvolvimento

### Service Worker
O `CACHE_NAME` (ex: `trilha-aprovacao-v94`) deve ser incrementado a cada deploy que altere qualquer arquivo `.js` ou `.css`. Isso força o navegador a baixar os arquivos atualizados.

### IndexedDB
A `DB_VERSION` em `database.js` deve ser incrementada sempre que um novo store for criado ou um índice for alterado. Cada versão deve ter seu bloco de migração no `onupgradeneeded`.

### Estado global
O objeto `state` em `app.js` é a única fonte de verdade em memória. Sempre use `reloadState()` após operações de escrita no banco, e dispare `ta:mudou` para acionar o backup automático.

### Vínculo Edital ↔ Tentativas
Os nomes de disciplina no edital devem ser **idênticos** aos usados no campo `disciplina` das tentativas. O campo `assunto` da tentativa deve corresponder ao nome do tópico no edital. Não há fuzzy match obrigatório — use "🔄 Sincronizar tópicos" para popular os tópicos automaticamente a partir dos assuntos já registrados.

---

## Licença

Uso pessoal. Todos os direitos reservados.
