/**
 * mentor-ia.js — Mentor IA v2
 * Consome buildLearningProfile() e nunca calcula diretamente.
 * Abas: Análise do Dia / DNA do Estudante / Insights / Linha do Tempo / Diário
 */

/* ============================================================
   CACHE DO DIA
   ============================================================ */

const _MENTOR_CACHE_KEY = 'mentor_ia_cache_v3';

function _lerCacheMentor() {
  try {
    const o = JSON.parse(localStorage.getItem(_MENTOR_CACHE_KEY)||'null');
    return (o&&o.data===todayISO()) ? o : null;
  } catch { return null; }
}
function _salvarCacheMentor(profile, analise) {
  try { localStorage.setItem(_MENTOR_CACHE_KEY, JSON.stringify({data:todayISO(),profile,analise})); } catch {}
}
function _invalidarCacheMentor() {
  try { localStorage.removeItem(_MENTOR_CACHE_KEY); } catch {}
}
window._invalidarCacheMentor = _invalidarCacheMentor;

/* ============================================================
   PROMPT
   ============================================================ */

function _promptMentor(profile) {
  const compact = JSON.parse(JSON.stringify(profile));
  if (compact.questoes?.porDisc)   compact.questoes.porDisc   = compact.questoes.porDisc.slice(0,8);
  if (compact.ciclo?.materias)     compact.ciclo.materias     = compact.ciclo.materias.slice(0,10);
  if (compact.linhaDoTempo)        compact.linhaDoTempo       = compact.linhaDoTempo.slice(0,6);
  if (compact.tempo?.ultimos30)    delete compact.tempo.ultimos30;
  if (compact.insights)            delete compact.insights; // calculados, não precisam voltar

  const fase = profile.indicadores.faseDaPreparacao;
  const focoFase = {
    pre_edital:  'Foco em consistência, base teórica e cobertura do edital. Não pressione o aluno com simulados — ainda é cedo.',
    pos_edital:  'Foco em priorização das disciplinas de maior peso, revisão e volume de questões.',
    reta_final:  'Foco total em simulados, retenção dos pontos fortes e estratégia de prova. Cada dia conta.'
  }[fase] || '';

  // Memória de longo prazo: recomendações passadas e impacto
  const memoriaLP = (profile.perfilEvolutivo?.recomPassadas||[]).slice(0,2).map(r=>
    `Em ${r.data}: recomendei "${r.recomendacao}" (taxa então: ${r.taxaNaEpoca??'—'}%)`
  ).join('\n');

  return `Você é o Mentor Trilha — Coach de Alto Desempenho especializado em concursos públicos brasileiros.

FASE ATUAL: ${fase.replace('_',' ')}. ${focoFase}

${memoriaLP ? `MEMÓRIA DE LONGO PRAZO (suas recomendações anteriores — use-as para mostrar impacto e continuidade):\n${memoriaLP}\n` : ''}

CALIBRAÇÃO OBRIGATÓRIA — leia antes de qualquer coisa:
- Taxa geral ≥65%: o aluno está ACIMA DA MÉDIA para concursos públicos. NÃO dramatize. Foque em elevar ao próximo patamar (70%, 75%), não em tratar como crise.
- Taxa geral ≥70%: desempenho BOM. Tom deve ser de manutenção e refinamento, não de urgência.
- Índice de Aprovação entre 50–65: situação REGULAR, não crítica — use tom motivador, não alarmista.
- Os dados já estão FILTRADOS pelo concurso/período escolhido — não mencione dados históricos de outros concursos.
- Se a tendência de 14 dias for negativa mas a taxa geral ainda estiver acima de 65%, trate como ajuste fino, não como queda grave.

REGRAS ABSOLUTAS:
- Cite números reais dos dados em TODAS as recomendações — nada genérico
- Ao mencionar recomendações passadas, relate o impacto observado nos dados (taxa subiu? caiu? quanto?)
- Use aspas simples (') em vez de aspas retas duplas (") dentro dos textos
- Responda SOMENTE em JSON válido, sem markdown fora do JSON

═══ RESUMO EXECUTIVO ═══
${profile.resumoExecutivo}

═══ DADOS COMPLETOS ═══
${JSON.stringify(compact, null, 1)}

═══ FORMATO DA RESPOSTA ═══
{
  "resumoDia": {
    "saudacao": "frase motivacional personalizada — cite concurso/sequência/fase real (1 linha)",
    "snapshot": "3-4 linhas: o que está indo bem, o que está em risco, foco de hoje — com números"
  },
  "prioridades": [
    {"ordem":1,"acao":"ação específica (cite disciplina+número)","justificativa":"por que agora — 1 frase com dado real","minutos":45},
    {"ordem":2,"acao":"...","justificativa":"...","minutos":30},
    {"ordem":3,"acao":"...","justificativa":"...","minutos":45},
    {"ordem":4,"acao":"...","justificativa":"...","minutos":20}
  ],
  "alertas": [
    {"nivel":"critico","mensagem":"alerta com disciplina+dias/taxa exatos"},
    {"nivel":"atencao","mensagem":"..."},
    {"nivel":"info","mensagem":"..."}
  ],
  "pontosFortes": [
    {"disciplina":"...","detalhe":"taxa e tendência real"},
    {"disciplina":"...","detalhe":"..."}
  ],
  "pontosFracos": [
    {"disciplina":"...","detalhe":"o que está errado + ação específica"},
    {"disciplina":"...","detalhe":"..."}
  ],
  "previsao": {
    "texto":"2-3 frases concretas com base no ritmo atual — citar questões/dia, cobertura, projeção",
    "risco":"risco real e específico se nada mudar (1 frase)"
  },
  "coach": {
    "mensagem":"3-5 frases pessoais — citar concurso/perfil, sequência, 1 ponto forte, 1 desafio real. NUNCA genérico. Se tiver recomendação passada relevante, cite o impacto."
  },
  "planoDia": [
    {"horario":"Bloco 1","atividade":"atividade específica","disciplina":"nome","minutos":45,"motivo":"por que agora (1 frase com dado)"},
    {"horario":"Bloco 2","atividade":"...","disciplina":"...","minutos":30,"motivo":"..."},
    {"horario":"Bloco 3","atividade":"...","disciplina":"...","minutos":45,"motivo":"..."},
    {"horario":"Bloco 4","atividade":"...","disciplina":"...","minutos":30,"motivo":"..."}
  ],
  "missoes": [
    {"titulo":"missão prática específica","disciplina":"...","minutos":40,"prazo":"hoje|semana","objetivo":"o que vai conseguir com isso"},
    {"titulo":"...","disciplina":"...","minutos":20,"prazo":"...","objetivo":"..."},
    {"titulo":"...","disciplina":"...","minutos":30,"prazo":"...","objetivo":"..."}
  ]
}`;
}

/* ============================================================
   GERAÇÃO
   ============================================================ */

async function gerarAnaliseMentor(forcar=false) {
  if (!forcar) {
    const c = _lerCacheMentor();
    if (c) return c;
  }
  if (typeof window.chamarGeminiResumo !== 'function')
    throw new Error('IA não configurada. Acesse Configurações → Resolver com IA primeiro.');

  const profile = buildLearningProfile();
  const texto   = await window.chamarGeminiResumo(_promptMentor(profile));
  const limpo   = String(texto||'').replace(/```json|```/g,'').trim();

  let analise;
  try { analise = JSON.parse(limpo); }
  catch(e) {
    console.warn('Mentor JSON malformado:', e.message, '\n', limpo.slice(0,300));
    throw new Error('A IA respondeu em formato inesperado. Tente novamente.');
  }

  salvarEntradaDiario({profile, analise});
  _salvarCacheMentor(profile, analise);
  return {profile, analise};
}
window.gerarAnaliseMentor = gerarAnaliseMentor;

/* ============================================================
   HELPERS DE RENDER
   ============================================================ */

function _nEmoji(n) { return {critico:'🔴',atencao:'⚠️',info:'💡'}[n]||'⚠️'; }
function _nClass(n) { return {critico:'danger',atencao:'muted',info:'success'}[n]||'muted'; }
function _iCor(v)   { return v>=80?'var(--success)':v>=60?'var(--gold)':'var(--danger)'; }
function _iLabel(v) { return v>=80?'Excelente':v>=65?'Bom':v>=50?'Regular':'Crítico'; }
function _mLabel(n) { return {alto:'📈 Acelerando',estavel:'➡️ Estável',baixo:'📉 Desacelerando'}[n]||'➡️'; }
function _faseLabel(f){return {pre_edital:'🌱 Pré-edital',pos_edital:'📈 Pós-edital',reta_final:'🔥 Reta final'}[f]||f;}

/* ============================================================
   TELA /mentor
   ============================================================ */

let _mentorAba = 'analise';

async function renderMentorIA(view) {
  _renderShell(view, _lerCacheMentor());
}
window.renderMentorIA = renderMentorIA;

function _renderShell(view, dados) {
  const analise = dados?.analise||null;
  const profile = dados?.profile||null;
  const filtros = getMentorFiltros();
  const concursos = listarConcursosMentor();

  const filtroAtivo = filtros.dataInicio || filtros.concurso;
  const filtroLabel = [
    filtros.concurso   ? `Concurso: ${filtros.concurso}` : '',
    filtros.dataInicio ? `A partir de: ${toBRDate(filtros.dataInicio)}` : ''
  ].filter(Boolean).join(' · ');

  view.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:10px;align-items:center;">
      <div>
        ${analise
          ? `<span style="font-size:13px;color:var(--text-muted);">Análise de hoje · </span><span style="color:var(--gold);font-size:13px;">✦ Mentor ativo</span>`
          : `<span class="text-muted" style="font-size:13px;">Nenhuma análise gerada hoje.</span>`}
      </div>
      <button class="btn btn-primary" id="btn-mentor-atualizar">🤖 Atualizar análise</button>
    </div>

    <!-- Painel de filtros -->
    <div class="card mb-12" style="padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:700;font-size:13.5px;">🎯 Filtros da análise</div>
        ${filtroAtivo ? `<button class="btn btn-sm btn-ghost" id="btn-mentor-limpar-filtros">Limpar filtros</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Concurso</label>
          <select id="mentor-filtro-concurso" style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;">
            <option value="">Todos os concursos</option>
            ${concursos.map(c => `<option value="${escapeHtml(c)}" ${filtros.concurso===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Analisar a partir de</label>
          <input type="date" id="mentor-filtro-data" value="${filtros.dataInicio||''}"
            style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;box-sizing:border-box;">
        </div>
      </div>
      ${filtroAtivo ? `<div style="font-size:12px;color:var(--gold);margin-top:8px;">⚡ Filtro ativo: ${escapeHtml(filtroLabel)}</div>` : `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">Sem filtro — analisando todos os dados históricos.</div>`}
    </div>

    ${!analise ? `
      <div class="card" style="text-align:center;padding:48px 24px;">
        <div style="font-size:40px;margin-bottom:14px;">🎯</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:8px;">Mentor Trilha</div>
        <div class="text-muted" style="font-size:13.5px;max-width:420px;margin:0 auto 24px;">
          Defina os filtros acima e clique em "Atualizar análise" para o Mentor analisar só os dados do TCDF (ou do período que você escolher).
        </div>
      </div>` : ''}

    ${analise && profile ? _renderFull(analise, profile) : ''}
  `;

  // Filtros: aplicar ao mudar
  const aplicarFiltros = () => {
    const novosFiltros = {
      concurso:   $('#mentor-filtro-concurso').value || null,
      dataInicio: $('#mentor-filtro-data').value     || null
    };
    setMentorFiltros(novosFiltros);
    _invalidarCacheMentor();
    _renderShell(view, null); // limpa análise ao mudar filtro
    showToast('Filtros aplicados — clique em "Atualizar análise" para gerar com os novos dados.', '');
  };

  $('#mentor-filtro-concurso')?.addEventListener('change', aplicarFiltros);
  $('#mentor-filtro-data')?.addEventListener('change', aplicarFiltros);

  $('#btn-mentor-limpar-filtros')?.addEventListener('click', () => {
    setMentorFiltros({ dataInicio: null, concurso: null });
    _invalidarCacheMentor();
    _renderShell(view, null);
    showToast('Filtros removidos.', '');
  });

  $('#btn-mentor-atualizar')?.addEventListener('click', async () => {
    const btn = $('#btn-mentor-atualizar');
    btn.disabled = true; btn.textContent = '⏳ Analisando...';
    try {
      const d = await gerarAnaliseMentor(true);
      _renderShell(view, d);
      showToast('Análise do Mentor atualizada! 🧠','success');
    } catch(e) {
      showToast(e.message||'Erro ao gerar análise.','danger');
      btn.disabled=false; btn.textContent='🤖 Atualizar análise';
    }
  });

  const abas = ['analise','dna','insights','timeline','diario'];
  abas.forEach(aba => {
    $(`#btn-mentor-aba-${aba}`)?.addEventListener('click',()=>{_mentorAba=aba;_renderShell(view,dados);});
  });
}

function _renderFull(analise, profile) {
  const ind = profile.indicadores;
  return `
    <div class="filter-bar" style="margin-bottom:12px;overflow-x:auto;white-space:nowrap;padding-bottom:2px;">
      ${[['analise','📊 Análise'],['dna','🧬 DNA'],['insights','💡 Insights'],['timeline','📅 Linha do Tempo'],['diario','📔 Diário']]
        .map(([id,label])=>`<button class="chip ${_mentorAba===id?'active':''}" id="btn-mentor-aba-${id}">${label}</button>`).join('')}
    </div>
    ${_mentorAba==='analise'  ? _abaAnalise(analise,profile) : ''}
    ${_mentorAba==='dna'      ? _abaDNA(ind,profile)         : ''}
    ${_mentorAba==='insights' ? _abaInsights(profile)        : ''}
    ${_mentorAba==='timeline' ? _abaTimeline(profile)        : ''}
    ${_mentorAba==='diario'   ? _abaDiario()                 : ''}
  `;
}

/* ── ABA: ANÁLISE DO DIA ─────────────────────────────────── */

function _abaAnalise(a, profile) {
  const ind   = profile.indicadores;
  const prios = a.prioridades||[];
  const aler  = a.alertas||[];
  const fort  = a.pontosFortes||[];
  const frac  = a.pontosFracos||[];
  const prev  = a.previsao||{};
  const coach = a.coach||{};
  const plano = a.planoDia||[];
  const miss  = a.missoes||[];
  const res   = a.resumoDia||{};

  return `
    <!-- Índice + Resumo -->
    <div style="display:grid;grid-template-columns:110px 1fr;gap:12px;margin-bottom:12px;align-items:stretch;">
      <div class="card" style="text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.5px;color:var(--text-muted);">ÍNDICE</div>
        <div style="font-size:42px;font-weight:900;line-height:1;color:${_iCor(ind.indiceAprovacao)};">${ind.indiceAprovacao}</div>
        <div style="font-size:11.5px;color:${_iCor(ind.indiceAprovacao)};font-weight:600;">${_iLabel(ind.indiceAprovacao)}</div>
        ${ind.indiceDelta!=null?`<div style="font-size:10.5px;color:var(--text-muted);">${ind.indiceDelta>=0?'▲':'▼'} ${Math.abs(ind.indiceDelta)} vs 15d</div>`:''}
        <div style="font-size:10.5px;color:var(--text-muted);">${_mLabel(ind.momentum?.nivel)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${_faseLabel(ind.faseDaPreparacao)}</div>
      </div>
      <div class="card" style="border-left:4px solid var(--gold);">
        <div class="card-title">🌅 Resumo do Dia</div>
        ${res.saudacao?`<div style="font-size:15px;font-weight:700;margin-bottom:6px;">${escapeHtml(res.saudacao)}</div>`:''}
        ${res.snapshot ?`<div style="font-size:13.5px;line-height:1.7;">${escapeHtml(res.snapshot)}</div>` :''}
      </div>
    </div>

    <!-- Conquistas (calculadas pelo Engine) -->
    ${(profile.conquistas||[]).length?`
    <div class="card mb-12" style="padding:10px 14px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${profile.conquistas.map(c=>`<span class="badge success" style="font-size:12px;">${c.icone} ${escapeHtml(c.titulo)}</span>`).join('')}
      </div>
    </div>`:''}

    <!-- Prioridades -->
    <div class="card mb-12">
      <div class="card-title">🎯 Prioridades do Dia</div>
      ${prios.map(p=>`
        <div style="display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border);">
          <div style="font-size:22px;font-weight:900;color:var(--gold);min-width:28px;line-height:1;">${p.ordem}°</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;">${escapeHtml(p.acao)}</div>
            <div class="text-muted" style="font-size:12.5px;margin-top:2px;">${escapeHtml(p.justificativa)}</div>
          </div>
          ${p.minutos?`<div style="font-size:12px;color:var(--text-muted);flex-shrink:0;">${p.minutos}min</div>`:''}
        </div>`).join('')}
    </div>

    <!-- Missões -->
    ${miss.length?`
    <div class="card mb-12">
      <div class="card-title">🎮 Missões Inteligentes</div>
      ${miss.map(m=>`
        <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="flex:1;">
            <div style="font-weight:600;font-size:13.5px;">${escapeHtml(m.titulo)}</div>
            <div class="text-muted" style="font-size:12px;">${escapeHtml(m.objetivo)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:12px;color:var(--gold);">${m.minutos}min</div>
            <div class="text-muted" style="font-size:11px;">${m.prazo==='hoje'?'📍 Hoje':'📅 Esta semana'}</div>
          </div>
        </div>`).join('')}
    </div>`:''}

    <!-- Simulações "E se..." -->
    ${(profile.simulacoes||[]).length?`
    <div class="card mb-12">
      <div class="card-title">🔭 Simulações "E se..."</div>
      ${profile.simulacoes.map(s=>`
        <div style="padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="font-weight:600;font-size:13.5px;">E se: ${escapeHtml(s.cenario)}?</div>
          <div class="text-muted" style="font-size:12.5px;margin-top:2px;">→ ${escapeHtml(s.impacto)}</div>
        </div>`).join('')}
    </div>`:''}

    <!-- Alertas + Desempenho -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div class="card">
        <div class="card-title">⚠️ Alertas</div>
        ${aler.length
          ? aler.map(al=>`<div style="display:flex;gap:7px;align-items:flex-start;margin-bottom:8px;">${_nEmoji(al.nivel)} <span style="font-size:13px;">${escapeHtml(al.mensagem)}</span></div>`).join('')
          : '<p class="text-muted" style="font-size:13px;">Nenhum alerta hoje. ✅</p>'}
      </div>
      <div class="card">
        <div class="card-title">📊 Desempenho</div>
        ${fort.length?`<div style="font-size:11px;font-weight:700;color:var(--success);margin-bottom:4px;">FORTES</div>
          ${fort.map(f=>`<div style="margin-bottom:5px;"><div style="font-size:13px;font-weight:600;">✅ ${escapeHtml(f.disciplina)}</div><div class="text-muted" style="font-size:12px;">${escapeHtml(f.detalhe)}</div></div>`).join('')}`:''}
        ${frac.length?`<div style="font-size:11px;font-weight:700;color:var(--danger);margin:8px 0 4px;">FRACOS</div>
          ${frac.map(f=>`<div style="margin-bottom:5px;"><div style="font-size:13px;font-weight:600;">❌ ${escapeHtml(f.disciplina)}</div><div class="text-muted" style="font-size:12px;">${escapeHtml(f.detalhe)}</div></div>`).join('')}`:''}
      </div>
    </div>

    <!-- Previsão -->
    <div class="card mb-12">
      <div class="card-title">🔮 Previsão</div>
      ${prev.texto?`<div style="font-size:13.5px;line-height:1.7;margin-bottom:10px;">${escapeHtml(prev.texto)}</div>`:''}
      ${prev.risco?`<div style="background:var(--danger-soft);color:var(--danger);border-radius:6px;padding:8px 12px;font-size:13px;">⚠️ <strong>Risco:</strong> ${escapeHtml(prev.risco)}</div>`:''}
    </div>

    <!-- Coach -->
    <div class="card mb-12" style="border:1px solid var(--gold);">
      <div class="card-title">🏆 Mentor Trilha</div>
      ${coach.mensagem?`<div style="font-size:14px;line-height:1.8;font-style:italic;">${escapeHtml(coach.mensagem)}</div>`:''}
    </div>

    <!-- Plano do Dia -->
    <div class="card">
      <div class="card-title">📅 Plano do Dia</div>
      ${plano.map((p,i)=>`
        <div style="display:flex;gap:12px;padding:10px 0;${i<plano.length-1?'border-bottom:1px solid var(--border);':''}">
          <div style="min-width:72px;font-size:11.5px;font-weight:600;color:var(--text-muted);padding-top:2px;">${escapeHtml(p.horario)}</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;">${escapeHtml(p.atividade)}</div>
            <div style="font-size:12.5px;color:var(--gold);">${escapeHtml(p.disciplina)}${p.minutos?` · ${p.minutos} min`:''}</div>
            ${p.motivo?`<div class="text-muted" style="font-size:12px;margin-top:2px;">${escapeHtml(p.motivo)}</div>`:''}
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── ABA: DNA DO ESTUDANTE ───────────────────────────────── */

function _abaDNA(ind, profile) {
  const dna   = ind.dna||{};
  const mom   = ind.momentum||{};
  const risco = ind.riscoAbandono||{};
  const sob   = ind.sobrecarga;
  const eq    = ind.equilibrio||{};
  const evo   = profile.perfilEvolutivo||{};

  const row=(label,valor,sub='')=>`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);">
      <div><div style="font-size:13.5px;">${label}</div>${sub?`<div class="text-muted" style="font-size:12px;">${sub}</div>`:''}</div>
      <div style="font-weight:700;font-size:13.5px;text-align:right;max-width:55%;">${valor??'—'}</div>
    </div>`;

  return `
    <div class="card mb-12">
      <div class="card-title">🧠 Como você aprende</div>
      ${row('Melhor dia da semana', dna.melhorDiaSemana?`📅 ${dna.melhorDiaSemana}`:'—','taxa de acerto por dia')}
      ${row('Método mais usado', dna.melhorMetodo?`📖 ${dna.melhorMetodo}`:'—','tempo no Ciclo de Estudos')}
      ${row('Disciplina em alta', dna.disciplinaCrescendo?`📈 ${dna.disciplinaCrescendo}`:'—','maior subida 14 dias')}
      ${row('Disciplina consolidada', dna.disciplinaConsolidada?`✅ ${dna.disciplinaConsolidada}`:'—','taxa ≥75% com volume')}
    </div>
    <div class="card mb-12">
      <div class="card-title">📈 Perfil Evolutivo (30 dias)</div>
      ${row('Variação de taxa',evo.varTaxa30d!=null?`${evo.varTaxa30d>=0?'+':''}${evo.varTaxa30d}pp`:'—','presente vs 30-60 dias atrás')}
      ${row('Variação de velocidade',evo.varVelocidade30d!=null?`${evo.varVelocidade30d>=0?'+':''}${evo.varVelocidade30d}% q/dia`:'—','questões/dia: presente vs 30-60d')}
      ${row('Variação de consistência',evo.varConsistencia30d!=null?`${evo.varConsistencia30d>=0?'+':''}${evo.varConsistencia30d}pp`:'—','% dias estudados: presente vs 30-60d')}
      ${(evo.discMelhorou||[]).length?row('Melhorou em',evo.discMelhorou.map(d=>`${d.disciplina} +${d.delta}pp`).join(', '),'últimos 30 dias'):''}
      ${(evo.discPiorou||[]).length?row('Piorou em',evo.discPiorou.map(d=>`${d.disciplina} ${d.delta}pp`).join(', '),'últimos 30 dias'):''}
    </div>
    <div class="card mb-12">
      <div class="card-title">📊 Desempenho</div>
      ${row('Retenção estimada',dna.retencaoEstimada!=null?`${dna.retencaoEstimada}%`:'—','% disciplinas com ≥70% e ≥20 questões')}
      ${row('Velocidade de aprendizagem',`${dna.velocidade??'—'} questões/dia`,'média últimos 30 dias')}
      ${row('Momentum',_mLabel(mom.nivel),`${mom.questDelta>=0?'+':''}${mom.questDelta??0} questões vs semana anterior`)}
    </div>
    <div class="card mb-12">
      <div class="card-title">🗓 Hábitos</div>
      ${row('Sequência atual',`${profile.tempo.sequencia} dias`,'dias consecutivos')}
      ${row('Consistência (30d)',`${profile.tempo.consistencia30}%`,`${profile.tempo.dias30} dias nos últimos 30`)}
      ${row('Equilíbrio do ciclo',eq.equilibrada?'✅ Equilibrado':`⚠️ ${(eq.negligenciadas||[]).join(', ')}`,eq.equilibrada?'':'matérias com peso alto e >7d sem estudo')}
      ${sob?row('Sobrecarga detectada',`${sob.pct}% em ${sob.disciplina}`,'nos últimos 7 dias'):row('Distribuição','✅ Diversificada','sem concentração excessiva')}
    </div>
    <div class="card">
      <div class="card-title">⚠️ Risco</div>
      ${row('Risco de abandono',{baixo:'🟢 Baixo',medio:'🟡 Médio',alto:'🔴 Alto'}[risco.nivel]||'—',`score: ${risco.score}/100`)}
      ${row('Dias sem estudar',profile.tempo.diasSemEstudar!=null?`${profile.tempo.diasSemEstudar}d`:'—',profile.tempo.diasSemEstudar===0?'estudou hoje!':'')}
      ${row('Fase da preparação',_faseLabel(ind.faseDaPreparacao),'inferida pelos dados')}
    </div>`;
}

/* ── ABA: CENTRAL DE INSIGHTS ────────────────────────────── */

function _abaInsights(profile) {
  const insights = profile.insights||[];
  if (!insights.length) return `<div class="card"><p class="text-muted" style="font-size:13px;">Nenhum insight disponível ainda — continue estudando e os padrões aparecem aqui automaticamente.</p></div>`;

  const cats = [...new Set(insights.map(i=>i.categoria))];
  return cats.map(cat=>`
    <div class="card mb-12">
      <div class="card-title">${cat}</div>
      ${insights.filter(i=>i.categoria===cat).map(i=>`
        <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="font-size:22px;flex-shrink:0;">${i.icone}</div>
          <div>
            <div style="font-weight:600;font-size:13.5px;">${escapeHtml(i.titulo)}</div>
            <div class="text-muted" style="font-size:12.5px;margin-top:2px;">${escapeHtml(i.detalhe)}</div>
          </div>
        </div>`).join('')}
    </div>`).join('');
}

/* ── ABA: LINHA DO TEMPO ─────────────────────────────────── */

function _abaTimeline(profile) {
  const meses = profile.linhaDoTempo||[];
  if (!meses.length) return `<div class="card"><p class="text-muted" style="font-size:13px;">Nenhum dado histórico ainda.</p></div>`;

  return meses.map(m=>`
    <div class="card mb-12">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:700;font-size:14px;text-transform:capitalize;">${m.label}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${m.indice!=null?`<span class="badge" style="background:${_iCor(m.indice)}22;color:${_iCor(m.indice)};font-weight:700;">Índice ${m.indice}</span>`:''}
          ${m.taxa!=null?`<span class="badge muted">${m.taxa}% acerto</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--text-muted);margin-bottom:${m.coach?'10px':'0'};">
        <span>📚 ${m.questoes} questões</span>
        <span>⏱️ ${Math.round(m.minutos/60)}h estudadas</span>
        <span>✅ ${m.acertos} acertos</span>
      </div>
      ${m.coach?`<div style="font-size:12.5px;font-style:italic;border-top:1px solid var(--border);padding-top:8px;margin-top:4px;">"${escapeHtml(m.coach)}"</div>`:''}
    </div>`).join('');
}

/* ── ABA: DIÁRIO ─────────────────────────────────────────── */

function _abaDiario() {
  const diario = typeof lerDiarioMentor==='function' ? lerDiarioMentor() : [];
  if (!diario.length) return `<div class="card"><p class="text-muted" style="font-size:13px;">O Diário começa a ser preenchido a partir da primeira análise do Mentor.</p></div>`;

  return `<div style="display:flex;flex-direction:column;gap:12px;">
    ${diario.slice(0,60).map(e=>`
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:700;font-size:14px;">${toBRDate(e.data)}</div>
          <div style="text-align:right;">
            <span style="font-size:22px;font-weight:900;color:${_iCor(e.indiceAprovacao)};">${e.indiceAprovacao}</span>
            ${e.indiceAnterior!=null?`<span style="font-size:11px;color:var(--text-muted);"> (${e.indiceAprovacao-e.indiceAnterior>=0?'+':''}${e.indiceAprovacao-e.indiceAnterior})</span>`:''}
          </div>
        </div>
        <div style="display:flex;gap:10px;font-size:12px;color:var(--text-muted);margin-bottom:8px;flex-wrap:wrap;">
          ${e.taxaHoje!=null?`<span>Taxa: ${e.taxaHoje}%</span>`:''}
          ${e.sequencia?`<span>🔥 ${e.sequencia}d</span>`:''}
        </div>
        ${e.principalConquista?`<div style="font-size:13.5px;font-weight:600;margin-bottom:4px;">✨ ${escapeHtml(e.principalConquista)}</div>`:''}
        ${e.principalProblema?`<div style="font-size:13px;color:var(--danger);margin-bottom:4px;">⚠️ ${escapeHtml(e.principalProblema)}</div>`:''}
        ${e.prioridadeSeguinte?`<div class="text-muted" style="font-size:12.5px;margin-bottom:6px;">→ ${escapeHtml(e.prioridadeSeguinte)}</div>`:''}
        ${e.coach?`<div style="font-size:12.5px;font-style:italic;border-top:1px solid var(--border);padding-top:8px;">"${escapeHtml(e.coach)}"</div>`:''}
      </div>`).join('')}
  </div>`;
}

/* ============================================================
   CARD DO DASHBOARD
   ============================================================ */

async function renderCardMentorDashboard() {
  const card = $('#card-mentor-dashboard');
  if (!card) return;

  const cache   = _lerCacheMentor();
  const analise = cache?.analise||null;
  const profile = cache?.profile||null;

  if (!analise||!profile) {
    card.innerHTML=`
      <div class="card-title">🧠 Mentor Trilha</div>
      <p class="text-muted" style="font-size:13px;">O Mentor ainda não analisou sua preparação hoje.</p>
      <a href="#/mentor" class="btn btn-primary btn-sm">Abrir Mentor IA</a>`;
    return;
  }

  const ind  = profile.indicadores||{};
  const prio = (analise.prioridades||[])[0];
  const acrit= (analise.alertas||[]).filter(a=>a.nivel==='critico').slice(0,2);
  const aaten= (analise.alertas||[]).filter(a=>a.nivel==='atencao').slice(0,1);
  const conq = (profile.conquistas||[]).slice(-1)[0];
  const filt = profile.filtrosAplicados||{};
  const filtLabel = [filt.concurso, filt.dataInicio?`desde ${toBRDate(filt.dataInicio)}`:''].filter(Boolean).join(' · ');

  card.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${filtLabel?'4px':'10px'};">
      <div class="card-title" style="margin:0;">🧠 Mentor Trilha</div>
      <a href="#/mentor" class="btn btn-sm">Análise completa</a>
    </div>
    ${filtLabel?`<div style="font-size:11.5px;color:var(--gold);margin-bottom:8px;">⚡ ${escapeHtml(filtLabel)}</div>`:''}
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;">
      <div style="text-align:center;flex-shrink:0;">
        <div style="font-size:32px;font-weight:900;line-height:1;color:${_iCor(ind.indiceAprovacao)};">${ind.indiceAprovacao??'—'}</div>
        <div style="font-size:10.5px;color:var(--text-muted);">índice${ind.indiceDelta!=null?` ${ind.indiceDelta>=0?'▲':'▼'}${Math.abs(ind.indiceDelta)}`:''}</div>
        <div style="font-size:10px;color:var(--text-muted);">${_faseLabel(ind.faseDaPreparacao)}</div>
      </div>
      ${prio?`
        <div style="flex:1;background:var(--surface-2);border-radius:8px;padding:8px 12px;">
          <div style="font-size:11px;color:var(--gold);font-weight:700;margin-bottom:2px;">PRIORIDADE 1</div>
          <div style="font-weight:600;font-size:13.5px;">${escapeHtml(prio.acao)}</div>
          <div class="text-muted" style="font-size:12px;">${escapeHtml(prio.justificativa)}</div>
        </div>`:''}
    </div>
    ${conq?`<div style="font-size:12.5px;color:var(--success);margin-bottom:6px;">${conq.icone} ${escapeHtml(conq.titulo)}</div>`:''}
    ${acrit.map(al=>`<div style="display:flex;gap:6px;margin-bottom:4px;font-size:13px;">🔴 ${escapeHtml(al.mensagem)}</div>`).join('')}
    ${aaten.map(al=>`<div style="display:flex;gap:6px;margin-bottom:4px;font-size:12.5px;color:var(--text-muted);">⚠️ ${escapeHtml(al.mensagem)}</div>`).join('')}
    ${!acrit.length&&!aaten.length?`<div class="text-muted" style="font-size:13px;">Nenhum alerta hoje. ✅</div>`:''}
  `;
}
window.renderCardMentorDashboard = renderCardMentorDashboard;
