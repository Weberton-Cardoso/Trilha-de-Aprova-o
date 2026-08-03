/**
 * database.js
 * Camada de acesso a dados usando IndexedDB.
 * Todas as entidades principais (tentativas, editais, simulados, ciclo de
 * estudos) ficam aqui. Configurações pequenas (tema, sidebar, duração padrão
 * da sessão do ciclo) usam localStorage — ver app.js.
 *
 * v2: o cadastro por questão individual ("questoes") foi substituído pelo
 * cadastro por TENTATIVA (bloco de questões de um mesmo assunto).
 * v3: os tópicos de um edital passam a ter 4 status (quadro estilo Kanban)
 * em vez de 3. Editais antigos são migrados automaticamente:
 *   nao_estudado -> nao_iniciado
 *   em_estudo    -> em_estudo (mantém)
 *   concluido    -> dominado
 * v4: adiciona o Ciclo de Estudos (cicloMaterias + cicloSessoes).
 * v5: adiciona cicloConfig (config única: tempo total do ciclo em minutos
 *     e quantos ciclos completos já foram fechados).
 * v6: suporte a VÁRIOS ciclos nomeados. Cria o store "ciclos" (cada um com
 *     nome, tempo total e contador de voltas fechadas) e cicloMaterias
 *     passa a ter um campo cicloId apontando para o ciclo dono. O ciclo
 *     único que já existia (cicloConfig, id fixo 1) vira "Ciclo 1".
 * v7: adiciona PERFIS DE ESTATÍSTICAS. Cria o store "perfis" (cada um com
 *     nome) e os stores com dado do usuário (tentativas, editais,
 *     simulados, ciclos, cicloMaterias, cicloSessoes) passam a ter um
 *     campo perfilId. Tudo que já existia é migrado para um perfil padrão
 *     chamado "Histórico Geral". db.getAll/db.add/db.clear desses stores
 *     agora filtram/marcam automaticamente pelo perfil ativo
 *     (db.perfilAtivoId) — o resto do app não precisa se preocupar com isso.
 * v8: adiciona BACKUPS AUTOMÁTICOS LOCAIS. Cria o store "backupsLocais"
 *     (não filtrado por perfil — guarda um retrato de TODOS os perfis de
 *     uma vez). Toda vez que algo muda no banco, um snapshot completo é
 *     salvo automaticamente aqui (mantendo só os 10 mais recentes), para
 *     servir de rede de segurança caso uma sincronização ou importação dê
 *     errado. Ver db.exportAllRaw / db.importAllRaw / db.criarBackupLocalAutomatico.
 * v9: adiciona o CADERNO DE RESUMOS. Cria o store "resumos" (com escopo por
 *     perfil, igual tentativas/editais): cada resumo é gerado a partir de
 *     UMA questão resolvida (tela "Resolver com IA") e fica vinculado à
 *     tentativa que o originou via tentativaId. Guarda duas versões do
 *     texto — "bruto" (explicação da teoria) e "condensado" (estilo Anki) —
 *     mais o controle de envio pro Anki (enviadoAnki/ankiDeck), preparando
 *     terreno pra integração com AnkiConnect nas próximas fases. As
 *     tentativas também passam a poder guardar o enunciado/alternativas da
 *     questão de origem e um resultado de 3 estados ('certa'|'errada'|
 *     'branco') — isso é só um uso novo de campos livres no mesmo store de
 *     tentativas, não exige migração de schema.
 * v10: Sistema de Revisão do Dia — rastreia revisões concluídas por tema.
 * v11: DIAGNÓSTICO DE ERROS (padrão de erro + recomendação da IA). Cria dois
 *     stores novos:
 *     - "errosQuestoes": um registro por QUESTÃO ERRADA individual, vinda de
 *       qualquer tela (Resolver com IA, Ciclo de Estudos, Simulados,
 *       Tentativas ou avulso). Guarda disciplina/assunto, enunciado (se
 *       colado), alternativa marcada, gabarito correto, origem, e um
 *       controle "analisado" (se já entrou em algum diagnóstico da IA).
 *     - "diagnosticosErro": o resultado gerado pela IA a partir de um lote
 *       de errosQuestoes — um "padrão de erro" (ex.: "base de cálculo do
 *       ISS") + uma recomendação específica de revisão, com a lista dos
 *       erros que embasaram aquela recomendação (erroIds). Guarda também
 *       "textoOriginalIA" (a recomendação como a IA gerou, antes de
 *       qualquer edição) e um "status" (ativo/revisado/descartado) — é aqui
 *       que entra a correção manual: se a IA errar o diagnóstico, dá pra
 *       editar o texto ou descartar, sem perder o registro. Ver
 *       analise-erros.js.
 */

const DB_NAME = 'TrilhaAprovacaoDB';
const DB_VERSION = 11;

const STORES = {
  tentativas: 'tentativas',
  editais: 'editais',
  simulados: 'simulados',
  ciclos: 'ciclos',
  cicloMaterias: 'cicloMaterias',
  cicloSessoes: 'cicloSessoes',
  cicloConfig: 'cicloConfig',
  perfis: 'perfis',
  backupsLocais: 'backupsLocais',
  resumos: 'resumos',
  revisoes: 'revisoes',
  errosQuestoes: 'errosQuestoes',
  diagnosticosErro: 'diagnosticosErro'
};

/** Stores que pertencem a um perfil de estatísticas específico — getAll/add/clear
 *  destes stores são automaticamente filtrados/marcados pelo perfil ativo. */
const PERFIL_SCOPED_STORES = new Set([
  STORES.tentativas, STORES.editais, STORES.simulados,
  STORES.ciclos, STORES.cicloMaterias, STORES.cicloSessoes, STORES.resumos,
  STORES.errosQuestoes, STORES.diagnosticosErro
]);

const TIPOS_TENTATIVA = [
  'Primeiro estudo',
  'Revisão',
  'Refazendo questões',
  'Refazendo questões erradas',
  'Simulado',
  'Questão avulsa (Resolver com IA)'
];

const STATUS_TOPICO = ['nao_iniciado', 'em_estudo', 'em_revisao', 'dominado'];

const STATUS_TOPICO_LABEL = {
  nao_iniciado: 'Não iniciado',
  em_estudo: 'Em estudo',
  em_revisao: 'Em revisão',
  dominado: 'Dominado'
};

const _STATUS_MIGRACAO_V3 = {
  nao_estudado: 'nao_iniciado',
  em_estudo: 'em_estudo',
  concluido: 'dominado'
};

let _dbPromise = null;

/** Abre (ou cria/migra) o banco de dados. Reaproveita a mesma promise. */
function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;
      const oldVersion = event.oldVersion || 0;

      let editaisStore;
      if (!db.objectStoreNames.contains(STORES.editais)) {
        editaisStore = db.createObjectStore(STORES.editais, { keyPath: 'id', autoIncrement: true });
      } else {
        editaisStore = tx.objectStore(STORES.editais);
      }

      if (!db.objectStoreNames.contains(STORES.simulados)) {
        const store = db.createObjectStore(STORES.simulados, { keyPath: 'id', autoIncrement: true });
        store.createIndex('data', 'data', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.cicloMaterias)) {
        db.createObjectStore(STORES.cicloMaterias, { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains(STORES.cicloSessoes)) {
        const store = db.createObjectStore(STORES.cicloSessoes, { keyPath: 'id', autoIncrement: true });
        store.createIndex('data', 'data', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.cicloConfig)) {
        db.createObjectStore(STORES.cicloConfig, { keyPath: 'id' });
      }

      let ciclosStore;
      if (!db.objectStoreNames.contains(STORES.ciclos)) {
        ciclosStore = db.createObjectStore(STORES.ciclos, { keyPath: 'id', autoIncrement: true });
      } else {
        ciclosStore = tx.objectStore(STORES.ciclos);
      }

      const jaTinhaQuestoes = db.objectStoreNames.contains('questoes');
      let tentativasStore;

      if (!db.objectStoreNames.contains(STORES.tentativas)) {
        tentativasStore = db.createObjectStore(STORES.tentativas, { keyPath: 'id', autoIncrement: true });
        tentativasStore.createIndex('disciplina', 'disciplina', { unique: false });
        tentativasStore.createIndex('assunto', 'assunto', { unique: false });
        tentativasStore.createIndex('banca', 'banca', { unique: false });
        tentativasStore.createIndex('concurso', 'concurso', { unique: false });
        tentativasStore.createIndex('data', 'data', { unique: false });
      } else {
        tentativasStore = tx.objectStore(STORES.tentativas);
      }

      // Migração: cada questão individual antiga vira uma tentativa de 1 questão.
      if (jaTinhaQuestoes) {
        const questoesStore = tx.objectStore('questoes');
        questoesStore.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            const q = cursor.value;
            tentativasStore.add({
              disciplina: q.disciplina || '',
              assunto: q.assunto || '',
              banca: q.banca || '',
              concurso: q.concurso || '',
              data: q.data || '',
              numQuestoes: 1,
              acertos: q.correta ? 1 : 0,
              erros: q.correta ? 0 : 1,
              taxa: q.correta ? 100 : 0,
              tipo: 'Primeiro estudo',
              observacoes: q.observacoes || ''
            });
            cursor.continue();
          } else {
            // terminou a migração: remove o store antigo
            db.deleteObjectStore('questoes');
          }
        };
      }

      // Migração v3: remapeia status antigos (3 estados) para o novo modelo (4 estados)
      if (oldVersion > 0 && oldVersion < 3) {
        editaisStore.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const edital = cursor.value;
          (edital.materias || []).forEach(m => {
            (m.topicos || []).forEach(t => {
              t.status = _STATUS_MIGRACAO_V3[t.status] || 'nao_iniciado';
            });
          });
          cursor.update(edital);
          cursor.continue();
        };
      }

      // Migração v6: o ciclo único antigo (cicloConfig, id fixo 1) + as
      // cicloMaterias "soltas" (sem cicloId) viram um ciclo nomeado "Ciclo 1".
      if (oldVersion > 0 && oldVersion < 6) {
        const materiasStore = tx.objectStore(STORES.cicloMaterias);
        const configStoreAntiga = tx.objectStore(STORES.cicloConfig);

        materiasStore.getAll().onsuccess = (ev) => {
          const materiasExistentes = (ev.target.result || []).filter(m => !m.cicloId);
          if (!materiasExistentes.length) return;

          const criarCicloEMigrar = (cfgAntiga) => {
            const novoCiclo = {
              nome: 'Ciclo 1',
              minutosCicloTotal: (cfgAntiga && cfgAntiga.minutosCicloTotal) || 1200,
              ciclosCompletos: (cfgAntiga && cfgAntiga.ciclosCompletos) || 0,
              ordem: 0
            };
            const reqAdd = ciclosStore.add(novoCiclo);
            reqAdd.onsuccess = () => {
              const novoCicloId = reqAdd.result;
              materiasExistentes.forEach(m => {
                m.cicloId = novoCicloId;
                materiasStore.put(m);
              });
            };
          };

          configStoreAntiga.get(1).onsuccess = (ev2) => criarCicloEMigrar(ev2.target.result);
        };
      }

      // v7: cria o store de perfis. Se ele ainda não existia, este banco tem
      // dados "soltos" (sem perfilId) — cria o perfil padrão "Histórico Geral"
      // e marca tudo que já existe com ele.
      const perfisJaExistia = db.objectStoreNames.contains(STORES.perfis);
      let perfisStore;
      if (!perfisJaExistia) {
        perfisStore = db.createObjectStore(STORES.perfis, { keyPath: 'id', autoIncrement: true });
      } else {
        perfisStore = tx.objectStore(STORES.perfis);
      }

      if (!perfisJaExistia) {
        const reqPerfil = perfisStore.add({ nome: 'Histórico Geral', ordem: 0, criadoEm: new Date().toISOString() });
        reqPerfil.onsuccess = () => {
          const perfilPadraoId = reqPerfil.result;
          Array.from(PERFIL_SCOPED_STORES).forEach(storeName => {
            if (!db.objectStoreNames.contains(storeName)) return;
            const store = tx.objectStore(storeName);
            store.openCursor().onsuccess = (ev) => {
              const cursor = ev.target.result;
              if (!cursor) return;
              const item = cursor.value;
              if (item.perfilId == null) {
                item.perfilId = perfilPadraoId;
                cursor.update(item);
              }
              cursor.continue();
            };
          });
        };
      }

      // v8: store de backups automáticos locais — um retrato completo do
      // banco (todos os perfis) a cada mudança importante.
      if (!db.objectStoreNames.contains(STORES.backupsLocais)) {
        const backupsStore = db.createObjectStore(STORES.backupsLocais, { keyPath: 'id', autoIncrement: true });
        backupsStore.createIndex('criadoEm', 'criadoEm', { unique: false });
      }
      // v9: Caderno de Resumos — cada resumo é gerado a partir de uma
      // questão resolvida e fica vinculado à tentativa de origem.
      if (!db.objectStoreNames.contains(STORES.resumos)) {
        const resumosStore = db.createObjectStore(STORES.resumos, { keyPath: 'id', autoIncrement: true });
        resumosStore.createIndex('tentativaId', 'tentativaId', { unique: false });
        resumosStore.createIndex('data', 'data', { unique: false });
        resumosStore.createIndex('materia', 'materia', { unique: false });
      }
      // v10: Sistema de Revisão do Dia — rastreia revisões concluídas por tema.
      if (!db.objectStoreNames.contains(STORES.revisoes)) {
        const revisoesStore = db.createObjectStore(STORES.revisoes, { keyPath: 'id', autoIncrement: true });
        revisoesStore.createIndex('data', 'data', { unique: false });
        revisoesStore.createIndex('disciplina', 'disciplina', { unique: false });
      }

      // v11: Diagnóstico de Erros — ver comentário no topo do arquivo.
      if (!db.objectStoreNames.contains(STORES.errosQuestoes)) {
        const errosStore = db.createObjectStore(STORES.errosQuestoes, { keyPath: 'id', autoIncrement: true });
        errosStore.createIndex('analisado', 'analisado', { unique: false });
        errosStore.createIndex('data', 'data', { unique: false });
        errosStore.createIndex('disciplina', 'disciplina', { unique: false });
        errosStore.createIndex('tentativaId', 'tentativaId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.diagnosticosErro)) {
        const diagStore = db.createObjectStore(STORES.diagnosticosErro, { keyPath: 'id', autoIncrement: true });
        diagStore.createIndex('status', 'status', { unique: false });
        diagStore.createIndex('criadoEm', 'criadoEm', { unique: false });
      }
    };

    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = (event) => reject(event.target.error);
  });

  return _dbPromise;
}

/** Executa uma transação e devolve uma Promise resolvida com o resultado do request. */
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = fn(store);

    transaction.oncomplete = () => {
      // Avisa quem estiver interessado (ex.: cloud-sync.js) que algo mudou,
      // apenas para transações de escrita.
      if (mode === 'readwrite') {
        window.dispatchEvent(new CustomEvent('ta:mudou', { detail: { storeName } }));
      }
      resolve(request ? request.result : undefined);
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

// ---------- Backup automático local ----------
// Sempre que algo muda no banco (exceto o próprio store de backups, pra não
// entrar em loop), agenda um snapshot completo (todos os perfis) alguns
// segundos depois — funciona como uma rede de segurança silenciosa.
let _backupAutoTimer = null;
const BACKUP_AUTO_DEBOUNCE_MS = 4000;
const BACKUP_AUTO_MAX_ITENS = 10;

// Chave no localStorage com o instante (ISO) da última alteração local —
// usada pelo cloud-sync.js pra nunca sobrescrever dados locais mais novos
// com uma cópia da nuvem mais antiga (ex.: se o envio pra nuvem ainda não
// tinha terminado quando a página foi recarregada por causa de um deploy).
const CHAVE_ULTIMA_ALTERACAO_LOCAL = 'ta_ultima_alteracao_local';

window.addEventListener('ta:mudou', (ev) => {
  if (ev.detail && ev.detail.storeName === STORES.backupsLocais) return;

  try {
    localStorage.setItem(CHAVE_ULTIMA_ALTERACAO_LOCAL, new Date().toISOString());
  } catch (err) {
    console.warn('Não foi possível registrar o horário da última alteração local:', err);
  }

  clearTimeout(_backupAutoTimer);
  _backupAutoTimer = setTimeout(() => {
    db.criarBackupLocalAutomatico('alteracao_automatica').catch((err) => {
      console.error('Falha ao criar backup automático local:', err);
    });
  }, BACKUP_AUTO_DEBOUNCE_MS);
});

const db = {

  // Perfil de estatísticas atualmente selecionado (persiste no localStorage
  // deste aparelho — cada dispositivo escolhe seu próprio perfil ativo).
  get perfilAtivoId() {
    const raw = localStorage.getItem('ta_perfil_ativo_id');
    return raw ? Number(raw) : null;
  },
  set perfilAtivoId(id) {
    if (id == null) localStorage.removeItem('ta_perfil_ativo_id');
    else localStorage.setItem('ta_perfil_ativo_id', String(id));
  },

  // ---------- CRUD genérico ----------
  add(storeName, obj) {
    if (PERFIL_SCOPED_STORES.has(storeName) && obj.perfilId == null) {
      obj = { ...obj, perfilId: db.perfilAtivoId };
    }
    return tx(storeName, 'readwrite', (store) => store.add(obj));
  },

  update(storeName, obj) {
    // Mesma rede de segurança do add(): se por algum motivo o objeto que
    // está sendo salvo perdeu o perfilId (ex.: uma tela de edição
    // reconstruiu o objeto do zero sem incluir esse campo), reaproveita o
    // perfilId atual em vez de gravar undefined — o que faria o registro
    // "sumir" silenciosamente por ficar de fora do filtro por perfil.
    if (PERFIL_SCOPED_STORES.has(storeName) && obj.perfilId == null) {
      obj = { ...obj, perfilId: db.perfilAtivoId };
    }
    return tx(storeName, 'readwrite', (store) => store.put(obj));
  },

  remove(storeName, id) {
    return tx(storeName, 'readwrite', (store) => store.delete(id));
  },

  get(storeName, id) {
    return tx(storeName, 'readonly', (store) => store.get(id));
  },

  async getAll(storeName) {
    const todos = await tx(storeName, 'readonly', (store) => store.getAll());
    if (!PERFIL_SCOPED_STORES.has(storeName)) return todos;
    const ativo = db.perfilAtivoId;
    if (ativo == null) return todos; // ainda não resolvido — evita esconder tudo por engano
    return todos.filter(item => item.perfilId === ativo);
  },

  async clear(storeName) {
    if (!PERFIL_SCOPED_STORES.has(storeName)) {
      return tx(storeName, 'readwrite', (store) => store.clear());
    }
    // Em stores com escopo por perfil, "clear" apaga só os itens do perfil ativo.
    const itens = await db.getAll(storeName);
    return Promise.all(itens.map(item => db.remove(storeName, item.id)));
  },

  // ---------- Atalhos por entidade ----------
  tentativas: {
    add: (t) => db.add(STORES.tentativas, t),
    update: (t) => db.update(STORES.tentativas, t),
    remove: (id) => db.remove(STORES.tentativas, id),
    getAll: () => db.getAll(STORES.tentativas),
    clear: () => db.clear(STORES.tentativas)
  },

  editais: {
    add: (e) => db.add(STORES.editais, e),
    update: (e) => db.update(STORES.editais, e),
    remove: (id) => db.remove(STORES.editais, id),
    get: (id) => db.get(STORES.editais, id),
    getAll: () => db.getAll(STORES.editais),
    clear: () => db.clear(STORES.editais)
  },

  simulados: {
    add: (s) => db.add(STORES.simulados, s),
    update: (s) => db.update(STORES.simulados, s),
    remove: (id) => db.remove(STORES.simulados, id),
    getAll: () => db.getAll(STORES.simulados),
    clear: () => db.clear(STORES.simulados)
  },

  ciclos: {
    add: (c) => db.add(STORES.ciclos, c),
    update: (c) => db.update(STORES.ciclos, c),
    remove: (id) => db.remove(STORES.ciclos, id),
    getAll: () => db.getAll(STORES.ciclos),
    clear: () => db.clear(STORES.ciclos)
  },

  cicloMaterias: {
    add: (m) => db.add(STORES.cicloMaterias, m),
    update: (m) => db.update(STORES.cicloMaterias, m),
    remove: (id) => db.remove(STORES.cicloMaterias, id),
    getAll: () => db.getAll(STORES.cicloMaterias),
    clear: () => db.clear(STORES.cicloMaterias)
  },

  cicloSessoes: {
    add: (s) => db.add(STORES.cicloSessoes, s),
    update: (s) => db.update(STORES.cicloSessoes, s),
    remove: (id) => db.remove(STORES.cicloSessoes, id),
    getAll: () => db.getAll(STORES.cicloSessoes),
    clear: () => db.clear(STORES.cicloSessoes)
  },

  // Caderno de Resumos — cada resumo vem de UMA tentativa (questão) e fica
  // ligado a ela via tentativaId. Ver comentário v9 no topo do arquivo.
  resumos: {
    add: (r) => db.add(STORES.resumos, r),
    update: (r) => db.update(STORES.resumos, r),
    remove: (id) => db.remove(STORES.resumos, id),
    get: (id) => db.get(STORES.resumos, id),
    getAll: () => db.getAll(STORES.resumos),
    clear: () => db.clear(STORES.resumos)
  },

  // Sistema de Revisão do Dia (v10) — sem escopo por perfil.
  revisoes: {
    add: (r) => db.add(STORES.revisoes, r),
    remove: (id) => db.remove(STORES.revisoes, id),
    getAll: () => db.getAll(STORES.revisoes),
    clear: () => db.clear(STORES.revisoes)
  },

  // Diagnóstico de Erros (v11) — ver analise-erros.js.
  errosQuestoes: {
    add: (e) => db.add(STORES.errosQuestoes, e),
    update: (e) => db.update(STORES.errosQuestoes, e),
    remove: (id) => db.remove(STORES.errosQuestoes, id),
    get: (id) => db.get(STORES.errosQuestoes, id),
    getAll: () => db.getAll(STORES.errosQuestoes),
    clear: () => db.clear(STORES.errosQuestoes)
  },

  diagnosticosErro: {
    add: (d) => db.add(STORES.diagnosticosErro, d),
    update: (d) => db.update(STORES.diagnosticosErro, d),
    remove: (id) => db.remove(STORES.diagnosticosErro, id),
    get: (id) => db.get(STORES.diagnosticosErro, id),
    getAll: () => db.getAll(STORES.diagnosticosErro),
    clear: () => db.clear(STORES.diagnosticosErro)
  },

  // Perfis de estatísticas (não filtrados por perfil — é a própria lista deles).
  perfis: {
    add: (p) => db.add(STORES.perfis, p),
    update: (p) => db.update(STORES.perfis, p),
    remove: (id) => db.remove(STORES.perfis, id),
    get: (id) => db.get(STORES.perfis, id),
    getAll: () => db.getAll(STORES.perfis),
    clear: () => db.clear(STORES.perfis)
  },

  // ---------- Backup ----------
  /** Instante (ISO) da última alteração local conhecida — usado pelo
   *  cloud-sync.js para decidir com segurança qual lado (local ou nuvem)
   *  está mais atualizado antes de sobrescrever qualquer um dos dois. */
  getUltimaAlteracaoLocal() {
    try {
      return localStorage.getItem(CHAVE_ULTIMA_ALTERACAO_LOCAL) || null;
    } catch {
      return null;
    }
  },

  async exportAll() {
    const [tentativas, editais, simulados, ciclos, cicloMaterias, cicloSessoes, resumos, errosQuestoes, diagnosticosErro] = await Promise.all([
      db.getAll(STORES.tentativas),
      db.getAll(STORES.editais),
      db.getAll(STORES.simulados),
      db.getAll(STORES.ciclos),
      db.getAll(STORES.cicloMaterias),
      db.getAll(STORES.cicloSessoes),
      db.getAll(STORES.resumos),
      db.getAll(STORES.errosQuestoes),
      db.getAll(STORES.diagnosticosErro)
    ]);
    return {
      versao: DB_VERSION,
      exportadoEm: new Date().toISOString(),
      alteradoEm: db.getUltimaAlteracaoLocal(),
      tentativas, editais, simulados, ciclos, cicloMaterias, cicloSessoes, resumos,
      errosQuestoes, diagnosticosErro
    };
  },

  /** Backup COMPLETO: todos os perfis de uma vez, preservando ids e
   *  perfilId de cada item. Usado pelos backups automáticos locais (e pode
   *  ser usado para um backup manual "de tudo", diferente do backup normal
   *  que exporta só o perfil ativo). */
  async exportAllRaw() {
    const [perfis, tentativas, editais, simulados, ciclos, cicloMaterias, cicloSessoes, resumos, errosQuestoes, diagnosticosErro] = await Promise.all([
      tx(STORES.perfis, 'readonly', (store) => store.getAll()),
      tx(STORES.tentativas, 'readonly', (store) => store.getAll()),
      tx(STORES.editais, 'readonly', (store) => store.getAll()),
      tx(STORES.simulados, 'readonly', (store) => store.getAll()),
      tx(STORES.ciclos, 'readonly', (store) => store.getAll()),
      tx(STORES.cicloMaterias, 'readonly', (store) => store.getAll()),
      tx(STORES.cicloSessoes, 'readonly', (store) => store.getAll()),
      tx(STORES.resumos, 'readonly', (store) => store.getAll()),
      tx(STORES.errosQuestoes, 'readonly', (store) => store.getAll()),
      tx(STORES.diagnosticosErro, 'readonly', (store) => store.getAll())
    ]);
    return {
      versao: DB_VERSION,
      tipo: 'completo',
      exportadoEm: new Date().toISOString(),
      perfis, tentativas, editais, simulados, ciclos, cicloMaterias, cicloSessoes, resumos,
      errosQuestoes, diagnosticosErro
    };
  },

  /** Restaura um backup COMPLETO (gerado por exportAllRaw), substituindo
   *  TODOS os perfis e dados existentes pelos do snapshot, com os mesmos
   *  ids. Use com cuidado — é uma substituição total do banco. */
  async importAllRaw(dados) {
    await Promise.all([
      tx(STORES.perfis, 'readwrite', (store) => store.clear()),
      tx(STORES.tentativas, 'readwrite', (store) => store.clear()),
      tx(STORES.editais, 'readwrite', (store) => store.clear()),
      tx(STORES.simulados, 'readwrite', (store) => store.clear()),
      tx(STORES.ciclos, 'readwrite', (store) => store.clear()),
      tx(STORES.cicloMaterias, 'readwrite', (store) => store.clear()),
      tx(STORES.cicloSessoes, 'readwrite', (store) => store.clear()),
      tx(STORES.resumos, 'readwrite', (store) => store.clear()),
      tx(STORES.errosQuestoes, 'readwrite', (store) => store.clear()),
      tx(STORES.diagnosticosErro, 'readwrite', (store) => store.clear())
    ]);

    const restaurar = (storeName, lista) =>
      Promise.all((lista || []).map(item => tx(storeName, 'readwrite', (store) => store.add(item))));

    await restaurar(STORES.perfis, dados.perfis);
    await restaurar(STORES.tentativas, dados.tentativas);
    await restaurar(STORES.editais, dados.editais);
    await restaurar(STORES.simulados, dados.simulados);
    await restaurar(STORES.ciclos, dados.ciclos);
    await restaurar(STORES.cicloMaterias, dados.cicloMaterias);
    await restaurar(STORES.cicloSessoes, dados.cicloSessoes);
    await restaurar(STORES.resumos, dados.resumos);
    await restaurar(STORES.errosQuestoes, dados.errosQuestoes);
    await restaurar(STORES.diagnosticosErro, dados.diagnosticosErro);
  },

  /** Encontra e corrige registros "invisíveis" — itens de stores com
   *  escopo por perfil (tentativas, editais, simulados, ciclos,
   *  cicloMaterias, cicloSessoes) que ficaram sem perfilId por causa de um
   *  bug em telas de edição antigas. Como não dá pra saber com certeza a
   *  qual perfil pertenciam, assume o perfil ATIVO no momento do reparo
   *  (o mais provável, especialmente para quem usa só um perfil). Cria um
   *  backup automático antes, por segurança. */
  async repararPerfilIdAusente() {
    await db.criarBackupLocalAutomatico('antes_de_reparar_perfil_ausente').catch(() => {});

    const stores = [
      STORES.tentativas, STORES.editais, STORES.simulados,
      STORES.ciclos, STORES.cicloMaterias, STORES.cicloSessoes, STORES.resumos
    ];

    let totalReparados = 0;
    const porStore = {};

    for (const storeName of stores) {
      const todos = await tx(storeName, 'readonly', (store) => store.getAll());
      const semPerfil = todos.filter(item => item.perfilId == null);
      if (semPerfil.length) {
        await Promise.all(semPerfil.map(item =>
          tx(storeName, 'readwrite', (store) => store.put({ ...item, perfilId: db.perfilAtivoId }))
        ));
        porStore[storeName] = semPerfil.length;
        totalReparados += semPerfil.length;
      }
    }

    return { totalReparados, porStore };
  },

  /** Cria um snapshot completo (todos os perfis) no store local de backups
   *  automáticos, e mantém só os BACKUP_AUTO_MAX_ITENS mais recentes. */
  async criarBackupLocalAutomatico(motivo) {
    const dados = await db.exportAllRaw();
    await tx(STORES.backupsLocais, 'readwrite', (store) => store.add({
      criadoEm: new Date().toISOString(),
      motivo: motivo || 'auto',
      dados
    }));

    const todos = await tx(STORES.backupsLocais, 'readonly', (store) => store.getAll());
    if (todos.length > BACKUP_AUTO_MAX_ITENS) {
      const excedentes = todos.sort((a, b) => a.id - b.id).slice(0, todos.length - BACKUP_AUTO_MAX_ITENS);
      await Promise.all(excedentes.map(b => tx(STORES.backupsLocais, 'readwrite', (store) => store.delete(b.id))));
    }
  },

  backupsLocais: {
    async getAll() {
      const todos = await tx(STORES.backupsLocais, 'readonly', (store) => store.getAll());
      return todos.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    },
    remove: (id) => tx(STORES.backupsLocais, 'readwrite', (store) => store.delete(id))
  },

  async importAll(data, { substituir = true } = {}) {
    if (substituir) {
      // Rede de segurança: guarda um retrato de tudo ANTES de qualquer
      // substituição, sem esperar o debounce do backup automático normal.
      await db.criarBackupLocalAutomatico('antes_de_importar').catch(() => {});
      await Promise.all([
        db.clear(STORES.tentativas),
        db.clear(STORES.editais),
        db.clear(STORES.simulados),
        db.clear(STORES.ciclos),
        db.clear(STORES.cicloMaterias),
        db.clear(STORES.cicloSessoes),
        db.clear(STORES.cicloConfig),
        db.clear(STORES.resumos),
        db.clear(STORES.errosQuestoes),
        db.clear(STORES.diagnosticosErro)
      ]);
    }

    // Compatível com backups antigos (v1, baseados em "questoes")
    const listaTentativas = Array.isArray(data.tentativas)
      ? data.tentativas
      : (Array.isArray(data.questoes) ? data.questoes.map(q => ({
          disciplina: q.disciplina || '',
          assunto: q.assunto || '',
          banca: q.banca || '',
          concurso: q.concurso || '',
          data: q.data || '',
          numQuestoes: 1,
          acertos: q.correta ? 1 : 0,
          erros: q.correta ? 0 : 1,
          taxa: q.correta ? 100 : 0,
          tipo: 'Primeiro estudo',
          observacoes: q.observacoes || ''
        })) : []);

    const listaEditais = Array.isArray(data.editais) ? data.editais : [];
    const listaSimulados = Array.isArray(data.simulados) ? data.simulados : [];
    const listaCiclos = Array.isArray(data.ciclos) ? data.ciclos : [];
    const listaCicloMaterias = Array.isArray(data.cicloMaterias) ? data.cicloMaterias : [];
    const listaCicloSessoes = Array.isArray(data.cicloSessoes) ? data.cicloSessoes : [];
    const listaResumos = Array.isArray(data.resumos) ? data.resumos : [];

    // Mapa do id antigo de cada tentativa -> novo id gerado. Necessário pra
    // resumos (Caderno) não perderem o vínculo com a questão de origem a
    // cada sincronização/importação, igual já fazemos com cicloMateriaId.
    const mapaTentativaId = {};
    for (const t of listaTentativas) {
      const { id, perfilId, ...rest } = t;
      const novoId = await db.add(STORES.tentativas, rest);
      if (id != null) mapaTentativaId[id] = novoId;
    }
    for (const e of listaEditais) {
      const { id, perfilId, ...rest } = e;
      await db.add(STORES.editais, rest);
    }
    for (const s of listaSimulados) {
      const { id, perfilId, ...rest } = s;
      await db.add(STORES.simulados, rest);
    }

    // Mapa do id antigo do ciclo -> novo id gerado (os ids mudam ao reimportar)
    const mapaCicloId = {};
    for (const c of listaCiclos) {
      const { id, perfilId, ...rest } = c;
      const novoId = await db.add(STORES.ciclos, rest);
      if (id != null) mapaCicloId[id] = novoId;
    }

    // Compatível com backup antigo (ciclo único, sem "ciclos" nem cicloId nas matérias)
    let cicloUnicoIdAntigo = null;
    if (!listaCiclos.length && listaCicloMaterias.length && data.cicloConfig) {
      cicloUnicoIdAntigo = await db.add(STORES.ciclos, {
        nome: 'Ciclo 1',
        minutosCicloTotal: data.cicloConfig.minutosCicloTotal ?? 1200,
        ciclosCompletos: data.cicloConfig.ciclosCompletos ?? 0,
        ordem: 0
      });
    }

    // Mapa do id antigo de cada disciplina do ciclo -> novo id gerado.
    // CRÍTICO: sem isso, toda sessão (db.cicloSessoes) perde a ligação com
    // a disciplina certa a cada sincronização/importação, porque os ids
    // das disciplinas são recriados do zero a cada vez.
    const mapaMateriaId = {};
    for (const m of listaCicloMaterias) {
      const { id, cicloId, perfilId, ...rest } = m;
      rest.cicloId = cicloId != null && mapaCicloId[cicloId] != null
        ? mapaCicloId[cicloId]
        : (cicloUnicoIdAntigo ?? cicloId);
      const novoId = await db.add(STORES.cicloMaterias, rest);
      if (id != null) mapaMateriaId[id] = novoId;
    }
    for (const s of listaCicloSessoes) {
      const { id, perfilId, cicloMateriaId, ...rest } = s;
      // Se a disciplina referenciada não existir mais no mapa (ex.: foi
      // removida do ciclo), descarta a sessão órfã em vez de gravar um
      // link quebrado que nunca mais vai aparecer em lugar nenhum.
      const novoCicloMateriaId = cicloMateriaId != null ? mapaMateriaId[cicloMateriaId] : null;
      if (novoCicloMateriaId == null) continue;
      rest.cicloMateriaId = novoCicloMateriaId;
      await db.add(STORES.cicloSessoes, rest);
    }

    for (const r of listaResumos) {
      const { id, perfilId, tentativaId, ...rest } = r;
      // Diferente da sessão do ciclo, um resumo órfão (sem tentativa
      // correspondente) ainda tem valor por si só — o texto continua útil
      // no Caderno mesmo sem o vínculo, então mantém em vez de descartar.
      rest.tentativaId = tentativaId != null && mapaTentativaId[tentativaId] != null
        ? mapaTentativaId[tentativaId]
        : null;
      await db.add(STORES.resumos, rest);
    }

    // Mapa do id antigo de cada erro registrado -> novo id gerado. Necessário
    // pra diagnosticosErro não perderem o vínculo com os erros que os
    // originaram (erroIds) a cada sincronização/importação.
    const listaErros = Array.isArray(data.errosQuestoes) ? data.errosQuestoes : [];
    const listaDiagnosticos = Array.isArray(data.diagnosticosErro) ? data.diagnosticosErro : [];
    const mapaErroId = {};
    for (const e of listaErros) {
      const { id, perfilId, tentativaId, ...rest } = e;
      rest.tentativaId = tentativaId != null && mapaTentativaId[tentativaId] != null
        ? mapaTentativaId[tentativaId]
        : null;
      const novoId = await db.add(STORES.errosQuestoes, rest);
      if (id != null) mapaErroId[id] = novoId;
    }
    for (const d of listaDiagnosticos) {
      const { id, perfilId, erroIds, ...rest } = d;
      // Um diagnóstico sem nenhum erro correspondente ainda vale por si só
      // (a recomendação continua útil) — mantém a lista vazia em vez de
      // descartar o registro inteiro.
      rest.erroIds = Array.isArray(erroIds)
        ? erroIds.map(idAntigo => mapaErroId[idAntigo]).filter(v => v != null)
        : [];
      await db.add(STORES.diagnosticosErro, rest);
    }
  },

  async zerarTudo() {
    // Rede de segurança: guarda um retrato de tudo ANTES de zerar.
    await db.criarBackupLocalAutomatico('antes_de_zerar').catch(() => {});
    await Promise.all([
      db.clear(STORES.tentativas),
      db.clear(STORES.editais),
      db.clear(STORES.simulados),
      db.clear(STORES.ciclos),
      db.clear(STORES.cicloMaterias),
      db.clear(STORES.cicloSessoes),
      db.clear(STORES.cicloConfig),
      db.clear(STORES.resumos),
      db.clear(STORES.errosQuestoes),
      db.clear(STORES.diagnosticosErro)
    ]);
  }
};
