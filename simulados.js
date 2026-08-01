/**
 * simulados.js
 * Tela de Simulados, Banco Pessoal de Questões (Resolver com IA)
 * e Gerador de Simulado Personalizado.
 *
 * Extraído do app.js em 2026-07-31 como parte da refatoração.
 *
 * Depende de (carregados antes no index.html):
 *  database.js  — db.*
 *  app.js       — state, todayISO, toBRDate, fmtPct, escapeHtml,
 *                 $, $$, showToast, reloadState, router,
 *                 openModal, closeModal, renderLineChart,
 *                 _mdParaHtml, pad
 */

/* ============================================================
   TELA: SIMULADOS
   ============================================================ */

function renderSimulados(view) {
  const lista = [...state.simulados].sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  view.innerHTML = `
    <div class="toolbar">
      <div class="text-muted">Registre seus simulados e acompanhe a evolução do aproveitamento.</div>
      <button class="btn btn-primary" id="btn-novo-simulado">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
        Novo simulado
      </button>
    </div>

    ${lista.length ? `
    <div class="card mb-12">
      <div class="card-title">Evolução do aproveitamento</div>
      <div class="chart-wrap"><canvas id="chart-simulados"></canvas></div>
    </div>` : ''}

    <div class="card" style="padding:0;">
      <div class="table-wrap" id="tabela-simulados"></div>
    </div>
  `;

  $('#btn-novo-simulado').addEventListener('click', () => openSimuladoModal());

  if (lista.length) {
    const cronologico = [...lista].reverse();
    renderLineChart('chart-simulados', {
      labels: cronologico.map(s => toBRDate(s.data).slice(0, 5)),
      series: [{
        label: '% de acerto',
        data: cronologico.map(s => s.numQuestoes ? Number(((s.acertos / s.numQuestoes) * 100).toFixed(1)) : 0)
      }]
    });
  }

  const wrap = $('#tabela-simulados');
  if (!lista.length) {
    wrap.innerHTML = `<div class="empty-state">
      <p>Nenhum simulado cadastrado ainda.</p>
      <button class="btn btn-primary" id="empty-add-simulado">Cadastrar simulado</button>
    </div>`;
    $('#empty-add-simulado')?.addEventListener('click', () => openSimuladoModal());
  } else {
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Nome</th><th>Questões</th><th>Acertos</th><th>Erros</th><th>Aproveitamento</th><th>Tempo</th><th></th></tr></thead>
        <tbody>
          ${lista.map(s => {
            const pct = s.numQuestoes ? (s.acertos / s.numQuestoes) * 100 : 0;
            return `
            <tr>
              <td class="num">${toBRDate(s.data)}</td>
              <td>${escapeHtml(s.nome)}</td>
              <td class="num">${s.numQuestoes}</td>
              <td class="num" style="color:var(--success)">${s.acertos}</td>
              <td class="num" style="color:var(--danger)">${s.erros}</td>
              <td>${fmtPct(pct)}</td>
              <td class="num">${s.tempo ? fmtTempo(s.tempo) : '-'}</td>
              <td><button class="icon-btn" data-del-sim="${s.id}" title="Excluir">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7zM9 4h6l1 2H8zM9 10v8M12 10v8M15 10v8"/></svg>
              </button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
    $$('[data-del-sim]', wrap).forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Excluir este simulado?')) return;
      await db.simulados.remove(Number(btn.dataset.delSim));
      await reloadState();
      renderSimulados(view);
      showToast('Simulado excluído.', 'danger');
    }));
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
    .filter(t => (t.tipo === 'Questão avulsa (Resolver com IA)' || t.tipo === 'Sessão Resolver com IA') && t.enunciado)
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.id - a.id));

  const secao = document.createElement('div');
  secao.style.marginTop = '24px';

  if (!questoesIA.length) {
    secao.innerHTML = `
      <div class="section-title">Banco Pessoal de Questões</div>
      <div class="card">
        <p class="text-muted" style="font-size:13.5px;margin:0;">
          Nenhuma questão no banco ainda. Use "Resolver com IA" para resolver questões —
          elas são salvas aqui automaticamente com a classificação e o comentário da IA.
        </p>
      </div>
    `;
    view.appendChild(secao);
    return;
  }

  secao.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
      <div class="section-title" style="margin:0;">
        Banco Pessoal de Questões
        <span style="font-size:14px;font-weight:normal;color:var(--text-muted);margin-left:6px;">${questoesIA.length} questão${questoesIA.length !== 1 ? 'ões' : ''}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <select id="banco-ia-agrupamento" class="search-input" style="max-width:180px;font-size:12.5px;">
          <option value="materia">📁 Por Matéria</option>
          <option value="topico">📌 Por Tópico</option>
          <option value="banca">🏛️ Por Banca</option>
          <option value="nenhum">📜 Lista corrida</option>
        </select>
        <button class="btn btn-primary btn-sm" id="btn-gerar-simulado-ia">🎯 Gerar Simulado</button>
        <input type="text" id="banco-ia-busca" class="search-input" style="max-width:180px;" placeholder="🔍 Buscar…">
      </div>
    </div>
    <div id="banco-ia-lista"></div>
  `;

  view.appendChild(secao);

  let _bancoBusca = '';
  let _bancoAgrupamento = 'materia';

  function renderCardQuestao(t) {
    const resumo = state.resumos.find(r => r.tentativaId === t.id);
    const resultadoClass = t.resultado === 'certa' ? 'success' : t.resultado === 'errada' ? 'danger' : 'muted';
    const resultadoLabel = t.resultado === 'certa' ? 'Certa' : t.resultado === 'errada' ? 'Errada' : 'Branco';
    return `
      <div class="card mb-12" style="background:var(--surface-2);">
        <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
          <div>
            <b style="font-size:14px;">${escapeHtml(t.disciplina || '(Sem disciplina)')}</b>
            ${t.assunto ? `<span style="color:var(--text-muted);font-size:13px;"> · ${escapeHtml(t.assunto)}</span>` : ''}
            ${t.banca ? `<span style="color:var(--text-muted);font-size:12px;"> · ${escapeHtml(t.banca)}</span>` : ''}
            ${t.concurso ? `<span style="color:var(--text-muted);font-size:12px;"> · ${escapeHtml(t.concurso)}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span class="badge ${resultadoClass}">${resultadoLabel}</span>
            <span style="font-size:12px;color:var(--text-muted);">${toBRDate(t.data)}</span>
            ${t.gabaritoConfirmado ? `<span style="font-size:12px;background:var(--surface);padding:2px 8px;border-radius:4px;">Gabarito: <b>${escapeHtml(t.gabaritoConfirmado)}</b></span>` : ''}
          </div>
        </div>
        <details open>
          <summary style="cursor:pointer;font-size:13px;color:var(--primary);user-select:none;margin-bottom:4px;">📋 Enunciado completo</summary>
          <div style="white-space:pre-wrap;font-size:13px;color:var(--text);line-height:1.6;margin:8px 0;padding:10px;background:var(--surface);border-radius:6px;">${escapeHtml(t.enunciado || '')}</div>
        </details>
        ${resumo ? `
          <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">💡 Comentário da IA</div>
            <div style="line-height:1.6;font-size:13px;color:var(--text);">${_mdParaHtml(resumo.textoBruto)}</div>
            ${resumo.textoCondensado ? `<div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:12px;margin-top:8px;">📎 ${escapeHtml(resumo.textoCondensado)}</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderListaBanco() {
    const termo = _bancoBusca.trim().toLowerCase();
    let lista = questoesIA;
    if (termo) {
      lista = lista.filter(t =>
        (t.enunciado || '').toLowerCase().includes(termo) ||
        (t.disciplina || '').toLowerCase().includes(termo) ||
        (t.assunto || '').toLowerCase().includes(termo) ||
        (t.banca || '').toLowerCase().includes(termo)
      );
    }

    const listaEl = $('#banco-ia-lista');
    if (!lista.length) {
      listaEl.innerHTML = `<p class="text-muted" style="padding:8px 0;">Nenhuma questão encontrada para essa busca.</p>`;
      return;
    }

    if (_bancoAgrupamento === 'nenhum') {
      listaEl.innerHTML = lista.map(t => renderCardQuestao(t)).join('');
      return;
    }

    // Agrupa por Matéria, Tópico ou Banca
    const grupos = new Map();
    lista.forEach(t => {
      let chave = '(Sem classificação)';
      if (_bancoAgrupamento === 'materia') chave = t.disciplina || '(Sem matéria)';
      else if (_bancoAgrupamento === 'topico') chave = t.assunto || '(Sem tópico)';
      else if (_bancoAgrupamento === 'banca') chave = t.banca || '(Sem banca)';

      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(t);
    });

    const gruposOrdenados = Array.from(grupos.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));

    listaEl.innerHTML = gruposOrdenados.map(([nomeGrupo, itens]) => `
      <div class="banco-grupo">
        <div class="banco-grupo-head" data-toggle-grupo="${escapeHtml(nomeGrupo)}">
          <span>📂 ${escapeHtml(nomeGrupo)}</span>
          <span class="badge muted">${itens.length} questão${itens.length !== 1 ? 'ões' : ''}</span>
        </div>
        <div class="banco-grupo-body">
          ${itens.map(t => renderCardQuestao(t)).join('')}
        </div>
      </div>
    `).join('');

    $$('.banco-grupo-head', listaEl).forEach(head => {
      head.addEventListener('click', () => {
        const body = head.nextElementSibling;
        if (body) {
          body.style.display = body.style.display === 'none' ? 'block' : 'none';
        }
      });
    });
  }

  renderListaBanco();

  $('#banco-ia-agrupamento')?.addEventListener('change', (e) => {
    _bancoAgrupamento = e.target.value;
    renderListaBanco();
  });

  $('#banco-ia-busca')?.addEventListener('input', (e) => {
    _bancoBusca = e.target.value;
    renderListaBanco();
  });

  $('#btn-gerar-simulado-ia')?.addEventListener('click', () => _abrirModalGerarSimulado(questoesIA));
}

/* ============================================================
   GERADOR DE SIMULADO PERSONALIZADO
   Fluxo: filtros (modal) → simulado questão a questão →
   resultado com revisão → salvar no histórico de simulados.
   ============================================================ */

// Estado em memória do simulado em andamento (null = nenhum ativo).
let _simuladoGerado = null;

function _abrirModalGerarSimulado(todasQuestoes) {
  const disciplinas = [...new Set(todasQuestoes.map(t => t.disciplina).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const bancas     = [...new Set(todasQuestoes.map(t => t.banca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const concursos  = [...new Set(todasQuestoes.map(t => t.concurso).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const qtdMax = todasQuestoes.length;
  const hoje = new Date().toLocaleDateString('pt-BR');

  openModal(`
    <h2>🎯 Gerar Simulado Personalizado</h2>
    <form id="form-gerar-simulado">
      <div class="form-row">
        <label>Nome do simulado</label>
        <input type="text" name="nome" value="Simulado ${hoje}" placeholder="Ex: Revisão Direito Constitucional">
      </div>

      ${disciplinas.length > 1 ? `
      <div class="form-row">
        <label>Disciplinas <span style="font-weight:normal;color:var(--text-muted)">(desmarcadas = todas)</span></label>
        <div style="max-height:130px;overflow-y:auto;padding:8px;background:var(--surface-2);border-radius:6px;display:flex;flex-direction:column;gap:5px;">
          ${disciplinas.map(d => `<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;">
            <input type="checkbox" name="disciplina" value="${escapeHtml(d)}"> ${escapeHtml(d)}
          </label>`).join('')}
        </div>
      </div>` : ''}

      ${bancas.length > 1 ? `
      <div class="form-row">
        <label>Bancas <span style="font-weight:normal;color:var(--text-muted)">(desmarcadas = todas)</span></label>
        <div style="padding:8px;background:var(--surface-2);border-radius:6px;display:flex;flex-wrap:wrap;gap:4px 12px;">
          ${bancas.map(b => `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
            <input type="checkbox" name="banca" value="${escapeHtml(b)}"> ${escapeHtml(b)}
          </label>`).join('')}
        </div>
      </div>` : ''}

      ${concursos.length > 1 ? `
      <div class="form-row">
        <label>Concursos <span style="font-weight:normal;color:var(--text-muted)">(desmarcados = todos)</span></label>
        <div style="max-height:100px;overflow-y:auto;padding:8px;background:var(--surface-2);border-radius:6px;display:flex;flex-wrap:wrap;gap:4px 12px;">
          ${concursos.map(c => `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
            <input type="checkbox" name="concurso" value="${escapeHtml(c)}"> ${escapeHtml(c)}
          </label>`).join('')}
        </div>
      </div>` : ''}

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

  $('#btn-cancelar-gerar-sim').addEventListener('click', closeModal);

  function _filtrarQuestoes() {
    const form = $('#form-gerar-simulado');
    if (!form) return [];
    const discSel    = [...form.querySelectorAll('[name=disciplina]:checked')].map(el => el.value);
    const bancaSel   = [...form.querySelectorAll('[name=banca]:checked')].map(el => el.value);
    const concSel    = [...form.querySelectorAll('[name=concurso]:checked')].map(el => el.value);
    const filtroRes  = form.elements.filtroResultado?.value || 'todas';
    let lista = todasQuestoes;
    if (discSel.length)  lista = lista.filter(t => discSel.includes(t.disciplina));
    if (bancaSel.length) lista = lista.filter(t => bancaSel.includes(t.banca));
    if (concSel.length)  lista = lista.filter(t => concSel.includes(t.concurso));
    if (filtroRes !== 'todas') lista = lista.filter(t => t.resultado === filtroRes);
    return lista;
  }

  function _atualizarPreview() {
    const form = $('#form-gerar-simulado');
    const preview = $('#gerar-sim-preview');
    const btnOk   = $('#btn-confirmar-gerar-sim');
    if (!form || !preview || !btnOk) return;
    const lista = _filtrarQuestoes();
    const qtd   = Math.min(Number(form.elements.quantidade?.value) || 20, lista.length);
    if (lista.length) {
      preview.innerHTML = `<span style="color:var(--success)">✓</span> <b>${lista.length}</b> questões correspondem — serão usadas <b>${qtd}</b>`;
      btnOk.disabled = false;
    } else {
      preview.innerHTML = `<span style="color:var(--danger)">⚠ Nenhuma questão corresponde aos filtros. Ajuste as seleções.</span>`;
      btnOk.disabled = true;
    }
  }

  $('#form-gerar-simulado').querySelectorAll('input, select').forEach(el => el.addEventListener('change', _atualizarPreview));
  _atualizarPreview();

  $('#form-gerar-simulado').addEventListener('submit', (e) => {
    e.preventDefault();
    const form    = e.target;
    const nome    = form.elements.nome?.value.trim() || 'Simulado Personalizado';
    const ordem   = form.elements.ordem?.value || 'aleatorio';
    const qtd     = Number(form.elements.quantidade?.value) || 20;
    let questoes  = _filtrarQuestoes();

    if (ordem === 'aleatorio') {
      questoes = [...questoes].sort(() => Math.random() - 0.5);
    } else if (ordem === 'erros') {
      questoes = [...questoes].sort((a, b) => {
        const rank = v => v === 'errada' ? 0 : v === 'branco' ? 1 : 2;
        return rank(a.resultado) - rank(b.resultado);
      });
    } else if (ordem === 'recente') {
      questoes = [...questoes].sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.id - a.id));
    } else if (ordem === 'antigo') {
      questoes = [...questoes].sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.id - b.id));
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
      fim: null
    };

    closeModal();
    location.hash = '#/simulado-gerado';
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
  if (_simuladoGerado.finalizado) { _renderResultadoSimuladoGerado(view); return; }

  const sg    = _simuladoGerado;
  const idx   = sg.questaoAtual;
  const total = sg.questoes.length;
  const q     = sg.questoes[idx];
  const gabRevelado = sg.gabaritosRevelados.has(q.id);
  const respondidas = Object.keys(sg.respostas).length;
  const resumo = state.resumos.find(r => r.tentativaId === q.id);
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
          <span style="font-size:12px;color:var(--text-muted);">${respondidas} respondida${respondidas !== 1 ? 's' : ''}</span>
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
        <b style="font-size:13.5px;">${escapeHtml(q.disciplina || '(Sem disciplina)')}</b>
        ${q.assunto   ? `<span style="color:var(--text-muted);font-size:12px;">· ${escapeHtml(q.assunto)}</span>` : ''}
        ${q.banca     ? `<span style="font-size:11px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">${escapeHtml(q.banca)}</span>` : ''}
        ${q.concurso  ? `<span style="font-size:11px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">${escapeHtml(q.concurso)}</span>` : ''}
        <span style="font-size:11px;color:var(--text-muted);">${toBRDate(q.data)}</span>
      </div>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.75;color:var(--text);padding:14px;background:var(--surface-2);border-radius:8px;">${escapeHtml(q.enunciado || '')}</div>
    </div>

    <!-- resposta + navegação -->
    <div class="card mb-12">
      <div class="form-row" style="margin-bottom:14px;">
        <label>Sua resposta</label>
        <input type="text" id="sim-resposta" autocomplete="off"
          value="${escapeHtml(sg.respostas[q.id] || '')}"
          placeholder="Ex: C  •  Certo  •  Errado"
          style="text-transform:uppercase;max-width:260px;">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${!gabRevelado ? `<button class="btn btn-sm" id="btn-revelar-gab">🔍 Ver gabarito e comentário</button>` : ''}
        <div style="flex:1;"></div>
        ${idx > 0 ? `<button class="btn btn-ghost btn-sm" id="btn-anterior-sim">← Anterior</button>` : ''}
        ${idx < total - 1
          ? `<button class="btn btn-primary btn-sm" id="btn-proxima-sim">Próxima →</button>`
          : `<button class="btn btn-primary" id="btn-finalizar-sim">🏁 Ver Resultado</button>`}
      </div>
    </div>

    <!-- gabarito + comentário da IA (visível após revelar) -->
    ${gabRevelado ? `
    <div class="card mb-12" style="border-left:3px solid var(--primary);">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-size:13px;font-weight:600;">Gabarito:</span>
        <span style="font-size:18px;font-weight:800;color:var(--primary);">${escapeHtml(q.gabaritoConfirmado || '(não registrado)')}</span>
        ${q.resultado ? `<span class="badge ${q.resultado === 'certa' ? 'success' : q.resultado === 'errada' ? 'danger' : 'muted'}" style="font-size:11px;">
          ${q.resultado === 'certa' ? '✅ você acertou da 1ª vez' : q.resultado === 'errada' ? '❌ você errou da 1ª vez' : '⬜ deixou em branco da 1ª vez'}
        </span>` : ''}
      </div>
      <div style="margin-bottom:12px;">
        <span style="font-size:12px;color:var(--text-muted);">Neste simulado:</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
          <button class="btn btn-sm ${sg.marcacoes[q.id] === 'certa'  ? 'btn-primary' : ''}" data-marcar="certa">✅ Acertei</button>
          <button class="btn btn-sm ${sg.marcacoes[q.id] === 'errada' ? 'btn-primary' : ''}" data-marcar="errada">❌ Errei</button>
          <button class="btn btn-sm ${sg.marcacoes[q.id] === 'branco' ? 'btn-primary' : ''}" data-marcar="branco">⬜ Em branco</button>
        </div>
      </div>
      ${resumo ? `
        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">💡 Comentário da IA</div>
          <div style="line-height:1.65;font-size:13px;">${_mdParaHtml(resumo.textoBruto)}</div>
          ${resumo.textoCondensado ? `<div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:12px;margin-top:10px;">📎 ${escapeHtml(resumo.textoCondensado)}</div>` : ''}
        </div>
      ` : ''}
    </div>` : ''}

    <!-- mini-mapa de questões -->
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
      ${sg.questoes.map((qt, i) => {
        const m = sg.marcacoes[qt.id];
        const bg = m === 'certa' ? 'var(--success)' : m === 'errada' ? 'var(--danger)' : sg.gabaritosRevelados.has(qt.id) ? 'var(--gold)' : 'var(--surface-2)';
        const cor = m ? '#fff' : 'var(--text)';
        const borda = i === idx ? '2px solid var(--primary)' : '2px solid transparent';
        return `<button class="btn btn-sm sim-mini" data-i="${i}" style="min-width:34px;background:${bg};color:${cor};border:${borda};padding:4px 6px;">${i + 1}</button>`;
      }).join('')}
    </div>
  `;

  // — listeners —
  $('#sim-resposta')?.addEventListener('input', e => { sg.respostas[q.id] = e.target.value.trim().toUpperCase(); });

  $('#btn-revelar-gab')?.addEventListener('click', () => { sg.gabaritosRevelados.add(q.id); renderSimuladoGerado(view); });

  $('#btn-anterior-sim')?.addEventListener('click', () => { sg.questaoAtual = idx - 1; renderSimuladoGerado(view); window.scrollTo(0,0); });
  $('#btn-proxima-sim')?.addEventListener('click',  () => { sg.questaoAtual = idx + 1; renderSimuladoGerado(view); window.scrollTo(0,0); });

  $('#btn-finalizar-sim')?.addEventListener('click', () => {
    sg.finalizado = true;
    sg.fim = new Date().toISOString();
    renderSimuladoGerado(view);
    window.scrollTo(0, 0);
  });

  $('#btn-abandonar-sim')?.addEventListener('click', () => {
    if (!confirm('Abandonar o simulado? O progresso atual será perdido.')) return;
    _simuladoGerado = null;
    location.hash = '#/simulados';
  });

  $$('[data-marcar]', view).forEach(btn => btn.addEventListener('click', () => {
    sg.marcacoes[q.id] = btn.dataset.marcar;
    renderSimuladoGerado(view);
  }));

  $$('.sim-mini', view).forEach(btn => btn.addEventListener('click', () => {
    sg.questaoAtual = Number(btn.dataset.i);
    renderSimuladoGerado(view);
    window.scrollTo(0, 0);
  }));
}

function _renderResultadoSimuladoGerado(view) {
  const sg     = _simuladoGerado;
  const total  = sg.questoes.length;
  const certas  = sg.questoes.filter(q => sg.marcacoes[q.id] === 'certa').length;
  const erradas = sg.questoes.filter(q => sg.marcacoes[q.id] === 'errada').length;
  const brancos = sg.questoes.filter(q => sg.marcacoes[q.id] === 'branco').length;
  const naoAval = total - certas - erradas - brancos;
  const pct     = total ? ((certas / total) * 100).toFixed(1) : 0;
  const tempoMs = sg.fim && sg.inicio ? new Date(sg.fim) - new Date(sg.inicio) : 0;
  const tempoMin = Math.round(tempoMs / 60000);

  view.innerHTML = `
    <!-- placar -->
    <div class="card mb-12" style="text-align:center;padding:28px 16px;">
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(sg.nome)}</div>
      <div style="font-size:56px;font-weight:900;color:var(--primary);line-height:1;">${pct}%</div>
      <div style="font-size:14px;color:var(--text-muted);margin-top:4px;">${certas} de ${total} questões corretas</div>
      ${tempoMin > 0 ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">⏱ Tempo total: ${tempoMin} min</div>` : ''}
    </div>

    <div class="stat-grid mb-12">
      <div class="stat-card success"><div class="label">Acertei</div><div class="value">${certas}</div></div>
      <div class="stat-card danger"><div class="label">Errei</div><div class="value">${erradas}</div></div>
      <div class="stat-card"><div class="label">Em branco</div><div class="value">${brancos}</div></div>
      ${naoAval ? `<div class="stat-card muted"><div class="label">Não avaliadas</div><div class="value">${naoAval}</div></div>` : ''}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
      <button class="btn btn-primary" id="btn-salvar-sim-gerado">💾 Salvar no histórico</button>
      <button class="btn btn-ghost"   id="btn-rever-sim">📋 Revisar questões</button>
      <a href="#/simulados" class="btn btn-ghost">← Simulados</a>
    </div>

    <!-- revisão colapsável -->
    <div id="revisao-sim" style="display:none;">
      ${sg.questoes.map((q, i) => {
        const m = sg.marcacoes[q.id];
        const mc = m === 'certa' ? 'success' : m === 'errada' ? 'danger' : 'muted';
        const ml = m === 'certa' ? 'Acertei' : m === 'errada' ? 'Errei' : m === 'branco' ? 'Em branco' : 'Não avaliada';
        const resumo = state.resumos.find(r => r.tentativaId === q.id);
        return `
          <div class="card mb-12">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
              <div>
                <span style="font-size:12px;color:var(--text-muted);">Q${i+1} · </span>
                <b style="font-size:13px;">${escapeHtml(q.disciplina || '')}</b>
                ${q.assunto ? `<span style="font-size:12px;color:var(--text-muted);"> · ${escapeHtml(q.assunto)}</span>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <span class="badge ${mc}">${ml}</span>
                ${q.gabaritoConfirmado ? `<span style="font-size:12px;background:var(--surface-2);padding:2px 8px;border-radius:4px;">Gabarito: <b>${escapeHtml(q.gabaritoConfirmado)}</b></span>` : ''}
                ${sg.respostas[q.id] ? `<span style="font-size:12px;color:var(--text-muted);">Sua resp.: <b>${escapeHtml(sg.respostas[q.id])}</b></span>` : ''}
              </div>
            </div>
            <details>
              <summary style="cursor:pointer;font-size:13px;color:var(--primary);user-select:none;">Ver enunciado</summary>
              <div style="white-space:pre-wrap;font-size:13px;line-height:1.65;padding:10px;background:var(--surface-2);border-radius:6px;margin-top:6px;">${escapeHtml(q.enunciado || '')}</div>
            </details>
            ${resumo ? `
              <details style="margin-top:6px;">
                <summary style="cursor:pointer;font-size:13px;color:var(--text-muted);user-select:none;">Ver comentário da IA</summary>
                <div style="line-height:1.65;font-size:13px;padding-top:8px;">${_mdParaHtml(resumo.textoBruto)}</div>
              </details>` : ''}
          </div>`;
      }).join('')}
    </div>
  `;

  $('#btn-salvar-sim-gerado')?.addEventListener('click', async () => {
    const btn = $('#btn-salvar-sim-gerado');
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    await db.simulados.add({
      nome: sg.nome,
      data: sg.inicio.slice(0, 10),
      numQuestoes: total,
      acertos: certas,
      erros: erradas,
      tempo: tempoMs ? Math.round(tempoMs / 1000) : 0,
      origem: 'gerado'
    });
    await reloadState();
    btn.textContent = '✓ Salvo!';
    showToast('Simulado salvo no histórico.', 'success');
  });

  $('#btn-rever-sim')?.addEventListener('click', () => {
    const el = $('#revisao-sim');
    if (!el) return;
    const visible = el.style.display !== 'none';
    el.style.display = visible ? 'none' : 'block';
    $('#btn-rever-sim').textContent = visible ? '📋 Revisar questões' : '▲ Ocultar revisão';
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

  $('#btn-cancelar-simulado').addEventListener('click', closeModal);
  $('#form-simulado').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await db.simulados.add({
      nome: fd.get('nome').trim(),
      data: fd.get('data'),
      numQuestoes: Number(fd.get('numQuestoes')),
      acertos: Number(fd.get('acertos')),
      erros: Number(fd.get('erros')),
      tempo: fd.get('tempoMin') ? Number(fd.get('tempoMin')) * 60 : 0
    });
    closeModal();
    await reloadState();
    showToast('Simulado salvo.', 'success');
    router();
  });
}

