/**
 * analise-erros.js
 * DIAGNÓSTICO DE ERROS — a IA lê as questões que você errou, agrupa por
 * PADRÃO DE ERRO (não por disciplina genérica) e devolve uma recomendação
 * específica de revisão. Ex.: em vez de "estude Direito Tributário", algo
 * como "você errou 3 questões seguidas sobre a base de cálculo do ISS —
 * reveja o item 1.04 da lista de serviços e a Súmula 166 do STJ".
 *
 * MODELO DE DADOS (ver v11 em database.js):
 * - errosQuestoes: um registro por QUESTÃO ERRADA individual. Pode vir de
 *   qualquer tela — Resolver com IA salva automaticamente (ver app.js,
 *   _resolverIASalvarResultado), e Ciclo de Estudos / Simulados / Tentativas
 *   ganham um botão "Registrar erro" que chama window.abrirModalRegistrarErro
 *   (definida aqui) pra registrar manualmente, colando o enunciado se tiver.
 * - diagnosticosErro: o resultado gerado pela IA a partir de um lote de
 *   errosQuestoes ainda não analisados — um "padrão" + uma "recomendação",
 *   com status 'ativo' | 'revisado' | 'descartado'. Editar ou descartar um
 *   diagnóstico é a "correção manual" pedida: a IA nem sempre acerta o
 *   padrão ou o gabarito de origem, então nada aqui é definitivo até você
 *   confirmar.
 *
 * FLUXO:
 * 1. Você (ou a tela de origem) registra um erro em db.errosQuestoes.
 * 2. Em algum momento (manual, pelo botão "Analisar agora", tanto no card do
 *    Dashboard quanto na tela /diagnostico) roda rodarDiagnosticoErros().
 * 3. Ela pega os erros ainda não analisados, manda pra IA (reaproveitando o
 *    mesmo canal window.chamarGeminiResumo de ia-gemini.js/app.js) e grava
 *    os diagnósticos retornados, marcando os erros usados como analisados.
 * 4. O card "📌 Recomendação do dia" no Dashboard mostra os diagnósticos
 *    ativos mais recentes; a tela /diagnostico mostra tudo, com abas por
 *    status e edição manual.
 *
 * POR QUE NÃO RODA SOZINHO EM BACKGROUND: cada chamada usa cota da API do
 * Gemini. Em vez de disparar sozinho a cada erro novo, o app só nudga
 * ("N erros ainda não analisados") e deixa você decidir quando gerar —
 * continua parecendo automático no dia a dia (um clique) sem gastar cota à
 * toa nem surpreender ninguém com uma chamada de rede escondida.
 */

/* ============================================================
   REGISTRO MANUAL DE ERRO (Ciclo, Simulados, Tentativas, avulso)
   ============================================================ */

/**
 * Abre o modal de registro rápido de uma questão errada. `ctx` pode trazer
 * disciplina/assunto já preenchidos (ex.: a matéria em estudo no Ciclo) e a
 * origem (usada só como rótulo informativo na listagem depois).
 */
function abrirModalRegistrarErro(ctx = {}) {
  const { disciplina = '', assunto = '', origem = 'avulso', tentativaId = null } = ctx;

  openModal(`
    <h2>📝 Registrar questão errada</h2>
    <p class="text-muted" style="font-size:12.5px;margin-top:-6px;">
      Quanto mais detalhe você der (principalmente o enunciado), mais específica a IA consegue
      ser na recomendação depois — mas mesmo só com disciplina/assunto já ajuda a IA a ver o padrão.
    </p>
    <div class="form-row">
      <label>Disciplina</label>
      <div class="autocomplete-wrap">
        <input type="text" id="erro-disciplina" autocomplete="off" value="${escapeHtml(disciplina)}" placeholder="Ex: Direito Tributário">
      </div>
    </div>
    <div class="form-row">
      <label>Assunto/tópico</label>
      <div class="autocomplete-wrap">
        <input type="text" id="erro-assunto" autocomplete="off" value="${escapeHtml(assunto)}" placeholder="Ex: ISS - Lista de serviços">
      </div>
    </div>
    <div class="form-row">
      <label>Enunciado (opcional, mas recomendado)</label>
      <textarea id="erro-enunciado" rows="6" placeholder="Cole aqui a questão completa, se tiver à mão..."></textarea>
    </div>
    <div class="form-row" style="display:flex;gap:10px;">
      <div style="flex:1;">
        <label>Sua resposta</label>
        <input type="text" id="erro-resposta-marcada" placeholder="Ex: C">
      </div>
      <div style="flex:1;">
        <label>Gabarito correto</label>
        <input type="text" id="erro-gabarito" placeholder="Ex: A">
      </div>
    </div>
    <div class="form-row">
      <label>Data</label>
      <input type="date" id="erro-data" value="${todayISO()}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="erro-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="erro-salvar">Salvar</button>
    </div>
  `);

  const inputDisc = $('#erro-disciplina');
  const inputAssunto = $('#erro-assunto');

  if (typeof attachAutocomplete === 'function' && typeof valoresUnicos === 'function') {
    attachAutocomplete(inputDisc, () => valoresUnicos('disciplina'));
  }
  if (typeof attachAutocomplete === 'function' && typeof valoresAssuntoParaDisciplina === 'function') {
    attachAutocomplete(inputAssunto, () => valoresAssuntoParaDisciplina(inputDisc.value));
  }

  $('#erro-cancelar').addEventListener('click', closeModal);
  $('#erro-salvar').addEventListener('click', async () => {
    const disciplinaVal = inputDisc.value.trim();
    if (!disciplinaVal) { showToast('Informe ao menos a disciplina.', 'danger'); return; }

    await db.errosQuestoes.add({
      origem,
      tentativaId: tentativaId || null,
      disciplina: disciplinaVal,
      assunto: inputAssunto.value.trim(),
      enunciado: $('#erro-enunciado').value.trim(),
      alternativaMarcada: $('#erro-resposta-marcada').value.trim(),
      gabaritoCorreto: $('#erro-gabarito').value.trim(),
      data: $('#erro-data').value || todayISO(),
      analisado: false,
      diagnosticoId: null,
      criadoEm: new Date().toISOString()
    });

    showToast('Erro registrado — ele entra no próximo diagnóstico da IA.', 'success');
    closeModal();
    // Se o Dashboard estiver na tela por trás do modal, atualiza o aviso de pendentes.
    if (typeof window.renderCardRecomendacaoDia === 'function') {
      window.renderCardRecomendacaoDia().catch(() => {});
    }
  });
}
window.abrirModalRegistrarErro = abrirModalRegistrarErro;

function _origemLabel(origem) {
  return {
    resolver_ia: 'Resolver com IA',
    ciclo: 'Ciclo de Estudos',
    simulado: 'Simulados',
    tentativas: 'Tentativas',
    avulso: 'Avulso'
  }[origem] || 'Avulso';
}

/* ============================================================
   CHAMADA À IA — DIAGNÓSTICO DE PADRÃO DE ERRO
   ============================================================
   Reaproveita window.chamarGeminiResumo(prompt) (mesma ponte usada pela
   tela "Resolver com IA", ver app.js/ia-gemini.js) — nenhuma configuração
   nova de IA é necessária.
   ============================================================ */

function _montarPromptDiagnostico(erros) {
  const listaTexto = erros.map(e => `ID ${e.id}
Disciplina: ${e.disciplina || '(não informado)'}
Assunto/tópico: ${e.assunto || '(não informado)'}
${e.enunciado ? `Enunciado:\n${e.enunciado}` : 'Enunciado: (não foi colado — baseie-se só nos outros dados)'}
Alternativa marcada por mim: ${e.alternativaMarcada || '(não informado)'}
Gabarito correto: ${e.gabaritoCorreto || '(não informado)'}`).join('\n\n---\n\n');

  return `Você é um professor experiente preparando um aluno para concurso público. Abaixo está uma lista de questões que o aluno ERROU recentemente. Sua tarefa é AGRUPAR essas questões por PADRÃO DE ERRO — questões que erram pelo mesmo motivo específico (o mesmo sub-tema, a mesma pegadinha, o mesmo dispositivo legal/conceito) devem ficar no MESMO grupo, mesmo que os rótulos de disciplina/assunto não sejam idênticos.

REGRAS IMPORTANTES:
1. NUNCA recomende algo genérico como "estude Direito Tributário". Seja específico: cite o sub-tema exato, o artigo/súmula/item de lista/conceito preciso que causou o erro, sempre que der pra inferir isso do enunciado ou do gabarito.
2. Se 2 ou mais questões do lote compartilharem o mesmo padrão, a recomendação desse grupo deve deixar isso claro (ex.: "Você errou N questões seguidas sobre X — reveja Y").
3. Se uma questão for um erro isolado, sem relação com as demais, ainda assim gere um grupo (com 1 questão) e uma recomendação específica pra ela — só que mais curta.
4. TODA ID da lista abaixo precisa aparecer em EXATAMENTE UM grupo do resultado. Nenhuma pode ficar de fora.
5. Se o enunciado de uma questão não foi colado, baseie-se só em disciplina/assunto/gabarito e deixe a recomendação um pouco mais genérica (mas ainda assim direcionada ao assunto informado, nunca só "estude a disciplina").

QUESTÕES ERRADAS:

${listaTexto}

Responda SOMENTE em JSON válido (um array), sem markdown, sem texto fora do JSON, neste formato exato:
[{"padrao": "nome curto do padrão de erro", "disciplina": "...", "assunto": "...", "recomendacao": "recomendação específica e acionável, em 1 a 3 frases", "erroIds": [ID1, ID2]}]`;
}

async function _chamarIADiagnostico(erros) {
  if (typeof window.chamarGeminiResumo !== 'function') {
    throw new Error('IA ainda não configurada nesse dispositivo (falta configurar o Firebase AI Logic).');
  }
  const prompt = _montarPromptDiagnostico(erros);
  const textoResposta = await window.chamarGeminiResumo(prompt);
  const limpo = String(textoResposta || '').replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(limpo);
  } catch (err) {
    throw new Error('A IA respondeu num formato inesperado. Tente analisar de novo.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('A IA respondeu num formato inesperado (esperava uma lista de padrões).');
  }
  return parsed;
}

/** Quantos erros no máximo entram numa única chamada à IA — mantém o prompt
 *  em um tamanho razoável. Se houver mais pendentes que isso, processa os
 *  mais antigos primeiro; o restante fica pra próxima chamada de "Analisar
 *  agora" (o botão continua disponível e mostra quantos ainda faltam). */
const DIAGNOSTICO_LOTE_MAX = 20;

/**
 * Roda o diagnóstico sobre os erros ainda não analisados. Devolve
 * { gerados, questoesAnalisadas }. Não faz nada (e não gasta chamada de
 * IA) se não houver nenhum erro pendente.
 */
async function rodarDiagnosticoErros() {
  const todos = await db.errosQuestoes.getAll();
  const pendentes = todos.filter(e => !e.analisado);
  if (!pendentes.length) return { gerados: 0, questoesAnalisadas: 0 };

  const lote = pendentes
    .sort((a, b) => (a.criadoEm || '').localeCompare(b.criadoEm || ''))
    .slice(0, DIAGNOSTICO_LOTE_MAX);

  const grupos = await _chamarIADiagnostico(lote.map(e => ({
    id: e.id,
    disciplina: e.disciplina,
    assunto: e.assunto,
    enunciado: e.enunciado,
    alternativaMarcada: e.alternativaMarcada,
    gabaritoCorreto: e.gabaritoCorreto
  })));

  const idsDoLote = new Set(lote.map(e => e.id));
  const idsCobertos = new Set();
  let gerados = 0;

  for (const g of grupos) {
    const erroIds = Array.isArray(g.erroIds) ? g.erroIds.filter(id => idsDoLote.has(id) && !idsCobertos.has(id)) : [];
    const recomendacao = (g.recomendacao || '').trim();
    if (!erroIds.length || !recomendacao) continue;
    erroIds.forEach(id => idsCobertos.add(id));

    const diagId = await db.diagnosticosErro.add({
      criadoEm: new Date().toISOString(),
      disciplina: (g.disciplina || '').trim(),
      assunto: (g.assunto || '').trim(),
      padrao: (g.padrao || 'Padrão de erro').trim(),
      recomendacao,
      textoOriginalIA: recomendacao,
      editadoPeloUsuario: false,
      status: 'ativo',
      erroIds
    });
    gerados++;

    for (const id of erroIds) {
      const erro = lote.find(e => e.id === id);
      if (erro) await db.errosQuestoes.update({ ...erro, analisado: true, diagnosticoId: diagId });
    }
  }

  // Rede de segurança: se a IA deixou alguma ID do lote de fora de todo
  // grupo (aconteceu de não seguir a regra 4 do prompt), essas questões
  // ainda ganham um diagnóstico avulso — nunca ficam "escondidas" sem
  // aparecer em lugar nenhum.
  const esquecidos = lote.filter(e => !idsCobertos.has(e.id));
  if (esquecidos.length) {
    const diagId = await db.diagnosticosErro.add({
      criadoEm: new Date().toISOString(),
      disciplina: esquecidos[0].disciplina || '',
      assunto: esquecidos[0].assunto || '',
      padrao: 'Erros avulsos (sem padrão identificado)',
      recomendacao: 'A IA não conseguiu agrupar essas questões num padrão específico — revise o enunciado e o gabarito de cada uma individualmente.',
      textoOriginalIA: '',
      editadoPeloUsuario: false,
      status: 'ativo',
      erroIds: esquecidos.map(e => e.id)
    });
    gerados++;
    for (const e of esquecidos) {
      await db.errosQuestoes.update({ ...e, analisado: true, diagnosticoId: diagId });
    }
  }

  return { gerados, questoesAnalisadas: lote.length };
}
window.rodarDiagnosticoErros = rodarDiagnosticoErros;

/* ============================================================
   CARD DO DASHBOARD: "📌 Recomendação do dia"
   ============================================================ */

async function renderCardRecomendacaoDia() {
  const card = $('#card-recomendacao-dia');
  if (!card) return;

  const [todosErros, diagnosticos] = await Promise.all([
    db.errosQuestoes.getAll(),
    db.diagnosticosErro.getAll()
  ]);
  const pendentes = todosErros.filter(e => !e.analisado);
  const ativos = diagnosticos
    .filter(d => d.status === 'ativo')
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));

  const nudge = pendentes.length ? `
    <div class="flex" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:${ativos.length ? '12px' : '2px'};">
      <span class="text-muted" style="font-size:13px;">${pendentes.length} erro${pendentes.length === 1 ? '' : 's'} ainda não analisado${pendentes.length === 1 ? '' : 's'} pela IA.</span>
      <button class="btn btn-sm btn-primary" id="btn-rodar-diagnostico">🤖 Analisar agora</button>
    </div>` : '';

  if (!ativos.length && !pendentes.length) {
    card.innerHTML = `
      <div class="card-title">📌 Recomendação do dia</div>
      <p class="text-muted" style="font-size:13px;">
        Nenhuma recomendação ainda. Registre questões erradas (Resolver com IA, Ciclo de Estudos,
        Simulados ou Tentativas) e rode o diagnóstico pra IA identificar padrões de erro aqui.
      </p>
      <a href="#/diagnostico" class="btn btn-sm mt-8">Ver tela de diagnóstico</a>
    `;
    return;
  }

  const topN = ativos.slice(0, 3);
  card.innerHTML = `
    <div class="card-title">📌 Recomendação do dia</div>
    ${nudge}
    ${topN.length ? `
      <div>
        ${topN.map(d => `
          <div style="padding:9px 0;border-bottom:1px solid var(--border);">
            <div style="font-weight:700;font-size:13.5px;">${escapeHtml(d.padrao)}</div>
            <div class="text-muted" style="font-size:11.5px;margin-bottom:3px;">${escapeHtml(d.disciplina || '')}${d.assunto ? ' · ' + escapeHtml(d.assunto) : ''}</div>
            <div style="font-size:13.5px;">${escapeHtml(d.recomendacao)}</div>
          </div>
        `).join('')}
      </div>
      <a href="#/diagnostico" class="btn btn-sm mt-8">${ativos.length > 3 ? `Ver todas as ${ativos.length}` : 'Ver na tela de diagnóstico'}</a>
    ` : `<p class="text-muted" style="font-size:13px;">${pendentes.length ? '' : 'Nada pra revisar agora — bom trabalho!'}</p>`}
  `;

  const btn = $('#btn-rodar-diagnostico');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Analisando...';
    try {
      const r = await rodarDiagnosticoErros();
      showToast(`Diagnóstico gerado: ${r.gerados} recomendação(ões) a partir de ${r.questoesAnalisadas} questão(ões).`, 'success');
      await renderCardRecomendacaoDia();
    } catch (err) {
      showToast(err.message || 'Erro ao rodar o diagnóstico.', 'danger');
      btn.disabled = false;
      btn.textContent = '🤖 Analisar agora';
    }
  });
}
window.renderCardRecomendacaoDia = renderCardRecomendacaoDia;

/* ============================================================
   TELA: /diagnostico — lista completa + edição/correção manual
   ============================================================ */

let _diagAbaAtiva = 'ativo';

function renderDiagnosticoErros(view) {
  view.innerHTML = '<p class="text-muted">Carregando...</p>';
  _carregarTelaDiagnostico(view);
}
window.renderDiagnosticoErros = renderDiagnosticoErros;

async function _carregarTelaDiagnostico(view) {
  const [erros, diagnosticos] = await Promise.all([
    db.errosQuestoes.getAll(),
    db.diagnosticosErro.getAll()
  ]);

  const pendentes = erros
    .filter(e => !e.analisado)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));

  const contagem = {
    ativo: diagnosticos.filter(d => d.status === 'ativo').length,
    revisado: diagnosticos.filter(d => d.status === 'revisado').length,
    descartado: diagnosticos.filter(d => d.status === 'descartado').length
  };

  const listaAba = diagnosticos
    .filter(d => d.status === _diagAbaAtiva)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));

  view.innerHTML = `
    <div class="toolbar">
      <div class="text-muted" style="font-size:13px;">
        ${pendentes.length} erro${pendentes.length === 1 ? '' : 's'} pendente${pendentes.length === 1 ? '' : 's'} de análise ·
        ${diagnosticos.length} diagnóstico${diagnosticos.length === 1 ? '' : 's'} gerado${diagnosticos.length === 1 ? '' : 's'} no total
      </div>
      <button class="btn btn-primary" id="btn-diag-rodar">🤖 Analisar erros pendentes</button>
    </div>

    ${pendentes.length ? `
    <div class="card mb-12">
      <div class="card-title">Erros aguardando análise (${pendentes.length}${pendentes.length > DIAGNOSTICO_LOTE_MAX ? `, ${DIAGNOSTICO_LOTE_MAX} por análise` : ''})</div>
      <div>
        ${pendentes.map(e => `
          <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13.5px;">${escapeHtml(e.disciplina || '(sem disciplina)')}${e.assunto ? ' · ' + escapeHtml(e.assunto) : ''}</div>
              <div class="text-muted" style="font-size:11.5px;">
                ${toBRDate(e.data)} · origem: ${escapeHtml(_origemLabel(e.origem))}${e.gabaritoCorreto ? ' · gabarito: ' + escapeHtml(e.gabaritoCorreto) : ''}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-sm" data-editar-erro="${e.id}">Editar</button>
              <button class="btn btn-sm btn-ghost" data-excluir-erro="${e.id}">Excluir</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>` : `
    <div class="card mb-12">
      <p class="text-muted" style="font-size:13px;margin:0;">Nenhum erro pendente de análise no momento.</p>
    </div>`}

    <div class="card">
      <div class="card-title">Diagnósticos (padrões de erro identificados pela IA)</div>
      <div class="filter-bar" style="margin-bottom:12px;">
        <button class="chip ${_diagAbaAtiva === 'ativo' ? 'active' : ''}" data-aba="ativo">Ativos (${contagem.ativo})</button>
        <button class="chip ${_diagAbaAtiva === 'revisado' ? 'active' : ''}" data-aba="revisado">Revisados (${contagem.revisado})</button>
        <button class="chip ${_diagAbaAtiva === 'descartado' ? 'active' : ''}" data-aba="descartado">Descartados (${contagem.descartado})</button>
      </div>
      ${listaAba.length
        ? listaAba.map(d => _renderDiagnosticoItem(d)).join('')
        : `<p class="text-muted" style="font-size:13px;">Nenhum diagnóstico nesta aba ainda.</p>`}
    </div>
  `;

  $('#btn-diag-rodar').addEventListener('click', async () => {
    const btn = $('#btn-diag-rodar');
    btn.disabled = true;
    btn.textContent = 'Analisando...';
    try {
      const r = await rodarDiagnosticoErros();
      if (r.questoesAnalisadas === 0) showToast('Nenhum erro pendente de análise.', '');
      else showToast(`${r.gerados} recomendação(ões) geradas a partir de ${r.questoesAnalisadas} questão(ões).`, 'success');
      _carregarTelaDiagnostico(view);
    } catch (err) {
      showToast(err.message || 'Erro ao rodar o diagnóstico.', 'danger');
      btn.disabled = false;
      btn.textContent = '🤖 Analisar erros pendentes';
    }
  });

  $$('.chip[data-aba]', view).forEach(chip => {
    chip.addEventListener('click', () => {
      _diagAbaAtiva = chip.dataset.aba;
      _carregarTelaDiagnostico(view);
    });
  });

  $$('[data-editar-erro]', view).forEach(btn => {
    btn.addEventListener('click', () => _abrirEdicaoErro(Number(btn.dataset.editarErro), view));
  });
  $$('[data-excluir-erro]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir este registro de erro? Ele não vai mais entrar em nenhum diagnóstico futuro.')) return;
      await db.errosQuestoes.remove(Number(btn.dataset.excluirErro));
      _carregarTelaDiagnostico(view);
    });
  });

  $$('[data-status-diag]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const novoStatus = btn.dataset.statusDiag;
      const d = await db.diagnosticosErro.get(id);
      if (d) await db.diagnosticosErro.update({ ...d, status: novoStatus });
      _carregarTelaDiagnostico(view);
    });
  });
  $$('[data-editar-diag]', view).forEach(btn => {
    btn.addEventListener('click', () => _abrirEdicaoDiagnostico(Number(btn.dataset.editarDiag), view));
  });
}

function _renderDiagnosticoItem(d) {
  return `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-weight:700;font-size:14px;">${escapeHtml(d.padrao)}</div>
      <div class="text-muted" style="font-size:12px;margin-bottom:4px;">
        ${escapeHtml(d.disciplina || '')}${d.assunto ? ' · ' + escapeHtml(d.assunto) : ''} ·
        ${(d.erroIds || []).length} questão(ões) · ${toBRDate((d.criadoEm || '').slice(0, 10))}
        ${d.editadoPeloUsuario ? ' · <span title="Você editou esta recomendação">✏️ editado por você</span>' : ''}
      </div>
      <div style="font-size:13.5px;margin-bottom:8px;">${escapeHtml(d.recomendacao)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-sm" data-editar-diag="${d.id}">✏️ Editar</button>
        ${d.status !== 'revisado' ? `<button class="btn btn-sm btn-primary" data-status-diag="revisado" data-id="${d.id}">✔️ Marcar como revisado</button>` : ''}
        ${d.status !== 'ativo' ? `<button class="btn btn-sm" data-status-diag="ativo" data-id="${d.id}">↩️ Reativar</button>` : ''}
        ${d.status !== 'descartado' ? `<button class="btn btn-sm btn-ghost" data-status-diag="descartado" data-id="${d.id}">🗑️ A IA errou / descartar</button>` : ''}
      </div>
    </div>
  `;
}

async function _abrirEdicaoDiagnostico(id, view) {
  const d = await db.diagnosticosErro.get(id);
  if (!d) return;

  openModal(`
    <h2>Editar recomendação</h2>
    <p class="text-muted" style="font-size:12px;margin-top:-6px;">
      Corrija o texto se a IA identificou o padrão errado ou deu uma recomendação imprecisa —
      isso não muda as questões vinculadas, só o diagnóstico em si.
    </p>
    <div class="form-row"><label>Padrão de erro</label><input type="text" id="diag-edit-padrao" value="${escapeHtml(d.padrao)}"></div>
    <div class="form-row"><label>Recomendação</label><textarea id="diag-edit-recomendacao" rows="5">${escapeHtml(d.recomendacao)}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="diag-edit-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="diag-edit-salvar">Salvar</button>
    </div>
  `);

  $('#diag-edit-cancelar').addEventListener('click', closeModal);
  $('#diag-edit-salvar').addEventListener('click', async () => {
    const novoPadrao = $('#diag-edit-padrao').value.trim() || d.padrao;
    const novaRecomendacao = $('#diag-edit-recomendacao').value.trim() || d.recomendacao;
    await db.diagnosticosErro.update({
      ...d,
      padrao: novoPadrao,
      recomendacao: novaRecomendacao,
      editadoPeloUsuario: true
    });
    closeModal();
    showToast('Recomendação atualizada.', 'success');
    _carregarTelaDiagnostico(view);
  });
}

async function _abrirEdicaoErro(id, view) {
  const e = await db.errosQuestoes.get(id);
  if (!e) return;

  openModal(`
    <h2>Editar erro registrado</h2>
    <div class="form-row"><label>Disciplina</label><input type="text" id="erro-edit-disciplina" value="${escapeHtml(e.disciplina || '')}"></div>
    <div class="form-row"><label>Assunto/tópico</label><input type="text" id="erro-edit-assunto" value="${escapeHtml(e.assunto || '')}"></div>
    <div class="form-row"><label>Enunciado</label><textarea id="erro-edit-enunciado" rows="6">${escapeHtml(e.enunciado || '')}</textarea></div>
    <div class="form-row" style="display:flex;gap:10px;">
      <div style="flex:1;"><label>Sua resposta</label><input type="text" id="erro-edit-resposta" value="${escapeHtml(e.alternativaMarcada || '')}"></div>
      <div style="flex:1;"><label>Gabarito correto</label><input type="text" id="erro-edit-gabarito" value="${escapeHtml(e.gabaritoCorreto || '')}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="erro-edit-cancelar">Cancelar</button>
      <button class="btn btn-primary" id="erro-edit-salvar">Salvar</button>
    </div>
  `);

  $('#erro-edit-cancelar').addEventListener('click', closeModal);
  $('#erro-edit-salvar').addEventListener('click', async () => {
    await db.errosQuestoes.update({
      ...e,
      disciplina: $('#erro-edit-disciplina').value.trim(),
      assunto: $('#erro-edit-assunto').value.trim(),
      enunciado: $('#erro-edit-enunciado').value.trim(),
      alternativaMarcada: $('#erro-edit-resposta').value.trim(),
      gabaritoCorreto: $('#erro-edit-gabarito').value.trim()
    });
    closeModal();
    showToast('Erro atualizado.', 'success');
    _carregarTelaDiagnostico(view);
  });
}
