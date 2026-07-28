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

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Formata Date -> 'YYYY-MM-DD' (usado como chave interna) */
function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Formata 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
function toBRDate(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function todayISO() {
  return toISODate(new Date());
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

function fmtPct(n) {
  if (!isFinite(n)) return "0%";
  return `${n.toFixed(1)}%`;
}

function fmtPctSigned(n) {
  if (!isFinite(n)) return "0 p.p.";
  const sinal = n > 0 ? "+" : "";
  return `${sinal}${n.toFixed(1)} p.p.`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, type = "") {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ============================================================
   CONFIGURAÇÕES LEVES — localStorage
   ============================================================ */

const settings = {
  get theme() {
    return localStorage.getItem("ta_theme") || "dark";
  },
  set theme(v) {
    localStorage.setItem("ta_theme", v);
  },
  get sidebarCollapsed() {
    return localStorage.getItem("ta_sidebar_collapsed") === "1";
  },
  set sidebarCollapsed(v) {
    localStorage.setItem("ta_sidebar_collapsed", v ? "1" : "0");
  },
  // Sessão de estudo em andamento no Ciclo de Estudos: { materiaId, inicio (timestamp ms) } ou null.
  // Fica em localStorage (não sincroniza entre dispositivos) porque é só o estado
  // momentâneo do cronômetro deste aparelho — o tempo já concluído é salvo no banco.
  get cicloSessaoAtiva() {
    const raw = localStorage.getItem("ta_ciclo_sessao_ativa");
    return raw ? JSON.parse(raw) : null;
  },
  set cicloSessaoAtiva(v) {
    if (v) localStorage.setItem("ta_ciclo_sessao_ativa", JSON.stringify(v));
    else localStorage.removeItem("ta_ciclo_sessao_ativa");
  },
};

function applyTheme() {
  document.documentElement.setAttribute("data-theme", settings.theme);
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
  dashboardFiltro: { tipo: "7d", inicio: null, fim: null },
  statsDisciplinaFiltro: {
    tipo: "tudo",
    inicio: null,
    fim: null,
    disciplina: "todas",
  },
};

async function reloadState() {
  const [
    tentativas,
    editais,
    simulados,
    ciclos,
    cicloMaterias,
    cicloSessoes,
    perfis,
    resumos,
  ] = await Promise.all([
    db.tentativas.getAll(),
    db.editais.getAll(),
    db.simulados.getAll(),
    db.ciclos.getAll(),
    db.cicloMaterias.getAll(),
    db.cicloSessoes.getAll(),
    db.perfis.getAll(),
    db.resumos.getAll(),
  ]);
  state.perfis = perfis.sort((a, b) => a.ordem - b.ordem);
  state.ciclos = ciclos.sort((a, b) => a.ordem - b.ordem);
  state.cicloMaterias = cicloMaterias.sort((a, b) => a.ordem - b.ordem);
  state.cicloSessoes = cicloSessoes;
  state.tentativas = tentativas;
  state.editais = editais;
  state.simulados = simulados;
  state.resumos = resumos;
}

/** Disciplinas sugeridas por padrão no autocomplete, mesmo antes de qualquer
 *  tentativa ser registrada com elas. */
const DISCIPLINAS_PADRAO = [
  "Direito Tributário",
  "Contabilidade Geral",
  "Direito Administrativo",
  "Direito Constitucional",
  "Língua Portuguesa",
  "Raciocínio Lógico / Matemática",
  "Noções de Informática",
  "Legislação Tributária Municipal",
  "Auditoria",
  "Administração",
  "Noções de Legislação",
  "Estatística",
  "Matemática Financeira",
  "Análise de Dados",
  "Inteligência Artificial",
  "Direito Penal",
  "Economia",
  "Administração Pública",
  "Administração Financeira e Orçamentária",
  "Contabilidade Pública",
  "Controle Externo",
  "Auditoria Governamental",
  "Tecnologia da Informação",
  "Ética no Serviço Público",
  "Lei Orgânica do Distrito Federal",
  "Regime Jurídico dos Servidores do DF",
  "Conhecimentos sobre o Distrito Federal",
  "Política para Mulheres",
  "Primeiros Socorros",
];

/** Tópicos sugeridos por padrão para cada disciplina (chave = nome exato
 *  da disciplina em DISCIPLINAS_PADRAO). Preencha aqui conforme for
 *  passando as listas — o app já funciona sem isso, usando o histórico. */
const TOPICOS_PADRAO = {
  "Língua Portuguesa": [
    "Interpretação de textos",
    "Tipologia textual",
    "Ortografia",
    "Acentuação",
    "Classes de palavras",
    "Sintaxe",
    "Concordância",
    "Regência",
    "Crase",
    "Pontuação",
    "Coesão",
    "Coerência",
    "Reescrita",
    "Redação oficial",
  ],
  "Direito Constitucional": [
    "Constituição",
    "Princípios Fundamentais",
    "Direitos e Garantias",
    "Direitos Sociais",
    "Organização do Estado",
    "Administração Pública",
    "Poder Legislativo",
    "Poder Executivo",
    "Poder Judiciário",
    "Controle de Constitucionalidade",
  ],
  "Direito Administrativo": [
    "Princípios",
    "Atos Administrativos",
    "Poderes Administrativos",
    "Serviços Públicos",
    "Licitações",
    "Contratos",
    "Responsabilidade Civil do Estado",
    "Processo Administrativo",
    "Agentes Públicos",
  ],
  "Administração Pública": [
    "Administração Geral",
    "Planejamento Estratégico",
    "Organização",
    "Liderança",
    "Controle",
    "Gestão de Pessoas",
    "Gestão por Processos",
    "Qualidade",
    "Governança",
    "Gestão de Riscos",
  ],
  "Administração Financeira e Orçamentária": [
    "Orçamento Público",
    "PPA",
    "LDO",
    "LOA",
    "Créditos Adicionais",
    "Receita Pública",
    "Despesa Pública",
    "Restos a Pagar",
    "LRF",
  ],
  "Contabilidade Pública": [
    "Patrimônio Público",
    "Plano de Contas",
    "MCASP",
    "Demonstrações Contábeis",
    "Receita",
    "Despesa",
    "NBC TSP",
  ],
  "Controle Externo": [
    "Sistemas de Controle",
    "Tribunais de Contas",
    "Fiscalização",
    "Prestação de Contas",
    "Auditoria Governamental",
    "Responsabilização",
    "Sanções",
  ],
  "Auditoria Governamental": [
    "Normas",
    "Planejamento",
    "Papéis de Trabalho",
    "Evidências",
    "Materialidade",
    "Risco",
    "Relatórios",
    "Auditoria Operacional",
    "Auditoria de Conformidade",
  ],
  Estatística: [
    "Estatística Descritiva",
    "Probabilidade",
    "Distribuições",
    "Inferência",
    "Intervalos de Confiança",
    "Testes de Hipóteses",
    "Correlação",
    "Regressão",
  ],
  "Raciocínio Lógico / Matemática": [
    "Proposições",
    "Conectivos",
    "Tabelas-Verdade",
    "Equivalências",
    "Negação",
    "Argumentação",
    "Conjuntos",
    "Contagem",
    "Probabilidade",
  ],
  "Tecnologia da Informação": [
    "Hardware",
    "Software",
    "Redes",
    "Segurança",
    "Banco de Dados",
    "Computação em Nuvem",
    "Governança de TI",
    "LGPD",
  ],
  "Ética no Serviço Público": [
    "Ética",
    "Moral",
    "Código de Ética",
    "Deveres",
    "Infrações",
    "Processo Disciplinar",
  ],
  "Lei Orgânica do Distrito Federal": [
    "Organização do DF",
    "Competências",
    "Administração Pública",
    "Poderes",
    "Tributação",
    "Orçamento",
  ],
  "Regime Jurídico dos Servidores do DF": [
    "LC 840/2011",
    "Provimento",
    "Direitos",
    "Deveres",
    "Licenças",
    "Processo Disciplinar",
    "Penalidades",
  ],
  "Conhecimentos sobre o Distrito Federal": [
    "História",
    "Geografia",
    "Economia",
    "Cultura",
    "RIDE",
    "Atualidades do DF",
  ],
  "Política para Mulheres": [
    "Plano Distrital",
    "Igualdade de Gênero",
    "Violência contra a Mulher",
    "Políticas Públicas",
  ],
  "Primeiros Socorros": [
    "Avaliação Inicial",
    "Suporte Básico de Vida",
    "Hemorragias",
    "Fraturas",
    "Queimaduras",
    "Convulsões",
    "Engasgamento",
    "PCR",
  ],
};

function _norm(s) {
  return (s || "").trim().toLowerCase();
}

/** Lista de assuntos sugeridos para uma disciplina específica: junta os
 *  tópicos padrão cadastrados + os assuntos já usados no histórico para
 *  essa mesma disciplina + tópicos de editais importados para ela. */
function valoresAssuntoParaDisciplina(disciplina) {
  const alvo = _norm(disciplina);
  const vistos = new Set();

  if (alvo) {
    const chavePadrao = Object.keys(TOPICOS_PADRAO).find(
      (k) => _norm(k) === alvo,
    );
    if (chavePadrao) TOPICOS_PADRAO[chavePadrao].forEach((v) => vistos.add(v));
  }

  state.tentativas.forEach((t) => {
    if (!alvo || _norm(t.disciplina) === alvo) {
      const v = (t.assunto || "").trim();
      if (v) vistos.add(v);
    }
  });

  state.editais.forEach((e) =>
    (e.materias || []).forEach((m) => {
      if (!alvo || _norm(m.nome) === alvo) {
        (m.topicos || []).forEach((tp) => {
          if (tp.nome) vistos.add(tp.nome);
        });
      }
    }),
  );

  return Array.from(vistos).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Lista de valores únicos (não vazios) já usados em um campo das tentativas,
 *  em ordem alfabética — usada para popular os <datalist> de autocomplete. */
function valoresUnicos(campo) {
  const vistos = new Set();
  if (campo === "disciplina") {
    DISCIPLINAS_PADRAO.forEach((v) => vistos.add(v));
  }
  state.tentativas.forEach((t) => {
    const v = (t[campo] || "").trim();
    if (v) vistos.add(v);
  });
  if (campo === "disciplina") {
    state.editais.forEach((e) =>
      (e.materias || []).forEach((m) => {
        if (m.nome) vistos.add(m.nome);
      }),
    );
  }
  return Array.from(vistos).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/* ============================================================
   SIDEBAR / NAVEGAÇÃO
   ============================================================ */

function initSidebar() {
  const sidebar = $("#sidebar");
  const overlay = $("#sidebar-overlay");

  if (settings.sidebarCollapsed) sidebar.classList.add("collapsed");

  $("#sidebar-toggle").addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    settings.sidebarCollapsed = sidebar.classList.contains("collapsed");
  });

  $("#mobile-menu-btn").addEventListener("click", () => {
    sidebar.classList.add("mobile-open");
    overlay.classList.add("show");
  });
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("show");
  });

  // Submenus recolhíveis (Estatísticas)
  $$(".nav-group-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".nav-group").classList.toggle("open");
    });
  });
}

function closeMobileSidebar() {
  $("#sidebar").classList.remove("mobile-open");
  $("#sidebar-overlay").classList.remove("show");
}

function updateActiveNav(route) {
  $$(".nav-item[data-route], .nav-submenu a[data-route]").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  // Abre o submenu de estatísticas se a rota atual estiver dentro dele
  if (route.startsWith("estatisticas/")) {
    $(".nav-group[data-group]")?.classList.add("open");
    $(".nav-group")?.classList.add("open");
  }
}

/* ============================================================
   ROTEADOR
   ============================================================ */

const PAGE_TITLES = {
  dashboard: "Dashboard",
  tentativas: "Tentativas",
  "resolver-ia": "Resolver com IA",
  caderno: "Caderno de Resumos",
  "importar-historico": "Importar Histórico",
  ciclo: "Ciclo de Estudos",
  "estatisticas/disciplinas": "Estatísticas por Disciplina",
  "estatisticas/assuntos": "Estatísticas por Assunto",
  "estatisticas/bancas": "Estatísticas por Banca",
  "estatisticas/concursos": "Estatísticas por Concurso",
  editais: "Editais",
  "editais/importar": "Importar Edital",
  simulados: "Simulados",
  "simulado-gerado": "Simulado Personalizado",
  perfis: "Perfis",
  configuracoes: "Configurações",
};

async function router() {
  let hash = location.hash.replace(/^#\//, "") || "dashboard";
  // compatibilidade com links antigos (versão baseada em questões individuais)
  if (hash === "questoes" || hash.startsWith("questoes/")) {
    hash = hash.replace("questoes", "tentativas");
  }
  const [base, sub, sub2] = hash.split("/");
  const routeKey = sub ? `${base}/${sub}` : base;

  closeMobileSidebar();
  await reloadState();
  atualizarSeletorPerfilUI();

  const view = $("#view");
  view.innerHTML = "";

  if (base === "dashboard") {
    $("#page-title").textContent = PAGE_TITLES["dashboard"];
    updateActiveNav("dashboard");
    renderDashboard(view);
  } else if (base === "tentativas") {
    $("#page-title").textContent = PAGE_TITLES["tentativas"];
    updateActiveNav("tentativas");
    renderTentativas(view);
  } else if (base === "resolver-ia") {
    $("#page-title").textContent = PAGE_TITLES["resolver-ia"];
    updateActiveNav("resolver-ia");
    renderResolverIA(view);
  } else if (base === "caderno") {
    $("#page-title").textContent = PAGE_TITLES["caderno"];
    updateActiveNav("caderno");
    renderCaderno(view);
  } else if (base === "importar-historico") {
    $("#page-title").textContent = PAGE_TITLES["importar-historico"];
    updateActiveNav("importar-historico");
    renderImportarHistorico(view);
  } else if (base === "ciclo") {
    if (sub) {
      const cicloId = Number(sub);
      const ciclo = state.ciclos.find((c) => c.id === cicloId);
      $("#page-title").textContent = ciclo ? ciclo.nome : PAGE_TITLES["ciclo"];
      updateActiveNav("ciclo");
      renderCicloPainelRoute(view, cicloId);
    } else {
      $("#page-title").textContent = PAGE_TITLES["ciclo"];
      updateActiveNav("ciclo");
      renderCiclosLista(view);
    }
  } else if (base === "estatisticas") {
    if (sub === "disciplinas" && sub2) {
      $("#page-title").textContent = `Disciplina: ${decodeURIComponent(sub2)}`;
      updateActiveNav("estatisticas/disciplinas");
      renderDisciplinaDetalhe(view, decodeURIComponent(sub2));
    } else if (sub === "assuntos" && sub2) {
      $("#page-title").textContent = `Assunto: ${decodeURIComponent(sub2)}`;
      updateActiveNav("estatisticas/assuntos");
      renderAssuntoDetalhe(view, decodeURIComponent(sub2));
    } else {
      $("#page-title").textContent = PAGE_TITLES[routeKey] || "Estatísticas";
      updateActiveNav(routeKey);
      renderAgrupamento(view, sub);
    }
  } else if (base === "editais") {
    if (sub === "importar") {
      $("#page-title").textContent = "Importar Edital";
      updateActiveNav("editais/importar");
      renderImportarEdital(view);
    } else if (sub) {
      $("#page-title").textContent = "Detalhe do Edital";
      updateActiveNav("editais");
      renderEditalDetalhe(view, sub);
    } else {
      $("#page-title").textContent = PAGE_TITLES["editais"];
      updateActiveNav("editais");
      renderEditais(view);
    }
  } else if (base === "simulados") {
    $("#page-title").textContent = PAGE_TITLES["simulados"];
    updateActiveNav("simulados");
    renderSimulados(view);
  } else if (base === "simulado-gerado") {
    $("#page-title").textContent = _simuladoGerado
      ? escapeHtml(_simuladoGerado.nome)
      : PAGE_TITLES["simulado-gerado"];
    updateActiveNav("simulados");
    renderSimuladoGerado(view);
  } else if (base === "perfis") {
    $("#page-title").textContent = PAGE_TITLES["perfis"];
    updateActiveNav("perfis");
    renderPerfisPage(view);
  } else if (base === "configuracoes") {
    $("#page-title").textContent = PAGE_TITLES["configuracoes"];
    updateActiveNav("configuracoes");
    renderConfiguracoes(view);
  } else {
    view.innerHTML =
      '<div class="empty-state"><p>Página não encontrada.</p></div>';
  }

  updateStreakMini();
}

/* ============================================================
   CÁLCULO DE ESTATÍSTICAS (funções puras sobre state.tentativas)
   ============================================================ */

/** Filtra tentativas dentro de um intervalo de datas (inclusive), formato ISO 'YYYY-MM-DD' */
function filtrarTentativasPorPeriodo(inicio, fim) {
  return state.tentativas.filter((t) => t.data >= inicio && t.data <= fim);
}

/** Resolve o filtro do dashboard em { inicio, fim } */
function resolverPeriodo(filtro) {
  const hoje = todayISO();
  switch (filtro.tipo) {
    case "hoje":
      return { inicio: hoje, fim: hoje };
    case "7d":
      return { inicio: daysAgoISO(6), fim: hoje };
    case "30d":
      return { inicio: daysAgoISO(29), fim: hoje };
    case "90d":
      return { inicio: daysAgoISO(89), fim: hoje };
    case "tudo":
      return { inicio: "1970-01-01", fim: hoje };
    case "custom":
      return {
        inicio: filtro.inicio || daysAgoISO(6),
        fim: filtro.fim || hoje,
      };
    default:
      return { inicio: daysAgoISO(6), fim: hoje };
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
  const norm = (s) => (s || "").trim().toLowerCase();
  const sessoesDoDia = (state.cicloSessoes || []).filter(
    (s) => s && s.data === dataISO,
  );
  const tentativasDoDia = (state.tentativas || []).filter(
    (t) => t && t.data === dataISO,
  );

  const grupos = new Map(); // chave normalizada -> acumulador

  function pegaGrupo(nomeOriginal) {
    const nome = (nomeOriginal || "").trim() || "(Não informado)";
    const chave = norm(nome);
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        nome,
        topicos: new Set(),
        tipos: new Set(),
        minutos: 0,
        numQuestoes: 0,
        acertos: 0,
        erros: 0,
      });
    }
    return grupos.get(chave);
  }

  sessoesDoDia.forEach((s) => {
    const g = pegaGrupo(s.nome);
    g.minutos += Number(s.minutos) || 0;
    if (s.topico) g.topicos.add(s.topico);
    if (s.tipoEstudo) g.tipos.add(s.tipoEstudo);
  });

  tentativasDoDia.forEach((t) => {
    const g = pegaGrupo(t.disciplina);
    g.numQuestoes += Number(t.numQuestoes) || 0;
    g.acertos += Number(t.acertos) || 0;
    g.erros += Number(t.erros) || 0;
    if (t.assunto) g.topicos.add(t.assunto);
    if (t.tipo) g.tipos.add(t.tipo);
  });

  const materias = Array.from(grupos.values()).map((g) => ({
    nome: g.nome,
    topicos: Array.from(g.topicos),
    tipos: Array.from(g.tipos),
    minutos: g.minutos,
    numQuestoes: g.numQuestoes,
    acertos: g.acertos,
    erros: g.erros,
    taxa: g.numQuestoes ? (g.acertos / g.numQuestoes) * 100 : 0,
  }));

  // matérias com mais tempo estudado primeiro; empate desempata por nº de questões
  materias.sort(
    (a, b) => b.minutos - a.minutos || b.numQuestoes - a.numQuestoes,
  );

  const totais = materias.reduce(
    (acc, g) => {
      acc.minutos += g.minutos;
      acc.numQuestoes += g.numQuestoes;
      acc.acertos += g.acertos;
      acc.erros += g.erros;
      return acc;
    },
    { minutos: 0, numQuestoes: 0, acertos: 0, erros: 0 },
  );
  totais.taxa = totais.numQuestoes
    ? (totais.acertos / totais.numQuestoes) * 100
    : 0;

  return { materias, totais };
}

/** Sequência de dias consecutivos (até hoje) com pelo menos 1 tentativa registrada */
function calcSequenciaDias() {
  const diasComTentativa = new Set(state.tentativas.map((t) => t.data));
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
    const ts = state.tentativas.filter((t) => t.data === iso);
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
  $("#streak-mini-count").textContent =
    `${streak} dia${streak === 1 ? "" : "s"}`;
}

/** Agrupa tentativas por uma chave (disciplina, assunto, banca, concurso) */
function agruparPor(lista, chave) {
  const mapa = new Map();
  lista.forEach((t) => {
    const valor = (t[chave] || "(Não informado)").trim() || "(Não informado)";
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
    return { label: "Estável", icone: "➡" };
  }
  const ultima = tentativasOrdenadas[tentativasOrdenadas.length - 1];
  const anteriores = tentativasOrdenadas.slice(0, -1);
  const mediaAnterior =
    anteriores.reduce((acc, t) => acc + (t.taxa || 0), 0) / anteriores.length;
  const diff = (ultima.taxa || 0) - mediaAnterior;

  if (diff >= 3) return { label: "Melhorando", icone: "📈" };
  if (diff <= -3) return { label: "Piorando", icone: "📉" };
  return { label: "Estável", icone: "➡" };
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

  const diasNoPeriodo = Math.max(
    1,
    (new Date(fim) - new Date(inicio)) / 86400000 + 1,
  );
  const mediaDiaria = resumo.total / diasNoPeriodo;

  const porDisciplina = agruparPor(lista, "disciplina").slice(0, 6);
  const trilha = calcTrilhaDias(30);

  // Tempo total estudado desde que os registros do Ciclo de Estudos
  // começaram (soma de TODAS as sessões, sem filtro de data) — independente
  // do filtro de período escolhido acima no dashboard.
  const minutosTotalCiclo = (state.cicloSessoes || []).reduce(
    (soma, s) => soma + (Number(s && s.minutos) || 0),
    0,
  );

  view.innerHTML = `
    <div class="filter-bar" id="dash-filters">
      ${["hoje", "7d", "30d", "90d", "custom"]
        .map(
          (t) => `
        <button class="chip ${filtro.tipo === t ? "active" : ""}" data-filtro="${t}">
          ${{ hoje: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", "90d": "Últimos 90 dias", custom: "Personalizado" }[t]}
        </button>
      `,
        )
        .join("")}
      <div id="custom-range" style="display:${filtro.tipo === "custom" ? "flex" : "none"};gap:8px;align-items:center;">
        <input type="date" id="filtro-inicio" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.inicio || daysAgoISO(6)}">
        <span class="text-muted">até</span>
        <input type="date" id="filtro-fim" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.fim || todayISO()}">
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="label">Total de questões</div><div class="value">${resumo.total}</div></div>
      <div class="stat-card success"><div class="label">Questões certas</div><div class="value">${resumo.certas}</div></div>
      <div class="stat-card danger"><div class="label">Questões erradas</div><div class="value">${resumo.erradas}</div></div>
      <div class="stat-card gold"><div class="label">Taxa de acerto</div><div class="value">${fmtPct(resumo.taxa)}</div></div>
      <div class="stat-card info"><div class="label">Tentativas registradas</div><div class="value">${resumo.tentativas}</div></div>
      <div class="stat-card"><div class="label">Média de questões/dia</div><div class="value">${mediaDiaria.toFixed(1)}</div></div>
      <div class="stat-card gold"><div class="label">Sequência de dias</div><div class="value">${streak} 🔥</div></div>
      <div class="stat-card info"><div class="label">Tempo total estudado</div><div class="value">${_formatarMinutos(minutosTotalCiclo)}</div></div>
    </div>

    <div class="card mb-12" id="card-relatorio-diario"></div>

    <div class="card mb-12" id="card-prioridade-revisao"></div>

    <div class="grid-2 mb-12">
      <div class="card">
        <div class="card-title">Acertos × Erros</div>
        <div class="chart-wrap"><canvas id="chart-pizza"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Questões por disciplina</div>
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
        ${trilha.map((d) => `<div class="streak-dot" data-level="${nivelStreakDot(d)}" title="${toBRDate(d.iso)} · ${d.count} questão(ões)"></div>`).join("")}
      </div>
    </div>

    <div class="card mt-12" id="card-tempo-por-tipo-ciclo"></div>

    <div class="card mt-12" id="card-correlacao-tipo-taxa"></div>

    ${buildDashboardEditalHTML()}

    <div class="card mt-12" id="card-stats-disciplina"></div>
  `;

  // filtros
  $$("#dash-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.dashboardFiltro.tipo = chip.dataset.filtro;
      renderDashboard(view);
    });
  });
  const inicioInput = $("#filtro-inicio");
  const fimInput = $("#filtro-fim");
  if (inicioInput)
    inicioInput.addEventListener("change", () => {
      state.dashboardFiltro.tipo = "custom";
      state.dashboardFiltro.inicio = inicioInput.value;
      renderDashboard(view);
    });
  if (fimInput)
    fimInput.addEventListener("change", () => {
      state.dashboardFiltro.tipo = "custom";
      state.dashboardFiltro.fim = fimInput.value;
      renderDashboard(view);
    });

  // gráficos
  try {
    renderPieChart("chart-pizza", {
      acertos: resumo.certas,
      erros: resumo.erradas,
    });
    renderBarChart("chart-barras", {
      labels: porDisciplina.map((d) => d.nome),
      certas: porDisciplina.map((d) => d.certas),
      erradas: porDisciplina.map((d) => d.erradas),
    });
  } catch (err) {
    console.error("Erro ao renderizar gráficos pizza/barras:", err);
  }

  // evolução: agrupa por dia dentro do período (ou últimos 60 dias se período muito curto)
  try {
    const diasEvolucao = [];
    const nDias = Math.min(60, diasNoPeriodo);
    for (let i = nDias - 1; i >= 0; i--) {
      const iso = daysAgoISO(i);
      if (iso < inicio) continue;
      const ts = state.tentativas.filter((t) => t.data === iso);
      const r = calcResumo(ts);
      diasEvolucao.push({ iso, certas: r.certas, total: r.total });
    }
    renderLineChart("chart-linha", {
      labels: diasEvolucao.map((d) => toBRDate(d.iso).slice(0, 5)),
      series: [
        { label: "Certas", data: diasEvolucao.map((d) => d.certas) },
        { label: "Total", data: diasEvolucao.map((d) => d.total) },
      ],
    });
  } catch (err) {
    console.error("Erro ao renderizar gráfico de evolução:", err);
  }

  try {
    initDashboardEditalChart();
  } catch (err) {
    console.error("Erro em initDashboardEditalChart:", err);
  }
  try {
    renderStatsPorDisciplina();
  } catch (err) {
    console.error("Erro em renderStatsPorDisciplina:", err);
  }
  try {
    renderTempoPorTipoCicloDashboard();
  } catch (err) {
    console.error("Erro em renderTempoPorTipoCicloDashboard:", err);
  }
  try {
    renderRelatorioDiario();
  } catch (err) {
    console.error("Erro em renderRelatorioDiario:", err);
  }
  try {
    renderPrioridadeRevisao();
  } catch (err) {
    console.error("Erro em renderPrioridadeRevisao:", err);
  }
  try {
    renderCorrelacaoTipoTaxa();
  } catch (err) {
    console.error("Erro em renderCorrelacaoTipoTaxa:", err);
  }
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
  const card = $("#card-correlacao-tipo-taxa");
  if (!card) return;

  const norm = (s) => (s || "").trim().toLowerCase();
  const materias = state.cicloMaterias || [];

  const grupos = {}; // tipo -> { totalQuestoes, totalAcertos, disciplinas: Set }

  materias.forEach((m) => {
    const sessoesDaMateria = state.cicloSessoes.filter(
      (s) => s.cicloMateriaId === m.id && (s.minutos || 0) > 0 && s.tipoEstudo,
    );
    if (!sessoesDaMateria.length) return; // sem tipo registrado, não entra na correlação

    const porTipo = {};
    sessoesDaMateria.forEach((s) => {
      porTipo[s.tipoEstudo] = (porTipo[s.tipoEstudo] || 0) + s.minutos;
    });
    const tipoPredominante = Object.entries(porTipo).sort(
      (a, b) => b[1] - a[1],
    )[0][0];

    const ciclo = state.ciclos.find((c) => c.id === m.cicloId);
    const nomeCiclo = ciclo ? ciclo.nome : "";
    const tentativasDaMateria = state.tentativas.filter(
      (t) =>
        _materiaCasaComDisciplina(m, t.disciplina) &&
        (nomeCiclo ? norm(t.concurso) === norm(nomeCiclo) : true),
    );
    const totalQuestoes = tentativasDaMateria.reduce(
      (s, t) => s + (t.numQuestoes || 0),
      0,
    );
    const totalAcertos = tentativasDaMateria.reduce(
      (s, t) => s + (t.acertos || 0),
      0,
    );
    if (totalQuestoes === 0) return; // sem questões, não dá pra medir desempenho

    if (!grupos[tipoPredominante])
      grupos[tipoPredominante] = {
        totalQuestoes: 0,
        totalAcertos: 0,
        disciplinas: new Set(),
      };
    grupos[tipoPredominante].totalQuestoes += totalQuestoes;
    grupos[tipoPredominante].totalAcertos += totalAcertos;
    grupos[tipoPredominante].disciplinas.add(m.nome);
  });

  const lista = Object.entries(grupos)
    .map(([tipo, g]) => ({
      tipo,
      taxa: (g.totalAcertos / g.totalQuestoes) * 100,
      disciplinas: g.disciplinas.size,
      questoes: g.totalQuestoes,
    }))
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
      ${lista
        .map(
          (item) => `
        <div class="flex" style="justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);gap:10px;">
          <span>${escapeHtml(item.tipo)}</span>
          <span class="text-muted" style="font-size:13px;">
            <strong style="color:var(--gold);">${fmtPct(item.taxa)}</strong>
            · ${item.disciplinas} disciplina${item.disciplinas === 1 ? "" : "s"} · ${item.questoes} questões
          </span>
        </div>
      `,
        )
        .join("")}
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
  const card = $("#card-relatorio-diario");
  if (!card) return;

  const dataSelecionada = _relatorioDiarioData;
  const { materias, totais } = calcRelatorioDiario(dataSelecionada);
  const filtroEhHoje = state.dashboardFiltro.tipo === "hoje";
  const ehHoje = dataSelecionada === todayISO();

  card.style.borderColor = filtroEhHoje && ehHoje ? "var(--gold)" : "";

  const navegacaoHTML = `
    <div class="flex" style="justify-content:center;align-items:center;gap:10px;margin-bottom:12px;">
      <button class="btn btn-sm btn-ghost" id="btn-relatorio-dia-anterior" title="Dia anterior">◀</button>
      <input type="date" id="input-relatorio-data" value="${dataSelecionada}" max="${todayISO()}" style="text-align:center;">
      <button class="btn btn-sm btn-ghost" id="btn-relatorio-dia-seguinte" title="Próximo dia" ${ehHoje ? "disabled" : ""}>▶</button>
      ${!ehHoje ? `<button class="btn btn-sm btn-ghost" id="btn-relatorio-hoje">Hoje</button>` : ""}
    </div>
  `;

  if (!materias.length) {
    card.innerHTML = `
      <div class="card-title">🗓️ Relatório diário de estudos — ${toBRDate(dataSelecionada)}</div>
      ${navegacaoHTML}
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        ${
          ehHoje
            ? "Nenhuma sessão do Ciclo de Estudos ou tentativa de questões registrada hoje ainda. Assim que você estudar algo ou lançar questões, o resumo do dia aparece aqui, matéria por matéria."
            : "Nenhuma sessão do Ciclo de Estudos ou tentativa de questões registrada nesse dia."
        }
      </p>
    `;
    _wireRelatorioDiarioNav();
    return;
  }

  card.innerHTML = `
    <div class="card-title">🗓️ Relatório diário de estudos — ${toBRDate(dataSelecionada)}</div>
    ${navegacaoHTML}
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;margin-bottom:14px;">
      Combina automaticamente as sessões do Ciclo de Estudos e as tentativas de questões registradas nesse dia, por matéria.
      ${
        filtroEhHoje && ehHoje
          ? 'O filtro de período acima está em "Hoje" — os cartões de resumo no topo mostram os mesmos totais.'
          : "Este resumo é referente ao dia selecionado acima, independente do filtro de período escolhido no topo do Dashboard."
      }
    </p>

    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-bottom:16px;">
      <div class="stat-card info"><div class="label">Tempo total no dia</div><div class="value" style="font-size:20px;">${_formatarMinutos(totais.minutos)}</div></div>
      <div class="stat-card"><div class="label">Questões no dia</div><div class="value" style="font-size:20px;">${totais.numQuestoes}</div></div>
      <div class="stat-card success"><div class="label">Certas</div><div class="value" style="font-size:20px;">${totais.acertos}</div></div>
      <div class="stat-card danger"><div class="label">Erradas</div><div class="value" style="font-size:20px;">${totais.erros}</div></div>
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
            <th>Certas / Erradas</th>
            <th>Taxa</th>
          </tr>
        </thead>
        <tbody>
          ${materias
            .map(
              (g) => `
            <tr>
              <td style="white-space:normal;font-weight:600;">${escapeHtml(g.nome)}</td>
              <td style="white-space:normal;max-width:220px;">${g.topicos.length ? g.topicos.map((tp) => escapeHtml(tp)).join(", ") : '<span class="text-muted">-</span>'}</td>
              <td style="white-space:normal;max-width:200px;">${g.tipos.length ? g.tipos.map((tp) => `<span class="badge muted" style="margin:2px 4px 2px 0;display:inline-block;">${escapeHtml(tp)}</span>`).join("") : '<span class="text-muted">-</span>'}</td>
              <td class="num">${g.minutos > 0 ? _formatarMinutos(g.minutos) : "-"}</td>
              <td class="num">${g.numQuestoes || "-"}</td>
              <td class="num">${g.numQuestoes ? `<span style="color:var(--success)">${g.acertos}</span> / <span style="color:var(--danger)">${g.erros}</span>` : "-"}</td>
              <td>
                ${
                  g.numQuestoes
                    ? `
                  <div class="pct-bar-wrap">
                    <div class="pct-bar"><span style="width:${g.taxa.toFixed(1)}%"></span></div>
                    <span class="num">${fmtPct(g.taxa)}</span>
                  </div>
                `
                    : '<span class="text-muted">-</span>'
                }
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  _wireRelatorioDiarioNav();
}

/** Conecta as setas de navegação e o campo de data do relatório diário —
 *  qualquer mudança só re-renderiza esse card específico, sem recarregar
 *  o resto do Dashboard. */
function _wireRelatorioDiarioNav() {
  const somarDias = (iso, n) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toISODate(d);
  };

  $("#btn-relatorio-dia-anterior")?.addEventListener("click", () => {
    _relatorioDiarioData = somarDias(_relatorioDiarioData, -1);
    renderRelatorioDiario();
  });
  $("#btn-relatorio-dia-seguinte")?.addEventListener("click", () => {
    if (_relatorioDiarioData >= todayISO()) return;
    _relatorioDiarioData = somarDias(_relatorioDiarioData, 1);
    renderRelatorioDiario();
  });
  $("#btn-relatorio-hoje")?.addEventListener("click", () => {
    _relatorioDiarioData = todayISO();
    renderRelatorioDiario();
  });
  $("#input-relatorio-data")?.addEventListener("change", (e) => {
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
  const card = $("#card-prioridade-revisao");
  if (!card) return;

  const norm = (s) => (s || "").trim().toLowerCase();
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

  materias.forEach((m) => {
    const ciclo = state.ciclos.find((c) => c.id === m.cicloId);
    const nomeCiclo = ciclo ? ciclo.nome : "";

    const sessoesDaMateria = state.cicloSessoes.filter(
      (s) => s.cicloMateriaId === m.id && (s.minutos || 0) > 0,
    );
    const tentativasDaMateria = state.tentativas.filter(
      (t) =>
        _materiaCasaComDisciplina(m, t.disciplina) &&
        (nomeCiclo ? norm(t.concurso) === norm(nomeCiclo) : true),
    );
    const totalQuestoes = tentativasDaMateria.reduce(
      (s, t) => s + (t.numQuestoes || 0),
      0,
    );
    const totalAcertos = tentativasDaMateria.reduce(
      (s, t) => s + (t.acertos || 0),
      0,
    );

    // "Já estudada" considera QUALQUER evidência: tempo no Ciclo de Estudos
    // OU questões já registradas para essa disciplina (mesmo sem ter usado
    // o cronômetro do ciclo nem uma vez).
    const jaEstudou =
      sessoesDaMateria.length > 0 || m.minutosFeitos > 0 || totalQuestoes > 0;

    if (!jaEstudou) {
      nuncaEstudadas.push({ materia: m, nomeCiclo });
      return;
    }

    const taxa = totalQuestoes > 0 ? (totalAcertos / totalQuestoes) * 100 : 50; // sem dados = neutro

    // "Há quanto tempo não revisa" olha a data mais recente entre sessões
    // do ciclo E tentativas — o que tiver acontecido por último conta.
    const datasSessoes = sessoesDaMateria.map((s) => s.data).filter(Boolean);
    const datasTentativas = tentativasDaMateria
      .map((t) => t.data)
      .filter(Boolean);
    const ultimaData =
      [...datasSessoes, ...datasTentativas].sort().pop() || null;
    const diasSemRevisar = ultimaData
      ? Math.max(
          0,
          Math.round((new Date(hoje) - new Date(ultimaData)) / 86400000),
        )
      : 30; // fallback (não deveria cair aqui, já que jaEstudou é true)

    // Urgência usa pelo menos 1 "dia" no cálculo do score (revisar hoje ainda
    // conta como pouco urgente, mas não zera o score de disciplinas de peso alto).
    // Estudado hoje ainda conta pra urgência (uma disciplina fraca não vira
    // forte só por ter sido revisada uma vez), mas com um peso bem menor do
    // que um dia inteiro sem revisar — evita empatar "estudei há 5 minutos"
    // com "estudei ontem".
    const fatorDias = diasSemRevisar === 0 ? 0.3 : diasSemRevisar;
    const urgencia = (m.peso || 1) * (100 - taxa) * fatorDias;

    paraCalcular.push({
      materia: m,
      nomeCiclo,
      taxa,
      totalQuestoes,
      diasSemRevisar,
      urgencia,
    });
  });

  paraCalcular.sort((a, b) => b.urgencia - a.urgencia);
  const nuncaEstudadasOrdenadas = nuncaEstudadas.sort(
    (a, b) => (b.materia.peso || 0) - (a.materia.peso || 0),
  );

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
            ${item.nomeCiclo ? escapeHtml(item.nomeCiclo) + " · " : ""}peso ${m.peso} ·
            ${item.totalQuestoes > 0 ? `${fmtPct(item.taxa)} de acerto` : "sem questões registradas"} ·
            ${item.diasSemRevisar === 0 ? "estudada hoje" : `há ${item.diasSemRevisar} dia${item.diasSemRevisar === 1 ? "" : "s"} sem revisar`}
          </div>
        </div>
      </div>
    `;
  };

  const linhaNuncaEstudada = (item) => `
    <div class="flex" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);gap:10px;">
      <span>${escapeHtml(item.materia.nome)}</span>
      <span class="text-muted" style="font-size:12px;">${item.nomeCiclo ? escapeHtml(item.nomeCiclo) + " · " : ""}peso ${item.materia.peso}</span>
    </div>
  `;

  card.innerHTML = `
    <div class="card-title">📌 O que revisar agora</div>
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">Combina peso no edital, taxa de acerto e há quanto tempo você não revisa cada disciplina.</p>
    ${
      paraCalcular.length
        ? `
      <div>${paraCalcular.slice(0, 8).map(linhaJaEstudada).join("")}</div>
    `
        : `<p class="text-muted" style="font-size:13px;">Nenhuma disciplina já estudada com dado suficiente pra calcular urgência ainda.</p>`
    }
    ${
      nuncaEstudadasOrdenadas.length
        ? `
      <div class="mt-12" style="font-size:12.5px;font-weight:700;color:var(--danger);">⚠ Ainda não estudadas (${nuncaEstudadasOrdenadas.length})</div>
      <div class="mt-4">${nuncaEstudadasOrdenadas.map(linhaNuncaEstudada).join("")}</div>
    `
        : ""
    }
  `;
}

/** Card do Dashboard com o tempo total (todos os ciclos, todo o histórico)
 *  gasto em cada tipo de estudo (Exercícios, Revisão, Vídeo, etc.), vindo
 *  do Ciclo de Estudos — NÃO das tentativas/questões. É a soma geral, sem
 *  filtro de período nem de "hoje". */
function renderTempoPorTipoCicloDashboard() {
  const card = $("#card-tempo-por-tipo-ciclo");
  if (!card) return;

  const totais = {};
  state.cicloSessoes.forEach((s) => {
    const tipo = s.tipoEstudo || "Não informado";
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
      ${lista
        .map(
          ([tipo, minutos], i) => `
        <div class="flex" style="justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border);">
          <span>
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${_CORES_TIPO_ESTUDO[i % _CORES_TIPO_ESTUDO.length]};margin-right:7px;"></span>
            ${escapeHtml(tipo)}
          </span>
          <span class="text-muted">${_formatarMinutos(minutos)} · ${fmtPct((minutos / totalGeral) * 100)}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  renderStatusDoughnutChart("chart-tipo-estudo-dashboard", {
    labels: lista.map(([tipo]) => tipo),
    values: lista.map(([, minutos]) => Math.round(minutos)),
    colors: lista.map(
      (_, i) => _CORES_TIPO_ESTUDO[i % _CORES_TIPO_ESTUDO.length],
    ),
  });
}

/** Seção "Estatísticas por disciplina" da Dashboard — tem seu próprio filtro
 *  de período (mesmo componente de chips + data usado no resto da Dashboard)
 *  e um filtro de disciplina. Atualiza sozinha, sem re-renderizar o resto
 *  da página (gráficos e cards existentes não são tocados). */
function renderStatsPorDisciplina() {
  const card = $("#card-stats-disciplina");
  if (!card) return;

  const filtro = state.statsDisciplinaFiltro;
  const { inicio, fim } = resolverPeriodo(filtro);
  const listaPeriodo = filtrarTentativasPorPeriodo(inicio, fim);
  const listaFiltrada =
    filtro.disciplina === "todas"
      ? listaPeriodo
      : listaPeriodo.filter(
          (t) => _norm(t.disciplina) === _norm(filtro.disciplina),
        );

  const porDisciplina = agruparPor(listaFiltrada, "disciplina"); // já vem ordenado por total desc
  const disciplinasDisponiveis = valoresUnicos("disciplina");

  card.innerHTML = `
    <div class="card-title">Estatísticas por disciplina</div>

    <div class="filter-bar" id="stats-disc-filters" style="margin-top:14px;">
      ${["hoje", "7d", "30d", "90d", "tudo", "custom"]
        .map(
          (t) => `
        <button class="chip ${filtro.tipo === t ? "active" : ""}" data-filtro="${t}">
          ${{ hoje: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", "90d": "Últimos 90 dias", tudo: "Tudo", custom: "Personalizado" }[t]}
        </button>
      `,
        )
        .join("")}
      <div id="stats-disc-custom-range" style="display:${filtro.tipo === "custom" ? "flex" : "none"};gap:8px;align-items:center;">
        <input type="date" id="stats-disc-inicio" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.inicio || daysAgoISO(6)}">
        <span class="text-muted">até</span>
        <input type="date" id="stats-disc-fim" min="2015-01-01" max="${daysAgoISO(-1)}" value="${filtro.fim || todayISO()}">
      </div>
      <select class="status-select" id="stats-disc-select" style="margin-left:auto;">
        <option value="todas" ${filtro.disciplina === "todas" ? "selected" : ""}>Todas as disciplinas</option>
        ${disciplinasDisponiveis.map((d) => `<option value="${escapeHtml(d)}" ${filtro.disciplina === d ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}
      </select>
    </div>

    <div class="table-wrap">
      ${
        porDisciplina.length
          ? `
        <table>
          <thead>
            <tr><th>Disciplina</th><th>Certas</th><th>Erradas</th><th>Total</th><th>%</th></tr>
          </thead>
          <tbody>
            ${porDisciplina
              .map(
                (d) => `
              <tr>
                <td>${escapeHtml(d.nome)}</td>
                <td class="num" style="color:var(--success)">${d.certas}</td>
                <td class="num" style="color:var(--danger)">${d.erradas}</td>
                <td class="num">${d.total}</td>
                <td class="num" style="font-weight:700;">${fmtPct(d.taxa)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `
          : `<p class="text-muted" style="font-size:13.5px;">Nenhuma tentativa registrada nesse período.</p>`
      }
    </div>
  `;

  $$("#stats-disc-filters .chip", card).forEach((chip) => {
    chip.addEventListener("click", () => {
      state.statsDisciplinaFiltro.tipo = chip.dataset.filtro;
      renderStatsPorDisciplina();
    });
  });
  const inicioInput = $("#stats-disc-inicio", card);
  const fimInput = $("#stats-disc-fim", card);
  if (inicioInput)
    inicioInput.addEventListener("change", () => {
      state.statsDisciplinaFiltro.tipo = "custom";
      state.statsDisciplinaFiltro.inicio = inicioInput.value;
      renderStatsPorDisciplina();
    });
  if (fimInput)
    fimInput.addEventListener("change", () => {
      state.statsDisciplinaFiltro.tipo = "custom";
      state.statsDisciplinaFiltro.fim = fimInput.value;
      renderStatsPorDisciplina();
    });
  $("#stats-disc-select", card).addEventListener("change", (e) => {
    state.statsDisciplinaFiltro.disciplina = e.target.value;
    renderStatsPorDisciplina();
  });
}

/* ============================================================
   TELA: TENTATIVAS (lista + CRUD do novo modelo por blocos)
   ============================================================ */

let _tentativasBusca = "";

function renderTentativas(view) {
  view.innerHTML = `
    <div class="toolbar">
      <input type="text" class="search-input" id="busca-tentativas" placeholder="Pesquisar por disciplina, assunto, banca ou concurso..." value="${escapeHtml(_tentativasBusca)}">
      <button class="btn btn-primary" id="btn-nova-tentativa"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg> Registrar tentativa</button>
    </div>
    <div id="lista-tentativas"></div>
  `;

  $("#btn-nova-tentativa").addEventListener("click", () =>
    openTentativaModal(),
  );
  const buscaInput = $("#busca-tentativas");
  buscaInput.addEventListener("input", () => {
    _tentativasBusca = buscaInput.value;
    renderTabelaTentativas();
  });

  renderTabelaTentativas();

  function renderTabelaTentativas() {
    const termo = _tentativasBusca.trim().toLowerCase();
    let lista = [...state.tentativas].sort((a, b) =>
      (b.data || "").localeCompare(a.data || ""),
    );
    if (termo) {
      lista = lista.filter((t) =>
        [t.disciplina, t.assunto, t.banca, t.concurso].some((v) =>
          (v || "").toLowerCase().includes(termo),
        ),
      );
    }

    const wrap = $("#lista-tentativas");
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
      $("#empty-add-tentativa")?.addEventListener("click", () =>
        openTentativaModal(),
      );
      return;
    }

    wrap.innerHTML = `
      <div class="tentativas-lista">
        ${lista
          .map(
            (t) => `
          <div class="tentativa-card">
            <div class="tentativa-card-topo">
              <div>
                <div class="tentativa-card-disciplina">${escapeHtml(t.disciplina) || "-"}</div>
                <div class="tentativa-card-assunto">${escapeHtml(t.assunto) || "-"}</div>
              </div>
              <span class="badge muted">${escapeHtml(t.tipo) || "-"}</span>
            </div>
            <div class="tentativa-card-meta">
              <span>${toBRDate(t.data)}</span>
              ${t.banca ? `<span>${escapeHtml(t.banca)}</span>` : ""}
              ${t.concurso ? `<span>${escapeHtml(t.concurso)}</span>` : ""}
            </div>
            <div class="tentativa-card-stats">
              <span>${t.numQuestoes} questões</span>
              <span style="color:var(--success)">${t.acertos} certas</span>
              <span style="color:var(--danger)">${t.erros} erradas</span>
              <span class="tentativa-card-taxa">${fmtPct(t.taxa)}</span>
            </div>
            ${t.observacoes ? `<div class="tentativa-card-obs">${escapeHtml(t.observacoes)}</div>` : ""}
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
        `,
          )
          .join("")}
      </div>
    `;

    $$("[data-edit]", wrap).forEach((btn) =>
      btn.addEventListener("click", () => {
        const t = state.tentativas.find(
          (x) => x.id === Number(btn.dataset.edit),
        );
        openTentativaModal(t);
      }),
    );
    $$("[data-del]", wrap).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir esta tentativa?")) return;
        await db.tentativas.remove(Number(btn.dataset.del));
        await reloadState();
        renderTabelaTentativas();
        updateStreakMini();
        showToast("Tentativa excluída.", "danger");
      }),
    );
  }
}

/** Liga uma lista de sugestões clicável a um <input>, dentro do
 *  .autocomplete-wrap que o envolve. Mais confiável que <datalist>,
 *  que no Chrome para Android costuma não exibir sugestão nenhuma.
 *  `valoresOuFn` pode ser um array fixo ou uma função sem argumentos que
 *  devolve o array na hora (usado quando a lista depende de outro campo,
 *  como Assunto depender da Disciplina escolhida). */
function attachAutocomplete(input, valoresOuFn) {
  const wrap = input.closest(".autocomplete-wrap");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "autocomplete-toggle";
  toggleBtn.setAttribute("aria-label", "Mostrar opções");
  toggleBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';
  wrap.appendChild(toggleBtn);

  const lista = document.createElement("div");
  lista.className = "autocomplete-list";
  wrap.appendChild(lista);

  function renderSugestoes(forcarLista = false) {
    const valores =
      typeof valoresOuFn === "function" ? valoresOuFn() : valoresOuFn;
    const termo = forcarLista ? "" : input.value.trim().toLowerCase();
    const filtradas = termo
      ? valores.filter(
          (v) => v.toLowerCase().includes(termo) && v.toLowerCase() !== termo,
        )
      : valores;

    if (!filtradas.length) {
      lista.classList.remove("show");
      lista.innerHTML = "";
      return;
    }

    lista.innerHTML = filtradas
      .slice(0, 30)
      .map((v) => `<div class="autocomplete-item">${escapeHtml(v)}</div>`)
      .join("");
    lista.classList.add("show");
  }

  input.addEventListener("focus", () => renderSugestoes());
  input.addEventListener("click", () => renderSugestoes());
  input.addEventListener("input", () => renderSugestoes());

  // Botão de seta: sempre mostra a lista completa (sem filtrar pelo texto
  // digitado), funcionando como um "select" — e fecha se já estiver aberta.
  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (lista.classList.contains("show")) {
      lista.classList.remove("show");
    } else {
      input.focus();
      renderSugestoes(true);
    }
  });

  lista.addEventListener("mousedown", (e) => {
    // mousedown (não click) para disparar antes do blur do input
    const item = e.target.closest(".autocomplete-item");
    if (!item) return;
    input.value = item.textContent;
    lista.classList.remove("show");
    lista.innerHTML = "";
    input.dispatchEvent(new Event("input"));
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) {
      lista.classList.remove("show");
    }
  });
}

/* ---- Modal de cadastro/edição de tentativa ---- */

function openTentativaModal(tentativa = null) {
  const isEdit = !!tentativa;
  const t = tentativa || {
    data: todayISO(),
    numQuestoes: "",
    acertos: "",
    tipo: TIPOS_TENTATIVA[0],
  };

  openModal(`
    <h2>${isEdit ? "Editar tentativa" : "Registrar tentativa"}</h2>
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
            ${TIPOS_TENTATIVA.map((tp) => `<option value="${tp}" ${t.tipo === tp ? "selected" : ""}>${tp}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Quantidade de questões</label>
          <input type="number" name="numQuestoes" id="input-num-questoes" required min="1" value="${t.numQuestoes ?? ""}" placeholder="Ex: 19">
        </div>
        <div class="form-row">
          <label>Quantidade de acertos</label>
          <input type="number" name="acertos" id="input-acertos" min="0" value="${t.acertos ?? ""}" placeholder="Ex: 14">
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Quantidade de erros</label>
          <input type="number" name="erros" id="input-erros" min="0" value="${isEdit ? t.numQuestoes - t.acertos : ""}" placeholder="Ex: 5">
        </div>
        <div class="form-row">
          <label>Taxa de acertos</label>
          <input type="text" id="display-taxa" disabled value="${isEdit ? fmtPct(t.taxa) : ""}">
        </div>
      </div>
      <div class="form-row">
        <label>Observações (opcional)</label>
        <textarea name="observacoes" placeholder="Anotações sobre essa tentativa...">${escapeHtml(t.observacoes)}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="btn-cancelar-tentativa">Cancelar</button>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? "Salvar alterações" : "Salvar tentativa"}</button>
      </div>
    </form>
  `);

  const form = $("#form-tentativa");
  const numQuestoesInput = $("#input-num-questoes", form);
  const acertosInput = $("#input-acertos", form);
  const errosInput = $("#input-erros", form);
  const displayTaxa = $("#display-taxa", form);

  attachAutocomplete(form.elements.disciplina, valoresUnicos("disciplina"));
  attachAutocomplete(form.elements.assunto, () =>
    valoresAssuntoParaDisciplina(form.elements.disciplina.value),
  );
  attachAutocomplete(form.elements.banca, valoresUnicos("banca"));
  attachAutocomplete(form.elements.concurso, valoresUnicos("concurso"));

  // Acertos e Erros são dois jeitos de informar o mesmo resultado — o que
  // o usuário digitar por último é usado como referência e o outro campo
  // (e a taxa) são recalculados automaticamente a partir dele.
  function atualizarTaxa() {
    const num = Number(numQuestoesInput.value) || 0;
    const acertos = Number(acertosInput.value) || 0;
    const taxa = num ? (acertos / num) * 100 : 0;
    displayTaxa.value = num ? fmtPct(taxa) : "";
  }

  function aoDigitarAcertos() {
    const num = Number(numQuestoesInput.value) || 0;
    let acertos = Number(acertosInput.value) || 0;
    if (acertos > num) {
      acertos = num;
      acertosInput.value = num;
    }
    errosInput.value = num ? Math.max(0, num - acertos) : "";
    atualizarTaxa();
  }

  function aoDigitarErros() {
    const num = Number(numQuestoesInput.value) || 0;
    let erros = Number(errosInput.value) || 0;
    if (erros > num) {
      erros = num;
      errosInput.value = num;
    }
    acertosInput.value = num ? Math.max(0, num - erros) : "";
    atualizarTaxa();
  }

  numQuestoesInput.addEventListener("input", aoDigitarAcertos);
  acertosInput.addEventListener("input", aoDigitarAcertos);
  errosInput.addEventListener("input", aoDigitarErros);

  $("#btn-cancelar-tentativa").addEventListener("click", closeModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const numQuestoes = Number(fd.get("numQuestoes"));
    let acertos = Number(fd.get("acertos"));
    if (acertos > numQuestoes) acertos = numQuestoes;
    const erros = numQuestoes - acertos;
    const taxa = numQuestoes ? (acertos / numQuestoes) * 100 : 0;

    const obj = {
      disciplina: fd.get("disciplina").trim(),
      assunto: fd.get("assunto").trim(),
      banca: fd.get("banca").trim(),
      concurso: fd.get("concurso").trim(),
      data: fd.get("data"),
      numQuestoes,
      acertos,
      erros,
      taxa,
      tipo: fd.get("tipo"),
      observacoes: fd.get("observacoes").trim(),
    };

    // Ao REGISTRAR uma nova tentativa (não ao editar), se já existir uma
    // tentativa da mesma disciplina + assunto + tipo no mesmo dia, soma as
    // questões nela em vez de criar um registro separado — assim várias
    // rodadas do mesmo assunto no mesmo dia viram um único registro.
    const existente =
      !isEdit &&
      state.tentativas.find(
        (x) =>
          x.data === obj.data &&
          x.tipo === obj.tipo &&
          x.disciplina.trim().toLowerCase() === obj.disciplina.toLowerCase() &&
          x.assunto.trim().toLowerCase() === obj.assunto.toLowerCase(),
      );

    if (existente) {
      const novoNum = existente.numQuestoes + obj.numQuestoes;
      const novoAcertos = existente.acertos + obj.acertos;
      const novoErros = novoNum - novoAcertos;
      const novaTaxa = novoNum ? (novoAcertos / novoNum) * 100 : 0;
      const obsUnidas = [existente.observacoes, obj.observacoes]
        .filter(Boolean)
        .join(" | ");

      await db.tentativas.update({
        ...existente,
        banca: existente.banca || obj.banca,
        concurso: existente.concurso || obj.concurso,
        numQuestoes: novoNum,
        acertos: novoAcertos,
        erros: novoErros,
        taxa: novaTaxa,
        observacoes: obsUnidas,
      });
      showToast(
        `Somado ao registro de hoje: ${novoNum} questões no total.`,
        "success",
      );
    } else if (isEdit) {
      await db.tentativas.update({ ...t, ...obj, id: t.id });
      showToast("Tentativa atualizada.", "success");
    } else {
      await db.tentativas.add(obj);
      showToast("Tentativa registrada.", "success");
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

function _montarPromptResumo({
  enunciado,
  gabaritoOficial,
  disciplina,
  assunto,
}) {
  return `Você é um professor experiente preparando alunos para concurso público. Vai gerar dois resumos sobre o tema da questão abaixo, no estilo de um caderno de estudos — NÃO no formato de flashcard pergunta/resposta.

MATÉRIA: ${disciplina || "(não informado)"}
TÓPICO: ${assunto || "(não informado)"}
QUESTÃO:
${enunciado}

${
  gabaritoOficial
    ? `GABARITO OFICIAL CONFIRMADO: ${gabaritoOficial}`
    : "GABARITO: não informado — analise a questão e indique qual alternativa você acredita ser a correta. Isso é só uma sugestão, pode estar errada."
}

Gere:

1. "bruto": explicação COMPLETA e estruturada, no formato abaixo (é o formato que costuma sair melhor pra fixação — siga à risca):

   - Comece com um parágrafo curto direto: **Por que esta é a resposta correta?** seguido da explicação de por que a alternativa certa está certa (base legal/doutrinária/conceitual, sem economizar detalhe).
   - Se a questão for de múltipla escolha (A a E): depois adicione **Por que as outras alternativas estão incorretas?** seguido de uma lista com um item por alternativa errada, cada um começando com "- **LETRA) nome curto da alternativa:** " e a explicação de por que ela está errada.
   - Se a questão for Certo/Errado (Cebraspe): em vez da lista de alternativas, adicione **Por que a afirmação está [certa/errada]?** com uma lista numerada ("1. ", "2. ", "3. "...) dos motivos, cada um com um termo em negrito no início (ex.: "1. **Nome do motivo:** explicação").
   - Feche (em qualquer um dos dois formatos) com um parágrafo iniciado por **Regra de ouro / Resumo prático:** trazendo uma regra prática, mnemônico ou dica de prova sobre o tema, quando fizer sentido existir uma.
   - Use "**texto**" para negrito e "- " ou "N. " pra itens de lista — não use nenhuma outra marcação (sem #, sem \`código\`, sem links). Cada cabeçalho em negrito (ex.: "**Por que esta é a resposta correta?**") deve ficar SOZINHO na própria linha, com uma linha em branco antes e depois dele — nunca na mesma linha do parágrafo que vem a seguir. Separe parágrafos comuns entre si também com uma linha em branco.
   - Não tenha medo de escrever bastante se o tema exigir — não corte informação relevante por medo de ser longo. Escreva como se o aluno nunca tivesse visto o assunto.

2. "condensado": versão ultra-compacta, estilo "Comp. privativa U = art.22 · Comum = art.23 (todos entes) · Concorrente = art.24" — frases curtas separadas por "·", sem pergunta, sem negrito, sem lista, só o essencial pra fixação (esse SIM deve ser curto — é o "bruto" que precisa ser completo e estruturado).
${gabaritoOficial ? "" : '3. "gabaritoSugerido": a letra/valor da alternativa que você acredita ser a correta, ou null se não der pra determinar.'}

Responda SOMENTE em JSON válido, sem markdown fora dos campos, sem texto fora do JSON:
{"bruto": "...", "condensado": "..."${gabaritoOficial ? "" : ', "gabaritoSugerido": "..."'}}`;
}

/** Conversor mínimo e seguro de um subconjunto de markdown pra HTML: negrito
 *  (**texto**), listas com "- " ou "N. ", e parágrafos separados por linha
 *  em branco — é exatamente (e só) o que _montarPromptResumo pede pra IA
 *  gerar. SEMPRE escapa o texto primeiro (escapeHtml) e só depois interpreta
 *  os marcadores nesse texto já escapado — então não existe risco de HTML
 *  ou script vindo da resposta da IA virar HTML de verdade na tela; o pior
 *  caso é um "**" ou "-" sobrando sem formatar. */
function _mdParaHtml(texto) {
  const linhas = escapeHtml(texto || "").split("\n");
  const blocos = [];
  let paragrafoAtual = [];
  let listaAtual = null; // { tipo: 'ul'|'ol', itens: [] }

  const negrito = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  function fecharParagrafo() {
    if (paragrafoAtual.length) {
      blocos.push(`<p>${paragrafoAtual.join(" ")}</p>`);
      paragrafoAtual = [];
    }
  }
  function fecharLista() {
    if (listaAtual) {
      blocos.push(
        `<${listaAtual.tipo}>${listaAtual.itens.map((i) => `<li>${i}</li>`).join("")}</${listaAtual.tipo}>`,
      );
      listaAtual = null;
    }
  }

  linhas.forEach((linhaRaw) => {
    const linha = linhaRaw.trim();
    if (!linha) {
      fecharParagrafo();
      fecharLista();
      return;
    }

    const bullet = linha.match(/^-\s+(.*)/);
    const numerado = linha.match(/^\d+\.\s+(.*)/);
    const linhaTodaEmNegrito = linha.match(/^\*\*(.+)\*\*$/); // ex.: "**Por que...?**" sozinho na linha

    if (linhaTodaEmNegrito) {
      // Cabeçalho: fecha o que estava aberto e vira um parágrafo próprio,
      // pra não colar visualmente no texto seguinte.
      fecharParagrafo();
      fecharLista();
      blocos.push(
        `<p class="md-heading"><strong>${linhaTodaEmNegrito[1]}</strong></p>`,
      );
    } else if (bullet) {
      fecharParagrafo();
      if (!listaAtual || listaAtual.tipo !== "ul") {
        fecharLista();
        listaAtual = { tipo: "ul", itens: [] };
      }
      listaAtual.itens.push(negrito(bullet[1]));
    } else if (numerado) {
      fecharParagrafo();
      if (!listaAtual || listaAtual.tipo !== "ol") {
        fecharLista();
        listaAtual = { tipo: "ol", itens: [] };
      }
      listaAtual.itens.push(negrito(numerado[1]));
    } else {
      fecharLista();
      paragrafoAtual.push(negrito(linha));
    }
  });
  fecharParagrafo();
  fecharLista();

  return blocos.join("");
}

/** Chama a IA e devolve { bruto, condensado, gabaritoSugerido }. Lança erro
 *  (com mensagem amigável) se a IA não estiver configurada ou responder em
 *  formato inesperado — quem chama decide como mostrar isso ao usuário. */
async function gerarResumoIA(dados, { onStream } = {}) {
  if (typeof window.chamarGeminiResumo !== "function") {
    throw new Error(
      "IA ainda não configurada nesse dispositivo (falta configurar o Firebase AI Logic — ver comentário no código).",
    );
  }
  const prompt = _montarPromptResumo(dados);
  let textoResposta;
  if (onStream && typeof window.chamarGeminiResumoStream === "function") {
    textoResposta = await window.chamarGeminiResumoStream(prompt, onStream);
  } else {
    textoResposta = await window.chamarGeminiResumo(prompt);
  }
  const limpo = String(textoResposta || "")
    .replace(/```json|```/g, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(limpo);
  } catch (err) {
    throw new Error(
      "A IA respondeu num formato inesperado. Tente gerar de novo.",
    );
  }
  return {
    bruto: parsed.bruto || "",
    condensado: parsed.condensado || "",
    gabaritoSugerido: parsed.gabaritoSugerido || null,
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
let _resolverIASessao = {
  disciplina: "",
  assunto: "",
  banca: "",
  concurso: "",
};
// Questão atual sendo resolvida: null enquanto não gera nenhum resumo ainda.
let _resolverIAAtual = null;
// Só contagem visual da sessão (não persiste — reseta ao recarregar a página).
let _resolverIAContagem = { certas: 0, erradas: 0, brancos: 0 };
// Buffer para agrupar questões da mesma matéria/tópico antes de salvar no banco
let _resolverIABuffer = [];
// Timer do ciclo de estudos (para exibir em todas as abas)
let _globalCicloTimerInterval = null;

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
        <textarea id="ia-enunciado" rows="14" placeholder="Cole a questão completa...">${escapeHtml(_resolverIAAtual?.enunciado || "")}</textarea>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Gabarito oficial (se já souber) — opcional</label>
          <input type="text" id="ia-gabarito-oficial" value="${escapeHtml(_resolverIAAtual?.gabaritoOficial || "")}" placeholder="Ex: C, ou 'Certo'">
        </div>
        <div class="form-row">
          <label>Sua resposta marcada (opcional)</label>
          <input type="text" id="ia-resposta-marcada" value="${escapeHtml(_resolverIAAtual?.respostaMarcada || "")}" placeholder="Ex: A">
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-gerar-resumo-ia">
        ${_resolverIAAtual?.bruto ? "🔄 Gerar de novo" : "✨ Gerar explicação com IA"}
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

  attachAutocomplete($("#ia-disciplina"), valoresUnicos("disciplina"));
  attachAutocomplete($("#ia-assunto"), () =>
    valoresAssuntoParaDisciplina($("#ia-disciplina").value),
  );
  attachAutocomplete($("#ia-banca"), valoresUnicos("banca"));
  attachAutocomplete($("#ia-concurso"), valoresUnicos("concurso"));

  ["disciplina", "assunto", "banca", "concurso"].forEach((campo) => {
    $(`#ia-${campo}`).addEventListener("change", (e) => {
      _resolverIASessao[campo] = e.target.value.trim();
    });
  });

  $("#btn-finalizar-sessao-ia").addEventListener("click", async () => {
    // Salva todas as questões do buffer agrupadas por matéria/tópico
    if (_resolverIABuffer.length === 0) {
      location.hash = "#/caderno";
      return;
    }

    // Agrupa questões por disciplina + assunto para criar registros consolidados
    const grupos = new Map();
    for (const q of _resolverIABuffer) {
      const chave = `${q.disciplina}|${q.assunto}`;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          disciplina: q.disciplina,
          assunto: q.assunto,
          banca: q.banca,
          concurso: q.concurso,
          data: q.data,
          questoes: [],
        });
      }
      grupos.get(chave).questoes.push(q);
    }

    // Salva cada grupo como um registro único no banco
    for (const [chave, grupo] of grupos) {
      const totalQuestoes = grupo.questoes.length;
      const totalAcertos = grupo.questoes.reduce((s, q) => s + q.acertos, 0);
      const totalErros = grupo.questoes.reduce((s, q) => s + q.erros, 0);
      const taxa = totalAcertos + totalErros ? (totalAcertos / (totalAcertos + totalErros)) * 100 : 0;

      const tentativaId = await db.tentativas.add({
        disciplina: grupo.disciplina,
        assunto: grupo.assunto,
        banca: grupo.banca,
        concurso: grupo.concurso,
        data: grupo.data,
        numQuestoes: totalQuestoes,
        acertos: totalAcertos,
        erros: totalErros,
        taxa,
        tipo: "Questão avulsa (Resolver com IA)",
        observacoes: "",
        // Armazena apenas o primeiro enunciado como referência (ou poderia concatenar)
        enunciado: grupo.questoes[0].enunciado,
        resultado: grupo.questoes[0].resultado,
        respostaMarcada: grupo.questoes[0].respostaMarcada,
        gabaritoConfirmado: grupo.questoes[0].gabaritoConfirmado,
      });

      // Salva resumos de todas as questões do grupo
      for (const q of grupo.questoes) {
        await db.resumos.add({
          tentativaId,
          materia: q.disciplina,
          topico: q.assunto,
          data: q.data,
          textoBruto: q.bruto,
          textoCondensado: q.condensado,
          enviadoAnki: false,
          ankiDeck: null,
        });
      }
    }

    await reloadState();
    updateStreakMini();
    showToast(`${_resolverIABuffer.length} questão(ões) registradas e resumos salvos no Caderno.`, "success");

    // Zera a contagem e a sessão atual ao finalizar
    _resolverIAContagem = { certas: 0, erradas: 0, brancos: 0 };
    _resolverIASessao = { disciplina: "", assunto: "", banca: "", concurso: "" };
    _resolverIAAtual = null;
    _resolverIABuffer = [];
    location.hash = "#/caderno";
  });

  $("#btn-gerar-resumo-ia").addEventListener("click", async () => {
    const enunciado = $("#ia-enunciado").value.trim();
    if (!enunciado) {
      showToast("Cole o enunciado da questão primeiro.", "danger");
      return;
    }

    const disciplinaPreenchida = $("#ia-disciplina").value.trim();
    if (!disciplinaPreenchida) {
      showToast(
        "Preencha a Disciplina antes de gerar — sem isso o resumo fica sem matéria no Caderno.",
        "danger",
      );
      $("#ia-disciplina").focus();
      return;
    }

    const gabaritoOficial = $("#ia-gabarito-oficial").value.trim();
    const respostaMarcada = $("#ia-resposta-marcada").value.trim();

    // Captura os campos de matéria direto do DOM aqui (não só via listener
    // de 'change') — se o usuário selecionou pelo autocomplete ou clicou
    // direto em "Gerar" sem tirar o foco do campo, o evento 'change' pode
    // não ter disparado ainda, e o re-render que acontece depois de gerar
    // reconstrói o formulário a partir de _resolverIASessao. Sem isso, os
    // campos voltavam vazios ("(Sem matéria)") mesmo com o texto digitado.
    _resolverIASessao = {
      disciplina: $("#ia-disciplina").value.trim(),
      assunto: $("#ia-assunto").value.trim(),
      banca: $("#ia-banca").value.trim(),
      concurso: $("#ia-concurso").value.trim(),
    };
    const { disciplina, assunto } = _resolverIASessao;

    const btn = $("#btn-gerar-resumo-ia");
    btn.disabled = true;
    btn.textContent = "Gerando...";

    // Mostra preview de streaming enquanto a IA responde
    const resultWrap = $("#ia-resultado-wrap");
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
      return m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    try {
      const ia = await gerarResumoIA(
        { enunciado, gabaritoOficial, disciplina, assunto },
        {
          onStream(acumulado) {
            const charsEl = $("#ia-stream-chars");
            const textEl = $("#ia-stream-text");
            if (!charsEl || !textEl) return;
            charsEl.textContent = `${acumulado.length} caracteres`;
            const parcial = _extrairBrutoStream(acumulado);
            if (parcial) textEl.textContent = parcial;
          },
        },
      );
      _resolverIAAtual = {
        enunciado,
        gabaritoOficial,
        respostaMarcada,
        bruto: ia.bruto,
        condensado: ia.condensado,
        gabaritoSugerido: ia.gabaritoSugerido,
        gabaritoConfirmado: gabaritoOficial || ia.gabaritoSugerido || "",
        resultado: null,
      };
      renderResolverIA(view);
    } catch (err) {
      showToast(
        err.message || "Não foi possível gerar o resumo agora.",
        "danger",
      );
      btn.disabled = false;
      btn.textContent = "✨ Gerar explicação com IA";
      resultWrap.innerHTML = "";
    }
  });

  _renderResolverIAResultado(view);
}

function _renderResolverIAResultado(view) {
  const wrap = $("#ia-resultado-wrap");
  if (!wrap || !_resolverIAAtual || !_resolverIAAtual.bruto) {
    if (wrap) wrap.innerHTML = "";
    return;
  }

  const r = _resolverIAAtual;
  const foiInformado = !!r.gabaritoOficial;

  wrap.innerHTML = `
    <div class="card mb-12">
      <div class="card-title" style="margin-bottom:10px;">Explicação gerada</div>

      ${
        foiInformado
          ? `<span class="badge success" style="margin-bottom:10px;display:inline-block;">Gabarito informado: ${escapeHtml(r.gabaritoOficial)}</span>`
          : `<span class="badge muted" style="margin-bottom:10px;display:inline-block;">🤖 IA sugere: ${escapeHtml(r.gabaritoSugerido || "—")} (confirme antes de salvar)</span>`
      }

      <div class="texto-resumo-bruto" style="line-height:1.6;font-size:13.5px;color:var(--text);margin:8px 0 14px;">${_mdParaHtml(r.bruto)}</div>

      <div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:13px;margin-bottom:16px;">
        📎 ${escapeHtml(r.condensado)}
      </div>

      <div class="form-grid-2">
        <div class="form-row">
          <label>Gabarito confirmado (obrigatório pra salvar)</label>
          <input type="text" id="ia-gabarito-confirmado" value="${escapeHtml(r.gabaritoConfirmado || "")}" placeholder="Ex: C">
        </div>
        <div class="form-row" style="align-self:flex-end;">
          <button class="btn btn-sm" id="btn-regenerar-com-gabarito">🔄 Regenerar explicação com esse gabarito</button>
        </div>
      </div>

      <div class="form-row">
        <label>Como foi essa questão?</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm ${r.resultado === "certa" ? "btn-primary" : ""}" data-resultado="certa">✅ Acertei</button>
          <button class="btn btn-sm ${r.resultado === "errada" ? "btn-primary" : ""}" data-resultado="errada">❌ Errei</button>
          <button class="btn btn-sm ${r.resultado === "branco" ? "btn-primary" : ""}" data-resultado="branco">⬜ Deixei em branco</button>
        </div>
      </div>

      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-ghost btn-sm" id="btn-descartar-ia">Descartar</button>
        <button class="btn btn-primary btn-sm" id="btn-salvar-ia" ${!r.resultado ? "disabled" : ""}>Salvar e ir pra próxima questão</button>
      </div>
    </div>
  `;

  $$("[data-resultado]", wrap).forEach((btn) =>
    btn.addEventListener("click", () => {
      _resolverIAAtual.resultado = btn.dataset.resultado;
      _renderResolverIAResultado(view);
    }),
  );

  $("#ia-gabarito-confirmado").addEventListener("change", (e) => {
    _resolverIAAtual.gabaritoConfirmado = e.target.value.trim();
  });

  $("#btn-regenerar-com-gabarito").addEventListener("click", async () => {
    const gabaritoCorrigido = $("#ia-gabarito-confirmado").value.trim();
    if (!gabaritoCorrigido) {
      showToast("Informe o gabarito antes de regenerar.", "danger");
      return;
    }
    const btn = $("#btn-regenerar-com-gabarito");
    btn.disabled = true;
    btn.textContent = "Regenerando...";
    try {
      const ia = await gerarResumoIA({
        enunciado: r.enunciado,
        gabaritoOficial: gabaritoCorrigido,
        disciplina: $("#ia-disciplina").value.trim(),
        assunto: $("#ia-assunto").value.trim(),
      });
      _resolverIAAtual.gabaritoOficial = gabaritoCorrigido;
      _resolverIAAtual.gabaritoConfirmado = gabaritoCorrigido;
      _resolverIAAtual.bruto = ia.bruto;
      _resolverIAAtual.condensado = ia.condensado;
      _renderResolverIAResultado(view);
      showToast("Explicação regenerada.", "success");
    } catch (err) {
      showToast(err.message || "Não foi possível regenerar agora.", "danger");
      btn.disabled = false;
      btn.textContent = "🔄 Regenerar explicação com esse gabarito";
    }
  });

  $("#btn-descartar-ia").addEventListener("click", () => {
    _resolverIAAtual = null;
    renderResolverIA(view);
  });

  $("#btn-salvar-ia").addEventListener("click", async () => {
    const gabaritoConfirmado = $("#ia-gabarito-confirmado").value.trim();
    if (!gabaritoConfirmado) {
      showToast("Confirme o gabarito antes de salvar.", "danger");
      return;
    }
    if (!r.resultado) {
      showToast("Marque se você acertou, errou ou deixou em branco.", "danger");
      return;
    }

    const disciplina = $("#ia-disciplina").value.trim();
    const assunto = $("#ia-assunto").value.trim();
    const banca = $("#ia-banca").value.trim();
    const concurso = $("#ia-concurso").value.trim();
    const respostaMarcada = $("#ia-resposta-marcada").value.trim();

    // Adiciona ao buffer para agrupamento posterior
    _resolverIABuffer.push({
      disciplina,
      assunto,
      banca,
      concurso,
      data: todayISO(),
      acertos: r.resultado === "certa" ? 1 : 0,
      erros: r.resultado === "errada" ? 1 : 0,
      enunciado: r.enunciado,
      resultado: r.resultado,
      respostaMarcada: respostaMarcada || null,
      gabaritoConfirmado,
      bruto: r.bruto,
      condensado: r.condensado,
    });

    _resolverIAContagem[
      r.resultado === "certa"
        ? "certas"
        : r.resultado === "errada"
          ? "erradas"
          : "brancos"
    ]++;
    _resolverIASessao = { disciplina, assunto, banca, concurso };
    _resolverIAAtual = null;

    updateStreakMini();
    showToast("Questão adicionada à sessão. Continue resolvendo ou finalize para salvar.", "success");
    renderResolverIA(view);
    $("#ia-enunciado")?.focus();
  });
}

/* ============================================================
   TELA: CADERNO DE RESUMOS
   ============================================================
   Mostra state.resumos organizados em árvore Matéria -> Tópico, com as
   entradas do tópico selecionado agrupadas por sessão (mesmo dia),
   mais recente primeiro. Reaproveita a mesma normalização de nome usada em
   calcRelatorioDiario, pra "Direito Constitucional" e "direito constitucional"
   caírem no mesmo grupo.
   ============================================================ */

let _cadernoSelecao = { materia: null, topico: null };
let _cadernoBusca = "";
let _cadernoAnotacoes = new Map(); // mapa tentativaId -> anotação do usuário

/** Agrupa state.resumos em { materia -> { topico -> [resumos] } }, com
 *  contagem por nó, pronta pra desenhar a árvore da sidebar do Caderno. */
function calcCadernoArvore() {
  const norm = (s) => (s || "").trim().toLowerCase();
  const arvore = new Map(); // chaveNorm materia -> { nome, topicos: Map(chaveNorm topico -> {nome, resumos:[]}) }

  state.resumos.forEach((r) => {
    const nomeMateria = (r.materia || "").trim() || "(Sem matéria)";
    const nomeTopico = (r.topico || "").trim() || "(Sem tópico)";
    const chaveMateria = norm(nomeMateria);
    const chaveTopico = norm(nomeTopico);

    if (!arvore.has(chaveMateria))
      arvore.set(chaveMateria, { nome: nomeMateria, topicos: new Map() });
    const materiaNode = arvore.get(chaveMateria);

    if (!materiaNode.topicos.has(chaveTopico))
      materiaNode.topicos.set(chaveTopico, { nome: nomeTopico, resumos: [] });
    materiaNode.topicos.get(chaveTopico).resumos.push(r);
  });

  return arvore;
}

function renderCaderno(view) {
  const arvore = calcCadernoArvore();
  const materias = Array.from(arvore.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR"),
  );

  if (!materias.length) {
    view.innerHTML = `
      <div class="empty-state">
        <p>Nenhum resumo no Caderno ainda.</p>
        <p class="text-muted" style="font-size:13px;">Resolva questões na tela "Resolver com IA" para começar a preencher o Caderno automaticamente.</p>
        <button class="btn btn-primary" id="empty-ir-resolver-ia">Ir para Resolver com IA</button>
      </div>
    `;
    $("#empty-ir-resolver-ia").addEventListener("click", () => {
      location.hash = "#/resolver-ia";
    });
    return;
  }

  // Se nada selecionado ainda (ou seleção antiga não existe mais), seleciona a primeira matéria.
  if (!_cadernoSelecao.materia || !arvore.has(norm2(_cadernoSelecao.materia))) {
    _cadernoSelecao = { materia: materias[0].nome, topico: null };
  }

  view.innerHTML = `
    <div class="caderno-layout">
      <div class="caderno-sidebar" id="caderno-sidebar"></div>
      <div class="caderno-main" id="caderno-main"></div>
    </div>
  `;

  function norm2(s) {
    return (s || "").trim().toLowerCase();
  }

  function renderSidebar() {
    const sidebar = $("#caderno-sidebar");
    sidebar.innerHTML = materias
      .map((m) => {
        const aberta = norm2(m.nome) === norm2(_cadernoSelecao.materia);
        const topicos = Array.from(m.topicos.values()).sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR"),
        );
        return `
        <div class="caderno-materia">
          <div class="caderno-materia-head" data-materia="${escapeHtml(m.nome)}">
            <span class="arrow">${aberta ? "▾" : "▸"}</span> ${escapeHtml(m.nome)}
          </div>
          ${
            aberta
              ? `
            <div class="caderno-topicos">
              ${topicos
                .map(
                  (t) => `
                <div class="caderno-topico ${norm2(t.nome) === norm2(_cadernoSelecao.topico) ? "active" : ""}" data-topico="${escapeHtml(t.nome)}">
                  <span>${escapeHtml(t.nome)}</span><span class="count">${t.resumos.length}</span>
                </div>
              `,
                )
                .join("")}
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");

    $$(".caderno-materia-head", sidebar).forEach((el) =>
      el.addEventListener("click", () => {
        const nome = el.dataset.materia;
        _cadernoSelecao =
          norm2(_cadernoSelecao.materia) === norm2(nome)
            ? { materia: null, topico: null }
            : { materia: nome, topico: null };
        renderSidebar();
        renderMain();
      }),
    );
    $$(".caderno-topico", sidebar).forEach((el) =>
      el.addEventListener("click", () => {
        _cadernoSelecao.topico = el.dataset.topico;
        renderSidebar();
        renderMain();
      }),
    );
  }

  function renderMain() {
    const main = $("#caderno-main");
    const materiaNode = materias.find(
      (m) => norm2(m.nome) === norm2(_cadernoSelecao.materia),
    );

    if (!materiaNode) {
      main.innerHTML = `<p class="text-muted">Selecione uma matéria ao lado.</p>`;
      return;
    }

    const topicoNode = _cadernoSelecao.topico
      ? materiaNode.topicos.get(norm2(_cadernoSelecao.topico))
      : null;

    let resumos = topicoNode
      ? topicoNode.resumos
      : Array.from(materiaNode.topicos.values()).flatMap((t) => t.resumos);

    const termo = _cadernoBusca.trim().toLowerCase();
    if (termo) {
      resumos = resumos.filter(
        (r) =>
          (r.textoBruto || "").toLowerCase().includes(termo) ||
          (r.textoCondensado || "").toLowerCase().includes(termo),
      );
    }

    resumos = [...resumos].sort(
      (a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id,
    );

    // Agrupa por data só pra exibição (sessão = mesmo dia).
    const porData = new Map();
    resumos.forEach((r) => {
      const d = r.data || "(sem data)";
      if (!porData.has(d)) porData.set(d, []);
      porData.get(d).push(r);
    });

    main.innerHTML = `
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <div>
          <div class="text-muted" style="font-size:12.5px;">${escapeHtml(materiaNode.nome)}</div>
          <h2 style="margin:2px 0 0;font-size:19px;">${escapeHtml(topicoNode ? topicoNode.nome : "Todos os tópicos")}</h2>
        </div>
        <input type="text" id="caderno-busca" class="search-input" style="max-width:260px;" placeholder="🔍 Buscar nos resumos..." value="${escapeHtml(_cadernoBusca)}">
      </div>

      ${
        !resumos.length
          ? `<p class="text-muted">Nenhum resumo encontrado.</p>`
          : Array.from(porData.entries())
              .map(
                ([data, itens]) => `
        <div class="sessao" style="margin-bottom:22px;">
          <div class="flex" style="align-items:center;gap:10px;margin-bottom:10px;">
            <span style="font-size:12px;color:var(--text-muted);background:var(--surface-2);padding:3px 10px;border-radius:999px;">${data === todayISO() ? "Hoje" : toBRDate(data)}</span>
            <div style="flex:1;height:1px;background:var(--border);"></div>
          </div>
          ${itens
            .map((r) => {
              const t = state.tentativas.find((x) => x.id === r.tentativaId);
              const anotacaoSalva = _cadernoAnotacoes.get(r.tentativaId) || "";
              return `
            <div class="card mb-12">
              <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <div style="font-size:12px;color:var(--text-muted);">
                  ${t ? `<b style="color:var(--text)">${escapeHtml(t.disciplina)}</b> · <span class="badge ${t.resultado === "certa" ? "success" : t.resultado === "errada" ? "danger" : "muted"}">${t.resultado === "certa" ? "Certa" : t.resultado === "errada" ? "Errada" : "Branco"}</span>` : "Resumo avulso"}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  <button class="btn btn-sm" data-editar-resumo="${r.id}">✏️ Editar</button>
                  <button class="btn btn-sm btn-ghost" data-excluir-resumo="${r.id}">🗑 Excluir</button>
                  <button class="btn btn-sm ${r.enviadoAnki ? "enviado" : ""}" data-enviar-anki="${r.id}" ${r.enviadoAnki ? "disabled" : ""}>
                    ${r.enviadoAnki ? "✓ Enviado ao Anki" : "Enviar pro Anki"}
                  </button>
                </div>
              </div>
              ${t?.enunciado ? `
              <div style="margin-bottom:12px;padding:12px;background:var(--surface-2);border-radius:8px;border-left:3px solid var(--info);">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;font-weight:700;">📝 Enunciado</div>
                <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:var(--text);">${escapeHtml(t.enunciado)}</div>
              </div>
              ` : ""}
              <div style="line-height:1.6;font-size:13.5px;color:var(--text);margin:8px 0;">${_mdParaHtml(r.textoBruto)}</div>
              ${r.textoCondensado ? `<div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:13px;margin-top:10px;">📎 ${escapeHtml(r.textoCondensado)}</div>` : ""}
              <div style="margin-top:14px;">
                <label style="font-size:12px;color:var(--text-muted);font-weight:600;display:block;margin-bottom:6px;">📌 Suas anotações</label>
                <textarea class="caderno-anotacao" data-tentativa-id="${r.tentativaId}" rows="3" placeholder="Digite suas anotações pessoais sobre esta questão...">${escapeHtml(anotacaoSalva)}</textarea>
              </div>
            </div>
          `;
            })
            .join("")}
        </div>
      `,
              )
              .join("")
      }
    `;

    // Listener para busca
    $("#caderno-busca").addEventListener("input", (e) => {
      _cadernoBusca = e.target.value;
      renderMain();
    });

    // Listener para anotações (salva em tempo real no Map em memória)
    main.addEventListener("input", (e) => {
      if (e.target.classList.contains("caderno-anotacao")) {
        const tentativaId = Number(e.target.dataset.tentativaId);
        const valor = e.target.value;
        if (valor.trim()) {
          _cadernoAnotacoes.set(tentativaId, valor);
        } else {
          _cadernoAnotacoes.delete(tentativaId);
        }
      }
    });

    $$("[data-enviar-anki]", main).forEach((btn) =>
      btn.addEventListener("click", () => {
        // Fase 2 do roadmap (AnkiConnect) ainda não está plugada — placeholder por enquanto.
        showToast(
          "Integração com Anki ainda não configurada nesta tela (próxima fase do roadmap).",
          "",
        );
      }),
    );

    $$("[data-excluir-resumo]", main).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (
          !confirm(
            "Excluir este resumo do Caderno? Essa ação não pode ser desfeita.",
          )
        )
          return;
        await db.resumos.remove(Number(btn.dataset.excluirResumo));
        await reloadState();
        renderCaderno(view);
        showToast("Resumo excluído.", "danger");
      }),
    );

    $$("[data-editar-resumo]", main).forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.editarResumo);
        const resumo = state.resumos.find((r) => r.id === id);
        if (!resumo) return;
        openModal(`
        <h2>Editar resumo</h2>
        <form id="form-editar-resumo">
          <div class="form-row">
            <label>Explicação completa</label>
            <textarea name="textoBruto" rows="12" style="font-size:13px;">${escapeHtml(resumo.textoBruto || "")}</textarea>
          </div>
          <div class="form-row">
            <label>Versão condensada</label>
            <textarea name="textoCondensado" rows="3" style="font-size:13px;">${escapeHtml(resumo.textoCondensado || "")}</textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="btn-cancelar-editar-resumo">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar alterações</button>
          </div>
        </form>
      `);
        $("#btn-cancelar-editar-resumo").addEventListener("click", closeModal);
        $("#form-editar-resumo").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          await db.resumos.update({
            ...resumo,
            textoBruto: fd.get("textoBruto").trim(),
            textoCondensado: fd.get("textoCondensado").trim(),
          });
          closeModal();
          await reloadState();
          renderCaderno(view);
          showToast("Resumo atualizado.", "success");
        });
      }),
    );
  }

  renderSidebar();
  renderMain();
}

/* ============================================================
   TELA: ESTATÍSTICAS (agrupamentos: disciplina/assunto/banca/concurso)
   ============================================================ */

const AGRUPAMENTO_CONFIG = {
  disciplinas: {
    chave: "disciplina",
    titulo: "Disciplina",
    clicavel: true,
    rota: "disciplinas",
  },
  assuntos: {
    chave: "assunto",
    titulo: "Assunto",
    clicavel: true,
    rota: "assuntos",
  },
  bancas: { chave: "banca", titulo: "Banca", clicavel: false },
  concursos: { chave: "concurso", titulo: "Concurso", clicavel: false },
};

function renderAgrupamento(view, tipo) {
  const cfg = AGRUPAMENTO_CONFIG[tipo] || AGRUPAMENTO_CONFIG.disciplinas;
  const dados = agruparPor(state.tentativas, cfg.chave);

  if (!dados.length) {
    view.innerHTML = `<div class="empty-state"><p>Nenhuma tentativa registrada para gerar estatísticas por ${cfg.titulo.toLowerCase()}.</p></div>`;
    return;
  }

  const isRanking = tipo === "bancas";

  view.innerHTML = `
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${isRanking ? "<th>#</th>" : ""}
              <th>${cfg.titulo}</th><th>Tentativas</th><th>Certas</th><th>Erradas</th><th>Total</th><th>% de acerto</th>
            </tr>
          </thead>
          <tbody>
            ${dados
              .map(
                (d, i) => `
              <tr class="${cfg.clicavel ? "clickable" : ""}" ${cfg.clicavel ? `data-nome="${escapeHtml(d.nome)}"` : ""}>
                ${isRanking ? `<td class="num">${i + 1}º</td>` : ""}
                <td>${escapeHtml(d.nome)}</td>
                <td class="num">${d.tentativas}</td>
                <td class="num" style="color:var(--success)">${d.certas}</td>
                <td class="num" style="color:var(--danger)">${d.erradas}</td>
                <td class="num">${d.total}</td>
                <td>
                  <div class="pct-bar-wrap">
                    <div class="pct-bar"><span style="width:${d.taxa.toFixed(1)}%"></span></div>
                    <span class="num">${fmtPct(d.taxa)}</span>
                  </div>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (cfg.clicavel) {
    $$("tr[data-nome]").forEach((tr) => {
      tr.addEventListener("click", () => {
        location.hash = `#/estatisticas/${cfg.rota}/${encodeURIComponent(tr.dataset.nome)}`;
      });
    });
  }
}

/* ---- Detalhe de uma disciplina específica ---- */

function renderDisciplinaDetalhe(view, nomeDisciplina) {
  const lista = state.tentativas.filter(
    (t) => (t.disciplina || "(Não informado)") === nomeDisciplina,
  );
  const resumo = calcResumo(lista);
  const porAssunto = agruparPor(lista, "assunto");

  // evolução: últimos 30 dias, apenas tentativas desta disciplina
  const dias = [];
  for (let i = 29; i >= 0; i--) {
    const iso = daysAgoISO(i);
    const ts = lista.filter((t) => t.data === iso);
    const r = calcResumo(ts);
    dias.push({ iso, certas: r.certas, total: r.total });
  }

  view.innerHTML = `
    <div class="flex mb-12"><a href="#/estatisticas/disciplinas" class="btn btn-ghost btn-sm">&larr; Voltar</a></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Tentativas</div><div class="value">${resumo.tentativas}</div></div>
      <div class="stat-card"><div class="label">Total de questões</div><div class="value">${resumo.total}</div></div>
      <div class="stat-card success"><div class="label">Certas</div><div class="value">${resumo.certas}</div></div>
      <div class="stat-card danger"><div class="label">Erradas</div><div class="value">${resumo.erradas}</div></div>
      <div class="stat-card gold"><div class="label">% de acerto</div><div class="value">${fmtPct(resumo.taxa)}</div></div>
    </div>

    <div class="card mb-12">
      <div class="card-title">Evolução</div>
      <div class="chart-wrap"><canvas id="chart-disciplina-evolucao"></canvas></div>
    </div>

    <div class="section-title">Assuntos estudados</div>
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Assunto</th><th>Tentativas</th><th>Certas</th><th>Erradas</th><th>Total</th><th>% de acerto</th></tr></thead>
          <tbody>
            ${porAssunto
              .map(
                (a) => `
              <tr class="clickable" data-assunto="${escapeHtml(a.nome)}">
                <td>${escapeHtml(a.nome)}</td>
                <td class="num">${a.tentativas}</td>
                <td class="num" style="color:var(--success)">${a.certas}</td>
                <td class="num" style="color:var(--danger)">${a.erradas}</td>
                <td class="num">${a.total}</td>
                <td>
                  <div class="pct-bar-wrap">
                    <div class="pct-bar"><span style="width:${a.taxa.toFixed(1)}%"></span></div>
                    <span class="num">${fmtPct(a.taxa)}</span>
                  </div>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section-title">Histórico de tentativas</div>
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Assunto</th><th>Banca</th><th>Tipo</th><th>Questões</th><th>Acertos</th><th>Erros</th><th>Taxa</th></tr></thead>
          <tbody>
            ${[...lista]
              .sort((a, b) => b.data.localeCompare(a.data))
              .map(
                (t) => `
              <tr>
                <td class="num">${toBRDate(t.data)}</td>
                <td>${escapeHtml(t.assunto) || "-"}</td>
                <td>${escapeHtml(t.banca) || "-"}</td>
                <td><span class="badge muted">${escapeHtml(t.tipo) || "-"}</span></td>
                <td class="num">${t.numQuestoes}</td>
                <td class="num" style="color:var(--success)">${t.acertos}</td>
                <td class="num" style="color:var(--danger)">${t.erros}</td>
                <td class="num">${fmtPct(t.taxa)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $$("tr[data-assunto]").forEach((tr) => {
    tr.addEventListener("click", () => {
      location.hash = `#/estatisticas/assuntos/${encodeURIComponent(tr.dataset.assunto)}`;
    });
  });

  renderLineChart("chart-disciplina-evolucao", {
    labels: dias.map((d) => toBRDate(d.iso).slice(0, 5)),
    series: [
      { label: "Certas", data: dias.map((d) => d.certas) },
      { label: "Total", data: dias.map((d) => d.total) },
    ],
  });
}

/* ---- Detalhe de um assunto específico: evolução por tentativa ---- */

function renderAssuntoDetalhe(view, nomeAssunto) {
  const lista = state.tentativas.filter(
    (t) => (t.assunto || "(Não informado)") === nomeAssunto,
  );

  if (!lista.length) {
    view.innerHTML = `
      <div class="flex mb-12"><a href="#/estatisticas/assuntos" class="btn btn-ghost btn-sm">&larr; Voltar</a></div>
      <div class="empty-state"><p>Nenhuma tentativa registrada para este assunto.</p></div>
    `;
    return;
  }

  const ordenada = [...lista].sort(
    (a, b) => (a.data || "").localeCompare(b.data || "") || a.id - b.id,
  );
  const resumo = calcResumo(lista);
  const melhor = ordenada.reduce(
    (m, t) => (t.taxa > m.taxa ? t : m),
    ordenada[0],
  );
  const pior = ordenada.reduce(
    (m, t) => (t.taxa < m.taxa ? t : m),
    ordenada[0],
  );
  const ultima = ordenada[ordenada.length - 1];
  const primeira = ordenada[0];
  const tendencia = calcTendencia(ordenada);
  const evolucaoPP = ultima.taxa - primeira.taxa;

  view.innerHTML = `
    <div class="flex mb-12"><a href="#/estatisticas/assuntos" class="btn btn-ghost btn-sm">&larr; Voltar</a></div>

    <div class="stat-grid">
      <div class="stat-card"><div class="label">Total de tentativas</div><div class="value">${resumo.tentativas}</div></div>
      <div class="stat-card"><div class="label">Total de questões</div><div class="value">${resumo.total}</div></div>
      <div class="stat-card success"><div class="label">Total de acertos</div><div class="value">${resumo.certas}</div></div>
      <div class="stat-card danger"><div class="label">Total de erros</div><div class="value">${resumo.erradas}</div></div>
      <div class="stat-card gold"><div class="label">Taxa média</div><div class="value">${fmtPct(resumo.taxa)}</div></div>
      <div class="stat-card success"><div class="label">Melhor resultado</div><div class="value">${fmtPct(melhor.taxa)}</div></div>
      <div class="stat-card danger"><div class="label">Pior resultado</div><div class="value">${fmtPct(pior.taxa)}</div></div>
      <div class="stat-card info"><div class="label">Última tentativa</div><div class="value">${toBRDate(ultima.data)}</div></div>
      <div class="stat-card"><div class="label">Tendência</div><div class="value">${tendencia.icone} ${tendencia.label}</div></div>
    </div>

    <div class="card mb-12">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>Evolução da taxa de acertos</span>
        <span class="text-muted" style="font-weight:500;font-size:13px;text-transform:none;letter-spacing:normal;">
          ${evolucaoPP >= 0 ? "📈" : "📉"} ${fmtPctSigned(evolucaoPP)} desde a primeira tentativa
        </span>
      </div>
      <div class="chart-wrap"><canvas id="chart-assunto-evolucao"></canvas></div>
    </div>

    <div class="section-title">Histórico completo</div>
    <div class="timeline">
      ${[...ordenada]
        .reverse()
        .map(
          (t) => `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-card">
            <div class="timeline-card-head">
              <span class="timeline-date">${toBRDate(t.data)}</span>
              <span class="badge muted">${escapeHtml(t.tipo) || "-"}</span>
            </div>
            <div class="timeline-stats">
              <span><strong>${t.numQuestoes}</strong> questões</span>
              <span style="color:var(--success)"><strong>${t.acertos}</strong> acertos</span>
              <span style="color:var(--danger)"><strong>${t.erros}</strong> erros</span>
              <span class="timeline-taxa">${fmtPct(t.taxa)}</span>
            </div>
            ${t.observacoes ? `<div class="timeline-obs">${escapeHtml(t.observacoes)}</div>` : ""}
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  renderLineChart("chart-assunto-evolucao", {
    labels: ordenada.map((t) => toBRDate(t.data).slice(0, 5)),
    series: [
      {
        label: "% de acerto",
        data: ordenada.map((t) => Number(t.taxa.toFixed(1))),
      },
    ],
  });
}

/* ============================================================
   TELA: EDITAIS (lista)
   A importação inteligente, o quadro Kanban de cada edital e o
   cálculo de progresso (calcProgressoEdital) vivem em editais.js —
   o cadastro manual de disciplina/tópico foi substituído pela
   Importação Inteligente de Editais.
   ============================================================ */

function renderEditais(view) {
  view.innerHTML = `
    <div class="toolbar">
      <div class="text-muted">Importe o edital automaticamente e acompanhe o progresso por disciplina e tópico.</div>
      <a class="btn btn-primary" href="#/editais/importar">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
        Importar edital
      </a>
    </div>
    <div id="lista-editais"></div>
  `;

  renderListaEditais();

  function renderListaEditais() {
    const wrap = $("#lista-editais");
    if (!state.editais.length) {
      wrap.innerHTML = `<div class="empty-state">
        <p>Nenhum edital cadastrado ainda.</p>
        <a class="btn btn-primary" href="#/editais/importar">Importar edital</a>
      </div>`;
      return;
    }
    wrap.innerHTML = `<div class="grid-3">
      ${state.editais
        .map((e) => {
          const prog = calcProgressoEdital(e);
          return `
        <div class="card clickable" data-edital="${e.id}" style="cursor:pointer;">
          <div class="card-title">${escapeHtml(e.concurso || "Edital")}</div>
          <h3 style="margin:0 0 10px;font-family:var(--font-display);">${escapeHtml(e.nome)}</h3>
          <div class="pct-bar-wrap mb-12">
            <div class="pct-bar"><span style="width:${prog.pct.toFixed(1)}%"></span></div>
            <span class="num">${fmtPct(prog.pct)}</span>
          </div>
          <div class="text-muted" style="font-size:13px;">${prog.dominado}/${prog.total} tópicos dominados</div>
        </div>`;
        })
        .join("")}
    </div>`;
    $$("[data-edital]", wrap).forEach((card) => {
      card.addEventListener("click", () => {
        location.hash = `#/editais/${card.dataset.edital}`;
      });
    });
  }
}

/* ============================================================
   TELA: SIMULADOS
   ============================================================ */

function renderSimulados(view) {
  const lista = [...state.simulados].sort((a, b) =>
    (b.data || "").localeCompare(a.data || ""),
  );

  view.innerHTML = `
    <div class="toolbar">
      <div class="text-muted">Registre seus simulados e acompanhe a evolução do aproveitamento.</div>
      <button class="btn btn-primary" id="btn-novo-simulado">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
        Novo simulado
      </button>
    </div>

    ${
      lista.length
        ? `
    <div class="card mb-12">
      <div class="card-title">Evolução do aproveitamento</div>
      <div class="chart-wrap"><canvas id="chart-simulados"></canvas></div>
    </div>`
        : ""
    }

    <div class="card" style="padding:0;">
      <div class="table-wrap" id="tabela-simulados"></div>
    </div>
  `;

  $("#btn-novo-simulado").addEventListener("click", () => openSimuladoModal());

  if (lista.length) {
    const cronologico = [...lista].reverse();
    renderLineChart("chart-simulados", {
      labels: cronologico.map((s) => toBRDate(s.data).slice(0, 5)),
      series: [
        {
          label: "% de acerto",
          data: cronologico.map((s) =>
            s.numQuestoes
              ? Number(((s.acertos / s.numQuestoes) * 100).toFixed(1))
              : 0,
          ),
        },
      ],
    });
  }

  const wrap = $("#tabela-simulados");
  if (!lista.length) {
    wrap.innerHTML = `<div class="empty-state">
      <p>Nenhum simulado cadastrado ainda.</p>
      <button class="btn btn-primary" id="empty-add-simulado">Cadastrar simulado</button>
    </div>`;
    $("#empty-add-simulado")?.addEventListener("click", () =>
      openSimuladoModal(),
    );
  } else {
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Nome</th><th>Matéria</th><th>Tópico</th><th>Banca</th><th>Questões</th><th>Acertos</th><th>Erros</th><th>Aproveitamento</th><th>Tempo</th><th></th></tr></thead>
        <tbody>
          ${lista
            .map((s) => {
              const pct = s.numQuestoes ? (s.acertos / s.numQuestoes) * 100 : 0;
              // Tenta extrair matéria, tópico e banca das questões associadas a este simulado
              // Se for um simulado antigo sem essa info, mostra "—"
              const questoesRelacionadas = state.tentativas.filter(t => t.simuladoId === s.id);
              const materiasUnicas = [...new Set(questoesRelacionadas.map(q => q.disciplina).filter(Boolean))];
              const topicosUnicos = [...new Set(questoesRelacionadas.map(q => q.assunto).filter(Boolean))];
              const bancasUnicas = [...new Set(questoesRelacionadas.map(q => q.banca).filter(Boolean))];
              const materiaDisplay = materiasUnicas.length > 0 
                ? (materiasUnicas.length > 1 ? `<span style="font-size:11px;color:var(--text-muted);">${materiasUnicas.length} matérias</span>` : escapeHtml(materiasUnicas[0]))
                : "—";
              const topicoDisplay = topicosUnicos.length > 0
                ? (topicosUnicos.length > 1 ? `<span style="font-size:11px;color:var(--text-muted);">${topicosUnicos.length} tópicos</span>` : escapeHtml(topicosUnicos[0]))
                : "—";
              const bancaDisplay = bancasUnicas.length > 0
                ? (bancasUnicas.length > 1 ? `<span style="font-size:11px;color:var(--text-muted);">${bancasUnicas.length} bancas</span>` : escapeHtml(bancasUnicas[0]))
                : "—";
              return `
            <tr>
              <td class="num">${toBRDate(s.data)}</td>
              <td>${escapeHtml(s.nome)}</td>
              <td style="font-size:13px;">${materiaDisplay}</td>
              <td style="font-size:13px;">${topicoDisplay}</td>
              <td style="font-size:13px;">${bancaDisplay}</td>
              <td class="num">${s.numQuestoes}</td>
              <td class="num" style="color:var(--success)">${s.acertos}</td>
              <td class="num" style="color:var(--danger)">${s.erros}</td>
              <td>${fmtPct(pct)}</td>
              <td class="num">${s.tempo ? fmtTempo(s.tempo) : "-"}</td>
              <td><button class="icon-btn" data-del-sim="${s.id}" title="Excluir">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7zM9 4h6l1 2H8zM9 10v8M12 10v8M15 10v8"/></svg>
              </button></td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;
    $$("[data-del-sim]", wrap).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir este simulado?")) return;
        await db.simulados.remove(Number(btn.dataset.delSim));
        await reloadState();
        renderSimulados(view);
        showToast("Simulado excluído.", "danger");
      }),
    );
  }

  // Banco pessoal de questões do Resolver com IA
  _renderBancoQuestoesIA(view);
}

/* ============================================================
   BANCO PESSOAL DE QUESTÕES (Resolver com IA)
   Seção exibida abaixo dos simulados com todas as questões
   resolvidas pelo "Resolver com IA", cada uma com enunciado,
   gabarito, resultado e o comentário gerado pela IA.
   ============================================================ */

function _renderBancoQuestoesIA(view) {
  const questoesIA = state.tentativas
    .filter((t) => t.tipo === "Questão avulsa (Resolver com IA)" && t.enunciado)
    .sort((a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id);

  const secao = document.createElement("div");
  secao.style.marginTop = "24px";

  if (!questoesIA.length) {
    secao.innerHTML = `
      <div class="section-title">Banco Pessoal de Questões (IA)</div>
      <div class="card">
        <p class="text-muted" style="font-size:13.5px;margin:0;">
          Nenhuma questão no banco ainda. Use "Resolver com IA" para resolver questões —
          elas são salvas aqui automaticamente com o comentário gerado pela IA.
        </p>
      </div>
    `;
    view.appendChild(secao);
    return;
  }

  secao.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
      <div class="section-title" style="margin:0;">
        Banco Pessoal de Questões (IA)
        <span style="font-size:14px;font-weight:normal;color:var(--text-muted);margin-left:6px;">${questoesIA.length} questão${questoesIA.length !== 1 ? "ões" : ""}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-primary btn-sm" id="btn-gerar-simulado-ia">🎯 Gerar Simulado</button>
        <select id="banco-ia-filtro-materia" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:var(--radius-sm);font-size:13px;">
          <option value="">Todas as matérias</option>
          ${[...new Set(questoesIA.map(q => q.disciplina).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR")).map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("")}
        </select>
        <select id="banco-ia-filtro-topico" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:var(--radius-sm);font-size:13px;">
          <option value="">Todos os tópicos</option>
        </select>
        <select id="banco-ia-filtro-banca" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:var(--radius-sm);font-size:13px;">
          <option value="">Todas as bancas</option>
          ${[...new Set(questoesIA.map(q => q.banca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR")).map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("")}
        </select>
        <input type="text" id="banco-ia-busca" class="search-input" style="max-width:200px;" placeholder="🔍 Buscar…">
      </div>
    </div>
    <div id="banco-ia-lista"></div>
  `;

  view.appendChild(secao);

  let _bancoBusca = "";
  let _bancoFiltroMateria = "";
  let _bancoFiltroTopico = "";
  let _bancoFiltroBanca = "";

  function renderListaBanco() {
    const termo = _bancoBusca.trim().toLowerCase();
    let lista = questoesIA;
    
    // Aplica filtros de matéria, tópico e banca
    if (_bancoFiltroMateria) {
      lista = lista.filter(t => t.disciplina === _bancoFiltroMateria);
    }
    if (_bancoFiltroTopico) {
      lista = lista.filter(t => t.assunto === _bancoFiltroTopico);
    }
    if (_bancoFiltroBanca) {
      lista = lista.filter(t => t.banca === _bancoFiltroBanca);
    }
    
    if (termo) {
      lista = lista.filter(
        (t) =>
          (t.enunciado || "").toLowerCase().includes(termo) ||
          (t.disciplina || "").toLowerCase().includes(termo) ||
          (t.assunto || "").toLowerCase().includes(termo) ||
          (t.banca || "").toLowerCase().includes(termo),
      );
    }

    const listaEl = $("#banco-ia-lista");
    if (!lista.length) {
      listaEl.innerHTML = `<p class="text-muted" style="padding:8px 0;">Nenhuma questão encontrada para esses filtros.</p>`;
      return;
    }

    listaEl.innerHTML = lista
      .map((t) => {
        const resumo = state.resumos.find((r) => r.tentativaId === t.id);
        const resultadoClass =
          t.resultado === "certa"
            ? "success"
            : t.resultado === "errada"
              ? "danger"
              : "muted";
        const resultadoLabel =
          t.resultado === "certa"
            ? "Certa"
            : t.resultado === "errada"
              ? "Errada"
              : "Branco";
        return `
        <div class="card mb-12">
          <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
            <div>
              <b style="font-size:14px;">${escapeHtml(t.disciplina || "(Sem disciplina)")}</b>
              ${t.assunto ? `<span style="color:var(--text-muted);font-size:13px;"> · ${escapeHtml(t.assunto)}</span>` : ""}
              ${t.banca ? `<span style="color:var(--text-muted);font-size:12px;"> · ${escapeHtml(t.banca)}</span>` : ""}
              ${t.concurso ? `<span style="color:var(--text-muted);font-size:12px;"> · ${escapeHtml(t.concurso)}</span>` : ""}
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <span class="badge ${resultadoClass}">${resultadoLabel}</span>
              <span style="font-size:12px;color:var(--text-muted);">${toBRDate(t.data)}</span>
              ${t.gabaritoConfirmado ? `<span style="font-size:12px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">Gabarito: <b>${escapeHtml(t.gabaritoConfirmado)}</b></span>` : ""}
            </div>
          </div>
          <details>
            <summary style="cursor:pointer;font-size:13px;color:var(--primary);user-select:none;margin-bottom:4px;">Ver enunciado completo</summary>
            <div style="white-space:pre-wrap;font-size:13px;color:var(--text);line-height:1.6;margin:8px 0;padding:10px;background:var(--surface-2);border-radius:6px;">${escapeHtml(t.enunciado || "")}</div>
          </details>
          ${
            resumo
              ? `
            <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">💡 Comentário da IA</div>
              <div style="line-height:1.6;font-size:13px;color:var(--text);">${_mdParaHtml(resumo.textoBruto)}</div>
              ${resumo.textoCondensado ? `<div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:12px;margin-top:8px;">📎 ${escapeHtml(resumo.textoCondensado)}</div>` : ""}
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");
  }

  // Atualiza tópicos quando matéria é selecionada
  function atualizarFiltroTopicos() {
    const topicoSelect = $("#banco-ia-filtro-topico");
    if (!topicoSelect) return;
    
    const topicos = questoesIA
      .filter(t => !_bancoFiltroMateria || t.disciplina === _bancoFiltroMateria)
      .map(t => t.assunto)
      .filter(Boolean);
    const topicosUnicos = [...new Set(topicos)].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    
    topicoSelect.innerHTML = `
      <option value="">Todos os tópicos</option>
      ${topicosUnicos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
    `;
  }

  renderListaBanco();

  $("#banco-ia-filtro-materia")?.addEventListener("change", (e) => {
    _bancoFiltroMateria = e.target.value;
    atualizarFiltroTopicos();
    renderListaBanco();
  });

  $("#banco-ia-filtro-topico")?.addEventListener("change", (e) => {
    _bancoFiltroTopico = e.target.value;
    renderListaBanco();
  });

  $("#banco-ia-filtro-banca")?.addEventListener("change", (e) => {
    _bancoFiltroBanca = e.target.value;
    renderListaBanco();
  });

  $("#banco-ia-busca")?.addEventListener("input", (e) => {
    _bancoBusca = e.target.value;
    renderListaBanco();
  });

  $("#btn-gerar-simulado-ia")?.addEventListener("click", () =>
    _abrirModalGerarSimulado(questoesIA),
  );
}

/* ============================================================
   GERADOR DE SIMULADO PERSONALIZADO
   Fluxo: filtros (modal) → simulado questão a questão →
   resultado com revisão → salvar no histórico de simulados.
   ============================================================ */

// Estado em memória do simulado em andamento (null = nenhum ativo).
let _simuladoGerado = null;

function _abrirModalGerarSimulado(todasQuestoes) {
  const disciplinas = [
    ...new Set(todasQuestoes.map((t) => t.disciplina).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const bancas = [
    ...new Set(todasQuestoes.map((t) => t.banca).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const concursos = [
    ...new Set(todasQuestoes.map((t) => t.concurso).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const qtdMax = todasQuestoes.length;
  const hoje = new Date().toLocaleDateString("pt-BR");

  openModal(`
    <h2>🎯 Gerar Simulado Personalizado</h2>
    <form id="form-gerar-simulado">
      <div class="form-row">
        <label>Nome do simulado</label>
        <input type="text" name="nome" value="Simulado ${hoje}" placeholder="Ex: Revisão Direito Constitucional">
      </div>

      ${
        disciplinas.length > 1
          ? `
      <div class="form-row">
        <label>Disciplinas <span style="font-weight:normal;color:var(--text-muted)">(desmarcadas = todas)</span></label>
        <div style="max-height:130px;overflow-y:auto;padding:8px;background:var(--surface-2);border-radius:6px;display:flex;flex-direction:column;gap:5px;">
          ${disciplinas
            .map(
              (
                d,
              ) => `<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;">
            <input type="checkbox" name="disciplina" value="${escapeHtml(d)}"> ${escapeHtml(d)}
          </label>`,
            )
            .join("")}
        </div>
      </div>`
          : ""
      }

      ${
        bancas.length > 1
          ? `
      <div class="form-row">
        <label>Bancas <span style="font-weight:normal;color:var(--text-muted)">(desmarcadas = todas)</span></label>
        <div style="padding:8px;background:var(--surface-2);border-radius:6px;display:flex;flex-wrap:wrap;gap:4px 12px;">
          ${bancas
            .map(
              (
                b,
              ) => `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
            <input type="checkbox" name="banca" value="${escapeHtml(b)}"> ${escapeHtml(b)}
          </label>`,
            )
            .join("")}
        </div>
      </div>`
          : ""
      }

      ${
        concursos.length > 1
          ? `
      <div class="form-row">
        <label>Concursos <span style="font-weight:normal;color:var(--text-muted)">(desmarcados = todos)</span></label>
        <div style="max-height:100px;overflow-y:auto;padding:8px;background:var(--surface-2);border-radius:6px;display:flex;flex-wrap:wrap;gap:4px 12px;">
          ${concursos
            .map(
              (
                c,
              ) => `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
            <input type="checkbox" name="concurso" value="${escapeHtml(c)}"> ${escapeHtml(c)}
          </label>`,
            )
            .join("")}
        </div>
      </div>`
          : ""
      }

      <div class="form-grid-2">
        <div class="form-row">
          <label>Filtrar por resultado anterior</label>
          <select name="filtroResultado">
            <option value="todas">Todas as questões</option>
            <option value="errada">Só as que errei</option>
            <option value="certa">Só as que acertei</option>
            <option value="branco">Só as em branco</option>
          </select>
        </div>
        <div class="form-row">
          <label>Quantidade máxima</label>
          <input type="number" name="quantidade" min="1" max="${qtdMax}" value="${Math.min(20, qtdMax)}">
        </div>
      </div>

      <div class="form-row">
        <label>Ordenação</label>
        <select name="ordem">
          <option value="aleatorio">Aleatória (embaralhada)</option>
          <option value="erros">Priorizar erros primeiro</option>
          <option value="recente">Mais recentes primeiro</option>
          <option value="antigo">Mais antigas primeiro</option>
        </select>
      </div>

      <div id="gerar-sim-preview" style="font-size:13px;padding:6px 0;"></div>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="btn-cancelar-gerar-sim">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="btn-confirmar-gerar-sim">Iniciar Simulado →</button>
      </div>
    </form>
  `);

  $("#btn-cancelar-gerar-sim").addEventListener("click", closeModal);

  function _filtrarQuestoes() {
    const form = $("#form-gerar-simulado");
    if (!form) return [];
    const discSel = [...form.querySelectorAll("[name=disciplina]:checked")].map(
      (el) => el.value,
    );
    const bancaSel = [...form.querySelectorAll("[name=banca]:checked")].map(
      (el) => el.value,
    );
    const concSel = [...form.querySelectorAll("[name=concurso]:checked")].map(
      (el) => el.value,
    );
    const filtroRes = form.elements.filtroResultado?.value || "todas";
    let lista = todasQuestoes;
    if (discSel.length)
      lista = lista.filter((t) => discSel.includes(t.disciplina));
    if (bancaSel.length)
      lista = lista.filter((t) => bancaSel.includes(t.banca));
    if (concSel.length)
      lista = lista.filter((t) => concSel.includes(t.concurso));
    if (filtroRes !== "todas")
      lista = lista.filter((t) => t.resultado === filtroRes);
    return lista;
  }

  function _atualizarPreview() {
    const form = $("#form-gerar-simulado");
    const preview = $("#gerar-sim-preview");
    const btnOk = $("#btn-confirmar-gerar-sim");
    if (!form || !preview || !btnOk) return;
    const lista = _filtrarQuestoes();
    const qtd = Math.min(
      Number(form.elements.quantidade?.value) || 20,
      lista.length,
    );
    if (lista.length) {
      preview.innerHTML = `<span style="color:var(--success)">✓</span> <b>${lista.length}</b> questões correspondem — serão usadas <b>${qtd}</b>`;
      btnOk.disabled = false;
    } else {
      preview.innerHTML = `<span style="color:var(--danger)">⚠ Nenhuma questão corresponde aos filtros. Ajuste as seleções.</span>`;
      btnOk.disabled = true;
    }
  }

  $("#form-gerar-simulado")
    .querySelectorAll("input, select")
    .forEach((el) => el.addEventListener("change", _atualizarPreview));
  _atualizarPreview();

  $("#form-gerar-simulado").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const nome = form.elements.nome?.value.trim() || "Simulado Personalizado";
    const ordem = form.elements.ordem?.value || "aleatorio";
    const qtd = Number(form.elements.quantidade?.value) || 20;
    let questoes = _filtrarQuestoes();

    if (ordem === "aleatorio") {
      questoes = [...questoes].sort(() => Math.random() - 0.5);
    } else if (ordem === "erros") {
      questoes = [...questoes].sort((a, b) => {
        const rank = (v) => (v === "errada" ? 0 : v === "branco" ? 1 : 2);
        return rank(a.resultado) - rank(b.resultado);
      });
    } else if (ordem === "recente") {
      questoes = [...questoes].sort(
        (a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id,
      );
    } else if (ordem === "antigo") {
      questoes = [...questoes].sort(
        (a, b) => (a.data || "").localeCompare(b.data || "") || a.id - b.id,
      );
    }

    questoes = questoes.slice(0, qtd);

    _simuladoGerado = {
      nome,
      questoes,
      questaoAtual: 0,
      respostas: {},
      gabaritosRevelados: new Set(),
      marcacoes: {},
      finalizado: false,
      inicio: new Date().toISOString(),
      fim: null,
    };

    closeModal();
    location.hash = "#/simulado-gerado";
  });
}

function renderSimuladoGerado(view) {
  if (!_simuladoGerado) {
    view.innerHTML = `
      <div class="empty-state">
        <p>Nenhum simulado ativo no momento.</p>
        <a href="#/simulados" class="btn btn-primary">← Ir para Simulados</a>
      </div>`;
    return;
  }
  if (_simuladoGerado.finalizado) {
    _renderResultadoSimuladoGerado(view);
    return;
  }

  const sg = _simuladoGerado;
  const idx = sg.questaoAtual;
  const total = sg.questoes.length;
  const q = sg.questoes[idx];
  const gabRevelado = sg.gabaritosRevelados.has(q.id);
  const respondidas = Object.keys(sg.respostas).length;
  const resumo = state.resumos.find((r) => r.tentativaId === q.id);
  const pctBarra = Math.round((idx / total) * 100);

  view.innerHTML = `
    <!-- cabeçalho / progresso -->
    <div class="card mb-12" style="padding:12px 16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <div>
          <span style="font-size:13px;color:var(--text-muted);">Questão </span>
          <b style="font-size:22px;">${idx + 1}</b>
          <span style="font-size:13px;color:var(--text-muted);"> / ${total}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:12px;color:var(--text-muted);">${respondidas} respondida${respondidas !== 1 ? "s" : ""}</span>
          <button class="btn btn-ghost btn-sm" id="btn-abandonar-sim">Abandonar</button>
        </div>
      </div>
      <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pctBarra}%;background:var(--primary);border-radius:3px;transition:width .3s;"></div>
      </div>
    </div>

    <!-- enunciado -->
    <div class="card mb-12">
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <b style="font-size:13.5px;">${escapeHtml(q.disciplina || "(Sem disciplina)")}</b>
        ${q.assunto ? `<span style="color:var(--text-muted);font-size:12px;">· ${escapeHtml(q.assunto)}</span>` : ""}
        ${q.banca ? `<span style="font-size:11px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">${escapeHtml(q.banca)}</span>` : ""}
        ${q.concurso ? `<span style="font-size:11px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">${escapeHtml(q.concurso)}</span>` : ""}
        <span style="font-size:11px;color:var(--text-muted);">${toBRDate(q.data)}</span>
      </div>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.75;color:var(--text);padding:14px;background:var(--surface-2);border-radius:8px;">${escapeHtml(q.enunciado || "")}</div>
    </div>

    <!-- resposta + navegação -->
    <div class="card mb-12">
      <div class="form-row" style="margin-bottom:14px;">
        <label>Sua resposta</label>
        <input type="text" id="sim-resposta" autocomplete="off"
          value="${escapeHtml(sg.respostas[q.id] || "")}"
          placeholder="Ex: C  •  Certo  •  Errado"
          style="text-transform:uppercase;max-width:260px;">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${!gabRevelado ? `<button class="btn btn-sm" id="btn-revelar-gab">🔍 Ver gabarito e comentário</button>` : ""}
        <div style="flex:1;"></div>
        ${idx > 0 ? `<button class="btn btn-ghost btn-sm" id="btn-anterior-sim">← Anterior</button>` : ""}
        ${
          idx < total - 1
            ? `<button class="btn btn-primary btn-sm" id="btn-proxima-sim">Próxima →</button>`
            : `<button class="btn btn-primary" id="btn-finalizar-sim">🏁 Ver Resultado</button>`
        }
      </div>
    </div>

    <!-- gabarito + comentário da IA (visível após revelar) -->
    ${
      gabRevelado
        ? `
    <div class="card mb-12" style="border-left:3px solid var(--primary);">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-size:13px;font-weight:600;">Gabarito:</span>
        <span style="font-size:18px;font-weight:800;color:var(--primary);">${escapeHtml(q.gabaritoConfirmado || "(não registrado)")}</span>
        ${
          q.resultado
            ? `<span class="badge ${q.resultado === "certa" ? "success" : q.resultado === "errada" ? "danger" : "muted"}" style="font-size:11px;">
          ${q.resultado === "certa" ? "✅ você acertou da 1ª vez" : q.resultado === "errada" ? "❌ você errou da 1ª vez" : "⬜ deixou em branco da 1ª vez"}
        </span>`
            : ""
        }
      </div>
      <div style="margin-bottom:12px;">
        <span style="font-size:12px;color:var(--text-muted);">Neste simulado:</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
          <button class="btn btn-sm ${sg.marcacoes[q.id] === "certa" ? "btn-primary" : ""}" data-marcar="certa">✅ Acertei</button>
          <button class="btn btn-sm ${sg.marcacoes[q.id] === "errada" ? "btn-primary" : ""}" data-marcar="errada">❌ Errei</button>
          <button class="btn btn-sm ${sg.marcacoes[q.id] === "branco" ? "btn-primary" : ""}" data-marcar="branco">⬜ Em branco</button>
        </div>
      </div>
      ${
        resumo
          ? `
        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">💡 Comentário da IA</div>
          <div style="line-height:1.65;font-size:13px;">${_mdParaHtml(resumo.textoBruto)}</div>
          ${resumo.textoCondensado ? `<div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:12px;margin-top:10px;">📎 ${escapeHtml(resumo.textoCondensado)}</div>` : ""}
        </div>
      `
          : ""
      }
    </div>`
        : ""
    }

    <!-- mini-mapa de questões -->
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
      ${sg.questoes
        .map((qt, i) => {
          const m = sg.marcacoes[qt.id];
          const bg =
            m === "certa"
              ? "var(--success)"
              : m === "errada"
                ? "var(--danger)"
                : sg.gabaritosRevelados.has(qt.id)
                  ? "var(--gold)"
                  : "var(--surface-2)";
          const cor = m ? "#fff" : "var(--text)";
          const borda =
            i === idx ? "2px solid var(--primary)" : "2px solid transparent";
          return `<button class="btn btn-sm sim-mini" data-i="${i}" style="min-width:34px;background:${bg};color:${cor};border:${borda};padding:4px 6px;">${i + 1}</button>`;
        })
        .join("")}
    </div>
  `;

  // — listeners —
  $("#sim-resposta")?.addEventListener("input", (e) => {
    sg.respostas[q.id] = e.target.value.trim().toUpperCase();
  });

  $("#btn-revelar-gab")?.addEventListener("click", () => {
    sg.gabaritosRevelados.add(q.id);
    renderSimuladoGerado(view);
  });

  $("#btn-anterior-sim")?.addEventListener("click", () => {
    sg.questaoAtual = idx - 1;
    renderSimuladoGerado(view);
    window.scrollTo(0, 0);
  });
  $("#btn-proxima-sim")?.addEventListener("click", () => {
    sg.questaoAtual = idx + 1;
    renderSimuladoGerado(view);
    window.scrollTo(0, 0);
  });

  $("#btn-finalizar-sim")?.addEventListener("click", () => {
    sg.finalizado = true;
    sg.fim = new Date().toISOString();
    renderSimuladoGerado(view);
    window.scrollTo(0, 0);
  });

  $("#btn-abandonar-sim")?.addEventListener("click", () => {
    if (!confirm("Abandonar o simulado? O progresso atual será perdido."))
      return;
    _simuladoGerado = null;
    location.hash = "#/simulados";
  });

  $$("[data-marcar]", view).forEach((btn) =>
    btn.addEventListener("click", () => {
      sg.marcacoes[q.id] = btn.dataset.marcar;
      renderSimuladoGerado(view);
    }),
  );

  $$(".sim-mini", view).forEach((btn) =>
    btn.addEventListener("click", () => {
      sg.questaoAtual = Number(btn.dataset.i);
      renderSimuladoGerado(view);
      window.scrollTo(0, 0);
    }),
  );
}

function _renderResultadoSimuladoGerado(view) {
  const sg = _simuladoGerado;
  const total = sg.questoes.length;
  const certas = sg.questoes.filter(
    (q) => sg.marcacoes[q.id] === "certa",
  ).length;
  const erradas = sg.questoes.filter(
    (q) => sg.marcacoes[q.id] === "errada",
  ).length;
  const brancos = sg.questoes.filter(
    (q) => sg.marcacoes[q.id] === "branco",
  ).length;
  const naoAval = total - certas - erradas - brancos;
  const pct = total ? ((certas / total) * 100).toFixed(1) : 0;
  const tempoMs =
    sg.fim && sg.inicio ? new Date(sg.fim) - new Date(sg.inicio) : 0;
  const tempoMin = Math.round(tempoMs / 60000);

  view.innerHTML = `
    <!-- placar -->
    <div class="card mb-12" style="text-align:center;padding:28px 16px;">
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(sg.nome)}</div>
      <div style="font-size:56px;font-weight:900;color:var(--primary);line-height:1;">${pct}%</div>
      <div style="font-size:14px;color:var(--text-muted);margin-top:4px;">${certas} de ${total} questões corretas</div>
      ${tempoMin > 0 ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">⏱ Tempo total: ${tempoMin} min</div>` : ""}
    </div>

    <div class="stat-grid mb-12">
      <div class="stat-card success"><div class="label">Acertei</div><div class="value">${certas}</div></div>
      <div class="stat-card danger"><div class="label">Errei</div><div class="value">${erradas}</div></div>
      <div class="stat-card"><div class="label">Em branco</div><div class="value">${brancos}</div></div>
      ${naoAval ? `<div class="stat-card muted"><div class="label">Não avaliadas</div><div class="value">${naoAval}</div></div>` : ""}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
      <button class="btn btn-primary" id="btn-salvar-sim-gerado">💾 Salvar no histórico</button>
      <button class="btn btn-ghost"   id="btn-rever-sim">📋 Revisar questões</button>
      <a href="#/simulados" class="btn btn-ghost">← Simulados</a>
    </div>

    <!-- revisão colapsável -->
    <div id="revisao-sim" style="display:none;">
      ${sg.questoes
        .map((q, i) => {
          const m = sg.marcacoes[q.id];
          const mc =
            m === "certa" ? "success" : m === "errada" ? "danger" : "muted";
          const ml =
            m === "certa"
              ? "Acertei"
              : m === "errada"
                ? "Errei"
                : m === "branco"
                  ? "Em branco"
                  : "Não avaliada";
          const resumo = state.resumos.find((r) => r.tentativaId === q.id);
          return `
          <div class="card mb-12">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
              <div>
                <span style="font-size:12px;color:var(--text-muted);">Q${i + 1} · </span>
                <b style="font-size:13px;">${escapeHtml(q.disciplina || "")}</b>
                ${q.assunto ? `<span style="font-size:12px;color:var(--text-muted);"> · ${escapeHtml(q.assunto)}</span>` : ""}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <span class="badge ${mc}">${ml}</span>
                ${q.gabaritoConfirmado ? `<span style="font-size:12px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">Gabarito: <b>${escapeHtml(q.gabaritoConfirmado)}</b></span>` : ""}
                ${sg.respostas[q.id] ? `<span style="font-size:12px;color:var(--text-muted);">Sua resp.: <b>${escapeHtml(sg.respostas[q.id])}</b></span>` : ""}
              </div>
            </div>
            <details>
              <summary style="cursor:pointer;font-size:13px;color:var(--primary);user-select:none;">Ver enunciado</summary>
              <div style="white-space:pre-wrap;font-size:13px;line-height:1.65;padding:10px;background:var(--surface-2);border-radius:6px;margin-top:6px;">${escapeHtml(q.enunciado || "")}</div>
            </details>
            ${
              resumo
                ? `
              <details style="margin-top:6px;">
                <summary style="cursor:pointer;font-size:13px;color:var(--text-muted);user-select:none;">Ver comentário da IA</summary>
                <div style="line-height:1.65;font-size:13px;padding-top:8px;">${_mdParaHtml(resumo.textoBruto)}</div>
              </details>`
                : ""
            }
          </div>`;
        })
        .join("")}
    </div>
  `;

  $("#btn-salvar-sim-gerado")?.addEventListener("click", async () => {
    const btn = $("#btn-salvar-sim-gerado");
    btn.disabled = true;
    btn.textContent = "Salvando…";
    await db.simulados.add({
      nome: sg.nome,
      data: sg.inicio.slice(0, 10),
      numQuestoes: total,
      acertos: certas,
      erros: erradas,
      tempo: tempoMs ? Math.round(tempoMs / 1000) : 0,
      origem: "gerado",
    });
    await reloadState();
    btn.textContent = "✓ Salvo!";
    showToast("Simulado salvo no histórico.", "success");
  });

  $("#btn-rever-sim")?.addEventListener("click", () => {
    const el = $("#revisao-sim");
    if (!el) return;
    const visible = el.style.display !== "none";
    el.style.display = visible ? "none" : "block";
    $("#btn-rever-sim").textContent = visible
      ? "📋 Revisar questões"
      : "▲ Ocultar revisão";
  });
}

function fmtTempo(totalSegundos) {
  const s = Math.round(totalSegundos || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m`;
}

function openSimuladoModal() {
  openModal(`
    <h2>Novo simulado</h2>
    <form id="form-simulado">
      <div class="form-row">
        <label>Nome</label>
        <input type="text" name="nome" required placeholder="Ex: Simulado Governança e Qualidade">
      </div>
      <div class="form-grid-2">
        <div class="form-row"><label>Data</label><input type="date" name="data" required value="${todayISO()}"></div>
        <div class="form-row"><label>Nº de questões</label><input type="number" name="numQuestoes" required min="1"></div>
      </div>
      <div class="form-grid-2">
        <div class="form-row"><label>Acertos</label><input type="number" name="acertos" required min="0"></div>
        <div class="form-row"><label>Erros</label><input type="number" name="erros" required min="0"></div>
      </div>
      <div class="form-row">
        <label>Tempo gasto (minutos, opcional)</label>
        <input type="number" name="tempoMin" min="0" placeholder="Ex: 180">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="btn-cancelar-simulado">Cancelar</button>
        <button type="submit" class="btn btn-primary btn-block">Salvar simulado</button>
      </div>
    </form>
  `);

  $("#btn-cancelar-simulado").addEventListener("click", closeModal);
  $("#form-simulado").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await db.simulados.add({
      nome: fd.get("nome").trim(),
      data: fd.get("data"),
      numQuestoes: Number(fd.get("numQuestoes")),
      acertos: Number(fd.get("acertos")),
      erros: Number(fd.get("erros")),
      tempo: fd.get("tempoMin") ? Number(fd.get("tempoMin")) * 60 : 0,
    });
    closeModal();
    await reloadState();
    showToast("Simulado salvo.", "success");
    router();
  });
}

/* ============================================================
   TELA: CONFIGURAÇÕES
   ============================================================ */

function renderConfiguracoes(view) {
  view.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Aparência</div>
        <div class="form-row">
          <label>Tema</label>
          <div class="toggle-group">
            <button type="button" id="tema-escuro" class="${settings.theme === "dark" ? "on correta" : ""}">Escuro</button>
            <button type="button" id="tema-claro" class="${settings.theme === "light" ? "on correta" : ""}">Claro</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Backup</div>
        <p class="text-muted" style="font-size:13.5px;margin-top:0;">Exporte todos os seus dados (tentativas, editais e simulados) em um arquivo JSON, ou restaure a partir de um backup anterior.</p>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-exportar">Exportar backup (.json)</button>
          <button class="btn" id="btn-importar">Importar backup</button>
          <input type="file" id="input-importar" accept="application/json" style="display:none;">
        </div>
      </div>
    </div>

    <div class="card mt-12" id="card-backups-locais">
      <div class="card-title">Backups automáticos deste aparelho</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        O app guarda automaticamente um retrato completo (todos os perfis) sempre que algo muda,
        e também logo antes de importações e sincronizações. Se algo der errado, você pode
        voltar para um desses pontos no tempo. Restaurar aqui substitui TODOS os perfis e dados
        atuais neste aparelho.
      </p>
      <div id="lista-backups-locais">Carregando...</div>
    </div>

    <div class="card mt-12" id="card-backups-nuvem" style="display:none;">
      <div class="card-title">Backups na nuvem</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Antes de cada sincronização com a nuvem, uma cópia do estado anterior é guardada aqui.
        Restaurar aqui substitui os dados do perfil ativo pelos do backup escolhido.
      </p>
      <div class="flex" style="gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm" id="btn-buscar-todos-backups-nuvem">🔎 Buscar todos os backups (não só os mais recentes)</button>
        <label class="flex" style="gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer;">
          <input type="checkbox" id="chk-so-com-ciclo"> Mostrar só os que têm ciclo(s)
        </label>
      </div>
      <div id="lista-backups-nuvem">Carregando...</div>
    </div>

    <div class="card mt-12">
      <div class="card-title">Consolidar tentativas duplicadas</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Junta em um único registro as tentativas com a mesma disciplina, assunto, tipo e data
        — útil se você registrou várias rodadas separadas do mesmo assunto no mesmo dia antes
        dessa opção existir. Essa ação não pode ser desfeita.
      </p>
      <button class="btn" id="btn-consolidar">Consolidar agora</button>
    </div>

    <div class="card mt-12">
      <div class="card-title">Reparar sessões do Ciclo de Estudos</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Corrige sessões do Ciclo de Estudos que ficaram sem ligação com a disciplina certa
        (isso podia acontecer em sincronizações antigas). Usa o nome já salvo em cada sessão
        para reencontrar a disciplina certa — não apaga nada, só religa o que já existe.
      </p>
      <button class="btn" id="btn-reparar-sessoes">Reparar agora</button>
    </div>

    <div class="card mt-12">
      <div class="card-title">Recuperar registros invisíveis</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Corrige tentativas, editais, simulados e dados do Ciclo de Estudos que ficaram sem
        vínculo com nenhum perfil (isso podia acontecer ao editar um registro, por um bug já
        corrigido) — o registro continuava existindo, só ficava fora da lista. Cria um backup
        antes de reparar.
      </p>
      <button class="btn" id="btn-reparar-perfil">Recuperar agora</button>
    </div>

    <div class="card mt-12">
      <div class="card-title">Zona de risco</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">Isto apaga permanentemente as tentativas, editais, ciclos e simulados do perfil ativo (${escapeHtml(state.perfis.find((p) => p.id === db.perfilAtivoId)?.nome || "")}) neste dispositivo. Outros perfis não são afetados.</p>
      <button class="btn btn-danger" id="btn-zerar">Zerar estatísticas deste perfil</button>
    </div>
  `;

  $("#tema-escuro").addEventListener("click", () => {
    settings.theme = "dark";
    applyTheme();
    router();
  });
  $("#tema-claro").addEventListener("click", () => {
    settings.theme = "light";
    applyTheme();
    router();
  });

  $("#btn-exportar").addEventListener("click", async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trilha-aprovacao-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup exportado.", "success");
  });

  const fileInput = $("#input-importar");
  $("#btn-importar").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (
        !confirm(
          "Importar este backup vai substituir todos os dados atuais. Continuar?",
        )
      )
        return;
      await db.importAll(data, { substituir: true });
      await reloadState();
      showToast("Backup importado com sucesso.", "success");
      router();
    } catch (err) {
      showToast("Arquivo inválido. Verifique o backup.", "danger");
    }
    fileInput.value = "";
  });

  renderListaBackupsLocais();
  renderListaBackupsNuvem();

  $("#btn-consolidar").addEventListener("click", async () => {
    const grupos = new Map();
    state.tentativas.forEach((t) => {
      const chave = [
        t.data,
        t.tipo,
        t.disciplina.trim().toLowerCase(),
        t.assunto.trim().toLowerCase(),
      ].join("|");
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(t);
    });

    const gruposComDuplicata = Array.from(grupos.values()).filter(
      (g) => g.length > 1,
    );
    if (!gruposComDuplicata.length) {
      showToast("Nenhuma tentativa duplicada encontrada.", "");
      return;
    }

    const totalDuplicatas = gruposComDuplicata.reduce(
      (s, g) => s + g.length,
      0,
    );
    if (
      !confirm(
        `Encontrei ${gruposComDuplicata.length} assunto(s) com registros repetidos no mesmo dia (${totalDuplicatas} tentativas ao todo). Elas serão somadas em ${gruposComDuplicata.length} registro(s) único(s). Continuar?`,
      )
    )
      return;

    for (const grupo of gruposComDuplicata) {
      const numQuestoes = grupo.reduce((s, t) => s + t.numQuestoes, 0);
      const acertos = grupo.reduce((s, t) => s + t.acertos, 0);
      const erros = numQuestoes - acertos;
      const taxa = numQuestoes ? (acertos / numQuestoes) * 100 : 0;
      const observacoes = grupo
        .map((t) => t.observacoes)
        .filter(Boolean)
        .join(" | ");
      const base = grupo[0];

      await db.tentativas.update({
        ...base,
        numQuestoes,
        acertos,
        erros,
        taxa,
        observacoes,
        banca: grupo.map((t) => t.banca).find(Boolean) || "",
        concurso: grupo.map((t) => t.concurso).find(Boolean) || "",
      });
      for (const t of grupo.slice(1)) {
        await db.tentativas.remove(t.id);
      }
    }

    await reloadState();
    showToast(
      `${gruposComDuplicata.length} registro(s) consolidado(s).`,
      "success",
    );
    router();
  });

  $("#btn-reparar-sessoes").addEventListener("click", async () => {
    if (typeof db.criarBackupLocalAutomatico === "function") {
      await db
        .criarBackupLocalAutomatico("antes_de_reparar_sessoes_orfas")
        .catch(() => {});
    }

    const norm = (s) => (s || "").trim().toLowerCase();
    const materias = await db.getAll("cicloMaterias");
    const sessoes = await db.getAll("cicloSessoes");
    const idsValidos = new Set(materias.map((m) => m.id));

    let religadas = 0;
    let semCorrespondencia = 0;

    for (const s of sessoes) {
      if (idsValidos.has(s.cicloMateriaId)) continue;
      const materiaCorreta = materias.find(
        (m) => norm(m.nome) === norm(s.nome),
      );
      if (materiaCorreta) {
        await db.cicloSessoes.update({
          ...s,
          cicloMateriaId: materiaCorreta.id,
        });
        religadas++;
      } else {
        semCorrespondencia++;
      }
    }

    await reloadState();
    if (religadas === 0 && semCorrespondencia === 0) {
      showToast("Nenhuma sessão órfã encontrada — está tudo certo.", "success");
    } else {
      showToast(
        `${religadas} sessão(ões) religada(s).` +
          (semCorrespondencia
            ? ` ${semCorrespondencia} sem disciplina correspondente.`
            : ""),
        "success",
      );
    }
    router();
  });

  $("#btn-reparar-perfil").addEventListener("click", async () => {
    const { totalReparados, porStore } = await db.repararPerfilIdAusente();
    await reloadState();
    if (totalReparados === 0) {
      showToast(
        "Nenhum registro invisível encontrado — está tudo certo.",
        "success",
      );
    } else {
      const detalhe = Object.entries(porStore)
        .map(([loja, n]) => `${n} em ${loja}`)
        .join(", ");
      showToast(
        `${totalReparados} registro(s) recuperado(s) (${detalhe}).`,
        "success",
      );
    }
    router();
  });

  $("#btn-zerar").addEventListener("click", async () => {
    if (!confirm("Tem certeza? Todos os dados serão apagados permanentemente."))
      return;
    await db.zerarTudo();
    await reloadState();
    showToast("Estatísticas zeradas.", "danger");
    router();
  });
}

function _formatarDataHoraBR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const _MOTIVO_BACKUP_LABEL = {
  alteracao_automatica: "Alteração no app",
  antes_de_importar: "Antes de importar um backup",
  antes_de_zerar: "Antes de zerar estatísticas",
  antes_de_puxar_da_nuvem: "Antes de sincronizar (baixando da nuvem)",
  antes_de_restaurar_backup_nuvem: "Antes de restaurar backup da nuvem",
  antes_de_enviar: "Antes de sincronizar (enviando para a nuvem)",
  auto: "Automático",
};

async function renderListaBackupsLocais() {
  const container = $("#lista-backups-locais");
  if (!container) return;

  const backups = await db.backupsLocais.getAll();
  if (!backups.length) {
    container.innerHTML =
      '<p class="text-muted" style="font-size:13.5px;">Nenhum backup automático ainda — assim que algo mudar no app, o primeiro será criado.</p>';
    return;
  }

  container.innerHTML = backups
    .map((b) => {
      const totalTentativas = (b.dados?.tentativas || []).length;
      const totalCiclos = (b.dados?.ciclos || []).length;
      const motivo = _MOTIVO_BACKUP_LABEL[b.motivo] || b.motivo || "Automático";
      return `
      <div class="flex" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;">${_formatarDataHoraBR(b.criadoEm)}</div>
          <div class="text-muted" style="font-size:12.5px;">${escapeHtml(motivo)} — ${totalTentativas} tentativa(s), ${totalCiclos} ciclo(s)</div>
        </div>
        <button class="btn" data-restaurar-local="${b.id}">Restaurar</button>
      </div>
    `;
    })
    .join("");

  container.querySelectorAll("[data-restaurar-local]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.restaurarLocal);
      const backup = backups.find((b) => b.id === id);
      if (!backup) return;
      if (
        !confirm(
          `Restaurar este backup de ${_formatarDataHoraBR(backup.criadoEm)}? Isso substitui TODOS os perfis e dados atuais neste aparelho.`,
        )
      )
        return;
      await db.importAllRaw(backup.dados);
      await reloadState();
      showToast("Backup restaurado com sucesso.", "success");
      router();
    });
  });
}

let _backupsNuvemCache = null; // guarda a última lista buscada, pra filtrar sem rebuscar

async function renderListaBackupsNuvem() {
  const card = $("#card-backups-nuvem");
  const container = $("#lista-backups-nuvem");
  if (!card || !container) return;
  if (typeof cloudSync === "undefined" || !cloudSync.usuarioAtual) return;

  card.style.display = "";

  const btnBuscarTudo = $("#btn-buscar-todos-backups-nuvem");
  const chkSoComCiclo = $("#chk-so-com-ciclo");

  async function carregar(limite) {
    try {
      container.innerHTML = "Carregando...";
      _backupsNuvemCache = await cloudSync.listarBackupsNuvem(limite);
      desenhar();
    } catch (err) {
      container.innerHTML =
        '<p class="text-muted" style="font-size:13.5px;">Não foi possível carregar os backups da nuvem agora.</p>';
    }
  }

  function desenhar() {
    let backups = _backupsNuvemCache || [];
    if (!backups.length) {
      container.innerHTML =
        '<p class="text-muted" style="font-size:13.5px;">Nenhum backup na nuvem ainda.</p>';
      return;
    }

    const soComCiclo = chkSoComCiclo?.checked;
    const listaExibida = soComCiclo
      ? backups.filter((b) => (b.dados?.ciclos || []).length > 0)
      : backups;

    if (!listaExibida.length) {
      container.innerHTML = `<p class="text-muted" style="font-size:13.5px;">Nenhum desses ${backups.length} backup(s) carregado(s) tem ciclo salvo. Tente "Buscar todos" primeiro, se ainda não buscou.</p>`;
      return;
    }

    container.innerHTML = `
      <p class="text-muted" style="font-size:12px;margin:0 0 10px;">${backups.length} backup(s) carregado(s)${soComCiclo ? `, ${listaExibida.length} com ciclo` : ""}.</p>
      ${listaExibida
        .map((b) => {
          const totalTentativas = (b.dados?.tentativas || []).length;
          const totalCiclos = (b.dados?.ciclos || []).length;
          const temCiclo = totalCiclos > 0;
          const motivo =
            _MOTIVO_BACKUP_LABEL[b.motivo] || b.motivo || "Automático";
          const criadoEm =
            b.criadoEm && b.criadoEm.toDate
              ? b.criadoEm.toDate().toISOString()
              : b.criadoEm;
          return `
          <div class="flex" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap;${temCiclo ? "background:var(--success-soft);border-radius:8px;padding-left:8px;padding-right:8px;" : ""}">
            <div>
              <div style="font-weight:600;">${_formatarDataHoraBR(criadoEm)} ${temCiclo ? '<span class="badge success">tem ciclo</span>' : ""}</div>
              <div class="text-muted" style="font-size:12.5px;">${escapeHtml(motivo)} — ${totalTentativas} tentativa(s), ${totalCiclos} ciclo(s) (perfil ativo)</div>
            </div>
            <button class="btn" data-restaurar-nuvem="${b.id}">Restaurar</button>
          </div>
        `;
        })
        .join("")}
    `;

    container.querySelectorAll("[data-restaurar-nuvem]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.restaurarNuvem;
        if (
          !confirm(
            "Restaurar este backup da nuvem? Isso substitui os dados do perfil ativo neste aparelho.",
          )
        )
          return;
        try {
          await cloudSync.restaurarBackupNuvem(id);
          await reloadState();
          showToast("Backup da nuvem restaurado com sucesso.", "success");
          router();
        } catch (err) {
          showToast("Não foi possível restaurar esse backup.", "danger");
        }
      });
    });
  }

  btnBuscarTudo?.addEventListener("click", () => {
    btnBuscarTudo.disabled = true;
    btnBuscarTudo.textContent = "Buscando...";
    carregar(500).finally(() => {
      btnBuscarTudo.disabled = false;
      btnBuscarTudo.textContent =
        "🔎 Buscar todos os backups (não só os mais recentes)";
    });
  });
  chkSoComCiclo?.addEventListener("change", desenhar);

  await carregar(20);
}

/* ============================================================
   SISTEMA DE MODAIS
   ============================================================ */

function openModal(innerHtml) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) closeModal();
  });
}

function closeModal() {
  $("#modal-root").innerHTML = "";
}

function initGlobalModalHandlers() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

window.addEventListener("DOMContentLoaded", async () => {
  applyTheme();
  initSidebar();
  initGlobalModalHandlers();

  $("#add-questao-btn").addEventListener("click", () => openTentativaModal());

  await garantirPerfilAtivo();
  initPerfilSelector();

  window.addEventListener("hashchange", router);
  router();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});
