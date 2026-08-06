/**
 * intelligenceEngine.js — Motor de Inteligência do Mentor da Trilha
 *
 * Centraliza todos os cálculos interpretativos do app. Funções puras que
 * recebem `state` (ou o leem diretamente) e devolvem insights prontos.
 * Não tem UI — é consumido por mentor.js, dashboard, coach pós-sessão, etc.
 *
 * Exporta o namespace global `window.IE` com todos os métodos.
 *
 * Ordem de dependências: deve ser carregado DEPOIS de database.js e app.js
 * (precisa de `state`, `todayISO`, `daysAgoISO`).
 */

window.IE = (() => {

  /* ============================================================
     UTILITÁRIOS INTERNOS
     ============================================================ */

  /** Normaliza nome de disciplina para comparações. */
  function _norm(s) {
    return (s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** Agrupa array por chave retornada pelo callback. */
  function _agrupar(arr, fn) {
    const map = {};
    for (const item of arr) {
      const k = fn(item);
      if (!map[k]) map[k] = [];
      map[k].push(item);
    }
    return map;
  }

  /** Média simples de um array de números. */
  function _media(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /** Tendência linear (regressão de mínimos quadrados) sobre array de valores.
   *  Devolve { slope } — positivo = melhora, negativo = piora. */
  function _tendencia(valores) {
    const n = valores.length;
    if (n < 2) return { slope: 0 };
    const xs = valores.map((_, i) => i);
    const mx = _media(xs), my = _media(valores);
    const num = xs.reduce((s, x, i) => s + (x - mx) * (valores[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    return { slope: den === 0 ? 0 : num / den };
  }

  /** Converte ISO string de data/hora para hora-do-dia em horas decimais. */
  function _horaDecimal(isoStr) {
    const d = new Date(isoStr);
    return d.getHours() + d.getMinutes() / 60;
  }

  /** Dias entre duas datas ISO (YYYY-MM-DD). Positivo se b > a. */
  function _diasEntre(a, b) {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  /* ============================================================
     1. DADOS POR DISCIPLINA
     Retorna array de objetos com acertos/erros/taxa/questões por
     disciplina, opcionalmente filtrado por período (últimos N dias).
     ============================================================ */
  function calcDisciplinas(diasAtras = 0) {
    const corte = diasAtras > 0 ? daysAgoISO(diasAtras) : null;
    const tentativas = (state.tentativas || []).filter(t =>
      !corte || t.data >= corte
    );
    const grupos = _agrupar(tentativas, t => _norm(t.disciplina));
    return Object.entries(grupos).map(([chave, ts]) => {
      const nome = ts[0].disciplina;
      const total = ts.reduce((s, t) => s + (t.numQuestoes || 0), 0);
      const acertos = ts.reduce((s, t) => s + (t.acertos || 0), 0);
      const erros = ts.reduce((s, t) => s + (t.erros || 0), 0);
      const denom = acertos + erros;
      return {
        chave, nome, total, acertos, erros,
        taxa: denom > 0 ? acertos / denom : null,
        tentativas: ts.length,
        ultimaData: ts.map(t => t.data).sort().at(-1) || null
      };
    }).sort((a, b) => b.total - a.total);
  }

  /* ============================================================
     2. CONSISTÊNCIA
     Analisa sequência de dias ativos, regularidade semanal, etc.
     ============================================================ */
  function calcConsistencia() {
    const tentativas = state.tentativas || [];
    const sessoes = state.cicloSessoes || [];

    // Dias únicos com qualquer atividade (tentativa ou sessão)
    const diasAtivos = new Set([
      ...tentativas.map(t => t.data),
      ...sessoes.map(s => s.data)
    ]);
    const diasOrdenados = [...diasAtivos].filter(Boolean).sort();

    // Sequência atual (streak)
    let streak = 0;
    const hoje = todayISO();
    const ontem = daysAgoISO(1);
    let cursor = diasAtivos.has(hoje) ? hoje : (diasAtivos.has(ontem) ? ontem : null);
    while (cursor && diasAtivos.has(cursor)) {
      streak++;
      const d = new Date(cursor + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      cursor = d.toISOString().slice(0, 10);
    }

    // Dias ativos nos últimos 30 dias
    const corte30 = daysAgoISO(30);
    const ativos30 = diasOrdenados.filter(d => d >= corte30).length;

    // Rendimento por dia da semana (0=dom, 6=sab) — questões + minutos normalizados
    const porDia = Array.from({ length: 7 }, () => ({ questoes: 0, minutos: 0, dias: 0 }));
    for (const t of tentativas) {
      if (!t.data) continue;
      const dow = new Date(t.data + 'T12:00:00').getDay();
      porDia[dow].questoes += t.numQuestoes || 0;
      porDia[dow].dias++;
    }
    for (const s of sessoes) {
      if (!s.data || s.ajusteManual) continue;
      const dow = new Date(s.data + 'T12:00:00').getDay();
      porDia[dow].minutos += s.minutos || 0;
    }
    const nomesDia = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    // Score composto: questões/dia + (minutos/30)/dia
    const scoreDia = porDia.map((d, i) => ({
      nome: nomesDia[i],
      score: d.dias > 0 ? (d.questoes / d.dias) + (d.minutos / 30 / Math.max(d.dias, 1)) : 0,
      questoesMediaDia: d.dias > 0 ? d.questoes / d.dias : 0,
      minutosMediaDia: d.dias > 0 ? d.minutos / d.dias : 0
    }));
    const melhorDia = scoreDia.reduce((m, d) => d.score > m.score ? d : m, scoreDia[0]);

    // Total de dias com atividade
    const totalDiasAtivos = diasOrdenados.length;
    // Primeiro dia de atividade
    const primeirodia = diasOrdenados[0] || null;
    const diasDesdeInicio = primeirodia ? _diasEntre(primeirodia, hoje) + 1 : 0;
    const taxaConsistencia = diasDesdeInicio > 0
      ? Math.min(1, totalDiasAtivos / diasDesdeInicio)
      : 0;

    return {
      streak,
      ativos30,
      totalDiasAtivos,
      taxaConsistencia,        // 0-1
      melhorDia,               // { nome, score }
      scoreDia,                // array[7]
      primeirodia
    };
  }

  /* ============================================================
     3. COBERTURA DO EDITAL
     Cruza disciplinas do edital ativo com tentativas feitas.
     ============================================================ */
  function calcCobertura() {
    const editais = (state.editais || []).filter(e => e.ativo);
    if (!editais.length) return { temEdital: false, pct: 0, disciplinasSemEstudo: [] };

    // Junta todas as disciplinas/matérias dos editais ativos
    const itensEdital = editais.flatMap(e => e.materias || []);
    if (!itensEdital.length) return { temEdital: true, pct: 0, disciplinasSemEstudo: [] };

    const nomesDisciplinas = calcDisciplinas().map(d => _norm(d.nome));
    let cobertas = 0;
    const disciplinasSemEstudo = [];

    for (const item of itensEdital) {
      const nomeNorm = _norm(item.nome || item.disciplina || '');
      if (nomesDisciplinas.includes(nomeNorm)) {
        cobertas++;
      } else {
        disciplinasSemEstudo.push(item.nome || item.disciplina || '(sem nome)');
      }
    }

    return {
      temEdital: true,
      pct: itensEdital.length > 0 ? cobertas / itensEdital.length : 0,
      total: itensEdital.length,
      cobertas,
      disciplinasSemEstudo: [...new Set(disciplinasSemEstudo)]
    };
  }

  /* ============================================================
     4. EVOLUÇÃO (tendência de taxa)
     Compara taxa dos últimos 7 dias vs. 7-30 dias atrás.
     ============================================================ */
  function calcEvolucao() {
    const tentativas = state.tentativas || [];
    const hoje = todayISO();

    function taxaNoIntervalo(de, ate) {
      const ts = tentativas.filter(t => t.data >= de && t.data <= ate);
      const ac = ts.reduce((s, t) => s + (t.acertos || 0), 0);
      const er = ts.reduce((s, t) => s + (t.erros || 0), 0);
      return (ac + er) > 0 ? ac / (ac + er) : null;
    }

    const taxa7d = taxaNoIntervalo(daysAgoISO(7), hoje);
    const taxa30d = taxaNoIntervalo(daysAgoISO(30), daysAgoISO(8));
    const taxaGeral = taxaNoIntervalo(daysAgoISO(9999), hoje);

    // Tendência semana a semana (até 8 semanas)
    const semanas = [];
    for (let i = 7; i >= 0; i--) {
      const ini = daysAgoISO(i * 7 + 7);
      const fim = daysAgoISO(i * 7);
      const t = taxaNoIntervalo(ini, fim);
      if (t !== null) semanas.push(t * 100);
    }
    const { slope } = _tendencia(semanas);

    let delta = null;
    let direcao = 'estavel';
    if (taxa7d !== null && taxa30d !== null) {
      delta = (taxa7d - taxa30d) * 100; // pp
      if (delta > 3) direcao = 'subindo';
      else if (delta < -3) direcao = 'caindo';
    }

    return { taxa7d, taxa30d, taxaGeral, delta, direcao, slope, semanas };
  }

  /* ============================================================
     5. LACUNAS DE REVISÃO
     Disciplinas com taxa baixa e/ou muito tempo sem revisar.
     ============================================================ */
  function calcLacunas() {
    const hoje = todayISO();
    const disc = calcDisciplinas();
    return disc
      .filter(d => d.taxa !== null)
      .map(d => {
        const diasSemRevisar = d.ultimaData ? _diasEntre(d.ultimaData, hoje) : 999;
        const urgencia = (100 - (d.taxa || 0) * 100) * Math.log1p(diasSemRevisar);
        return { ...d, diasSemRevisar, urgencia };
      })
      .sort((a, b) => b.urgencia - a.urgencia)
      .slice(0, 5);
  }

  /* ============================================================
     6. COBERTURA DO CADERNO (resumos)
     Quantas disciplinas com tentativas têm resumos no caderno.
     ============================================================ */
  function calcCoberturaCaderno() {
    const disc = calcDisciplinas().map(d => _norm(d.nome));
    const comResumo = new Set(
      (state.resumos || []).map(r => _norm(r.materia || ''))
    );
    const cobertas = disc.filter(d => comResumo.has(d)).length;
    return {
      total: disc.length,
      cobertas,
      pct: disc.length > 0 ? cobertas / disc.length : 0
    };
  }

  /* ============================================================
     7. TEMPO DE ESTUDO
     ============================================================ */
  function calcTempo() {
    const sessoes = state.cicloSessoes || [];
    const corte7 = daysAgoISO(7);
    const corte30 = daysAgoISO(30);

    const minTotal = sessoes.reduce((s, x) => s + (x.minutos || 0), 0);
    const min7d = sessoes.filter(x => x.data >= corte7).reduce((s, x) => s + (x.minutos || 0), 0);
    const min30d = sessoes.filter(x => x.data >= corte30).reduce((s, x) => s + (x.minutos || 0), 0);

    // Dias ativos com sessões (não manuais)
    const diasComSessao = new Set(
      sessoes.filter(s => !s.ajusteManual && s.minutos > 0).map(s => s.data)
    );
    const mediaMinDia = diasComSessao.size > 0 ? minTotal / diasComSessao.size : 0;

    // Melhor horário (usa campo `inicio` real, ignora sessões manuais com 12:00 fixo)
    const sessoesCromometradas = sessoes.filter(s =>
      !s.ajusteManual && s.inicio && !s.inicio.includes('T12:00:00')
    );
    const porFaixa = { manha: 0, tarde: 0, noite: 0 };
    for (const s of sessoesCromometradas) {
      const h = _horaDecimal(s.inicio);
      if (h < 12) porFaixa.manha += s.minutos || 0;
      else if (h < 18) porFaixa.tarde += s.minutos || 0;
      else porFaixa.noite += s.minutos || 0;
    }
    const melhorFaixa = Object.entries(porFaixa).reduce((m, [k, v]) => v > m[1] ? [k, v] : m, ['—', 0])[0];
    const nomeFaixa = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', '—': '—' };

    return {
      minTotal, min7d, min30d, mediaMinDia,
      melhorFaixa: nomeFaixa[melhorFaixa],
      temDadosHorario: sessoesCromometradas.length >= 3
    };
  }

  /* ============================================================
     8. FASE DA PREPARAÇÃO
     Determina pré-edital / pós-edital / reta-final automaticamente.
     ============================================================ */
  function calcFase() {
    const editais = (state.editais || []).filter(e => e.ativo);
    if (!editais.length) return { fase: 'pre-edital', label: 'Pré-edital', diasRestantes: null };

    // Tenta encontrar data da prova em algum edital ativo (campo dataProva)
    const datas = editais.map(e => e.dataProva).filter(Boolean).sort();
    if (!datas.length) return { fase: 'pos-edital', label: 'Pós-edital', diasRestantes: null };

    const proxima = datas[0];
    const diasRestantes = _diasEntre(todayISO(), proxima);
    if (diasRestantes <= 60) return { fase: 'reta-final', label: 'Reta Final', diasRestantes };
    return { fase: 'pos-edital', label: 'Pós-edital', diasRestantes };
  }

  /* ============================================================
     9. ÍNDICE DE APROVAÇÃO (0–100)
     Pesos dinâmicos conforme a fase da preparação.
     ============================================================ */
  function calcIndiceAprovacao() {
    const { fase } = calcFase();
    const consistencia = calcConsistencia();
    const cobertura = calcCobertura();
    const evolucao = calcEvolucao();
    const tempo = calcTempo();
    const caderno = calcCoberturaCaderno();
    const simulados = state.simulados || [];

    // --- Componentes individuais (0-100) ---

    // Taxa geral de acerto
    const compQuestoes = evolucao.taxaGeral !== null
      ? Math.min(100, evolucao.taxaGeral * 100 * 1.1) // leve boost pois 90%+ é raro
      : 0;

    // Consistência (taxa + streak)
    const compConsistencia = Math.min(100,
      consistencia.taxaConsistencia * 70 +
      Math.min(30, consistencia.streak * 3)
    );

    // Cobertura do edital
    const compCobertura = cobertura.temEdital
      ? Math.min(100, cobertura.pct * 100)
      : Math.min(100, caderno.pct * 60 + calcDisciplinas().length * 2); // sem edital: proxy

    // Revisões — usa lacunas (quanto menos lacunas urgentes, melhor)
    const lacunas = calcLacunas();
    const mediaUrgencia = lacunas.length > 0 ? _media(lacunas.map(l => l.urgencia)) : 0;
    const compRevisao = Math.max(0, Math.min(100, 100 - Math.sqrt(mediaUrgencia)));

    // Simulados — taxa média nos simulados
    const simsComTaxa = simulados.filter(s => s.numQuestoes > 0);
    const compSimulados = simsComTaxa.length > 0
      ? _media(simsComTaxa.map(s => (s.acertos / s.numQuestoes) * 100))
      : 0;

    // Tempo — meta ~2h/dia = 100 pts
    const compTempo = Math.min(100, (tempo.mediaMinDia / 120) * 100);

    // Caderno de resumos
    const compCaderno = Math.min(100, caderno.pct * 100);

    // --- Pesos por fase ---
    let pesos;
    if (fase === 'pre-edital') {
      pesos = {
        consistencia: 0.35, cobertura: 0.30, tempo: 0.20, questoes: 0.15,
        revisao: 0, simulados: 0, caderno: 0
      };
    } else if (fase === 'pos-edital') {
      pesos = {
        questoes: 0.30, simulados: 0.20, revisao: 0.20, consistencia: 0.15,
        cobertura: 0.10, caderno: 0.05, tempo: 0
      };
    } else { // reta-final
      pesos = {
        questoes: 0.35, simulados: 0.30, revisao: 0.25, consistencia: 0.10,
        cobertura: 0, caderno: 0, tempo: 0
      };
    }

    const indice = Math.round(
      compQuestoes      * pesos.questoes +
      compConsistencia  * pesos.consistencia +
      compCobertura     * pesos.cobertura +
      compRevisao       * pesos.revisao +
      compSimulados     * pesos.simulados +
      compTempo         * pesos.tempo +
      compCaderno       * pesos.caderno
    );

    return {
      indice: Math.max(0, Math.min(100, indice)),
      componentes: {
        questoes:     { valor: Math.round(compQuestoes),     peso: pesos.questoes },
        consistencia: { valor: Math.round(compConsistencia), peso: pesos.consistencia },
        cobertura:    { valor: Math.round(compCobertura),    peso: pesos.cobertura },
        revisao:      { valor: Math.round(compRevisao),      peso: pesos.revisao },
        simulados:    { valor: Math.round(compSimulados),    peso: pesos.simulados },
        tempo:        { valor: Math.round(compTempo),        peso: pesos.tempo },
        caderno:      { valor: Math.round(compCaderno),      peso: pesos.caderno }
      }
    };
  }

  /* ============================================================
     10. DNA DO ESTUDANTE
     Agrega tudo em indicadores de perfil.
     ============================================================ */
  function calcDNA() {
    const disc = calcDisciplinas();
    const evolucao = calcEvolucao();
    const consistencia = calcConsistencia();
    const tempo = calcTempo();
    const cobertura = calcCobertura();
    const caderno = calcCoberturaCaderno();
    const lacunas = calcLacunas();

    // Melhor e pior disciplina
    const comTaxa = disc.filter(d => d.taxa !== null && d.total >= 5);
    const melhorDisc = comTaxa.reduce((m, d) => d.taxa > (m?.taxa ?? -1) ? d : m, null);
    const piorDisc = comTaxa.reduce((m, d) => d.taxa < (m?.taxa ?? 2) ? d : m, null);

    // Velocidade de evolução
    let velocidade = 'estável';
    if (evolucao.slope > 0.3) velocidade = 'acelerando';
    else if (evolucao.slope < -0.3) velocidade = 'desacelerando';

    // Ritmo de aprendizagem (questões por dia ativo)
    const tentativas = state.tentativas || [];
    const diasAtivosSet = new Set(tentativas.map(t => t.data));
    const questoesTotal = tentativas.reduce((s, t) => s + (t.numQuestoes || 0), 0);
    const questoesPorDia = diasAtivosSet.size > 0 ? questoesTotal / diasAtivosSet.size : 0;

    // Tipo de estudo predominante
    const sessoes = state.cicloSessoes || [];
    const tiposTotais = {};
    for (const s of sessoes) {
      const t = s.tipoEstudo || 'Outros';
      tiposTotais[t] = (tiposTotais[t] || 0) + (s.minutos || 0);
    }
    const tiposOrdem = Object.entries(tiposTotais).sort((a, b) => b[1] - a[1]);
    const tipoPredominante = tiposOrdem[0]?.[0] || null;

    return {
      melhorDisc,
      piorDisc,
      velocidade,
      questoesPorDia: Math.round(questoesPorDia),
      consistencia: consistencia.taxaConsistencia,
      streak: consistencia.streak,
      melhorDia: consistencia.melhorDia?.nome || '—',
      melhorFaixa: tempo.melhorFaixa,
      temDadosHorario: tempo.temDadosHorario,
      cobertura: cobertura.pct,
      temEdital: cobertura.temEdital,
      coberturaCaderno: caderno.pct,
      lacunasTop: lacunas,
      tipoPredominante,
      tiposTotais,
      evolucao: evolucao.direcao,
      taxaGeral: evolucao.taxaGeral
    };
  }

  /* ============================================================
     11. COACH PÓS-SESSÃO
     Gera mensagem automática após concluir uma sessão do ciclo.
     ============================================================ */
  function gerarCoachPosSessao(sessao) {
    const msgs = [];
    const evo = calcEvolucao();
    const cons = calcConsistencia();
    const min = sessao.minutos || 0;
    const nomeMat = sessao.nome || 'a disciplina';

    // Duração
    if (min >= 90) {
      msgs.push(`Sessão sólida de ${Math.round(min)} min em ${nomeMat}. Seu esforço está acima da média hoje.`);
    } else if (min >= 45) {
      msgs.push(`${Math.round(min)} min registrados em ${nomeMat}. Bom ritmo — cada sessão conta.`);
    } else {
      msgs.push(`Sessão curta em ${nomeMat} registrada. Consistência vale mais que duração — continue.`);
    }

    // Streak
    if (cons.streak >= 7) {
      msgs.push(`🔥 ${cons.streak} dias consecutivos de estudo. Não deixe essa sequência quebrar.`);
    } else if (cons.streak >= 3) {
      msgs.push(`${cons.streak} dias seguidos — uma sequência está se formando.`);
    }

    // Tendência de desempenho
    if (evo.direcao === 'caindo' && evo.delta !== null) {
      msgs.push(`Atenção: seu desempenho caiu ${Math.abs(Math.round(evo.delta))} p.p. nesta semana. Revise antes de avançar.`);
    } else if (evo.direcao === 'subindo') {
      msgs.push(`Seu desempenho está em alta esta semana — mantenha o ritmo.`);
    }

    // Lacuna urgente
    const lacunas = calcLacunas();
    const maisUrgente = lacunas[0];
    if (maisUrgente && maisUrgente.diasSemRevisar >= 7 && _norm(maisUrgente.nome) !== _norm(nomeMat)) {
      msgs.push(`📌 ${maisUrgente.nome} está há ${maisUrgente.diasSemRevisar} dias sem revisão — considere incluir amanhã.`);
    }

    return msgs;
  }

  /* ============================================================
     12. CONTEXTO PARA A IA (prompt de sistema do Mentor)
     Monta string rica com todos os dados do aluno para o Gemini.
     ============================================================ */
  function buildContextoMentor(perfil) {
    const fase = calcFase();
    const indice = calcIndiceAprovacao();
    const dna = calcDNA();
    const evolucao = calcEvolucao();
    const consistencia = calcConsistencia();
    const tempo = calcTempo();
    const cobertura = calcCobertura();
    const tentativas = state.tentativas || [];
    const simulados = state.simulados || [];

    const fmtPct = v => v !== null && v !== undefined ? `${Math.round(v * 100)}%` : '—';
    const fmtMin = m => {
      const h = Math.floor(m / 60), mn = Math.round(m % 60);
      return h > 0 ? `${h}h${mn > 0 ? mn + 'min' : ''}` : `${mn}min`;
    };

    const linhas = [
      `## PERFIL DO ALUNO`,
      perfil?.concursoAlvo  ? `- Concurso-alvo: ${perfil.concursoAlvo}`   : '',
      perfil?.concursoSec   ? `- Concurso secundário: ${perfil.concursoSec}` : '',
      perfil?.dataProva     ? `- Data da prova: ${perfil.dataProva}`       : '',
      perfil?.objetivo      ? `- Objetivo declarado: ${perfil.objetivo}`   : '',
      ``,
      `## FASE ATUAL: ${fase.label}${fase.diasRestantes ? ` (${fase.diasRestantes} dias para a prova)` : ''}`,
      ``,
      `## ÍNDICE DE APROVAÇÃO: ${indice.indice}/100`,
      `- Componentes: Questões ${indice.componentes.questoes.valor} | Consistência ${indice.componentes.consistencia.valor} | Cobertura ${indice.componentes.cobertura.valor} | Revisão ${indice.componentes.revisao.valor} | Simulados ${indice.componentes.simulados.valor}`,
      ``,
      `## DESEMPENHO`,
      `- Taxa geral de acerto: ${fmtPct(evolucao.taxaGeral)}`,
      `- Taxa últimos 7 dias: ${fmtPct(evolucao.taxa7d)}`,
      `- Taxa 7-30 dias atrás: ${fmtPct(evolucao.taxa30d)}`,
      `- Tendência: ${evolucao.direcao}${evolucao.delta !== null ? ` (${evolucao.delta > 0 ? '+' : ''}${Math.round(evolucao.delta)} p.p.)` : ''}`,
      `- Total de questões respondidas: ${tentativas.reduce((s, t) => s + (t.numQuestoes || 0), 0)}`,
      ``,
      `## CONSISTÊNCIA`,
      `- Sequência atual (streak): ${consistencia.streak} dias`,
      `- Dias ativos nos últimos 30: ${consistencia.ativos30}`,
      `- Taxa de consistência geral: ${fmtPct(consistencia.taxaConsistencia)}`,
      `- Melhor dia da semana: ${consistencia.melhorDia?.nome || '—'}`,
      ``,
      `## TEMPO DE ESTUDO`,
      `- Total estudado: ${fmtMin(tempo.minTotal)}`,
      `- Últimos 7 dias: ${fmtMin(tempo.min7d)}`,
      `- Média por dia ativo: ${fmtMin(tempo.mediaMinDia)}`,
      tempo.temDadosHorario ? `- Melhor faixa horária: ${tempo.melhorFaixa}` : '',
      ``,
      `## COBERTURA DO EDITAL`,
      cobertura.temEdital
        ? `- ${fmtPct(cobertura.pct)} coberto (${cobertura.cobertas}/${cobertura.total} disciplinas)`
        : '- Sem edital ativo cadastrado',
      cobertura.disciplinasSemEstudo?.length
        ? `- Ainda sem estudo: ${cobertura.disciplinasSemEstudo.slice(0, 5).join(', ')}`
        : '',
      ``,
      `## DNA DO ESTUDANTE`,
      dna.melhorDisc ? `- Melhor disciplina: ${dna.melhorDisc.nome} (${fmtPct(dna.melhorDisc.taxa)})` : '',
      dna.piorDisc   ? `- Disciplina com mais dificuldade: ${dna.piorDisc.nome} (${fmtPct(dna.piorDisc.taxa)})` : '',
      `- Questões por dia ativo: ${dna.questoesPorDia}`,
      dna.tipoPredominante ? `- Método de estudo predominante: ${dna.tipoPredominante}` : '',
      ``,
      `## LACUNAS URGENTES (top 5 por urgência)`,
      ...(calcLacunas().map(l =>
        `- ${l.nome}: taxa ${fmtPct(l.taxa)}, ${l.diasSemRevisar} dias sem revisão`
      )),
      ``,
      `## SIMULADOS`,
      simulados.length
        ? simulados.slice(-5).map(s =>
            `- ${s.nome || 'Simulado'} (${s.data || ''}): ${s.acertos}/${s.numQuestoes} acertos`
          ).join('\n')
        : '- Nenhum simulado registrado',
      perfil?.pontosFortes ? `\n## PONTOS FORTES (registrados)\n${perfil.pontosFortes}` : '',
      perfil?.pontosFracos ? `\n## PONTOS FRACOS (registrados)\n${perfil.pontosFracos}` : '',
    ];

    return linhas.filter(l => l !== '').join('\n');
  }

  /* ============================================================
     13. SNAPSHOT DO DIA (para o Diário do Mentor)
     Resumo do dia de hoje para registrar no learningProfile.
     ============================================================ */
  function calcSnapshotHoje() {
    const hoje = todayISO();
    const tentativasHoje = (state.tentativas || []).filter(t => t.data === hoje);
    const sessoesHoje = (state.cicloSessoes || []).filter(s => s.data === hoje && !s.ajusteManual);

    const questoes = tentativasHoje.reduce((s, t) => s + (t.numQuestoes || 0), 0);
    const acertos = tentativasHoje.reduce((s, t) => s + (t.acertos || 0), 0);
    const erros = tentativasHoje.reduce((s, t) => s + (t.erros || 0), 0);
    const minutos = sessoesHoje.reduce((s, x) => s + (x.minutos || 0), 0);
    const taxa = (acertos + erros) > 0 ? acertos / (acertos + erros) : null;

    // Melhor e pior disciplina do dia
    const discHoje = {};
    for (const t of tentativasHoje) {
      const k = t.disciplina || '(sem disciplina)';
      if (!discHoje[k]) discHoje[k] = { acertos: 0, erros: 0 };
      discHoje[k].acertos += t.acertos || 0;
      discHoje[k].erros   += t.erros   || 0;
    }
    const discArr = Object.entries(discHoje).map(([nome, d]) => ({
      nome, taxa: (d.acertos + d.erros) > 0 ? d.acertos / (d.acertos + d.erros) : null
    })).filter(d => d.taxa !== null);

    const melhorHoje = discArr.reduce((m, d) => d.taxa > (m?.taxa ?? -1) ? d : m, null);
    const piorHoje   = discArr.reduce((m, d) => d.taxa < (m?.taxa ?? 2)  ? d : m, null);

    return {
      data: hoje, questoes, acertos, erros, minutos, taxa,
      melhorDiscHoje: melhorHoje?.nome || null,
      piorDiscHoje:   piorHoje?.nome   || null,
      disciplinas:    discArr
    };
  }

  /* --- API pública --- */
  return {
    calcDisciplinas,
    calcConsistencia,
    calcCobertura,
    calcEvolucao,
    calcLacunas,
    calcCoberturaCaderno,
    calcTempo,
    calcFase,
    calcIndiceAprovacao,
    calcDNA,
    calcSnapshotHoje,
    gerarCoachPosSessao,
    buildContextoMentor,
  };

})();
