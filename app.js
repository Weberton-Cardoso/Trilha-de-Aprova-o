/**
 * app.js
 * Roteador (hash-based), renderização das telas, formulários e
 * cálculo de estatísticas do app "Trilha de Aprovação".
 *
 * Modelo de dados principal: TENTATIVA — um bloco de questões resolvidas
 * de um mesmo assunto (disciplina, assunto, banca, concurso, data,
 * quantidade de questões, acertos, erros, taxa, tipo, observações).
 * Todas as telas (dashboard, estatísticas, editais, simulados) usam
 * as tentativas como fonte única de verdade.
 */

/* ============================================================
   HELPERS GERAIS
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid() { return Math.random().toString(36).slice(2, 9); }

function pad(n) { return String(n).padStart(2, '0'); }

/** Formata Date -> 'YYYY-MM-DD' (usado como chave interna) */
function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Formata 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
function toBRDate(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function todayISO() { return toISODate(new Date()); }

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

function fmtPct(n) {
  if (!isFinite(n)) return '0%';
  return `${n.toFixed(1)}%`;
}

function fmtPctSigned(n) {
  if (!isFinite(n)) return '0 p.p.';
  const sinal = n > 0 ? '+' : '';
  return `${sinal}${n.toFixed(1)} p.p.`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = '') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ============================================================
   CONFIGURAÇÕES LEVES — localStorage
   ============================================================ */

const settings = {
  get theme() { return localStorage.getItem('ta_theme') || 'dark'; },
  set theme(v) { localStorage.setItem('ta_theme', v); },
  get sidebarCollapsed() { return localStorage.getItem('ta_sidebar_collapsed') === '1'; },
  set sidebarCollapsed(v) { localStorage.setItem('ta_sidebar_collapsed', v ? '1' : '0'); },
  // Sessão de estudo em andamento no Ciclo de Estudos: { materiaId, inicio (timestamp ms) } ou null.
  // Fica em localStorage (não sincroniza entre dispositivos) porque é só o estado
  // momentâneo do cronômetro deste aparelho — o tempo já concluído é salvo no banco.
  get cicloSessaoAtiva() {
    const raw = localStorage.getItem('ta_ciclo_sessao_ativa');
    return raw ? JSON.parse(raw) : null;
  },
  set cicloSessaoAtiva(v) {
    if (v) localStorage.setItem('ta_ciclo_sessao_ativa', JSON.stringify(v));
    else localStorage.removeItem('ta_ciclo_sessao_ativa');
  }
};

function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme);
}

/* ============================================================
   ESTADO EM MEMÓRIA (cache simples para evitar reconsultas)
   ============================================================ */

const state = {
  tentativas: [],
  editais: [],
  simulados: [],
  ciclos: [],
  cicloMaterias: [],
  cicloSessoes: [],
  perfis: [],
  resumos: [],
  revisoes: [],
  errosQuestoes: [],
  diagnosticosErro: [],
  dashboardFiltro: { tipo: '7d', inicio: null, fim: null },
  statsDisciplinaFiltro: { tipo: 'tudo', inicio: null, fim: null, disciplina: 'todas' }
};

async function reloadState() {
  const [tentativas, editais, simulados, ciclos, cicloMaterias, cicloSessoes, perfis, resumos] = await Promise.all([
    db.tentativas.getAll(), db.editais.getAll(), db.simulados.getAll(),
    db.ciclos.getAll(), db.cicloMaterias.getAll(), db.cicloSessoes.getAll(),
    db.perfis.getAll(), db.resumos.getAll()
  ]);
  state.perfis = perfis.sort((a, b) => a.ordem - b.ordem);
  state.ciclos = ciclos.sort((a, b) => a.ordem - b.ordem);
  state.cicloMaterias = cicloMaterias.sort((a, b) => a.ordem - b.ordem);
  state.cicloSessoes = cicloSessoes;
  state.tentativas = tentativas;
  state.editais = editais;
  state.simulados = simulados;
  state.resumos = resumos;
  // revisoes: fallback seguro — funciona mesmo antes da migração v10
  try { state.revisoes = await db.revisoes.getAll(); } catch (_) { state.revisoes = []; }
  // errosQuestoes/diagnosticosErro: fallback seguro — funciona mesmo antes da migração v11
  try { state.errosQuestoes = await db.errosQuestoes.getAll(); } catch (_) { state.errosQuestoes = []; }
  try { state.diagnosticosErro = await db.diagnosticosErro.getAll(); } catch (_) { state.diagnosticosErro = []; }
}

/** Disciplinas sugeridas por padrão no autocomplete, mesmo antes de qualquer
 *  tentativa ser registrada com elas. */
const DISCIPLINAS_PADRAO = [
  'Direito Tributário',
  'Contabilidade Geral',
  'Direito Administrativo',
  'Direito Constitucional',
  'Língua Portuguesa',
  'Raciocínio Lógico / Matemática',
  'Noções de Informática',
  'Legislação Tributária Municipal',
  'Auditoria',
  'Administração',
  'Noções de Legislação',
  'Estatística',
  'Matemática Financeira',
  'Análise de Dados',
  'Inteligência Artificial',
  'Direito Penal',
  'Economia',
  'Administração Pública',
  'Administração Financeira e Orçamentária',
  'Contabilidade Pública',
  'Controle Externo',
  'Auditoria Governamental',
  'Tecnologia da Informação',
  'Ética no Serviço Público',
  'Lei Orgânica do Distrito Federal',
  'Regime Jurídico dos Servidores do DF',
  'Conhecimentos sobre o Distrito Federal',
  'Política para Mulheres',
  'Primeiros Socorros'
];

/** Tópicos sugeridos por padrão para cada disciplina (chave = nome exato
 *  da disciplina em DISCIPLINAS_PADRAO). Preencha aqui conforme for
 *  passando as listas — o app já funciona sem isso, usando o histórico. */
const TOPICOS_PADRAO = {
  'Língua Portuguesa': [
    'Interpretação de textos', 'Tipologia textual', 'Ortografia', 'Acentuação',
    'Classes de palavras', 'Sintaxe', 'Concordância', 'Regência', 'Crase',
    'Pontuação', 'Coesão', 'Coerência', 'Reescrita', 'Redação oficial'
  ],
  'Direito Constitucional': [
    'Constituição', 'Princípios Fundamentais', 'Direitos e Garantias',
    'Direitos Sociais', 'Organização do Estado', 'Administração Pública',
    'Poder Legislativo', 'Poder Executivo', 'Poder Judiciário',
    'Controle de Constitucionalidade'
  ],
  'Direito Administrativo': [
    'Princípios', 'Atos Administrativos', 'Poderes Administrativos',
    'Serviços Públicos', 'Licitações', 'Contratos',
    'Responsabilidade Civil do Estado', 'Processo Administrativo', 'Agentes Públicos'
  ],
  'Administração Pública': [
    'Administração Geral', 'Planejamento Estratégico', 'Organização', 'Liderança',
    'Controle', 'Gestão de Pessoas', 'Gestão por Processos', 'Qualidade',
    'Governança', 'Gestão de Riscos'
  ],
  'Administração Financeira e Orçamentária': [
    'Orçamento Público', 'PPA', 'LDO', 'LOA', 'Créditos Adicionais',
    'Receita Pública', 'Despesa Pública', 'Restos a Pagar', 'LRF'
  ],
  'Contabilidade Pública': [
    'Patrimônio Público', 'Plano de Contas', 'MCASP', 'Demonstrações Contábeis',
    'Receita', 'Despesa', 'NBC TSP'
  ],
  'Controle Externo': [
    'Sistemas de Controle', 'Tribunais de Contas', 'Fiscalização',
    'Prestação de Contas', 'Auditoria Governamental', 'Responsabilização', 'Sanções'
  ],
  'Auditoria Governamental': [
    'Normas', 'Planejamento', 'Papéis de Trabalho', 'Evidências', 'Materialidade',
    'Risco', 'Relatórios', 'Auditoria Operacional', 'Auditoria de Conformidade'
  ],
  'Estatística': [
    'Estatística Descritiva', 'Probabilidade', 'Distribuições', 'Inferência',
    'Intervalos de Confiança', 'Testes de Hipóteses', 'Correlação', 'Regressão'
  ],
  'Raciocínio Lógico / Matemática': [
    'Proposições', 'Conectivos', 'Tabelas-Verdade', 'Equivalências', 'Negação',
    'Argumentação', 'Conjuntos', 'Contagem', 'Probabilidade'
  ],
  'Tecnologia da Informação': [
    'Hardware', 'Software', 'Redes', 'Segurança', 'Banco de Dados',
    'Computação em Nuvem', 'Governança de TI', 'LGPD'
  ],
  'Ética no Serviço Público': [
    'Ética', 'Moral', 'Código de Ética', 'Deveres', 'Infrações', 'Processo Disciplinar'
  ],
  'Lei Orgânica do Distrito Federal': [
    'Organização do DF', 'Competências', 'Administração Pública', 'Poderes',
    'Tributação', 'Orçamento'
  ],
  'Regime Jurídico dos Servidores do DF': [
    'LC 840/2011', 'Provimento', 'Direitos', 'Deveres', 'Licenças',
    'Processo Disciplinar', 'Penalidades'
  ],
  'Conhecimentos sobre o Distrito Federal': [
    'História', 'Geografia', 'Economia', 'Cultura', 'RIDE', 'Atualidades do DF'
  ],
  'Política para Mulheres': [
    'Plano Distrital', 'Igualdade de Gênero', 'Violência contra a Mulher', 'Políticas Públicas'
  ],
  'Primeiros Socorros': [
    'Avaliação Inicial', 'Suporte Básico de Vida', 'Hemorragias', 'Fraturas',
    'Queimaduras', 'Convulsões', 'Engasgamento', 'PCR'
  ]
};

function _norm(s) { return (s || '').trim().toLowerCase(); }

/** Lista de assuntos sugeridos para uma disciplina específica: junta os
 *  tópicos padrão cadastrados + os assuntos já usados no histórico para
 *  essa mesma disciplina + tópicos de editais importados para ela. */
function valoresAssuntoParaDisciplina(disciplina) {
  const alvo = _norm(disciplina);
  const vistos = new Set();

  if (alvo) {
    const chavePadrao = Object.keys(TOPICOS_PADRAO).find(k => _norm(k) === alvo);
    if (chavePadrao) TOPICOS_PADRAO[chavePadrao].forEach(v => vistos.add(v));
  }

  state.tentativas.forEach(t => {
    if (!alvo || _norm(t.disciplina) === alvo) {
      const v = (t.assunto || '').trim();
      if (v) vistos.add(v);
    }
  });

  state.editais.forEach(e => (e.materias || []).forEach(m => {
    if (!alvo || _norm(m.nome) === alvo) {
      (m.topicos || []).forEach(tp => { if (tp.nome) vistos.add(tp.nome); });
    }
  }));

  return Array.from(vistos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Lista de valores únicos (não vazios) já usados em um campo das tentativas,
 *  em ordem alfabética — usada para popular os <datalist> de autocomplete. */
function valoresUnicos(campo) {
  const vistos = new Set();
  if (campo === 'disciplina') {
    DISCIPLINAS_PADRAO.forEach(v => vistos.add(v));
  }
  state.tentativas.forEach(t => {
    const v = (t[campo] || '').trim();
    if (v) vistos.add(v);
  });
  if (campo === 'disciplina') {
    state.editais.forEach(e => (e.materias || []).forEach(m => {
      if (m.nome) vistos.add(m.nome);
    }));
  }
  return Array.from(vistos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/* ============================================================
   SIDEBAR / NAVEGAÇÃO
   ============================================================ */

function initSidebar() {
  const sidebar = $('#sidebar');
  const overlay = $('#sidebar-overlay');

  if (settings.sidebarCollapsed) sidebar.classList.add('collapsed');

  $('#sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    settings.sidebarCollapsed = sidebar.classList.contains('collapsed');
  });

  $('#mobile-menu-btn').addEventListener('click', () => {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
  });

  // Submenus recolhíveis (Estatísticas)
  $$('.nav-group-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.nav-group').classList.toggle('open');
    });
  });
}

function closeMobileSidebar() {
  $('#sidebar').classList.remove('mobile-open');
  $('#sidebar-overlay').classList.remove('show');
}

function updateActiveNav(route) {
  $$('.nav-item[data-route], .nav-submenu a[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  // Abre o submenu de estatísticas se a rota atual estiver dentro dele
  if (route.startsWith('estatisticas/')) {
    $('.nav-group[data-group]')?.classList.add('open');
    $('.nav-group')?.classList.add('open');
  }
}

/* ============================================================
   ROTEADOR
   ============================================================ */

const PAGE_TITLES = {
  'dashboard': 'Dashboard',
  'tentativas': 'Tentativas',
  'resolver-ia': 'Resolver com IA',
  'caderno': 'Caderno de Resumos',
  'importar-historico': 'Importar Histórico',
  'ciclo': 'Ciclo de Estudos',
  'revisao': 'Revisão do Dia',
  'evolucao-revisao': 'Evolução da Revisão',
  'diagnostico': 'Diagnóstico de Erros',
  'mentor': 'Mentor IA',
  'estatisticas/disciplinas': 'Estatísticas por Disciplina',
  'estatisticas/assuntos': 'Estatísticas por Assunto',
  'estatisticas/bancas': 'Estatísticas por Banca',
  'estatisticas/concursos': 'Estatísticas por Concurso',
  'editais': 'Editais',
  'editais/importar': 'Importar Edital',
  'simulados': 'Simulados',
  'simulado-gerado': 'Simulado Personalizado',
  'perfis': 'Perfis',
  'configuracoes': 'Configurações'
};

async function router() {
  let hash = location.hash.replace(/^#\//, '') || 'dashboard';
  // compatibilidade com links antigos (versão baseada em questões individuais)
  if (hash === 'questoes' || hash.startsWith('questoes/')) {
    hash = hash.replace('questoes', 'tentativas');
  }
  const [base, sub, sub2] = hash.split('/');
  const routeKey = sub ? `${base}/${sub}` : base;

  closeMobileSidebar();
  await reloadState();
  atualizarSeletorPerfilUI();

  const view = $('#view');
  view.innerHTML = '';

  if (base === 'dashboard') {
    $('#page-title').textContent = PAGE_TITLES['dashboard'];
    updateActiveNav('dashboard');
    renderDashboard(view);
  } else if (base === 'tentativas') {
    $('#page-title').textContent = PAGE_TITLES['tentativas'];
    updateActiveNav('tentativas');
    renderTentativas(view);
  } else if (base === 'resolver-ia') {
    $('#page-title').textContent = PAGE_TITLES['resolver-ia'];
    updateActiveNav('resolver-ia');
    renderResolverIA(view);
  } else if (base === 'caderno') {
    $('#page-title').textContent = PAGE_TITLES['caderno'];
    updateActiveNav('caderno');
    renderCaderno(view);
  } else if (base === 'importar-historico') {
    $('#page-title').textContent = PAGE_TITLES['importar-historico'];
    updateActiveNav('importar-historico');
    renderImportarHistorico(view);
  } else if (base === 'ciclo') {
    if (sub) {
      const cicloId = Number(sub);
      const ciclo = state.ciclos.find(c => c.id === cicloId);
      $('#page-title').textContent = ciclo ? ciclo.nome : PAGE_TITLES['ciclo'];
      updateActiveNav('ciclo');
      renderCicloPainelRoute(view, cicloId);
    } else {
      $('#page-title').textContent = PAGE_TITLES['ciclo'];
      updateActiveNav('ciclo');
      renderCiclosLista(view);
    }
  } else if (base === 'estatisticas') {
    if (sub === 'disciplinas' && sub2) {
      $('#page-title').textContent = `Disciplina: ${decodeURIComponent(sub2)}`;
      updateActiveNav('estatisticas/disciplinas');
      renderDisciplinaDetalhe(view, decodeURIComponent(sub2));
    } else if (sub === 'assuntos' && sub2) {
      $('#page-title').textContent = `Assunto: ${decodeURIComponent(sub2)}`;
      updateActiveNav('estatisticas/assuntos');
      renderAssuntoDetalhe(view, decodeURIComponent(sub2));
    } else if (sub === 'concursos' && sub2) {
      const nomeConcurso = decodeURIComponent(sub2);
      $('#page-title').textContent = `Concurso: ${nomeConcurso}`;
      updateActiveNav('estatisticas/concursos');
      renderConcursoDetalhe(view, nomeConcurso);
    } else {
      $('#page-title').textContent = PAGE_TITLES[routeKey] || 'Estatísticas';
      updateActiveNav(routeKey);
      renderAgrupamento(view, sub);
    }
  } else if (base === 'editais') {
    if (sub === 'importar') {
      $('#page-title').textContent = 'Importar Edital';
      updateActiveNav('editais/importar');
      renderImportarEdital(view);
    } else if (sub) {
      $('#page-title').textContent = 'Detalhe do Edital';
      updateActiveNav('editais');
      renderEditalDetalhe(view, sub);
    } else {
      $('#page-title').textContent = PAGE_TITLES['editais'];
      updateActiveNav('editais');
      renderEditais(view);
    }
  } else if (base === 'simulados') {
    $('#page-title').textContent = PAGE_TITLES['simulados'];
    updateActiveNav('simulados');
    renderSimulados(view);
  } else if (base === 'simulado-gerado') {
    $('#page-title').textContent = _simuladoGerado ? escapeHtml(_simuladoGerado.nome) : PAGE_TITLES['simulado-gerado'];
    updateActiveNav('simulados');
    renderSimuladoGerado(view);
  } else if (base === 'perfis') {
    $('#page-title').textContent = PAGE_TITLES['perfis'];
    updateActiveNav('perfis');
    renderPerfisPage(view);
  } else if (base === 'revisao') {
    $('#page-title').textContent = PAGE_TITLES['revisao'];
    updateActiveNav('revisao');
    if (typeof renderRevisao === 'function') renderRevisao(view);
  } else if (base === 'evolucao-revisao') {
    $('#page-title').textContent = PAGE_TITLES['evolucao-revisao'];
    updateActiveNav('revisao');
    if (typeof renderEvolucaoRevisao === 'function') renderEvolucaoRevisao(view);
  } else if (base === 'mentor') {
    $('#page-title').textContent = PAGE_TITLES['mentor'];
    updateActiveNav('mentor');
    if (typeof renderMentorIA === 'function') renderMentorIA(view);
  } else if (base === 'diagnostico') {
    $('#page-title').textContent = PAGE_TITLES['diagnostico'];
    updateActiveNav('diagnostico');
    if (typeof renderDiagnosticoErros === 'function') renderDiagnosticoErros(view);
  } else if (base === 'configuracoes') {
    $('#page-title').textContent = PAGE_TITLES['configuracoes'];
    updateActiveNav('configuracoes');
    renderConfiguracoes(view);
  } else {
    view.innerHTML = '<div class="empty-state"><p>Página não encontrada.</p></div>';
  }

  updateStreakMini();
  if (typeof _atualizarCicloFlutuante === 'function') _atualizarCicloFlutuante();
}

/* ============================================================
   CÁLCULO DE ESTATÍSTICAS (funções puras sobre state.tentativas)
   ============================================================ */

/** Filtra tentativas dentro de um intervalo de datas (inclusive), formato ISO 'YYYY-MM-DD' */
function filtrarTentativasPorPeriodo(inicio, fim) {
  return state.tentativas.filter(t => t.data >= inicio && t.data <= fim);
}

/** Resolve o filtro do dashboard em { inicio, fim } */
function resolverPeriodo(filtro) {
  const hoje = todayISO();
  switch (filtro.tipo) {
    case 'hoje': return { inicio: hoje, fim: hoje };
    case '7d': return { inicio: daysAgoISO(6), fim: hoje };
    case '30d': return { inicio: daysAgoISO(29), fim: hoje };
    case '90d': return { inicio: daysAgoISO(89), fim: hoje };
    case 'tudo': return { inicio: '1970-01-01', fim: hoje };
    case 'custom': return { inicio: filtro.inicio || daysAgoISO(6), fim: filtro.fim || hoje };
    default: return { inicio: daysAgoISO(6), fim: hoje };
  }
}

/** Resumo agregado de uma lista de tentativas (soma questões/acertos/erros).
 *  A taxa de acerto exclui questões em branco do denominador — deixar em
 *  branco não é a mesma coisa que errar, então não pode penalizar a taxa
 *  como se fosse erro. "brancos" é derivado (total − certas − erradas), não
 *  precisa de um campo próprio salvo em cada tentativa. */
function calcResumo(lista) {
  const tentativas = lista.length;
  const total = lista.reduce((acc, t) => acc + (Number(t.numQuestoes) || 0), 0);
  const certas = lista.reduce((acc, t) => acc + (Number(t.acertos) || 0), 0);
  const erradas = lista.reduce((acc, t) => acc + (Number(t.erros) || 0), 0);
  const brancos = Math.max(0, total - certas - erradas);
  const respondidas = certas + erradas;
  const taxa = respondidas ? (certas / respondidas) * 100 : 0;
  return { tentativas, total, certas, erradas, brancos, taxa };
}

/**
 * Relatório diário completo: combina, para UMA data específica (hoje, por
 * padrão), as sessões de tempo do Ciclo de Estudos (state.cicloSessoes) com
 * as tentativas de questões (state.tentativas) daquele dia, agrupadas por
 * matéria/disciplina (comparação por nome normalizado, já que tentativas
 * guardam a disciplina como texto livre e sessões guardam o nome da matéria
 * do ciclo). É a fonte única do card "Relatório diário de estudos" do
 * dashboard — sempre recalculada a partir do state atual, então basta
 * chamar de novo (ex.: dentro de renderDashboard) para atualizar.
 */
function calcRelatorioDiario(dataISO = todayISO()) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const sessoesDoDia = (state.cicloSessoes || []).filter(s => s && s.data === dataISO);
  const tentativasDoDia = (state.tentativas || []).filter(t => t && t.data === dataISO);

  const grupos = new Map(); // chave normalizada -> acumulador

  function pegaGrupo(nomeOriginal) {
    const nome = (nomeOriginal || '').trim() || '(Não informado)';
    const chave = norm(nome);
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        nome, topicos: new Set(), tipos: new Set(),
        minutos: 0, numQuestoes: 0, acertos: 0, erros: 0
      });
    }
    return grupos.get(chave);
  }

  sessoesDoDia.forEach(s => {
    const g = pegaGrupo(s.nome);
    g.minutos += (Number(s.minutos) || 0);
    if (s.topico) g.topicos.add(s.topico);
    if (s.tipoEstudo) g.tipos.add(s.tipoEstudo);
  });

  tentativasDoDia.forEach(t => {
    const g = pegaGrupo(t.disciplina);
    g.numQuestoes += (Number(t.numQuestoes) || 0);
    g.acertos += (Number(t.acertos) || 0);
    g.erros += (Number(t.erros) || 0);
    if (t.assunto) g.topicos.add(t.assunto);
    if (t.tipo) g.tipos.add(t.tipo);
  });

  const materias = Array.from(grupos.values()).map(g => ({
    nome: g.nome,
    topicos: Array.from(g.topicos),
    tipos: Array.from(g.tipos),
    minutos: g.minutos,
    numQuestoes: g.numQuestoes,
    acertos: g.acertos,
    erros: g.erros,
    brancos: Math.max(0, g.numQuestoes - g.acertos - g.erros),
    taxa: g.numQuestoes ? (g.acertos / g.numQuestoes) * 100 : 0
  }));

  // matérias com mais tempo estudado primeiro; empate desempata por nº de questões
  materias.sort((a, b) => (b.minutos - a.minutos) || (b.numQuestoes - a.numQuestoes));

  const totais = materias.reduce((acc, g) => {
    acc.minutos += g.minutos;
    acc.numQuestoes += g.numQuestoes;
    acc.acertos += g.acertos;
    acc.erros += g.erros;
    acc.brancos += g.brancos;
    return acc;
  }, { minutos: 0, numQuestoes: 0, acertos: 0, erros: 0, brancos: 0 });
  totais.taxa = totais.numQuestoes ? (totais.acertos / totais.numQuestoes) * 100 : 0;

  return { materias, totais };
}

/** Sequência de dias consecutivos (até hoje) com pelo menos 1 tentativa registrada */
function calcSequenciaDias() {
  const diasComTentativa = new Set(state.tentativas.map(t => t.data));
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const iso = toISODate(cursor);
    if (diasComTentativa.has(iso)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/** Últimos N dias como array de {iso, count, correctRatio} para a trilha visual */
function calcTrilhaDias(n = 30) {
  const dias = [];
  for (let i = n - 1; i >= 0; i--) {
    const iso = daysAgoISO(i);
    const ts = state.tentativas.filter(t => t.data === iso);
    const r = calcResumo(ts);
    dias.push({ iso, count: r.total, ratio: r.total ? r.certas / r.total : 0 });
  }
  return dias;
}

function nivelStreakDot(dia) {
  if (dia.count === 0) return 0;
  if (dia.ratio >= 0.8) return 3;
  if (dia.ratio >= 0.5) return 2;
  return 1;
}

function updateStreakMini() {
  const streak = calcSequenciaDias();
  $('#streak-mini-count').textContent = `${streak} dia${streak === 1 ? '' : 's'}`;
}

/** Agrupa tentativas por uma chave (disciplina, assunto, banca, concurso) */
function agruparPor(lista, chave) {
  const mapa = new Map();
  lista.forEach(t => {
    const valor = (t[chave] || '(Não informado)').trim() || '(Não informado)';
    if (!mapa.has(valor)) mapa.set(valor, []);
    mapa.get(valor).push(t);
  });
  const resultado = [];
  mapa.forEach((ts, nome) => {
    const r = calcResumo(ts);
    resultado.push({ nome, ...r });
  });
  resultado.sort((a, b) => b.total - a.total);
  return resultado;
}

/**
 * Calcula a tendência de desempenho de um assunto/agrupamento a partir de
 * uma lista de tentativas JÁ ORDENADA CRONOLOGICAMENTE (mais antiga primeiro).
 * Compara a taxa da última tentativa com a média das tentativas anteriores.
 */
function calcTendencia(tentativasOrdenadas) {
  if (tentativasOrdenadas.length < 2) {
    return { label: 'Estável', icone: '➡' };
  }
  const ultima = tentativasOrdenadas[tentativasOrdenadas.length - 1];
  const anteriores = tentativasOrdenadas.slice(0, -1);
  const mediaAnterior = anteriores.reduce((acc, t) => acc + (t.taxa || 0), 0) / anteriores.length;
  const diff = (ultima.taxa || 0) - mediaAnterior;

  if (diff >= 3) return { label: 'Melhorando', icone: '📈' };
  if (diff <= -3) return { label: 'Piorando', icone: '📉' };
  return { label: 'Estável', icone: '➡' };
}

/* ============================================================
   TELA: DASHBOARD
   ============================================================ */

function renderDashboard(view) {
  const filtro = state.dashboardFiltro;
  const { inicio, fim } = resolverPeriodo(filtro);
  const lista = filtrarTentativasPorPeriodo(inicio, fim);
  const resumo = calcResumo(lista);
  const streak = calcSequenciaDias();

  const diasNoPeriodo = Math.max(1, (new Date(fim) - new Date(inicio)) / 86400000 + 1);
  const mediaDiaria = resumo.total / diasNoPeriodo;

  const porDisciplina = agruparPor(lista, 'disciplina').slice(0, 6);
  const trilha = calcTrilhaDias(30);

  // Tempo total estudado desde que os registros do Ciclo de Estudos
  // começaram (soma de TODAS as sessões, sem filtro de data) — independente
  // do filtro de período escolhido acima no dashboard.
  const minutosTotalCiclo = (state.cicloSessoes || [])
    .reduce((soma, s) => soma + (Number(s && s.minutos) || 0), 0);

  // Tempo da semana (últimos 7 dias do Ciclo de Estudos)
  const inicioSemana = daysAgoISO(6);
  const minutosSemanaCiclo = (state.cicloSessoes || [])
    .filter(s => s && s.data && s.data >= inicioSemana)
    .reduce((soma, s) => soma + (Number(s.minutos) || 0), 0);

  // Questões por dia (últimos 7 dias) para o gráfico de barras
  const ultimos7 = [];
  for (let i = 6; i >= 0; i--) {
    const iso = daysAgoISO(i);
    const ts = state.tentativas.filter(t => t.data === iso);
    const r = calcResumo(ts);
    ultimos7.push({ iso, label: toBRDate(iso).slice(0, 5), certas: r.certas, erradas: r.erradas, brancos: r.brancos });
  }

  view.innerHTML = `
    <div class="filter-bar" id="dash-filters">
      ${['hoje', '7d', '30d', '90d', 'custom'].map(t => `
        <button class="chip ${filtro.tipo === t ? 'active' : ''}" data-filtro="${t}">
          ${{hoje:'Hoje', '7d':'Últimos 7 dias', '30d':'Últimos 30 dias', '90d':'Últimos 90 dias', custom:'Personalizado'}[t]}
        </button>
      `).join('')}
      <div id="custom-range" style="display:${filtro.tipo === 'custom' ? 'flex' : 'none'};gap:8px;align-items:center;">
        <input type="date" id="filtro-inicio" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.inicio || daysAgoISO(6)}">
        <span class="text-muted">até</span>
        <input type="date" id="filtro-fim" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.fim || todayISO()}">
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="label">Total de questões</div><div class="value">${resumo.total}</div></div>
      <div class="stat-card success"><div class="label">Questões certas</div><div class="value">${resumo.certas}</div></div>
      <div class="stat-card danger"><div class="label">Questões erradas</div><div class="value">${resumo.erradas}</div></div>
      <div class="stat-card"><div class="label">Questões em branco</div><div class="value">${resumo.brancos}</div></div>
      <div class="stat-card gold"><div class="label">Taxa de acerto</div><div class="value">${fmtPct(resumo.taxa)}</div></div>
      <div class="stat-card info"><div class="label">Tentativas registradas</div><div class="value">${resumo.tentativas}</div></div>
      <div class="stat-card"><div class="label">Média de questões/dia</div><div class="value">${mediaDiaria.toFixed(1)}</div></div>
      <div class="stat-card gold"><div class="label">Sequência de dias</div><div class="value">${streak} 🔥</div></div>
      <div class="stat-card info"><div class="label">Tempo total estudado</div><div class="value">${_formatarMinutos(minutosTotalCiclo)}</div></div>
      <div class="stat-card info"><div class="label">Tempo esta semana</div><div class="value">${_formatarMinutos(minutosSemanaCiclo)}</div></div>
    </div>

    <div class="card mb-12" id="card-mentor-dashboard"></div>

    <div class="card mb-12" id="card-recomendacao-dia"></div>

    <div class="card mb-12" id="card-relatorio-diario"></div>

    <div class="card mb-12" id="card-prioridade-revisao"></div>

    <div class="grid-2 mb-12">
      <div class="card">
        <div class="card-title">Acertos × Erros</div>
        <div class="chart-wrap"><canvas id="chart-pizza"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Questões por dia — últimos 7 dias</div>
        <div class="chart-wrap"><canvas id="chart-barras"></canvas></div>
      </div>
    </div>

    <div class="card mb-12">
      <div class="card-title">Evolução — últimos dias</div>
      <div class="chart-wrap tall"><canvas id="chart-linha"></canvas></div>
    </div>

    <div class="card">
      <div class="card-title">Trilha de estudo — últimos 30 dias</div>
      <div class="streak-strip">
        ${trilha.map(d => `<div class="streak-dot" data-level="${nivelStreakDot(d)}" title="${toBRDate(d.iso)} · ${d.count} questão(ões)"></div>`).join('')}
      </div>
    </div>

    <div class="card mt-12" id="card-tempo-por-tipo-ciclo"></div>

    <div class="card mt-12" id="card-correlacao-tipo-taxa"></div>

    ${buildDashboardEditalHTML()}

    <div class="card mt-12" id="card-stats-disciplina"></div>
  `;

  // filtros
  $$('#dash-filters .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.dashboardFiltro.tipo = chip.dataset.filtro;
      renderDashboard(view);
    });
  });
  const inicioInput = $('#filtro-inicio');
  const fimInput = $('#filtro-fim');
  if (inicioInput) inicioInput.addEventListener('change', () => {
    state.dashboardFiltro.tipo = 'custom';
    state.dashboardFiltro.inicio = inicioInput.value;
    renderDashboard(view);
  });
  if (fimInput) fimInput.addEventListener('change', () => {
    state.dashboardFiltro.tipo = 'custom';
    state.dashboardFiltro.fim = fimInput.value;
    renderDashboard(view);
  });

  // gráficos
  try {
    renderPieChart('chart-pizza', { acertos: resumo.certas, erros: resumo.erradas, brancos: resumo.brancos });
    renderBarChart('chart-barras', {
      labels: ultimos7.map(d => d.label),
      certas: ultimos7.map(d => d.certas),
      erradas: ultimos7.map(d => d.erradas),
      brancos: ultimos7.map(d => d.brancos)
    });
  } catch (err) { console.error('Erro ao renderizar gráficos pizza/barras:', err); }

  // evolução: agrupa por dia dentro do período (ou últimos 60 dias se período muito curto)
  try {
    const diasEvolucao = [];
    const nDias = Math.min(60, diasNoPeriodo);
    for (let i = nDias - 1; i >= 0; i--) {
      const iso = daysAgoISO(i);
      if (iso < inicio) continue;
      const ts = state.tentativas.filter(t => t.data === iso);
      const r = calcResumo(ts);
      diasEvolucao.push({ iso, certas: r.certas, erradas: r.erradas, brancos: r.brancos, total: r.total });
    }
    renderLineChart('chart-linha', {
      labels: diasEvolucao.map(d => toBRDate(d.iso).slice(0, 5)),
      series: [
        { label: 'Certas', data: diasEvolucao.map(d => d.certas) },
        { label: 'Em branco', data: diasEvolucao.map(d => d.brancos) },
        { label: 'Total', data: diasEvolucao.map(d => d.total) }
      ]
    });
  } catch (err) { console.error('Erro ao renderizar gráfico de evolução:', err); }

  try { initDashboardEditalChart(); } catch (err) { console.error('Erro em initDashboardEditalChart:', err); }
  try { renderStatsPorDisciplina(); } catch (err) { console.error('Erro em renderStatsPorDisciplina:', err); }
  try { renderTempoPorTipoCicloDashboard(); } catch (err) { console.error('Erro em renderTempoPorTipoCicloDashboard:', err); }
  try {
    if (typeof renderCardMentorDashboard === 'function') renderCardMentorDashboard().catch(err => console.error('Erro em renderCardMentorDashboard:', err));
  } catch (err) { console.error('Erro em renderCardMentorDashboard:', err); }
  try {
    if (typeof renderCardRecomendacaoDia === 'function') renderCardRecomendacaoDia().catch(err => console.error('Erro em renderCardRecomendacaoDia:', err));
  } catch (err) { console.error('Erro em renderCardRecomendacaoDia:', err); }
  try { renderRelatorioDiario(); } catch (err) { console.error('Erro em renderRelatorioDiario:', err); }
  try { renderPrioridadeRevisao(); } catch (err) { console.error('Erro em renderPrioridadeRevisao:', err); }
  try { renderCorrelacaoTipoTaxa(); } catch (err) { console.error('Erro em renderCorrelacaoTipoTaxa:', err); }
}

/**
 * Card "Tipo de estudo × desempenho": para cada disciplina, descobre qual
 * foi o tipo de estudo predominante (o que teve mais minutos acumulados
 * nela, olhando db.cicloSessoes de todos os ciclos). Agrupa as disciplinas
 * por esse tipo predominante e calcula a taxa de acerto média (ponderada
 * pelo número de questões) de cada grupo — assim dá pra ver se, por
 * exemplo, disciplinas estudadas mais por Exercícios têm desempenho
 * diferente das estudadas mais por Vídeo.
 */
function renderCorrelacaoTipoTaxa() {
  const card = $('#card-correlacao-tipo-taxa');
  if (!card) return;

  const norm = (s) => (s || '').trim().toLowerCase();
  const materias = state.cicloMaterias || [];

  const grupos = {}; // tipo -> { totalQuestoes, totalAcertos, disciplinas: Set }

  materias.forEach(m => {
    const sessoesDaMateria = state.cicloSessoes.filter(s => s.cicloMateriaId === m.id && (s.minutos || 0) > 0 && s.tipoEstudo);
    if (!sessoesDaMateria.length) return; // sem tipo registrado, não entra na correlação

    const porTipo = {};
    sessoesDaMateria.forEach(s => { porTipo[s.tipoEstudo] = (porTipo[s.tipoEstudo] || 0) + s.minutos; });
    const tipoPredominante = Object.entries(porTipo).sort((a, b) => b[1] - a[1])[0][0];

    const ciclo = state.ciclos.find(c => c.id === m.cicloId);
    const nomeCiclo = ciclo ? ciclo.nome : '';
    const tentativasDaMateria = state.tentativas.filter(t =>
      _materiaCasaComDisciplina(m, t.disciplina) &&
      (nomeCiclo ? norm(t.concurso) === norm(nomeCiclo) : true)
    );
    const totalQuestoes = tentativasDaMateria.reduce((s, t) => s + (t.numQuestoes || 0), 0);
    const totalAcertos = tentativasDaMateria.reduce((s, t) => s + (t.acertos || 0), 0);
    if (totalQuestoes === 0) return; // sem questões, não dá pra medir desempenho

    if (!grupos[tipoPredominante]) grupos[tipoPredominante] = { totalQuestoes: 0, totalAcertos: 0, disciplinas: new Set() };
    grupos[tipoPredominante].totalQuestoes += totalQuestoes;
    grupos[tipoPredominante].totalAcertos += totalAcertos;
    grupos[tipoPredominante].disciplinas.add(m.nome);
  });

  const lista = Object.entries(grupos)
    .map(([tipo, g]) => ({ tipo, taxa: (g.totalAcertos / g.totalQuestoes) * 100, disciplinas: g.disciplinas.size, questoes: g.totalQuestoes }))
    .sort((a, b) => b.taxa - a.taxa);

  if (lista.length < 2) {
    card.innerHTML = `
      <div class="card-title">🔬 Tipo de estudo × desempenho</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Ainda não há disciplinas suficientes com tipo de estudo e questões registradas para comparar.
        Continue marcando o tipo (Vídeo, Exercícios, Revisão...) nas sessões do Ciclo de Estudos e
        registrando tentativas — essa análise aparece assim que houver pelo menos 2 tipos com dados.
      </p>
    `;
    return;
  }

  card.innerHTML = `
    <div class="card-title">🔬 Tipo de estudo × desempenho</div>
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">
      Agrupa cada disciplina pelo tipo de estudo que você mais usou nela, e mostra a taxa de acerto média de cada grupo.
    </p>
    <div>
      ${lista.map(item => `
        <div class="flex" style="justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);gap:10px;">
          <span>${escapeHtml(item.tipo)}</span>
          <span class="text-muted" style="font-size:13px;">
            <strong style="color:var(--gold);">${fmtPct(item.taxa)}</strong>
            · ${item.disciplinas} disciplina${item.disciplinas === 1 ? '' : 's'} · ${item.questoes} questões
          </span>
        </div>
      `).join('')}
    </div>
    <p class="text-muted" style="font-size:11.5px;margin-top:10px;margin-bottom:0;">
      Correlação, não causa: uma disciplina que você domina bem pode simplesmente precisar de menos exercícios e mais revisão, por exemplo.
    </p>
  `;
}

/**
 * Data atualmente selecionada no "Relatório diário de estudos" — controla
 * qual dia está sendo exibido no card. Começa sempre em hoje ao carregar o
 * app; navegar com as setas ou o campo de data só muda esse estado local
 * (não mexe no filtro geral do Dashboard).
 */
let _relatorioDiarioData = todayISO();

/**
 * Card "Relatório diário de estudos" — junta numa única tabela, por
 * matéria, tudo que aconteceu num dia (por padrão hoje): os tópicos e
 * tipos de estudo vistos (tanto no Ciclo de Estudos quanto nas tentativas
 * de questões), o tempo estudado (Ciclo de Estudos) e o desempenho em
 * questões (tentativas). Tem setas "◀ ▶" e um campo de data pra navegar
 * entre dias anteriores — a seta "▶" fica desabilitada em dias futuros.
 */
function renderRelatorioDiario() {
  const card = $('#card-relatorio-diario');
  if (!card) return;

  const dataSelecionada = _relatorioDiarioData;
  const { materias, totais } = calcRelatorioDiario(dataSelecionada);
  const filtroEhHoje = state.dashboardFiltro.tipo === 'hoje';
  const ehHoje = dataSelecionada === todayISO();

  card.style.borderColor = (filtroEhHoje && ehHoje) ? 'var(--gold)' : '';

  const navegacaoHTML = `
    <div class="flex" style="justify-content:center;align-items:center;gap:10px;margin-bottom:12px;">
      <button class="btn btn-sm btn-ghost" id="btn-relatorio-dia-anterior" title="Dia anterior">◀</button>
      <input type="date" id="input-relatorio-data" value="${dataSelecionada}" max="${todayISO()}" style="text-align:center;">
      <button class="btn btn-sm btn-ghost" id="btn-relatorio-dia-seguinte" title="Próximo dia" ${ehHoje ? 'disabled' : ''}>▶</button>
      ${!ehHoje ? `<button class="btn btn-sm btn-ghost" id="btn-relatorio-hoje">Hoje</button>` : ''}
    </div>
  `;

  if (!materias.length) {
    card.innerHTML = `
      <div class="card-title">🗓️ Relatório diário de estudos — ${toBRDate(dataSelecionada)}</div>
      ${navegacaoHTML}
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        ${ehHoje
          ? 'Nenhuma sessão do Ciclo de Estudos ou tentativa de questões registrada hoje ainda. Assim que você estudar algo ou lançar questões, o resumo do dia aparece aqui, matéria por matéria.'
          : 'Nenhuma sessão do Ciclo de Estudos ou tentativa de questões registrada nesse dia.'}
      </p>
      <div style="margin-top:10px;text-align:right;">
        <button class="btn btn-sm btn-ghost" id="btn-relatorio-add-materia" title="Lançar manualmente tempo ou questões desse dia">
          + Adicionar matéria
        </button>
      </div>
    `;
    _wireRelatorioDiarioNav();
    _wireRelatorioEdicao(dataSelecionada);
    return;
  }

  card.innerHTML = `
    <div class="card-title">🗓️ Relatório diário de estudos — ${toBRDate(dataSelecionada)}</div>
    ${navegacaoHTML}
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;margin-bottom:14px;">
      Combina automaticamente as sessões do Ciclo de Estudos e as tentativas de questões registradas nesse dia, por matéria.
      ${filtroEhHoje && ehHoje
        ? 'O filtro de período acima está em "Hoje" — os cartões de resumo no topo mostram os mesmos totais.'
        : 'Este resumo é referente ao dia selecionado acima, independente do filtro de período escolhido no topo do Dashboard.'}
    </p>

    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-bottom:16px;">
      <div class="stat-card info"><div class="label">Tempo total no dia</div><div class="value" style="font-size:20px;">${_formatarMinutos(totais.minutos)}</div></div>
      <div class="stat-card"><div class="label">Questões no dia</div><div class="value" style="font-size:20px;">${totais.numQuestoes}</div></div>
      <div class="stat-card success"><div class="label">Certas</div><div class="value" style="font-size:20px;">${totais.acertos}</div></div>
      <div class="stat-card danger"><div class="label">Erradas</div><div class="value" style="font-size:20px;">${totais.erros}</div></div>
      <div class="stat-card"><div class="label">Em branco</div><div class="value" style="font-size:20px;">${totais.brancos}</div></div>
      <div class="stat-card gold"><div class="label">Taxa de acerto</div><div class="value" style="font-size:20px;">${fmtPct(totais.taxa)}</div></div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Matéria</th>
            <th>Tópico(s)</th>
            <th>Tipo(s) de estudo</th>
            <th>Tempo</th>
            <th>Questões</th>
            <th>Certas / Erradas / Em branco</th>
            <th>Taxa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${materias.map(g => `
            <tr>
              <td style="white-space:normal;font-weight:600;">${escapeHtml(g.nome)}</td>
              <td style="white-space:normal;max-width:220px;">${g.topicos.length ? g.topicos.map(tp => escapeHtml(tp)).join(', ') : '<span class="text-muted">-</span>'}</td>
              <td style="white-space:normal;max-width:200px;">${g.tipos.length ? g.tipos.map(tp => `<span class="badge muted" style="margin:2px 4px 2px 0;display:inline-block;">${escapeHtml(tp)}</span>`).join('') : '<span class="text-muted">-</span>'}</td>
              <td class="num">${g.minutos > 0 ? _formatarMinutos(g.minutos) : '-'}</td>
              <td class="num">${g.numQuestoes || '-'}</td>
              <td class="num">${g.numQuestoes ? `<span style="color:var(--success)">${g.acertos}</span> / <span style="color:var(--danger)">${g.erros}</span> / <span class="text-muted">${g.brancos}</span>` : '-'}</td>
              <td>
                ${g.numQuestoes ? `
                  <div class="pct-bar-wrap">
                    <div class="pct-bar"><span style="width:${g.taxa.toFixed(1)}%"></span></div>
                    <span class="num">${fmtPct(g.taxa)}</span>
                  </div>
                ` : '<span class="text-muted">-</span>'}
              </td>
              <td>
                <button class="btn btn-sm btn-ghost relatorio-edit-btn" data-materia="${escapeHtml(g.nome)}" data-data="${dataSelecionada}" title="Adicionar/corrigir tempo ou questões desta matéria neste dia">
                  ✏️
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:10px;text-align:right;">
      <button class="btn btn-sm btn-ghost" id="btn-relatorio-add-materia" title="Adicionar uma matéria que não está na lista">
        + Adicionar matéria
      </button>
    </div>
  `;
  _wireRelatorioDiarioNav();
  _wireRelatorioEdicao(dataSelecionada);
}

/** Abre modal para adicionar/corrigir tempo ou questões de uma matéria no dia. */
async function _abrirModalEdicaoRelatorio(nomeMateria, dataISO) {
  const norm = s => (s || '').trim().toLowerCase();

  // Sessões de ciclo existentes dessa matéria nesse dia
  const sessoesExistentes = (state.cicloSessoes || []).filter(
    s => s.data === dataISO && norm(s.nome) === norm(nomeMateria)
  );

  // Tentativas existentes dessa matéria nesse dia
  const tentativasExistentes = (state.tentativas || []).filter(
    t => t.data === dataISO && norm(t.disciplina) === norm(nomeMateria)
  );

  const totalMinutos = sessoesExistentes.reduce((s, ss) => s + (Number(ss.minutos) || 0), 0);

  openModal(`
    <h2>✏️ Editar: ${escapeHtml(nomeMateria)}</h2>
    <p class="text-muted" style="font-size:13px;margin-top:0;">${toBRDate(dataISO)}</p>

    ${sessoesExistentes.length ? `
    <div class="card mb-12" style="background:var(--surface-2);">
      <div class="card-title" style="font-size:13.5px;">⏱ Sessões registradas — ${_formatarMinutos(totalMinutos)} total</div>
      ${sessoesExistentes.map((s, i) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border);display:grid;gap:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span style="font-size:13px;font-weight:600;">${_formatarMinutos(s.minutos || 0)}${s.topico ? ` — ${escapeHtml(s.topico)}` : ''}</span>
            <span style="font-size:11.5px;color:var(--text-muted);">${s.ajusteManual ? 'lançamento manual' : 'ciclo de estudos'}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select class="sel-tipo-sessao" data-sessao-idx="${i}" style="flex:1;min-width:140px;font-size:13px;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);">
              <option value="">Não informado</option>
              <option value="Primeiro estudo" ${s.tipoEstudo==='Primeiro estudo'?'selected':''}>Primeiro estudo</option>
              <option value="Revisão" ${s.tipoEstudo==='Revisão'?'selected':''}>Revisão</option>
              <option value="Vídeo" ${s.tipoEstudo==='Vídeo'?'selected':''}>Vídeo</option>
              <option value="Leitura" ${s.tipoEstudo==='Leitura'?'selected':''}>Leitura</option>
              <option value="Exercícios" ${s.tipoEstudo==='Exercícios'?'selected':''}>Exercícios</option>
              <option value="Simulado" ${s.tipoEstudo==='Simulado'?'selected':''}>Simulado</option>
              <option value="PDF" ${s.tipoEstudo==='PDF'?'selected':''}>PDF</option>
            </select>
            <button class="btn btn-sm btn-ghost btn-salvar-tipo-sessao" data-sessao-idx="${i}" style="white-space:nowrap;">Salvar</button>
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div class="card mb-12" style="background:var(--surface-2);">
      <div class="card-title" style="font-size:13.5px;">➕ Adicionar / corrigir tempo</div>
      <div class="form-row" style="margin-top:10px;">
        <label>Adicionar tempo (em minutos)</label>
        <input type="number" id="rel-edit-minutos-add" min="1" placeholder="Ex: 30">
      </div>
      <div class="form-row">
        <label>Ou corrigir o total (minutos)</label>
        <input type="number" id="rel-edit-minutos-total" min="0" placeholder="Ex: 90 (substitui o total atual)">
      </div>
      <div class="form-row">
        <label>Tópico estudado (opcional)</label>
        <input type="text" id="rel-edit-topico" placeholder="Ex: Espécies Tributárias">
      </div>
      <div class="form-row">
        <label>Tipo de estudo (opcional)</label>
        <select id="rel-edit-tipo">
          <option value="">Não informar</option>
          <option value="Primeiro estudo">Primeiro estudo</option>
          <option value="Revisão">Revisão</option>
          <option value="Vídeo">Vídeo</option>
          <option value="Leitura">Leitura</option>
          <option value="Exercícios">Exercícios</option>
          <option value="Simulado">Simulado</option>
          <option value="PDF">PDF</option>
        </select>
      </div>
      <button class="btn btn-primary mt-8" id="btn-rel-salvar-tempo">Salvar tempo</button>
    </div>

    ${tentativasExistentes.length ? `
    <div class="card" style="background:var(--surface-2);">
      <div class="card-title" style="font-size:13.5px;">📝 Tentativas de questões registradas</div>
      ${tentativasExistentes.map(t => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);gap:10px;">
          <span style="font-size:13px;">${escapeHtml(t.assunto || '(sem tópico)')} — ${t.numQuestoes} questões (${fmtPct(t.taxa)})</span>
          <button class="btn btn-sm btn-ghost" data-editar-tentativa="${t.id}">Editar</button>
        </div>
      `).join('')}
    </div>
    ` : ''}
  `);

  // Salvar tipo de estudo de sessão existente
  $$('.btn-salvar-tipo-sessao').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx  = Number(btn.dataset.sessaoIdx);
      const s    = sessoesExistentes[idx];
      const sel  = $(`.sel-tipo-sessao[data-sessao-idx="${idx}"]`);
      const tipo = sel?.value || null;
      if (!s) return;
      btn.disabled = true;
      btn.textContent = '…';
      await db.cicloSessoes.update({ ...s, tipoEstudo: tipo || null });
      closeModal();
      await reloadState();
      renderRelatorioDiario();
      showToast('Tipo de estudo atualizado.', 'success');
    });
  });

  // Salvar tempo
  $('#btn-rel-salvar-tempo')?.addEventListener('click', async () => {
    const adicionar = Number($('#rel-edit-minutos-add')?.value || 0);
    const total     = Number($('#rel-edit-minutos-total')?.value || -1);
    const topico    = $('#rel-edit-topico')?.value.trim() || null;
    const tipo      = $('#rel-edit-tipo')?.value || null;

    if (adicionar <= 0 && total < 0) {
      showToast('Informe quantos minutos adicionar ou o total correto.', 'error');
      return;
    }

    let minutosNovas;
    if (total >= 0) {
      // Corrigir: calcula a diferença para ajustar o cicloMateria
      minutosNovas = total - totalMinutos;
    } else {
      minutosNovas = adicionar;
    }

    // Cria uma sessão manual para o dia e matéria informados
    const materia = (state.cicloMaterias || []).find(m =>
      norm(m.nome) === norm(nomeMateria)
    );
    await db.cicloSessoes.add({
      cicloMateriaId: materia ? materia.id : null,
      nome: nomeMateria,
      data: dataISO,
      minutos: minutosNovas,
      inicio: new Date(`${dataISO}T12:00:00`).toISOString(),
      fim:    new Date(`${dataISO}T12:00:00`).toISOString(),
      ajusteManual: true,
      ...(topico ? { topico } : {}),
      ...(tipo   ? { tipoEstudo: tipo } : {})
    });

    // Atualiza minutosFeitos do cicloMateria se existir
    if (materia && minutosNovas !== 0) {
      materia.minutosFeitos = Math.max(0, (materia.minutosFeitos || 0) + minutosNovas);
      await db.cicloMaterias.update(materia);
    }

    closeModal();
    await reloadState();
    renderRelatorioDiario();
    showToast('Tempo atualizado no relatório.', 'success');
  });

  // Editar tentativa existente
  $$('[data-editar-tentativa]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = state.tentativas.find(x => x.id === Number(btn.dataset.editarTentativa));
      if (!t) return;
      closeModal();
      openTentativaModal(t);
    });
  });
}

function _wireRelatorioEdicao(dataSelecionada) {
  $$('.relatorio-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _abrirModalEdicaoRelatorio(btn.dataset.materia, btn.dataset.data);
    });
  });

  $('#btn-relatorio-add-materia')?.addEventListener('click', () => {
    const nome = prompt('Nome da matéria a adicionar no relatório deste dia:');
    if (!nome || !nome.trim()) return;
    _abrirModalEdicaoRelatorio(nome.trim(), dataSelecionada);
  });
}

/** Conecta as setas de navegação e o campo de data do relatório diário —
 *  qualquer mudança só re-renderiza esse card específico, sem recarregar
 *  o resto do Dashboard. */
function _wireRelatorioDiarioNav() {
  const somarDias = (iso, n) => {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toISODate(d);
  };

  $('#btn-relatorio-dia-anterior')?.addEventListener('click', () => {
    _relatorioDiarioData = somarDias(_relatorioDiarioData, -1);
    renderRelatorioDiario();
  });
  $('#btn-relatorio-dia-seguinte')?.addEventListener('click', () => {
    if (_relatorioDiarioData >= todayISO()) return;
    _relatorioDiarioData = somarDias(_relatorioDiarioData, 1);
    renderRelatorioDiario();
  });
  $('#btn-relatorio-hoje')?.addEventListener('click', () => {
    _relatorioDiarioData = todayISO();
    renderRelatorioDiario();
  });
  $('#input-relatorio-data')?.addEventListener('change', (e) => {
    if (e.target.value) {
      _relatorioDiarioData = e.target.value;
      renderRelatorioDiario();
    }
  });
}

/**
 * Card "O que revisar agora" — cruza, para cada disciplina de cada ciclo
 * ativo: peso no edital, taxa de acerto (só do concurso daquele ciclo) e
 * dias desde a última vez que foi estudada. Disciplinas NUNCA estudadas
 * vêm sempre no topo (são a prioridade máxima); as demais são ordenadas
 * por um score de urgência: peso × (100 − taxa) × dias sem revisar.
 */
function renderPrioridadeRevisao() {
  const card = $('#card-prioridade-revisao');
  if (!card) return;

  const norm = (s) => (s || '').trim().toLowerCase();
  const hoje = todayISO();
  const materias = state.cicloMaterias || [];

  if (!materias.length) {
    card.innerHTML = `
      <div class="card-title">📌 O que revisar agora</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">Crie um Ciclo de Estudos com suas disciplinas para ver a prioridade de revisão aqui.</p>
    `;
    return;
  }

  const nuncaEstudadas = [];
  const paraCalcular = [];

  materias.forEach(m => {
    const ciclo = state.ciclos.find(c => c.id === m.cicloId);
    const nomeCiclo = ciclo ? ciclo.nome : '';

    const sessoesDaMateria = state.cicloSessoes.filter(s => s.cicloMateriaId === m.id && (s.minutos || 0) > 0);
    const tentativasDaMateria = state.tentativas.filter(t =>
      _materiaCasaComDisciplina(m, t.disciplina) &&
      (nomeCiclo ? norm(t.concurso) === norm(nomeCiclo) : true)
    );
    const totalQuestoes = tentativasDaMateria.reduce((s, t) => s + (t.numQuestoes || 0), 0);
    const totalAcertos = tentativasDaMateria.reduce((s, t) => s + (t.acertos || 0), 0);

    // "Já estudada" considera QUALQUER evidência: tempo no Ciclo de Estudos
    // OU questões já registradas para essa disciplina (mesmo sem ter usado
    // o cronômetro do ciclo nem uma vez).
    const jaEstudou = sessoesDaMateria.length > 0 || m.minutosFeitos > 0 || totalQuestoes > 0;

    if (!jaEstudou) {
      nuncaEstudadas.push({ materia: m, nomeCiclo });
      return;
    }

    const taxa = totalQuestoes > 0 ? (totalAcertos / totalQuestoes) * 100 : 50; // sem dados = neutro

    // "Há quanto tempo não revisa" olha a data mais recente entre sessões
    // do ciclo E tentativas — o que tiver acontecido por último conta.
    const datasSessoes = sessoesDaMateria.map(s => s.data).filter(Boolean);
    const datasTentativas = tentativasDaMateria.map(t => t.data).filter(Boolean);
    const ultimaData = [...datasSessoes, ...datasTentativas].sort().pop() || null;
    const diasSemRevisar = ultimaData
      ? Math.max(0, Math.round((new Date(hoje) - new Date(ultimaData)) / 86400000))
      : 30; // fallback (não deveria cair aqui, já que jaEstudou é true)

    // Urgência usa pelo menos 1 "dia" no cálculo do score (revisar hoje ainda
    // conta como pouco urgente, mas não zera o score de disciplinas de peso alto).
    // Estudado hoje ainda conta pra urgência (uma disciplina fraca não vira
    // forte só por ter sido revisada uma vez), mas com um peso bem menor do
    // que um dia inteiro sem revisar — evita empatar "estudei há 5 minutos"
    // com "estudei ontem".
    const fatorDias = diasSemRevisar === 0 ? 0.3 : diasSemRevisar;
    const urgencia = (m.peso || 1) * (100 - taxa) * fatorDias;

    paraCalcular.push({ materia: m, nomeCiclo, taxa, totalQuestoes, diasSemRevisar, urgencia });
  });

  paraCalcular.sort((a, b) => b.urgencia - a.urgencia);
  const nuncaEstudadasOrdenadas = nuncaEstudadas.sort((a, b) => (b.materia.peso || 0) - (a.materia.peso || 0));

  if (!paraCalcular.length && !nuncaEstudadasOrdenadas.length) {
    card.innerHTML = `
      <div class="card-title">📌 O que revisar agora</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">Tudo em dia por aqui!</p>
    `;
    return;
  }

  const linhaJaEstudada = (item, i) => {
    const m = item.materia;
    return `
      <div class="flex" style="justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);gap:10px;">
        <div>
          <strong>${i + 1}. ${escapeHtml(m.nome)}</strong>
          <div class="text-muted" style="font-size:12px;">
            ${item.nomeCiclo ? escapeHtml(item.nomeCiclo) + ' · ' : ''}peso ${m.peso} ·
            ${item.totalQuestoes > 0 ? `${fmtPct(item.taxa)} de acerto` : 'sem questões registradas'} ·
            ${item.diasSemRevisar === 0 ? 'estudada hoje' : `há ${item.diasSemRevisar} dia${item.diasSemRevisar === 1 ? '' : 's'} sem revisar`}
          </div>
        </div>
      </div>
    `;
  };

  const linhaNuncaEstudada = (item) => `
    <div class="flex" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);gap:10px;">
      <span>${escapeHtml(item.materia.nome)}</span>
      <span class="text-muted" style="font-size:12px;">${item.nomeCiclo ? escapeHtml(item.nomeCiclo) + ' · ' : ''}peso ${item.materia.peso}</span>
    </div>
  `;

  card.innerHTML = `
    <div class="card-title">📌 O que revisar agora</div>
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">Combina peso no edital, taxa de acerto e há quanto tempo você não revisa cada disciplina.</p>
    ${paraCalcular.length ? `
      <div>${paraCalcular.slice(0, 8).map(linhaJaEstudada).join('')}</div>
    ` : `<p class="text-muted" style="font-size:13px;">Nenhuma disciplina já estudada com dado suficiente pra calcular urgência ainda.</p>`}
    ${nuncaEstudadasOrdenadas.length ? `
      <div class="mt-12" style="font-size:12.5px;font-weight:700;color:var(--danger);">⚠ Ainda não estudadas (${nuncaEstudadasOrdenadas.length})</div>
      <div class="mt-4">${nuncaEstudadasOrdenadas.map(linhaNuncaEstudada).join('')}</div>
    ` : ''}
  `;
}

/** Card do Dashboard com o tempo total (todos os ciclos, todo o histórico)
 *  gasto em cada tipo de estudo (Exercícios, Revisão, Vídeo, etc.), vindo
 *  do Ciclo de Estudos — NÃO das tentativas/questões. É a soma geral, sem
 *  filtro de período nem de "hoje". */
function renderTempoPorTipoCicloDashboard() {
  const card = $('#card-tempo-por-tipo-ciclo');
  if (!card) return;

  const totais = {};
  state.cicloSessoes.forEach(s => {
    const tipo = s.tipoEstudo || 'Não informado';
    totais[tipo] = (totais[tipo] || 0) + (s.minutos || 0);
  });
  const lista = Object.entries(totais)
    .filter(([, minutos]) => minutos > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!lista.length) {
    card.innerHTML = `
      <div class="card-title">Tempo por tipo de estudo (Ciclo de Estudos)</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Ainda não há sessões do Ciclo de Estudos com tipo registrado. Essa análise soma o
        tempo de todos os ciclos e todo o histórico — não usa os registros de tentativas/questões.
      </p>
    `;
    return;
  }

  const totalGeral = lista.reduce((soma, [, minutos]) => soma + minutos, 0);
  card.innerHTML = `
    <div class="card-title">Tempo por tipo de estudo (Ciclo de Estudos)</div>
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">Soma de todos os ciclos, todo o histórico — baseado no Ciclo de Estudos, não nas tentativas.</p>
    <div class="chart-wrap" style="max-width:280px;margin:8px auto;"><canvas id="chart-tipo-estudo-dashboard"></canvas></div>
    <div class="mt-8">
      ${lista.map(([tipo, minutos], i) => `
        <div class="flex" style="justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border);">
          <span>
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${_CORES_TIPO_ESTUDO[i % _CORES_TIPO_ESTUDO.length]};margin-right:7px;"></span>
            ${escapeHtml(tipo)}
          </span>
          <span class="text-muted">${_formatarMinutos(minutos)} · ${fmtPct((minutos / totalGeral) * 100)}</span>
        </div>
      `).join('')}
    </div>
  `;

  renderStatusDoughnutChart('chart-tipo-estudo-dashboard', {
    labels: lista.map(([tipo]) => tipo),
    values: lista.map(([, minutos]) => Math.round(minutos)),
    colors: lista.map((_, i) => _CORES_TIPO_ESTUDO[i % _CORES_TIPO_ESTUDO.length])
  });
}

/** Seção "Estatísticas por disciplina" da Dashboard — tem seu próprio filtro
 *  de período (mesmo componente de chips + data usado no resto da Dashboard)
 *  e um filtro de disciplina. Atualiza sozinha, sem re-renderizar o resto
 *  da página (gráficos e cards existentes não são tocados). */
function renderStatsPorDisciplina() {
  const card = $('#card-stats-disciplina');
  if (!card) return;

  const filtro = state.statsDisciplinaFiltro;
  const { inicio, fim } = resolverPeriodo(filtro);
  const listaPeriodo = filtrarTentativasPorPeriodo(inicio, fim);
  const listaFiltrada = filtro.disciplina === 'todas'
    ? listaPeriodo
    : listaPeriodo.filter(t => _norm(t.disciplina) === _norm(filtro.disciplina));

  const porDisciplina = agruparPor(listaFiltrada, 'disciplina'); // já vem ordenado por total desc
  const disciplinasDisponiveis = valoresUnicos('disciplina');

  card.innerHTML = `
    <div class="card-title">Estatísticas por disciplina</div>

    <div class="filter-bar" id="stats-disc-filters" style="margin-top:14px;">
      ${['hoje', '7d', '30d', '90d', 'tudo', 'custom'].map(t => `
        <button class="chip ${filtro.tipo === t ? 'active' : ''}" data-filtro="${t}">
          ${{hoje:'Hoje', '7d':'Últimos 7 dias', '30d':'Últimos 30 dias', '90d':'Últimos 90 dias', tudo:'Tudo', custom:'Personalizado'}[t]}
        </button>
      `).join('')}
      <div id="stats-disc-custom-range" style="display:${filtro.tipo === 'custom' ? 'flex' : 'none'};gap:8px;align-items:center;">
        <input type="date" id="stats-disc-inicio" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.inicio || daysAgoISO(6)}">
        <span class="text-muted">até</span>
        <input type="date" id="stats-disc-fim" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.fim || todayISO()}">
      </div>
      <select class="status-select" id="stats-disc-select" style="margin-left:auto;">
        <option value="todas" ${filtro.disciplina === 'todas' ? 'selected' : ''}>Todas as disciplinas</option>
        ${disciplinasDisponiveis.map(d => `<option value="${escapeHtml(d)}" ${filtro.disciplina === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
      </select>
    </div>

    <div class="table-wrap">
      ${porDisciplina.length ? `
        <table>
          <thead>
            <tr><th>Disciplina</th><th>Certas</th><th>Erradas</th><th>Em branco</th><th>Total</th><th>%</th></tr>
          </thead>
          <tbody>
            ${porDisciplina.map(d => `
              <tr>
                <td>${escapeHtml(d.nome)}</td>
                <td class="num" style="color:var(--success)">${d.certas}</td>
                <td class="num" style="color:var(--danger)">${d.erradas}</td>
                <td class="num text-muted">${d.brancos}</td>
                <td class="num">${d.total}</td>
                <td class="num" style="font-weight:700;">${fmtPct(d.taxa)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : `<p class="text-muted" style="font-size:13.5px;">Nenhuma tentativa registrada nesse período.</p>`}
    </div>
  `;

  $$('#stats-disc-filters .chip', card).forEach(chip => {
    chip.addEventListener('click', () => {
      state.statsDisciplinaFiltro.tipo = chip.dataset.filtro;
      renderStatsPorDisciplina();
    });
  });
  const inicioInput = $('#stats-disc-inicio', card);
  const fimInput = $('#stats-disc-fim', card);
  if (inicioInput) inicioInput.addEventListener('change', () => {
    state.statsDisciplinaFiltro.tipo = 'custom';
    state.statsDisciplinaFiltro.inicio = inicioInput.value;
    renderStatsPorDisciplina();
  });
  if (fimInput) fimInput.addEventListener('change', () => {
    state.statsDisciplinaFiltro.tipo = 'custom';
    state.statsDisciplinaFiltro.fim = fimInput.value;
    renderStatsPorDisciplina();
  });
  $('#stats-disc-select', card).addEventListener('change', (e) => {
    state.statsDisciplinaFiltro.disciplina = e.target.value;
    renderStatsPorDisciplina();
  });
}

/* ============================================================
   TELA: TENTATIVAS (lista + CRUD do novo modelo por blocos)
   ============================================================ */

let _tentativasBusca = '';

function renderTentativas(view) {
  view.innerHTML = `
    <div class="toolbar">
      <input type="text" class="search-input" id="busca-tentativas" placeholder="Pesquisar por disciplina, assunto, banca ou concurso..." value="${escapeHtml(_tentativasBusca)}">
      <button class="btn" id="btn-registrar-erro-tentativas">📝 Registrar erro</button>
      <button class="btn btn-primary" id="btn-nova-tentativa"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg> Registrar tentativa</button>
    </div>
    <div id="lista-tentativas"></div>
  `;

  $('#btn-nova-tentativa').addEventListener('click', () => openTentativaModal());
  $('#btn-registrar-erro-tentativas').addEventListener('click', () => {
    if (typeof abrirModalRegistrarErro === 'function') abrirModalRegistrarErro({ origem: 'tentativas' });
  });
  const buscaInput = $('#busca-tentativas');
  buscaInput.addEventListener('input', () => {
    _tentativasBusca = buscaInput.value;
    renderTabelaTentativas();
  });

  renderTabelaTentativas();

  function renderTabelaTentativas() {
    const termo = _tentativasBusca.trim().toLowerCase();
    let lista = [...state.tentativas].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    if (termo) {
      lista = lista.filter(t =>
        [t.disciplina, t.assunto, t.banca, t.concurso].some(v => (v || '').toLowerCase().includes(termo))
      );
    }

    const wrap = $('#lista-tentativas');
    if (!lista.length) {
      wrap.innerHTML = termo
        ? `<div class="empty-state">
            <p>Nenhuma tentativa encontrada para "${escapeHtml(_tentativasBusca.trim())}".</p>
            <p class="text-muted" style="font-size:13px;">Verifique a grafia ou limpe a busca para ver todas as tentativas.</p>
          </div>`
        : `<div class="empty-state">
            <p>Nenhuma tentativa registrada ainda.</p>
            <button class="btn btn-primary" id="empty-add-tentativa">Registrar primeira tentativa</button>
          </div>`;
      $('#empty-add-tentativa')?.addEventListener('click', () => openTentativaModal());
      return;
    }

    wrap.innerHTML = `
      <div class="tentativas-lista">
        ${lista.map(t => `
          <div class="tentativa-card">
            <div class="tentativa-card-topo">
              <div>
                <div class="tentativa-card-disciplina">${escapeHtml(t.disciplina) || '-'}</div>
                <div class="tentativa-card-assunto">${escapeHtml(t.assunto) || '-'}</div>
              </div>
              <span class="badge muted">${escapeHtml(t.tipo) || '-'}</span>
            </div>
            <div class="tentativa-card-meta">
              <span>${toBRDate(t.data)}</span>
              ${t.banca ? `<span>${escapeHtml(t.banca)}</span>` : ''}
              ${t.concurso ? `<span>${escapeHtml(t.concurso)}</span>` : ''}
            </div>
            <div class="tentativa-card-stats">
              <span>${t.numQuestoes} questões</span>
              <span style="color:var(--success)">${t.acertos} certas</span>
              <span style="color:var(--danger)">${t.erros} erradas</span>
              <span class="tentativa-card-taxa">${fmtPct(t.taxa)}</span>
            </div>
            ${t.observacoes ? `<div class="tentativa-card-obs">${escapeHtml(t.observacoes)}</div>` : ''}
            <div class="tentativa-card-acoes">
              <button class="btn btn-sm" data-edit="${t.id}">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
                Editar
              </button>
              <button class="btn btn-sm btn-ghost" data-del="${t.id}">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 7h12l-1 14H7zM9 4h6l1 2H8zM9 10v8M12 10v8M15 10v8"/></svg>
                Excluir
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    $$('[data-edit]', wrap).forEach(btn => btn.addEventListener('click', () => {
      const t = state.tentativas.find(x => x.id === Number(btn.dataset.edit));
      openTentativaModal(t);
    }));
    $$('[data-del]', wrap).forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta tentativa?')) return;
      await db.tentativas.remove(Number(btn.dataset.del));
      await reloadState();
      renderTabelaTentativas();
      updateStreakMini();
      showToast('Tentativa excluída.', 'danger');
    }));
  }
}

/** Liga uma lista de sugestões clicável a um <input>, dentro do
 *  .autocomplete-wrap que o envolve. Mais confiável que <datalist>,
 *  que no Chrome para Android costuma não exibir sugestão nenhuma.
 *  `valoresOuFn` pode ser um array fixo ou uma função sem argumentos que
 *  devolve o array na hora (usado quando a lista depende de outro campo,
 *  como Assunto depender da Disciplina escolhida). */
function attachAutocomplete(input, valoresOuFn) {
  const wrap = input.closest('.autocomplete-wrap');

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'autocomplete-toggle';
  toggleBtn.setAttribute('aria-label', 'Mostrar opções');
  toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';
  wrap.appendChild(toggleBtn);

  const lista = document.createElement('div');
  lista.className = 'autocomplete-list';
  wrap.appendChild(lista);

  function renderSugestoes(forcarLista = false) {
    const valores = typeof valoresOuFn === 'function' ? valoresOuFn() : valoresOuFn;
    const termo = forcarLista ? '' : input.value.trim().toLowerCase();
    const filtradas = termo
      ? valores.filter(v => v.toLowerCase().includes(termo) && v.toLowerCase() !== termo)
      : valores;

    if (!filtradas.length) {
      lista.classList.remove('show');
      lista.innerHTML = '';
      return;
    }

    lista.innerHTML = filtradas.slice(0, 30)
      .map(v => `<div class="autocomplete-item">${escapeHtml(v)}</div>`)
      .join('');
    lista.classList.add('show');
  }

  input.addEventListener('focus', () => renderSugestoes());
  input.addEventListener('click', () => renderSugestoes());
  input.addEventListener('input', () => renderSugestoes());

  // Botão de seta: sempre mostra a lista completa (sem filtrar pelo texto
  // digitado), funcionando como um "select" — e fecha se já estiver aberta.
  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (lista.classList.contains('show')) {
      lista.classList.remove('show');
    } else {
      input.focus();
      renderSugestoes(true);
    }
  });

  lista.addEventListener('mousedown', (e) => {
    // mousedown (não click) para disparar antes do blur do input
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    input.value = item.textContent;
    lista.classList.remove('show');
    lista.innerHTML = '';
    input.dispatchEvent(new Event('input'));
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      lista.classList.remove('show');
    }
  });
}

/* ---- Modal de cadastro/edição de tentativa ---- */

function openTentativaModal(tentativa = null) {
  const isEdit = !!tentativa;
  const t = tentativa || { data: todayISO(), numQuestoes: '', acertos: '', tipo: TIPOS_TENTATIVA[0] };

  openModal(`
    <h2>${isEdit ? 'Editar tentativa' : 'Registrar tentativa'}</h2>
    <form id="form-tentativa">
      <div class="form-grid-2">
        <div class="form-row">
          <label>Disciplina</label>
          <div class="autocomplete-wrap">
            <input type="text" name="disciplina" autocomplete="off" required value="${escapeHtml(t.disciplina)}" placeholder="Ex: Direito Constitucional">
          </div>
        </div>
        <div class="form-row">
          <label>Assunto</label>
          <div class="autocomplete-wrap">
            <input type="text" name="assunto" autocomplete="off" required value="${escapeHtml(t.assunto)}" placeholder="Ex: Poder Constituinte">
          </div>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Banca (opcional)</label>
          <div class="autocomplete-wrap">
            <input type="text" name="banca" autocomplete="off" value="${escapeHtml(t.banca)}" placeholder="Ex: CESPE/CEBRASPE">
          </div>
        </div>
        <div class="form-row">
          <label>Concurso (opcional)</label>
          <div class="autocomplete-wrap">
            <input type="text" name="concurso" autocomplete="off" value="${escapeHtml(t.concurso)}" placeholder="Ex: PF - Agente">
          </div>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Data</label>
          <input type="date" name="data" required value="${t.data}">
        </div>
        <div class="form-row">
          <label>Tipo da tentativa</label>
          <select name="tipo">
            ${TIPOS_TENTATIVA.map(tp => `<option value="${tp}" ${t.tipo === tp ? 'selected' : ''}>${tp}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Quantidade de questões</label>
          <input type="number" name="numQuestoes" id="input-num-questoes" required min="1" value="${t.numQuestoes ?? ''}" placeholder="Ex: 19">
        </div>
        <div class="form-row">
          <label>Quantidade de acertos</label>
          <input type="number" name="acertos" id="input-acertos" min="0" value="${t.acertos ?? ''}" placeholder="Ex: 14">
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Quantidade de erros</label>
          <input type="number" name="erros" id="input-erros" min="0" value="${isEdit ? (t.numQuestoes - t.acertos) : ''}" placeholder="Ex: 5">
        </div>
        <div class="form-row">
          <label>Taxa de acertos</label>
          <input type="text" id="display-taxa" disabled value="${isEdit ? fmtPct(t.taxa) : ''}">
        </div>
      </div>
      <div class="form-row">
        <label>Observações (opcional)</label>
        <textarea name="observacoes" placeholder="Anotações sobre essa tentativa...">${escapeHtml(t.observacoes)}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="btn-cancelar-tentativa">Cancelar</button>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Salvar alterações' : 'Salvar tentativa'}</button>
      </div>
    </form>
  `);

  const form = $('#form-tentativa');
  const numQuestoesInput = $('#input-num-questoes', form);
  const acertosInput = $('#input-acertos', form);
  const errosInput = $('#input-erros', form);
  const displayTaxa = $('#display-taxa', form);

  attachAutocomplete(form.elements.disciplina, valoresUnicos('disciplina'));
  attachAutocomplete(form.elements.assunto, () => valoresAssuntoParaDisciplina(form.elements.disciplina.value));
  attachAutocomplete(form.elements.banca, valoresUnicos('banca'));
  attachAutocomplete(form.elements.concurso, valoresUnicos('concurso'));

  // Acertos e Erros são dois jeitos de informar o mesmo resultado — o que
  // o usuário digitar por último é usado como referência e o outro campo
  // (e a taxa) são recalculados automaticamente a partir dele.
  function atualizarTaxa() {
    const num = Number(numQuestoesInput.value) || 0;
    const acertos = Number(acertosInput.value) || 0;
    const taxa = num ? (acertos / num) * 100 : 0;
    displayTaxa.value = num ? fmtPct(taxa) : '';
  }

  function aoDigitarAcertos() {
    const num = Number(numQuestoesInput.value) || 0;
    let acertos = Number(acertosInput.value) || 0;
    if (acertos > num) { acertos = num; acertosInput.value = num; }
    errosInput.value = num ? Math.max(0, num - acertos) : '';
    atualizarTaxa();
  }

  function aoDigitarErros() {
    const num = Number(numQuestoesInput.value) || 0;
    let erros = Number(errosInput.value) || 0;
    if (erros > num) { erros = num; errosInput.value = num; }
    acertosInput.value = num ? Math.max(0, num - erros) : '';
    atualizarTaxa();
  }

  numQuestoesInput.addEventListener('input', aoDigitarAcertos);
  acertosInput.addEventListener('input', aoDigitarAcertos);
  errosInput.addEventListener('input', aoDigitarErros);

  $('#btn-cancelar-tentativa').addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const numQuestoes = Number(fd.get('numQuestoes'));
    let acertos = Number(fd.get('acertos'));
    if (acertos > numQuestoes) acertos = numQuestoes;
    const erros = numQuestoes - acertos;
    const taxa = numQuestoes ? (acertos / numQuestoes) * 100 : 0;

    const obj = {
      disciplina: fd.get('disciplina').trim(),
      assunto: fd.get('assunto').trim(),
      banca: fd.get('banca').trim(),
      concurso: fd.get('concurso').trim(),
      data: fd.get('data'),
      numQuestoes,
      acertos,
      erros,
      taxa,
      tipo: fd.get('tipo'),
      observacoes: fd.get('observacoes').trim()
    };

    // Ao REGISTRAR uma nova tentativa (não ao editar), se já existir uma
    // tentativa da mesma disciplina + assunto + tipo no mesmo dia, soma as
    // questões nela em vez de criar um registro separado — assim várias
    // rodadas do mesmo assunto no mesmo dia viram um único registro.
    const existente = !isEdit && state.tentativas.find(x =>
      x.data === obj.data &&
      x.tipo === obj.tipo &&
      x.disciplina.trim().toLowerCase() === obj.disciplina.toLowerCase() &&
      x.assunto.trim().toLowerCase() === obj.assunto.toLowerCase()
    );

    if (existente) {
      const novoNum = existente.numQuestoes + obj.numQuestoes;
      const novoAcertos = existente.acertos + obj.acertos;
      const novoErros = novoNum - novoAcertos;
      const novaTaxa = novoNum ? (novoAcertos / novoNum) * 100 : 0;
      const obsUnidas = [existente.observacoes, obj.observacoes].filter(Boolean).join(' | ');

      await db.tentativas.update({
        ...existente,
        banca: existente.banca || obj.banca,
        concurso: existente.concurso || obj.concurso,
        numQuestoes: novoNum,
        acertos: novoAcertos,
        erros: novoErros,
        taxa: novaTaxa,
        observacoes: obsUnidas
      });
      showToast(`Somado ao registro de hoje: ${novoNum} questões no total.`, 'success');
    } else if (isEdit) {
      await db.tentativas.update({ ...t, ...obj, id: t.id });
      showToast('Tentativa atualizada.', 'success');
    } else {
      await db.tentativas.add(obj);
      showToast('Tentativa registrada.', 'success');
    }
    closeModal();
    await reloadState();
    router();
  });
}

/* ============================================================
   INTEGRAÇÃO COM IA (Firebase AI Logic) — GERAÇÃO DE RESUMO
   ============================================================
   Esta função só monta o prompt e faz o parse da resposta. A CHAMADA em si
   pro Gemini fica isolada em window.chamarGeminiResumo(prompt) — de
   propósito, pra essa tela funcionar (com erro amigável) mesmo antes do
   Firebase AI Logic estar configurado, e pra plugar a IA de verdade não
   exigir mexer em mais nada aqui.

   O que window.chamarGeminiResumo deveria fazer, depois de configurar o
   Firebase AI Logic no Console (provedor "Gemini Developer API", grátis):

     import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
     const ai = getAI(app, { backend: new GoogleAIBackend() }); // 'app' = seu app do Firebase já inicializado
     const model = getGenerativeModel(ai, { model: "gemini-3.1-flash-lite" }); // conferir nome do modelo vigente

     window.chamarGeminiResumo = async function(prompt) {
       const resultado = await model.generateContent(prompt);
       return resultado.response.text();
     };
   ============================================================ */

function _montarPromptResumo({ enunciado, gabaritoOficial, disciplina, assunto }) {
  return `Você é um professor experiente preparando alunos para concurso público. Vai gerar dois resumos sobre o tema da questão abaixo, no estilo de um caderno de estudos — NÃO no formato de flashcard pergunta/resposta.

MATÉRIA: ${disciplina || '(não informado)'}
TÓPICO: ${assunto || '(não informado)'}
QUESTÃO:
${enunciado}

${gabaritoOficial
    ? `GABARITO OFICIAL CONFIRMADO: ${gabaritoOficial}`
    : 'GABARITO: não informado — analise a questão e indique qual alternativa você acredita ser a correta. Isso é só uma sugestão, pode estar errada.'}

Gere:

1. "bruto": explicação COMPLETA e estruturada, no formato abaixo (é o formato que costuma sair melhor pra fixação — siga à risca):

   - Comece com um parágrafo curto direto: **Por que esta é a resposta correta?** seguido da explicação de por que a alternativa certa está certa (base legal/doutrinária/conceitual, sem economizar detalhe).
   - Se a questão for de múltipla escolha (A a E): depois adicione **Por que as outras alternativas estão incorretas?** seguido de uma lista com um item por alternativa errada, cada um começando com "- **LETRA) nome curto da alternativa:** " e a explicação de por que ela está errada.
   - Se a questão for Certo/Errado (Cebraspe): em vez da lista de alternativas, adicione **Por que a afirmação está [certa/errada]?** com uma lista numerada ("1. ", "2. ", "3. "...) dos motivos, cada um com um termo em negrito no início (ex.: "1. **Nome do motivo:** explicação").
   - Feche (em qualquer um dos dois formatos) com um parágrafo iniciado por **Regra de ouro / Resumo prático:** trazendo uma regra prática, mnemônico ou dica de prova sobre o tema, quando fizer sentido existir uma.
   - Use "**texto**" para negrito e "- " ou "N. " pra itens de lista — não use nenhuma outra marcação (sem #, sem \`código\`, sem links). Cada cabeçalho em negrito (ex.: "**Por que esta é a resposta correta?**") deve ficar SOZINHO na própria linha, com uma linha em branco antes e depois dele — nunca na mesma linha do parágrafo que vem a seguir. Separe parágrafos comuns entre si também com uma linha em branco.
   - Não tenha medo de escrever bastante se o tema exigir — não corte informação relevante por medo de ser longo. Escreva como se o aluno nunca tivesse visto o assunto.

2. "condensado": versão ultra-compacta, estilo "Comp. privativa U = art.22 · Comum = art.23 (todos entes) · Concorrente = art.24" — frases curtas separadas por "·", sem pergunta, sem negrito, sem lista, só o essencial pra fixação (esse SIM deve ser curto — é o "bruto" que precisa ser completo e estruturado).
${gabaritoOficial ? '' : '3. "gabaritoSugerido": a letra/valor da alternativa que você acredita ser a correta, ou null se não der pra determinar.'}

Responda SOMENTE em JSON válido, sem markdown fora dos campos, sem texto fora do JSON:
{"bruto": "...", "condensado": "..."${gabaritoOficial ? '' : ', "gabaritoSugerido": "..."'}}`;
}

/** Conversor mínimo e seguro de um subconjunto de markdown pra HTML: negrito
 *  (**texto**), listas com "- " ou "N. ", e parágrafos separados por linha
 *  em branco — é exatamente (e só) o que _montarPromptResumo pede pra IA
 *  gerar. SEMPRE escapa o texto primeiro (escapeHtml) e só depois interpreta
 *  os marcadores nesse texto já escapado — então não existe risco de HTML
 *  ou script vindo da resposta da IA virar HTML de verdade na tela; o pior
 *  caso é um "**" ou "-" sobrando sem formatar. */
function _mdParaHtml(texto) {
  const linhas = escapeHtml(texto || '').split('\n');
  const blocos = [];
  let paragrafoAtual = [];
  let listaAtual = null; // { tipo: 'ul'|'ol', itens: [] }

  const negrito = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/&lt;mark&gt;(.*?)&lt;\/mark&gt;/gi, '<mark>$1</mark>');

  function fecharParagrafo() {
    if (paragrafoAtual.length) {
      blocos.push(`<p>${paragrafoAtual.join(' ')}</p>`);
      paragrafoAtual = [];
    }
  }
  function fecharLista() {
    if (listaAtual) {
      blocos.push(`<${listaAtual.tipo}>${listaAtual.itens.map(i => `<li>${i}</li>`).join('')}</${listaAtual.tipo}>`);
      listaAtual = null;
    }
  }

  linhas.forEach(linhaRaw => {
    const linha = linhaRaw.trim();
    if (!linha) { fecharParagrafo(); fecharLista(); return; }

    const bullet = linha.match(/^-\s+(.*)/);
    const numerado = linha.match(/^\d+\.\s+(.*)/);
    const linhaTodaEmNegrito = linha.match(/^\*\*(.+)\*\*$/); // ex.: "**Por que...?**" sozinho na linha

    if (linhaTodaEmNegrito) {
      // Cabeçalho: fecha o que estava aberto e vira um parágrafo próprio,
      // pra não colar visualmente no texto seguinte.
      fecharParagrafo();
      fecharLista();
      blocos.push(`<p class="md-heading"><strong>${linhaTodaEmNegrito[1]}</strong></p>`);
    } else if (bullet) {
      fecharParagrafo();
      if (!listaAtual || listaAtual.tipo !== 'ul') { fecharLista(); listaAtual = { tipo: 'ul', itens: [] }; }
      listaAtual.itens.push(negrito(bullet[1]));
    } else if (numerado) {
      fecharParagrafo();
      if (!listaAtual || listaAtual.tipo !== 'ol') { fecharLista(); listaAtual = { tipo: 'ol', itens: [] }; }
      listaAtual.itens.push(negrito(numerado[1]));
    } else {
      fecharLista();
      paragrafoAtual.push(negrito(linha));
    }
  });
  fecharParagrafo();
  fecharLista();

  return blocos.join('');
}

/** Chama a IA e devolve { bruto, condensado, gabaritoSugerido }. Lança erro
 *  (com mensagem amigável) se a IA não estiver configurada ou responder em
 *  formato inesperado — quem chama decide como mostrar isso ao usuário. */
async function gerarResumoIA(dados, { onStream } = {}) {
  if (typeof window.chamarGeminiResumo !== 'function') {
    throw new Error('IA ainda não configurada nesse dispositivo (falta configurar o Firebase AI Logic — ver comentário no código).');
  }
  const prompt = _montarPromptResumo(dados);
  let textoResposta;
  if (onStream && typeof window.chamarGeminiResumoStream === 'function') {
    textoResposta = await window.chamarGeminiResumoStream(prompt, onStream);
  } else {
    textoResposta = await window.chamarGeminiResumo(prompt);
  }
  const limpo = String(textoResposta || '').replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(limpo);
  } catch (err) {
    throw new Error('A IA respondeu num formato inesperado. Tente gerar de novo.');
  }
  return {
    bruto: parsed.bruto || '',
    condensado: parsed.condensado || '',
    gabaritoSugerido: parsed.gabaritoSugerido || null
  };
}

/* ============================================================
   TELA: RESOLVER COM IA
   ============================================================
   Fluxo: cola a questão -> IA gera explicação + resumo condensado -> você
   confirma o gabarito (informado ou corrigindo a sugestão da IA) e marca o
   resultado (certa/errada/branco) -> salva. Nada é gravado no banco antes
   dessa confirmação. Sem limite de questões por sessão — o contador do
   rodapé é só informativo, você para quando quiser.
   ============================================================ */

// Dados da matéria/tópico/banca/concurso ficam persistentes entre uma
// questão e outra da mesma sessão (não precisa redigitar a cada questão).
let _resolverIASessao = { disciplina: '', assunto: '', banca: '', concurso: '' };
// Questão atual sendo resolvida: null enquanto não gera nenhum resumo ainda.
let _resolverIAAtual = null;
// Só contagem visual da sessão (não persiste — reseta ao recarregar a página).
let _resolverIAContagem = { certas: 0, erradas: 0, brancos: 0 };
// ID da tentativa agrupada da sessão ativa de Resolver com IA
let _resolverIASessaoTentativaId = null;

function renderResolverIA(view) {
  view.innerHTML = `
    <div class="card mb-12">
      <div class="card-title" style="margin-bottom:12px;">Matéria da questão</div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Disciplina</label>
          <div class="autocomplete-wrap">
            <input type="text" id="ia-disciplina" autocomplete="off" value="${escapeHtml(_resolverIASessao.disciplina)}" placeholder="Ex: Direito Constitucional">
          </div>
        </div>
        <div class="form-row">
          <label>Tópico</label>
          <div class="autocomplete-wrap">
            <input type="text" id="ia-assunto" autocomplete="off" value="${escapeHtml(_resolverIASessao.assunto)}" placeholder="Ex: Organização do Estado">
          </div>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Banca (opcional)</label>
          <div class="autocomplete-wrap">
            <input type="text" id="ia-banca" autocomplete="off" value="${escapeHtml(_resolverIASessao.banca)}" placeholder="Ex: CESPE/CEBRASPE">
          </div>
        </div>
        <div class="form-row">
          <label>Concurso (opcional)</label>
          <div class="autocomplete-wrap">
            <input type="text" id="ia-concurso" autocomplete="off" value="${escapeHtml(_resolverIASessao.concurso)}" placeholder="Ex: TCDF">
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-12">
      <div class="card-title" style="margin-bottom:12px;">Questão</div>
      <div class="form-row">
        <label>Cole aqui o enunciado e as alternativas</label>
        <textarea id="ia-enunciado" rows="14" placeholder="Cole a questão completa...">${escapeHtml(_resolverIAAtual?.enunciado || '')}</textarea>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Gabarito oficial (se já souber) — opcional</label>
          <input type="text" id="ia-gabarito-oficial" value="${escapeHtml(_resolverIAAtual?.gabaritoOficial || '')}" placeholder="Ex: C, ou 'Certo'">
        </div>
        <div class="form-row">
          <label>Sua resposta marcada (opcional)</label>
          <input type="text" id="ia-resposta-marcada" value="${escapeHtml(_resolverIAAtual?.respostaMarcada || '')}" placeholder="Ex: A">
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-gerar-resumo-ia">
        ${_resolverIAAtual?.bruto ? '🔄 Gerar de novo' : '✨ Gerar explicação com IA'}
      </button>
    </div>

    <div id="ia-resultado-wrap"></div>

    <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div class="text-muted" style="font-size:13px;">
        Nesta sessão: <b style="color:var(--text);">${_resolverIAContagem.certas + _resolverIAContagem.erradas + _resolverIAContagem.brancos}</b> questões ·
        <span style="color:var(--success)">${_resolverIAContagem.certas} certas</span> ·
        <span style="color:var(--danger)">${_resolverIAContagem.erradas} erradas</span> ·
        ${_resolverIAContagem.brancos} em branco
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-finalizar-sessao-ia">Finalizar por aqui → ver Caderno</button>
    </div>
  `;

  attachAutocomplete($('#ia-disciplina'), valoresUnicos('disciplina'));
  attachAutocomplete($('#ia-assunto'), () => valoresAssuntoParaDisciplina($('#ia-disciplina').value));
  attachAutocomplete($('#ia-banca'), valoresUnicos('banca'));
  attachAutocomplete($('#ia-concurso'), valoresUnicos('concurso'));

  ['disciplina', 'assunto', 'banca', 'concurso'].forEach(campo => {
    $(`#ia-${campo}`).addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (campo === 'disciplina' && _resolverIASessao.disciplina && val.toLowerCase() !== _resolverIASessao.disciplina.toLowerCase()) {
        // Ao trocar de matéria, zera a contagem e reseta o ID da tentativa agrupada
        _resolverIAContagem = { certas: 0, erradas: 0, brancos: 0 };
        _resolverIASessaoTentativaId = null;
        _resolverIAAtual = null;
      }
      _resolverIASessao[campo] = val;
    });
  });

  $('#btn-finalizar-sessao-ia').addEventListener('click', () => {
    // Ao clicar em finalizar por aqui, zera os contadores e limpa o ID da sessão
    _resolverIAContagem = { certas: 0, erradas: 0, brancos: 0 };
    _resolverIASessaoTentativaId = null;
    _resolverIAAtual = null;
    location.hash = '#/caderno';
  });

  $('#btn-gerar-resumo-ia').addEventListener('click', async () => {
    const enunciado = $('#ia-enunciado').value.trim();
    if (!enunciado) { showToast('Cole o enunciado da questão primeiro.', 'danger'); return; }

    const disciplinaPreenchida = $('#ia-disciplina').value.trim();
    if (!disciplinaPreenchida) {
      showToast('Preencha a Disciplina antes de gerar — sem isso o resumo fica sem matéria no Caderno.', 'danger');
      $('#ia-disciplina').focus();
      return;
    }

    const gabaritoOficial = $('#ia-gabarito-oficial').value.trim();
    const respostaMarcada = $('#ia-resposta-marcada').value.trim();

    // Captura os campos de matéria direto do DOM aqui (não só via listener
    // de 'change') — se o usuário selecionou pelo autocomplete ou clicou
    // direto em "Gerar" sem tirar o foco do campo, o evento 'change' pode
    // não ter disparado ainda, e o re-render que acontece depois de gerar
    // reconstrói o formulário a partir de _resolverIASessao. Sem isso, os
    // campos voltavam vazios ("(Sem matéria)") mesmo com o texto digitado.
    _resolverIASessao = {
      disciplina: $('#ia-disciplina').value.trim(),
      assunto: $('#ia-assunto').value.trim(),
      banca: $('#ia-banca').value.trim(),
      concurso: $('#ia-concurso').value.trim()
    };
    const { disciplina, assunto } = _resolverIASessao;

    const btn = $('#btn-gerar-resumo-ia');
    btn.disabled = true;
    btn.textContent = 'Gerando...';

    // Mostra preview de streaming enquanto a IA responde
    const resultWrap = $('#ia-resultado-wrap');
    resultWrap.innerHTML = `
      <div class="card mb-12" id="ia-streaming-preview">
        <div class="card-title" style="margin-bottom:10px;">
          Gerando explicação…
          <span id="ia-stream-chars" style="font-size:12px;color:var(--text-muted);font-weight:normal;margin-left:6px;"></span>
        </div>
        <div id="ia-stream-text" style="line-height:1.6;font-size:13.5px;color:var(--text);min-height:60px;opacity:0.75;white-space:pre-wrap;"></div>
      </div>
    `;

    // Extrai o campo "bruto" parcialmente do JSON que vai chegando em stream
    function _extrairBrutoStream(raw) {
      const m = raw.match(/"bruto"\s*:\s*"([\s\S]*?)(?="condensado"|$)/);
      if (!m) return null;
      return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    try {
      const ia = await gerarResumoIA({ enunciado, gabaritoOficial, disciplina, assunto }, {
        onStream(acumulado) {
          const charsEl = $('#ia-stream-chars');
          const textEl = $('#ia-stream-text');
          if (!charsEl || !textEl) return;
          charsEl.textContent = `${acumulado.length} caracteres`;
          const parcial = _extrairBrutoStream(acumulado);
          if (parcial) textEl.textContent = parcial;
        }
      });
      _resolverIAAtual = {
        enunciado, gabaritoOficial, respostaMarcada,
        bruto: ia.bruto,
        condensado: ia.condensado,
        gabaritoSugerido: ia.gabaritoSugerido,
        gabaritoConfirmado: gabaritoOficial || ia.gabaritoSugerido || '',
        resultado: null
      };
      renderResolverIA(view);
    } catch (err) {
      showToast(err.message || 'Não foi possível gerar o resumo agora.', 'danger');
      btn.disabled = false;
      btn.textContent = '✨ Gerar explicação com IA';
      resultWrap.innerHTML = '';
    }
  });

  _renderResolverIAResultado(view);
}

function _renderResolverIAResultado(view) {
  const wrap = $('#ia-resultado-wrap');
  if (!wrap || !_resolverIAAtual || !_resolverIAAtual.bruto) { if (wrap) wrap.innerHTML = ''; return; }

  const r = _resolverIAAtual;
  const foiInformado = !!r.gabaritoOficial;

  wrap.innerHTML = `
    <div class="card mb-12">
      <div class="card-title" style="margin-bottom:10px;">Explicação gerada</div>

      ${foiInformado
        ? `<span class="badge success" style="margin-bottom:10px;display:inline-block;">Gabarito informado: ${escapeHtml(r.gabaritoOficial)}</span>`
        : `<span class="badge muted" style="margin-bottom:10px;display:inline-block;">🤖 IA sugere: ${escapeHtml(r.gabaritoSugerido || '—')} (confirme antes de salvar)</span>`
      }

      <div class="texto-resumo-bruto" style="line-height:1.6;font-size:13.5px;color:var(--text);margin:8px 0 14px;">${_mdParaHtml(r.bruto)}</div>

      <div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:13px;margin-bottom:16px;">
        📎 ${escapeHtml(r.condensado)}
      </div>

      <div class="form-grid-2">
        <div class="form-row">
          <label>Gabarito confirmado (obrigatório pra salvar)</label>
          <input type="text" id="ia-gabarito-confirmado" value="${escapeHtml(r.gabaritoConfirmado || '')}" placeholder="Ex: C">
        </div>
        <div class="form-row" style="align-self:flex-end;">
          <button class="btn btn-sm" id="btn-regenerar-com-gabarito">🔄 Regenerar explicação com esse gabarito</button>
        </div>
      </div>

      <div class="form-row">
        <label>Como foi essa questão?</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm ${r.resultado === 'certa' ? 'btn-primary' : ''}" data-resultado="certa">✅ Acertei</button>
          <button class="btn btn-sm ${r.resultado === 'errada' ? 'btn-primary' : ''}" data-resultado="errada">❌ Errei</button>
          <button class="btn btn-sm ${r.resultado === 'branco' ? 'btn-primary' : ''}" data-resultado="branco">⬜ Deixei em branco</button>
        </div>
      </div>

      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-ghost btn-sm" id="btn-descartar-ia">Descartar</button>
        <button class="btn btn-primary btn-sm" id="btn-salvar-ia" ${(!r.resultado) ? 'disabled' : ''}>Salvar e ir pra próxima questão</button>
      </div>
    </div>
  `;

  $$('[data-resultado]', wrap).forEach(btn => btn.addEventListener('click', () => {
    _resolverIAAtual.resultado = btn.dataset.resultado;
    _renderResolverIAResultado(view);
  }));

  $('#ia-gabarito-confirmado').addEventListener('change', (e) => {
    _resolverIAAtual.gabaritoConfirmado = e.target.value.trim();
  });

  $('#btn-regenerar-com-gabarito').addEventListener('click', async () => {
    const gabaritoCorrigido = $('#ia-gabarito-confirmado').value.trim();
    if (!gabaritoCorrigido) { showToast('Informe o gabarito antes de regenerar.', 'danger'); return; }
    const btn = $('#btn-regenerar-com-gabarito');
    btn.disabled = true;
    btn.textContent = 'Regenerando...';
    try {
      const ia = await gerarResumoIA({
        enunciado: r.enunciado,
        gabaritoOficial: gabaritoCorrigido,
        disciplina: $('#ia-disciplina').value.trim(),
        assunto: $('#ia-assunto').value.trim()
      });
      _resolverIAAtual.gabaritoOficial = gabaritoCorrigido;
      _resolverIAAtual.gabaritoConfirmado = gabaritoCorrigido;
      _resolverIAAtual.bruto = ia.bruto;
      _resolverIAAtual.condensado = ia.condensado;
      _renderResolverIAResultado(view);
      showToast('Explicação regenerada.', 'success');
    } catch (err) {
      showToast(err.message || 'Não foi possível regenerar agora.', 'danger');
      btn.disabled = false;
      btn.textContent = '🔄 Regenerar explicação com esse gabarito';
    }
  });

  $('#btn-descartar-ia').addEventListener('click', () => {
    _resolverIAAtual = null;
    renderResolverIA(view);
  });

  $('#btn-salvar-ia').addEventListener('click', async () => {
    const gabaritoConfirmado = $('#ia-gabarito-confirmado').value.trim();
    if (!gabaritoConfirmado) { showToast('Confirme o gabarito antes de salvar.', 'danger'); return; }
    if (!r.resultado) { showToast('Marque se você acertou, errou ou deixou em branco.', 'danger'); return; }

    const disciplina = $('#ia-disciplina').value.trim();
    const assunto = $('#ia-assunto').value.trim();
    const banca = $('#ia-banca').value.trim();
    const concurso = $('#ia-concurso').value.trim();
    const respostaMarcada = $('#ia-resposta-marcada').value.trim();

    const acertosNum = r.resultado === 'certa' ? 1 : 0;
    const errosNum = r.resultado === 'errada' ? 1 : 0;

    // Agrupamento de Tentativas: Atualiza tentativa da sessão se já existir para a mesma matéria
    if (_resolverIASessaoTentativaId) {
      const tentExistente = state.tentativas.find(t => t.id === _resolverIASessaoTentativaId);
      if (tentExistente) {
        const novosAcertos = (tentExistente.acertos || 0) + acertosNum;
        const novosErros = (tentExistente.erros || 0) + errosNum;
        const numQtd = (tentExistente.numQuestoes || 1) + 1;
        const novaTaxa = (novosAcertos + novosErros) ? (novosAcertos / (novosAcertos + novosErros)) * 100 : 0;

        await db.tentativas.update({
          ...tentExistente,
          numQuestoes: numQtd,
          acertos: novosAcertos,
          erros: novosErros,
          taxa: novaTaxa
        });
      } else {
        _resolverIASessaoTentativaId = null;
      }
    }

    if (!_resolverIASessaoTentativaId) {
      _resolverIASessaoTentativaId = await db.tentativas.add({
        disciplina, assunto, banca, concurso,
        data: todayISO(),
        numQuestoes: 1,
        acertos: acertosNum,
        erros: errosNum,
        taxa: (acertosNum + errosNum) ? (acertosNum / (acertosNum + errosNum)) * 100 : 0,
        tipo: 'Sessão Resolver com IA',
        observacoes: '',
        enunciado: r.enunciado,
        resultado: r.resultado,
        respostaMarcada: respostaMarcada || null,
        gabaritoConfirmado
      });
    }

    // Salva o resumo no Caderno com o enunciado gravado diretamente no registro do resumo
    await db.resumos.add({
      tentativaId: _resolverIASessaoTentativaId,
      materia: disciplina,
      topico: assunto,
      data: todayISO(),
      textoBruto: r.bruto,
      textoCondensado: r.condensado,
      enunciado: r.enunciado,
      enviadoAnki: false,
      ankiDeck: null
    });

    // Diagnóstico de Erros (analise-erros.js): toda questão errada aqui já
    // entra sozinha na fila de análise da IA, sem precisar registrar de
    // novo manualmente — é a única tela que já tem enunciado + resposta +
    // gabarito confirmado disponíveis no momento do salvamento.
    if (r.resultado === 'errada' && typeof db.errosQuestoes !== 'undefined') {
      await db.errosQuestoes.add({
        origem: 'resolver_ia',
        tentativaId: _resolverIASessaoTentativaId,
        disciplina, assunto,
        enunciado: r.enunciado,
        alternativaMarcada: respostaMarcada || '',
        gabaritoCorreto: gabaritoConfirmado,
        data: todayISO(),
        analisado: false,
        diagnosticoId: null,
        criadoEm: new Date().toISOString()
      });
    }

    _resolverIAContagem[r.resultado === 'certa' ? 'certas' : r.resultado === 'errada' ? 'erradas' : 'brancos']++;
    _resolverIASessao = { disciplina, assunto, banca, concurso };
    _resolverIAAtual = null;

    await reloadState();
    updateStreakMini();
    showToast('Questão registrada e resumo salvo no Caderno.', 'success');
    renderResolverIA(view);
    $('#ia-enunciado')?.focus();
  });
}

/* ============================================================
   SISTEMA DE MODAIS
   ============================================================ */

function openModal(innerHtml) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function initGlobalModalHandlers() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

window.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  initSidebar();
  initGlobalModalHandlers();

  $('#add-questao-btn').addEventListener('click', () => openTentativaModal());

  await garantirPerfilAtivo();
  initPerfilSelector();

  window.addEventListener('hashchange', router);
  router();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
});
