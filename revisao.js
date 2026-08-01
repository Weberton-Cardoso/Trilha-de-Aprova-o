/**
 * revisao.js
 * Sistema de Revisão do Dia — priorização inteligente baseada em:
 *  • Taxa de acerto (menor % = maior prioridade)
 *  • Tempo sem revisar (dias desde última sessão/tentativa/revisão)
 *  • Peso da disciplina no ciclo
 *  • Resumos disponíveis no Caderno (se não houver, gera teoria via Gemini)
 *
 * Depende de (carregados antes no index.html):
 *  database.js  — db.*, STORES, tx
 *  ciclo.js     — _materiaCasaComDisciplina
 *  app.js       — state, todayISO, toBRDate, fmtPct, fmtPctSigned,
 *                 escapeHtml, $, $$, showToast, reloadState, _mdParaHtml
 */

/* ── Configuração ──────────────────────────────────────────── */

const REVISAO_POR_DIA = 5;        // itens exibidos por sessão de revisão
let _revisaoIndice    = 0;
let _revisaoFilaDoDia = [];
let _revisaoGerandoIA = false;    // lock anti-duplo-clique

/* ── Helpers internos ──────────────────────────────────────── */

const _normRev = (s) => (s || '').trim().toLowerCase();

/** Persiste uma revisão concluída no IndexedDB (store revisoes). */
async function _salvarRevisao(item) {
  await db.revisoes.add({
    materia: item.materia,
    topico:  item.topico || 'Geral',
    disciplina: item.disciplina,
    data:    todayISO(),
    taxaAntes: item.taxa || 0,
    resumoId:  item.resumoId || null,
    tipoFonte: item.tipo,
    cicloNome: item.cicloNome || null
  });
  window.dispatchEvent(new CustomEvent('ta:mudou', { detail: { storeName: 'revisoes' } }));
  await reloadState();
}

/* ── Algoritmo de prioridade ───────────────────────────────── */

/**
 * Calcula a fila de revisão do dia.
 * Retorna até REVISAO_POR_DIA itens, ordenados por urgência.
 */
function calcFilaRevisao() {
  const hoje    = todayISO();
  const jaHoje  = new Set(
    state.revisoes.filter(r => r.data === hoje)
      .map(r => _normRev(r.materia + '|' + (r.topico || '')))
  );

  // 1) Pra cada matéria de cada ciclo, calcula score de urgência
  const candidatos = [];

  state.cicloMaterias.forEach(m => {
    const ciclo = state.ciclos.find(c => c.id === m.cicloId);
    if (!ciclo) return;

    const nomeCiclo = ciclo.nome || '';
    const tentativas = state.tentativas.filter(t =>
      _materiaCasaComDisciplina(m, t.disciplina) &&
      (nomeCiclo ? _normRev(t.concurso) === _normRev(nomeCiclo) : true)
    );
    const totalQ = tentativas.reduce((s, t) => s + (t.numQuestoes || 0), 0);
    const totalA = tentativas.reduce((s, t) => s + (t.acertos || 0), 0);
    const taxa = totalQ > 0 ? (totalA / totalQ) * 100 : 50;

    const datasSessoes = state.cicloSessoes
      .filter(s => s.cicloMateriaId === m.id && (s.minutos || 0) > 0)
      .map(s => s.data);
    const datasTent    = tentativas.map(t => t.data);
    const datasRev     = state.revisoes
      .filter(r => _normRev(r.materia) === _normRev(m.nome))
      .map(r => r.data);
    const ultimaData = [...datasSessoes, ...datasTent, ...datasRev].sort().pop();
    const dias = ultimaData
      ? Math.max(0, Math.round((new Date(hoje) - new Date(ultimaData + 'T12:00:00')) / 86400000))
      : 30;

    const score = (m.peso || 1) * (100 - taxa) * Math.max(0.3, dias);

    candidatos.push({ materiaObj: m, ciclo, nome: m.nome, peso: m.peso || 1, taxa, totalQ, diasSemRevisar: dias, score, jaEstudou: tentativas.length > 0 || datasSessoes.length > 0 });
  });

  // Nunca estudadas no topo, depois por score desc
  candidatos.sort((a, b) => {
    if (!a.jaEstudou && b.jaEstudou) return -1;
    if (a.jaEstudou && !b.jaEstudou) return 1;
    return b.score - a.score;
  });

  // 2) Para cada candidato, escolhe resumo do caderno ou agenda teoria
  const fila  = [];
  const usados = new Set();

  for (const c of candidatos) {
    if (fila.length >= REVISAO_POR_DIA) break;

    const resumosDaMat = state.resumos.filter(r =>
      _normRev(r.materia) === _normRev(c.nome) &&
      !jaHoje.has(_normRev(c.nome + '|' + _normRev(r.topico || '(geral)')))
    );

    const porTopico = new Map();
    resumosDaMat.forEach(r => {
      const t = _normRev(r.topico || '(geral)');
      if (!porTopico.has(t) || r.id > porTopico.get(t).id) porTopico.set(t, r);
    });

    for (const [topicoNorm, resumo] of porTopico) {
      const chave = _normRev(c.nome + '|' + topicoNorm);
      if (usados.has(chave) || fila.length >= REVISAO_POR_DIA) break;
      usados.add(chave);
      fila.push({
        tipo: 'caderno', materia: c.nome, topico: resumo.topico || 'Geral',
        disciplina: c.nome, taxa: c.taxa, diasSemRevisar: c.diasSemRevisar,
        peso: c.peso, score: c.score, totalQ: c.totalQ, cicloNome: ciclo => c.ciclo.nome,
        cicloNome: c.ciclo.nome, resumoId: resumo.id,
        conteudoBruto: resumo.textoBruto, conteudoCondensado: resumo.textoCondensado,
        enunciado: resumo.enunciado, fonteLabel: '📄 Resumo de questão'
      });
    }

    // Se não achou resumo, agenda geração teórica
    const chaveGeral = _normRev(c.nome + '|(geral)');
    if (!usados.has(chaveGeral) && fila.length < REVISAO_POR_DIA) {
      usados.add(chaveGeral);
      fila.push({
        tipo: 'teorico', materia: c.nome, topico: null, disciplina: c.nome,
        taxa: c.taxa, diasSemRevisar: c.diasSemRevisar, peso: c.peso,
        score: c.score, totalQ: c.totalQ, cicloNome: c.ciclo.nome,
        resumoId: null, conteudoBruto: null, conteudoCondensado: null,
        enunciado: null, fonteLabel: '🤖 Resumo teórico (IA)', gerado: false
      });
    }
  }

  return fila;
}

/* ── Geração de teoria via Gemini ──────────────────────────── */

function _promptTeorico({ disciplina, topico, erradas, editalTopicos }) {
  return `Você é um professor especialista em concurso público. O aluno vai revisar a teoria de um tema onde está com baixo aproveitamento.

DISCIPLINA: ${disciplina}
${topico ? `TÓPICO: ${topico}` : 'TÓPICO: geral da disciplina'}

${erradas.length ? `QUESTÕES QUE O ALUNO ERROU (foco da revisão):\n${erradas.map((q, i) => `${i + 1}. ${(q.enunciado || '').slice(0, 400)} (Gabarito: ${q.gabaritoConfirmado || '?'})`).join('\n\n')}` : ''}

${editalTopicos.length ? `TÓPICOS DO EDITAL:\n${editalTopicos.join('\n')}` : ''}

Gere um resumo teórico PURO e DENSO, estilo caderno de estudos para concurso. Siga à risca:

1. "teoria": explicação didática, completa, estruturada. Use **negrito** para termos jurídicos/conceitos-chave. Use listas numeradas (1., 2., 3.) quando enumerar requisitos/hipóteses. Use listas com "- " quando relacionar itens. Separe seções com linha em branco. Escreva como se o aluno nunca tivesse visto o assunto, mas de forma direta, sem floreios.
2. "pontosFracos": parágrafo curto (3-5 linhas) com as armadilhas mais comuns neste tema e como evitá-las.
3. "checklist": 3 perguntas de auto-verificação numeradas que o aluno DEVE saber responder após ler este resumo.

Responda SOMENTE em JSON válido, sem markdown fora dos campos:
{"teoria": "...", "pontosFracos": "...", "checklist": "..."}`;
}

async function gerarResumoTeoricoIA(item) {
  if (typeof window.chamarGeminiResumo !== 'function') {
    throw new Error('IA não configurada. Acesse Configurações → Resolver com IA primeiro.');
  }
  const disciplina = item.disciplina;
  const tentativas = state.tentativas.filter(t =>
    _normRev(t.disciplina) === _normRev(disciplina) &&
    (item.cicloNome ? _normRev(t.concurso) === _normRev(item.cicloNome) : true)
  );
  const erradas = tentativas
    .filter(t => (t.taxa || 0) < 70)
    .sort((a, b) => (b.numQuestoes || 0) - (a.numQuestoes || 0))
    .slice(0, 3);

  let editalTopicos = [];
  state.editais.forEach(e => (e.materias || []).forEach(m => {
    if (_normRev(m.nome) === _normRev(disciplina)) {
      (m.topicos || []).forEach(tp => { if (tp.nome) editalTopicos.push(tp.nome); });
    }
  }));

  const texto = await window.chamarGeminiResumo(_promptTeorico({ disciplina, topico: item.topico, erradas, editalTopicos }));
  const limpo = String(texto || '').replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(limpo);
  return { teoria: parsed.teoria || '', pontosFracos: parsed.pontosFracos || '', checklist: parsed.checklist || '' };
}

/* ── Renderização dos blocos de conteúdo ───────────────────── */

function _htmlConteudoCaderno(item) {
  return `
    <div class="revisao-texto-preview" id="revisao-texto-preview"
         style="line-height:1.7;font-size:14px;color:var(--text);">${_mdParaHtml(item.conteudoBruto)}</div>
    <textarea class="revisao-textarea" id="revisao-textarea" style="display:none;"
      rows="14">${escapeHtml(item.conteudoBruto || '')}</textarea>

    ${item.conteudoCondensado ? `<div style="border-left:3px solid var(--gold);padding:10px 12px;margin-top:16px;color:var(--text-muted);font-size:13px;">
      📎 ${escapeHtml(item.conteudoCondensado)}
    </div>` : ''}
    ${item.enunciado ? `<details style="margin-top:14px;">
      <summary style="cursor:pointer;font-size:12.5px;color:var(--primary);font-weight:600;">📋 Enunciado original da questão</summary>
      <div style="white-space:pre-wrap;font-size:12.5px;color:var(--text-muted);padding:10px;background:var(--surface-2);border-radius:6px;margin-top:6px;">${escapeHtml(item.enunciado)}</div>
    </details>` : ''}

    <div class="revisao-acoes-editar" style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
      <button class="btn btn-sm btn-outline" id="btn-editar-resumo">✏️ Editar resumo</button>
      <button class="btn btn-sm" id="btn-salvar-edicao" style="display:none;">💾 Salvar edição</button>
      <button class="btn btn-sm btn-ghost" id="btn-cancelar-edicao" style="display:none;">Cancelar</button>
      <button class="btn btn-sm btn-outline" id="btn-pedir-mais-ia">✨ Pedir mais conteúdo à IA</button>
    </div>
    <div id="revisao-mais-ia-wrap" style="display:none;margin-top:14px;">
      <textarea id="revisao-mais-ia-prompt" class="revisao-textarea" rows="3"
        placeholder="O que você quer aprofundar? Ex: Explique melhor as imunidades tributárias, adicione exemplos práticos, crie um mnemônico..."></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-sm btn-primary" id="btn-enviar-mais-ia">✨ Enviar para a IA</button>
        <button class="btn btn-sm btn-ghost" id="btn-cancelar-mais-ia">Cancelar</button>
      </div>
      <div id="revisao-mais-ia-resultado" style="display:none;margin-top:12px;"></div>
    </div>
  `;
}

function _htmlConteudoTeorico(item) {
  return `
    <div class="revisao-texto-preview" id="revisao-texto-preview"
         style="line-height:1.7;font-size:14px;color:var(--text);">${_mdParaHtml(item.conteudoBruto)}</div>
    <textarea class="revisao-textarea" id="revisao-textarea" style="display:none;"
      rows="14">${escapeHtml(item.conteudoBruto || '')}</textarea>

    ${item.conteudoCondensado ? `<div style="border-left:3px solid var(--gold);padding:12px 12px 12px 16px;margin-top:16px;color:var(--text);font-size:13px;background:var(--surface-2);border-radius:6px;">
      ${_mdParaHtml(item.conteudoCondensado)}
    </div>` : ''}

    <div class="revisao-acoes-editar" style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
      <button class="btn btn-sm btn-outline" id="btn-editar-resumo">✏️ Editar resumo</button>
      <button class="btn btn-sm" id="btn-salvar-edicao" style="display:none;">💾 Salvar edição</button>
      <button class="btn btn-sm btn-ghost" id="btn-cancelar-edicao" style="display:none;">Cancelar</button>
      <button class="btn btn-sm btn-outline" id="btn-pedir-mais-ia">✨ Pedir mais conteúdo à IA</button>
    </div>
    <div id="revisao-mais-ia-wrap" style="display:none;margin-top:14px;">
      <textarea id="revisao-mais-ia-prompt" class="revisao-textarea" rows="3"
        placeholder="O que você quer aprofundar? Ex: Adicione exemplos práticos, crie um mnemônico, compare com outro conceito..."></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-sm btn-primary" id="btn-enviar-mais-ia">✨ Enviar para a IA</button>
        <button class="btn btn-sm btn-ghost" id="btn-cancelar-mais-ia">Cancelar</button>
      </div>
      <div id="revisao-mais-ia-resultado" style="display:none;margin-top:12px;"></div>
    </div>
  `;
}

/* ── Tela principal: Revisão do Dia ────────────────────────── */

function renderRevisao(view) {
  const hoje = todayISO();
  const jaLidosHoje = state.revisoes.filter(r => r.data === hoje).length;

  // Recalcula a fila só se mudou o dia ou está vazia
  if (!_revisaoFilaDoDia.length || _revisaoFilaDoDia._data !== hoje) {
    _revisaoFilaDoDia = calcFilaRevisao();
    _revisaoFilaDoDia._data = hoje;
    _revisaoIndice = 0;
  }

  // Sem ciclo cadastrado
  if (!state.cicloMaterias.length) {
    view.innerHTML = `
      <div class="empty-state">
        <p>📚 Configure o Ciclo de Estudos primeiro</p>
        <p class="text-muted" style="font-size:13px;">A Revisão do Dia usa as disciplinas e pesos do seu Ciclo de Estudos para calcular o que você mais precisa revisar.</p>
        <a href="#/ciclo" class="btn btn-primary">Ir ao Ciclo de Estudos</a>
      </div>`;
    return;
  }

  // Fila vazia (tudo revisado hoje)
  if (!_revisaoFilaDoDia.length) {
    view.innerHTML = `
      <div class="empty-state">
        <div style="font-size:40px;margin-bottom:10px;">🎉</div>
        <p>Nada para revisar hoje!</p>
        <p class="text-muted" style="font-size:13px;">Todas as disciplinas estão em dia. Volte amanhã ou resolva mais questões pelo Resolver com IA para gerar novos resumos.</p>
        <a href="#/ciclo" class="btn btn-primary">Ir ao Ciclo de Estudos</a>
        <a href="#/evolucao-revisao" class="btn btn-ghost" style="margin-top:8px;">📊 Ver evolução</a>
      </div>`;
    return;
  }

  const total  = _revisaoFilaDoDia.length;
  const atual  = Math.min(_revisaoIndice, total - 1);
  const item   = _revisaoFilaDoDia[atual];
  const pct    = (atual / total) * 100;
  const taxaClass = item.taxa < 60 ? 'danger' : item.taxa < 75 ? 'muted' : 'success';
  const diasTxt = item.diasSemRevisar === 0 ? 'Revisado hoje'
    : `Última revisão: ${item.diasSemRevisar} dia${item.diasSemRevisar === 1 ? '' : 's'} atrás`;

  view.innerHTML = `
    <div class="revisao-container">

      <!-- Progresso -->
      <div class="revisao-progresso">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:12px;color:var(--text-muted);">📚 Revisão do Dia</span>
          <span style="font-size:12px;color:var(--text-muted);">${atual + 1} de ${total} · ${jaLidosHoje} lido${jaLidosHoje === 1 ? '' : 's'} hoje</span>
        </div>
        <div class="pct-bar-wrap" style="margin:0;">
          <div class="pct-bar" style="flex:1;height:6px;border-radius:3px;">
            <span style="width:${pct}%;background:var(--gold);border-radius:3px;"></span>
          </div>
        </div>
      </div>

      <!-- Cabeçalho da disciplina -->
      <div class="card mb-12 revisao-header" style="border-left:4px solid var(--${taxaClass === 'danger' ? 'danger' : taxaClass === 'success' ? 'success' : 'border'});">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
          <div>
            <h2 style="margin:0 0 6px;font-size:20px;">${escapeHtml(item.disciplina)}</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <span class="badge ${taxaClass}">${fmtPct(item.taxa)} de acerto</span>
              <span class="text-muted" style="font-size:12.5px;">${diasTxt}</span>
              ${item.cicloNome ? `<span class="text-muted" style="font-size:12px;">· ${escapeHtml(item.cicloNome)}</span>` : ''}
              ${item.peso ? `<span class="text-muted" style="font-size:12px;">· peso ${item.peso}</span>` : ''}
              ${item.topico ? `<span class="badge muted" style="font-size:11.5px;">${escapeHtml(item.topico)}</span>` : ''}
            </div>
          </div>
          <span class="badge muted" style="font-size:12px;">${item.fonteLabel}</span>
        </div>
      </div>

      <!-- Conteúdo -->
      <div id="revisao-conteudo" class="card mb-12" style="min-height:160px;">
        ${item.tipo === 'caderno'
          ? _htmlConteudoCaderno(item)
          : `<div style="text-align:center;padding:30px 20px;" id="revisao-teoria-wrap">
               <p class="text-muted" style="font-size:13.5px;margin-bottom:16px;">Não há resumos do Caderno para esta disciplina.<br>Clique para gerar um resumo teórico com o Gemini.</p>
               <button class="btn btn-primary" id="btn-gerar-teoria">✨ Gerar resumo teórico</button>
               <div id="revisao-teoria-gerada" style="display:none;text-align:left;"></div>
             </div>`
        }
      </div>

      <!-- Ações -->
      <div class="revisao-acoes">
        <button class="btn btn-primary btn-lg" id="btn-li-e-entendi" style="min-width:200px;">
          ✓ Li e entendi — Próximo
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-pular-revisao">Pular este</button>
        <a href="#/evolucao-revisao" class="btn btn-ghost btn-sm">📊 Evolução</a>
      </div>

    </div>
  `;

  // Listeners
  $('#btn-li-e-entendi')?.addEventListener('click', () => _avancar(view, item, true));
  $('#btn-pular-revisao')?.addEventListener('click', () => _avancar(view, item, false));

  // ── Edição inline ────────────────────────────────────────────
  $('#btn-editar-resumo')?.addEventListener('click', () => {
    const preview = $('#revisao-texto-preview');
    const textarea = $('#revisao-textarea');
    const btnEditar = $('#btn-editar-resumo');
    const btnSalvar = $('#btn-salvar-edicao');
    const btnCancelar = $('#btn-cancelar-edicao');
    if (!preview || !textarea) return;
    preview.style.display = 'none';
    textarea.style.display = 'block';
    textarea.value = item.conteudoBruto || '';
    textarea.focus();
    btnEditar.style.display = 'none';
    btnSalvar.style.display = 'inline-flex';
    btnCancelar.style.display = 'inline-flex';
  });

  $('#btn-cancelar-edicao')?.addEventListener('click', () => {
    $('#revisao-texto-preview').style.display = 'block';
    $('#revisao-textarea').style.display = 'none';
    $('#btn-editar-resumo').style.display = 'inline-flex';
    $('#btn-salvar-edicao').style.display = 'none';
    $('#btn-cancelar-edicao').style.display = 'none';
  });

  $('#btn-salvar-edicao')?.addEventListener('click', async () => {
    const novoTexto = $('#revisao-textarea')?.value?.trim();
    if (!novoTexto) { showToast('O resumo não pode ficar vazio.', 'danger'); return; }

    item.conteudoBruto = novoTexto;

    // Persiste no Caderno de Resumos
    if (item.resumoId) {
      const todos = await db.resumos.getAll();
      const resumo = todos.find(r => r.id === item.resumoId);
      if (resumo) {
        resumo.textoBruto = novoTexto;
        await db.resumos.update(resumo);
      }
    } else {
      // Sem resumoId ainda (teórico recém-gerado antes de salvar): salva agora
      const novoId = await db.resumos.add({
        materia: item.materia, topico: item.topico || null,
        data: todayISO(), textoBruto: novoTexto,
        textoCondensado: item.conteudoCondensado || null,
        tentativaId: null, enunciado: null,
        enviadoAnki: false, ankiDeck: null, origemRevisao: true
      });
      item.resumoId = novoId;
    }

    await reloadState();
    showToast('Resumo salvo! ✓', 'success');

    // Atualiza preview sem re-renderizar a tela toda
    const preview = $('#revisao-texto-preview');
    if (preview) preview.innerHTML = _mdParaHtml(novoTexto);
    $('#revisao-texto-preview').style.display = 'block';
    $('#revisao-textarea').style.display = 'none';
    $('#btn-editar-resumo').style.display = 'inline-flex';
    $('#btn-salvar-edicao').style.display = 'none';
    $('#btn-cancelar-edicao').style.display = 'none';
  });

  // ── Pedir mais conteúdo à IA ─────────────────────────────────
  $('#btn-pedir-mais-ia')?.addEventListener('click', () => {
    const wrap = $('#revisao-mais-ia-wrap');
    if (wrap) { wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'; }
    $('#revisao-mais-ia-prompt')?.focus();
  });

  $('#btn-cancelar-mais-ia')?.addEventListener('click', () => {
    $('#revisao-mais-ia-wrap').style.display = 'none';
    $('#revisao-mais-ia-resultado').style.display = 'none';
  });

  $('#btn-enviar-mais-ia')?.addEventListener('click', async () => {
    if (typeof window.chamarGeminiResumoStream !== 'function' &&
        typeof window.chamarGeminiResumo !== 'function') {
      showToast('IA não configurada. Acesse Configurações → Resolver com IA.', 'danger');
      return;
    }
    const pedido = $('#revisao-mais-ia-prompt')?.value?.trim();
    if (!pedido) { showToast('Descreva o que quer aprofundar.', 'danger'); return; }

    const btnEnviar = $('#btn-enviar-mais-ia');
    if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.textContent = '⏳ Gerando…'; }

    const resultado = $('#revisao-mais-ia-resultado');
    if (resultado) {
      resultado.style.display = 'block';
      resultado.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">⏳ Aguardando IA…</div>`;
    }

    try {
      const prompt = `Você é um professor de concursos. O aluno está revisando "${item.disciplina}"${item.topico ? ` — tópico: ${item.topico}` : ''}.

RESUMO ATUAL:
${item.conteudoBruto || '(sem resumo ainda)'}

PEDIDO DO ALUNO:
${pedido}

Responda com conteúdo adicional relevante, em linguagem de caderno de estudos. Use **negrito** para termos importantes, listas quando necessário. Seja direto e denso — o aluno já leu o resumo acima.`;

      let textoGerado = '';

      if (typeof window.chamarGeminiResumoStream === 'function') {
        await window.chamarGeminiResumoStream(prompt, (acumulado) => {
          if (resultado) resultado.innerHTML = `
            <div style="line-height:1.7;font-size:14px;color:var(--text);
                        border-left:3px solid var(--primary);padding-left:12px;">
              ${_mdParaHtml(acumulado)}
            </div>`;
          textoGerado = acumulado;
        });
      } else {
        textoGerado = await window.chamarGeminiResumo(prompt);
        if (resultado) resultado.innerHTML = `
          <div style="line-height:1.7;font-size:14px;color:var(--text);
                      border-left:3px solid var(--primary);padding-left:12px;">
            ${_mdParaHtml(textoGerado)}
          </div>`;
      }

      // Oferece incorporar ao resumo principal
      if (textoGerado && resultado) {
        resultado.innerHTML += `
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-outline" id="btn-incorporar-ia">
              📎 Incorporar ao resumo principal
            </button>
          </div>`;

        $('#btn-incorporar-ia')?.addEventListener('click', async () => {
          const separador = '\n\n---\n\n';
          item.conteudoBruto = (item.conteudoBruto || '') + separador + textoGerado;

          if (item.resumoId) {
            const todos = await db.resumos.getAll();
            const resumo = todos.find(r => r.id === item.resumoId);
            if (resumo) {
              resumo.textoBruto = item.conteudoBruto;
              await db.resumos.update(resumo);
            }
          } else {
            const novoId = await db.resumos.add({
              materia: item.materia, topico: item.topico || null,
              data: todayISO(), textoBruto: item.conteudoBruto,
              textoCondensado: item.conteudoCondensado || null,
              tentativaId: null, enunciado: null,
              enviadoAnki: false, ankiDeck: null, origemRevisao: true
            });
            item.resumoId = novoId;
          }

          await reloadState();
          const preview = $('#revisao-texto-preview');
          if (preview) preview.innerHTML = _mdParaHtml(item.conteudoBruto);
          const textarea = $('#revisao-textarea');
          if (textarea) textarea.value = item.conteudoBruto;
          showToast('Conteúdo incorporado e salvo no Caderno! 📓', 'success');
          $('#btn-incorporar-ia').textContent = '✓ Incorporado!';
          $('#btn-incorporar-ia').disabled = true;
        });
      }

      if (btnEnviar) { btnEnviar.disabled = false; btnEnviar.textContent = '✨ Enviar para a IA'; }
      $('#revisao-mais-ia-prompt').value = '';

    } catch (err) {
      showToast(err.message || 'Erro ao consultar IA.', 'danger');
      if (resultado) resultado.innerHTML = `<div style="color:var(--danger);font-size:13px;">❌ ${escapeHtml(err.message)}</div>`;
      if (btnEnviar) { btnEnviar.disabled = false; btnEnviar.textContent = '✨ Enviar para a IA'; }
    }
  });

  if (item.tipo === 'teorico' && !item.gerado) {
    $('#btn-gerar-teoria')?.addEventListener('click', async () => {
      if (_revisaoGerandoIA) return;
      _revisaoGerandoIA = true;
      const btn = $('#btn-gerar-teoria');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando…'; }
      try {
        const ia = await gerarResumoTeoricoIA(item);
        item.conteudoBruto = ia.teoria;
        item.conteudoCondensado = (ia.pontosFracos + '\n\n' + ia.checklist).trim();
        item.gerado = true;

        // Salva automaticamente no Caderno de Resumos para uso futuro
        const novoId = await db.resumos.add({
          materia:          item.materia,
          topico:           item.topico || null,
          data:             todayISO(),
          textoBruto:       item.conteudoBruto,
          textoCondensado:  item.conteudoCondensado,
          tentativaId:      null,   // gerado pela IA, sem tentativa vinculada
          enunciado:        null,
          enviadoAnki:      false,
          ankiDeck:         null,
          origemRevisao:    true    // flag pra distinguir no Caderno se precisar
        });
        item.resumoId = novoId;
        await reloadState(); // atualiza state.resumos
        showToast('Resumo salvo no Caderno de Resumos! 📓', 'success');

        const wrap = $('#revisao-teoria-gerada');
        if (wrap) {
          wrap.style.display = 'block';
          wrap.innerHTML = _htmlConteudoTeorico(item);
        }
        if (btn) btn.style.display = 'none';
        const tituloWrap = $('#revisao-teoria-wrap > p');
        if (tituloWrap) tituloWrap.style.display = 'none';
      } catch (err) {
        showToast(err.message || 'Erro ao gerar resumo teórico.', 'danger');
        if (btn) { btn.disabled = false; btn.textContent = '✨ Tentar de novo'; }
      } finally {
        _revisaoGerandoIA = false;
      }
    });
  }
}

async function _avancar(view, item, marcar) {
  if (marcar) {
    if (item.tipo === 'teorico' && !item.gerado) {
      showToast('Gere o resumo teórico antes de marcar como lido.', 'danger'); return;
    }
    await _salvarRevisao(item);
    showToast('Revisão registrada! 🧠', 'success');
  }

  _revisaoIndice++;
  if (_revisaoIndice >= _revisaoFilaDoDia.length) {
    const lidos = state.revisoes.filter(r => r.data === todayISO()).length;
    view.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:40px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">🎉</div>
        <h2 style="margin:0 0 8px;">Revisão do Dia concluída!</h2>
        <p class="text-muted" style="font-size:14px;max-width:360px;margin:0 auto 20px;">
          Você revisou <strong>${_revisaoFilaDoDia.length}</strong> tema(s) hoje.<br>
          Total acumulado: <strong>${lidos}</strong> revisão(ões) registradas.
        </p>
        <a href="#/evolucao-revisao" class="btn btn-primary">Ver evolução</a>
        <a href="#/dashboard" class="btn btn-ghost" style="margin-top:8px;">Voltar ao Dashboard</a>
      </div>`;
    return;
  }
  renderRevisao(view);
}

/* ── Tela de Evolução ──────────────────────────────────────── */

function renderEvolucaoRevisao(view) {
  const disciplinas = [...new Set(state.revisoes.map(r => r.disciplina).filter(Boolean))];

  if (!disciplinas.length) {
    view.innerHTML = `
      <div class="empty-state">
        <p>📊 Nenhuma revisão registrada ainda.</p>
        <p class="text-muted" style="font-size:13px;">Complete pelo menos uma revisão para ver a evolução.</p>
        <a href="#/revisao" class="btn btn-primary">Iniciar Revisão do Dia</a>
      </div>`;
    return;
  }

  view.innerHTML = `
    <div style="margin-bottom:16px;">
      <a href="#/revisao" class="btn btn-ghost btn-sm">← Voltar à Revisão</a>
    </div>
    <div class="card-title" style="margin-bottom:16px;">Evolução por disciplina</div>
    <div class="grid-2">
      ${disciplinas.map(d => {
        const revs = state.revisoes
          .filter(r => _normRev(r.disciplina) === _normRev(d))
          .sort((a, b) => (a.data || '').localeCompare(b.data || ''));
        const ultima = revs[revs.length - 1];
        const taxaAntes = ultima ? ultima.taxaAntes : 0;

        const tents = state.tentativas.filter(t => _normRev(t.disciplina) === _normRev(d));
        const totalQ = tents.reduce((s, t) => s + (t.numQuestoes || 0), 0);
        const totalA = tents.reduce((s, t) => s + (t.acertos || 0), 0);
        const taxaAtual = totalQ > 0 ? (totalA / totalQ) * 100 : 0;
        const delta = taxaAtual - taxaAntes;
        const icon  = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡';
        const cls   = delta > 0 ? 'success' : delta < 0 ? 'danger' : 'muted';

        return `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
              <h3 style="margin:0;font-size:16px;">${escapeHtml(d)}</h3>
              <span class="badge ${cls}">${icon} ${fmtPctSigned(delta)}</span>
            </div>
            <div class="stat-grid" style="grid-template-columns:1fr 1fr;gap:10px;">
              <div class="stat-card"><div class="label">Taxa antes</div><div class="value">${fmtPct(taxaAntes)}</div></div>
              <div class="stat-card"><div class="label">Taxa atual</div><div class="value">${fmtPct(taxaAtual)}</div></div>
              <div class="stat-card"><div class="label">Revisões</div><div class="value">${revs.length}</div></div>
              <div class="stat-card"><div class="label">Última</div><div class="value">${toBRDate(ultima?.data) || '-'}</div></div>
            </div>
            <div style="margin-top:10px;font-size:12px;color:var(--text-muted);">
              ${revs.slice(-3).map(r =>
                `<span class="badge muted" style="margin:2px 4px 2px 0;">${toBRDate(r.data)} · ${r.tipoFonte === 'teorico' ? '🤖' : '📄'}</span>`
              ).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}
