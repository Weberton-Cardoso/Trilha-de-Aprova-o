/**
 * estatisticas.js
 * Telas de Estatísticas (agrupamentos por disciplina/assunto/banca/concurso),
 * detalhe de concurso e lista de Editais.
 *
 * Extraído do app.js em 2026-07-31 como parte da refatoração.
 *
 * Depende de (carregados antes no index.html):
 *  editais.js   — calcProgressoEdital, renderListaEditais
 *  app.js       — state, toBRDate, fmtPct, fmtPctSigned, escapeHtml,
 *                 $, $$, showToast, reloadState, agruparPor,
 *                 calcTendencia, _norm, renderLineChart, renderBarChart
 */

/* ============================================================
   TELA: ESTATÍSTICAS (agrupamentos: disciplina/assunto/banca/concurso)
   ============================================================ */

const AGRUPAMENTO_CONFIG = {
  disciplinas: { chave: 'disciplina', titulo: 'Disciplina', clicavel: true, rota: 'disciplinas' },
  assuntos: { chave: 'assunto', titulo: 'Assunto', clicavel: true, rota: 'assuntos' },
  bancas: { chave: 'banca', titulo: 'Banca', clicavel: false },
  concursos: { chave: 'concurso', titulo: 'Concurso', clicavel: true, rota: 'concursos' }
};

function renderAgrupamento(view, tipo) {
  const cfg = AGRUPAMENTO_CONFIG[tipo] || AGRUPAMENTO_CONFIG.disciplinas;
  const dados = agruparPor(state.tentativas, cfg.chave);

  if (!dados.length) {
    view.innerHTML = `<div class="empty-state"><p>Nenhuma tentativa registrada para gerar estatísticas por ${cfg.titulo.toLowerCase()}.</p></div>`;
    return;
  }

  const isRanking = tipo === 'bancas';

  view.innerHTML = `
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${isRanking ? '<th>#</th>' : ''}
              <th>${cfg.titulo}</th><th>Tentativas</th><th>Certas</th><th>Erradas</th><th>Em branco</th><th>Total</th><th>% de acerto</th>
            </tr>
          </thead>
          <tbody>
            ${dados.map((d, i) => `
              <tr class="${cfg.clicavel ? 'clickable' : ''}" ${cfg.clicavel ? `data-nome="${escapeHtml(d.nome)}"` : ''}>
                ${isRanking ? `<td class="num">${i + 1}º</td>` : ''}
                <td>${escapeHtml(d.nome)}</td>
                <td class="num">${d.tentativas}</td>
                <td class="num" style="color:var(--success)">${d.certas}</td>
                <td class="num" style="color:var(--danger)">${d.erradas}</td>
                <td class="num text-muted">${d.brancos}</td>
                <td class="num">${d.total}</td>
                <td>
                  <div class="pct-bar-wrap">
                    <div class="pct-bar"><span style="width:${d.taxa.toFixed(1)}%"></span></div>
                    <span class="num">${fmtPct(d.taxa)}</span>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (cfg.clicavel) {
    $$('tr[data-nome]').forEach(tr => {
      tr.addEventListener('click', () => {
        location.hash = `#/estatisticas/${cfg.rota}/${encodeURIComponent(tr.dataset.nome)}`;
      });
    });
  }
}

/* ---- Detalhe de uma disciplina específica ---- */

function renderDisciplinaDetalhe(view, nomeDisciplina) {
  const lista = state.tentativas.filter(t => (t.disciplina || '(Não informado)') === nomeDisciplina);
  const resumo = calcResumo(lista);
  const porAssunto = agruparPor(lista, 'assunto');

  // evolução: últimos 30 dias, apenas tentativas desta disciplina
  const dias = [];
  for (let i = 29; i >= 0; i--) {
    const iso = daysAgoISO(i);
    const ts = lista.filter(t => t.data === iso);
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
      <div class="stat-card"><div class="label">Em branco</div><div class="value">${resumo.brancos}</div></div>
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
          <thead><tr><th>Assunto</th><th>Tentativas</th><th>Certas</th><th>Erradas</th><th>Em branco</th><th>Total</th><th>% de acerto</th></tr></thead>
          <tbody>
            ${porAssunto.map(a => `
              <tr class="clickable" data-assunto="${escapeHtml(a.nome)}">
                <td>${escapeHtml(a.nome)}</td>
                <td class="num">${a.tentativas}</td>
                <td class="num" style="color:var(--success)">${a.certas}</td>
                <td class="num" style="color:var(--danger)">${a.erradas}</td>
                <td class="num text-muted">${a.brancos}</td>
                <td class="num">${a.total}</td>
                <td>
                  <div class="pct-bar-wrap">
                    <div class="pct-bar"><span style="width:${a.taxa.toFixed(1)}%"></span></div>
                    <span class="num">${fmtPct(a.taxa)}</span>
                  </div>
                </td>
              </tr>
            `).join('')}
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
            ${[...lista].sort((a, b) => b.data.localeCompare(a.data)).map(t => `
              <tr>
                <td class="num">${toBRDate(t.data)}</td>
                <td>${escapeHtml(t.assunto) || '-'}</td>
                <td>${escapeHtml(t.banca) || '-'}</td>
                <td><span class="badge muted">${escapeHtml(t.tipo) || '-'}</span></td>
                <td class="num">${t.numQuestoes}</td>
                <td class="num" style="color:var(--success)">${t.acertos}</td>
                <td class="num" style="color:var(--danger)">${t.erros}</td>
                <td class="num">${fmtPct(t.taxa)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $$('tr[data-assunto]').forEach(tr => {
    tr.addEventListener('click', () => {
      location.hash = `#/estatisticas/assuntos/${encodeURIComponent(tr.dataset.assunto)}`;
    });
  });

  renderLineChart('chart-disciplina-evolucao', {
    labels: dias.map(d => toBRDate(d.iso).slice(0, 5)),
    series: [
      { label: 'Certas', data: dias.map(d => d.certas) },
      { label: 'Total', data: dias.map(d => d.total) }
    ]
  });
}

/* ---- Detalhe de um assunto específico: evolução por tentativa ---- */

function renderAssuntoDetalhe(view, nomeAssunto) {
  const lista = state.tentativas.filter(t => (t.assunto || '(Não informado)') === nomeAssunto);

  if (!lista.length) {
    view.innerHTML = `
      <div class="flex mb-12"><a href="#/estatisticas/assuntos" class="btn btn-ghost btn-sm">&larr; Voltar</a></div>
      <div class="empty-state"><p>Nenhuma tentativa registrada para este assunto.</p></div>
    `;
    return;
  }

  const ordenada = [...lista].sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.id - b.id));
  const resumo = calcResumo(lista);
  const melhor = ordenada.reduce((m, t) => (t.taxa > m.taxa ? t : m), ordenada[0]);
  const pior = ordenada.reduce((m, t) => (t.taxa < m.taxa ? t : m), ordenada[0]);
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
      <div class="stat-card"><div class="label">Em branco</div><div class="value">${resumo.brancos}</div></div>
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
          ${evolucaoPP >= 0 ? '📈' : '📉'} ${fmtPctSigned(evolucaoPP)} desde a primeira tentativa
        </span>
      </div>
      <div class="chart-wrap"><canvas id="chart-assunto-evolucao"></canvas></div>
    </div>

    <div class="section-title">Histórico completo</div>
    <div class="timeline">
      ${[...ordenada].reverse().map(t => `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-card">
            <div class="timeline-card-head">
              <span class="timeline-date">${toBRDate(t.data)}</span>
              <span class="badge muted">${escapeHtml(t.tipo) || '-'}</span>
            </div>
            <div class="timeline-stats">
              <span><strong>${t.numQuestoes}</strong> questões</span>
              <span style="color:var(--success)"><strong>${t.acertos}</strong> acertos</span>
              <span style="color:var(--danger)"><strong>${t.erros}</strong> erros</span>
              <span class="timeline-taxa">${fmtPct(t.taxa)}</span>
            </div>
            ${t.observacoes ? `<div class="timeline-obs">${escapeHtml(t.observacoes)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  renderLineChart('chart-assunto-evolucao', {
    labels: ordenada.map(t => toBRDate(t.data).slice(0, 5)),
    series: [
      { label: '% de acerto', data: ordenada.map(t => Number(t.taxa.toFixed(1))) }
    ]
  });
}

/* ============================================================
   TELA: DETALHE DO CONCURSO
   Mostra disciplinas e tópicos estudados para um concurso específico,
   com quantidade de vezes que viu cada tópico e taxa de acertos.
   ============================================================ */

function renderConcursoDetalhe(view, nomeConcurso) {
  const norm = s => (s || '').trim().toLowerCase();
  const lista = state.tentativas.filter(t =>
    norm(t.concurso || '(Não informado)') === norm(nomeConcurso)
  );

  if (!lista.length) {
    view.innerHTML = `
      <div class="flex mb-12"><a href="#/estatisticas/concursos" class="btn btn-ghost btn-sm">&larr; Voltar</a></div>
      <div class="empty-state"><p>Nenhuma tentativa registrada para o concurso <strong>${escapeHtml(nomeConcurso)}</strong>.</p></div>
    `;
    return;
  }

  const resumoGeral = calcResumo(lista);

  // Agrupa por disciplina → tópico, contando vezes visto (nº de tentativas) e acertos
  const porDisciplina = new Map();
  lista.forEach(t => {
    const disc = (t.disciplina || '(Não informado)').trim();
    const top  = (t.assunto   || '(Sem tópico)').trim();
    const chaveDisc = norm(disc);
    if (!porDisciplina.has(chaveDisc)) {
      porDisciplina.set(chaveDisc, { nome: disc, topicos: new Map(),
        numQuestoes: 0, acertos: 0, erros: 0, tentativas: 0 });
    }
    const gDisc = porDisciplina.get(chaveDisc);
    gDisc.numQuestoes += Number(t.numQuestoes) || 0;
    gDisc.acertos     += Number(t.acertos)     || 0;
    gDisc.erros       += Number(t.erros)       || 0;
    gDisc.tentativas  += 1;

    const chaveTop = norm(top);
    if (!gDisc.topicos.has(chaveTop)) {
      gDisc.topicos.set(chaveTop, { nome: top, vezes: 0,
        numQuestoes: 0, acertos: 0, erros: 0 });
    }
    const gTop = gDisc.topicos.get(chaveTop);
    gTop.vezes       += 1;
    gTop.numQuestoes += Number(t.numQuestoes) || 0;
    gTop.acertos     += Number(t.acertos)     || 0;
    gTop.erros       += Number(t.erros)       || 0;
  });

  const disciplinas = Array.from(porDisciplina.values())
    .sort((a, b) => b.numQuestoes - a.numQuestoes || b.tentativas - a.tentativas);

  const linhasHTML = disciplinas.map(disc => {
    const taxa = disc.numQuestoes ? (disc.acertos / disc.numQuestoes * 100) : 0;
    const tops = Array.from(disc.topicos.values())
      .sort((a, b) => b.vezes - a.vezes || b.numQuestoes - a.numQuestoes);
    const topicosRows = tops.map(tp => {
      const tpTaxa = tp.numQuestoes ? (tp.acertos / tp.numQuestoes * 100) : 0;
      return `
        <tr style="background:var(--surface);">
          <td style="padding-left:32px;font-size:12.5px;color:var(--text-muted);">
            ↳ ${escapeHtml(tp.nome)}
          </td>
          <td class="num" style="font-size:12.5px;">${tp.vezes}×</td>
          <td class="num" style="font-size:12.5px;color:var(--success);">${tp.acertos}</td>
          <td class="num" style="font-size:12.5px;color:var(--danger);">${tp.erros}</td>
          <td class="num" style="font-size:12.5px;">${tp.numQuestoes}</td>
          <td>
            ${tp.numQuestoes ? `
              <div class="pct-bar-wrap">
                <div class="pct-bar"><span style="width:${tpTaxa.toFixed(1)}%"></span></div>
                <span class="num" style="font-size:12px;">${fmtPct(tpTaxa)}</span>
              </div>` : '<span class="text-muted" style="font-size:12px;">-</span>'}
          </td>
        </tr>`;
    }).join('');

    return `
      <tr class="clickable concurso-disc-row" data-disc="${escapeHtml(disc.nome)}" title="Clique para expandir/recolher tópicos">
        <td style="font-weight:700;">${escapeHtml(disc.nome)}</td>
        <td class="num">${disc.tentativas}</td>
        <td class="num" style="color:var(--success);">${disc.acertos}</td>
        <td class="num" style="color:var(--danger);">${disc.erros}</td>
        <td class="num">${disc.numQuestoes}</td>
        <td>
          ${disc.numQuestoes ? `
            <div class="pct-bar-wrap">
              <div class="pct-bar"><span style="width:${taxa.toFixed(1)}%"></span></div>
              <span class="num">${fmtPct(taxa)}</span>
            </div>` : '<span class="text-muted">-</span>'}
        </td>
      </tr>
      <tr class="concurso-topicos-row" data-topicos-de="${escapeHtml(disc.nome)}" style="display:none;">
        <td colspan="6" style="padding:0;">
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${topicosRows}</tbody>
          </table>
        </td>
      </tr>`;
  }).join('');

  view.innerHTML = `
    <div class="flex mb-12">
      <a href="#/estatisticas/concursos" class="btn btn-ghost btn-sm">&larr; Voltar</a>
    </div>

    <div class="stat-grid" style="margin-bottom:16px;">
      <div class="stat-card"><div class="label">Tentativas</div><div class="value">${resumoGeral.tentativas}</div></div>
      <div class="stat-card"><div class="label">Total de questões</div><div class="value">${resumoGeral.total}</div></div>
      <div class="stat-card success"><div class="label">Certas</div><div class="value">${resumoGeral.certas}</div></div>
      <div class="stat-card danger"><div class="label">Erradas</div><div class="value">${resumoGeral.erradas}</div></div>
      <div class="stat-card"><div class="label">Em branco</div><div class="value">${resumoGeral.brancos}</div></div>
      <div class="stat-card gold"><div class="label">% de acerto</div><div class="value">${fmtPct(resumoGeral.taxa)}</div></div>
    </div>

    <p class="text-muted" style="font-size:12.5px;margin-bottom:10px;">
      Clique em uma disciplina para ver os tópicos estudados e quantas vezes cada um foi visto.
    </p>

    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Disciplina / Tópico</th>
              <th>Tentativas / Vezes</th>
              <th>Certas</th>
              <th>Erradas</th>
              <th>Total</th>
              <th>% de acerto</th>
            </tr>
          </thead>
          <tbody>${linhasHTML}</tbody>
        </table>
      </div>
    </div>
  `;

  // Toggle expand/collapse dos tópicos ao clicar na disciplina
  $$('.concurso-disc-row', view).forEach(tr => {
    tr.addEventListener('click', () => {
      const discNome = tr.dataset.disc;
      const topicosRow = view.querySelector(`.concurso-topicos-row[data-topicos-de="${CSS.escape(discNome)}"]`);
      if (!topicosRow) return;
      const escondida = topicosRow.style.display === 'none';
      topicosRow.style.display = escondida ? 'table-row' : 'none';
      tr.style.background = escondida ? 'var(--gold-soft)' : '';
    });
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
      <div class="text-muted">Acompanhe o progresso por disciplina e tópico.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary" id="btn-criar-edital-branco">+ Criar em branco</button>
        <a class="btn btn-primary" href="#/editais/importar">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
          Importar edital
        </a>
      </div>
    </div>
    <div id="lista-editais"></div>
  `;

  $('#btn-criar-edital-branco')?.addEventListener('click', async () => {
    openModal(`
      <h3 style="margin:0 0 16px;font-family:var(--font-display);">Criar edital em branco</h3>
      <label class="form-label">Nome do edital</label>
      <input id="novo-edital-nome" class="form-input" placeholder="Ex: TCDF 2026" style="margin-bottom:16px;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-ghost" id="btn-cancelar-novo-edital">Cancelar</button>
        <button class="btn btn-primary" id="btn-confirmar-novo-edital">Criar</button>
      </div>
    `);
    $('#btn-cancelar-novo-edital')?.addEventListener('click', closeModal);
    const confirmar = async () => {
      const nome = $('#novo-edital-nome')?.value.trim();
      if (!nome) { showToast('Digite o nome do edital.', 'error'); return; }
      await db.editais.add({ nome, ativo: true, materias: [] });
      await reloadState();
      closeModal();
      showToast(`Edital "${nome}" criado! ✓`, 'success');
      const novo = (state.editais || []).find(e => e.nome === nome);
      if (novo) location.hash = `#/editais/${novo.id}`;
    };
    $('#btn-confirmar-novo-edital')?.addEventListener('click', confirmar);
    $('#novo-edital-nome')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmar(); });
  });

  renderListaEditais();

  function renderListaEditais() {
    const wrap = $('#lista-editais');
    if (!state.editais.length) {
      wrap.innerHTML = `<div class="empty-state">
        <p>Nenhum edital cadastrado ainda.</p>
        <p class="text-muted" style="font-size:13px;">Crie um edital em branco e adicione suas disciplinas, ou importe o PDF do edital oficial.</p>
      </div>`;
      return;
    }
    wrap.innerHTML = `<div class="grid-3">
      ${state.editais.map(e => {
        const prog = calcProgressoEdital(e);
        return `
        <div class="card clickable" data-edital="${e.id}" style="cursor:pointer;">
          <div class="card-title">${escapeHtml(e.concurso || 'Edital')}</div>
          <h3 style="margin:0 0 10px;font-family:var(--font-display);">${escapeHtml(e.nome)}</h3>
          <div class="pct-bar-wrap mb-12">
            <div class="pct-bar"><span style="width:${prog.pct.toFixed(1)}%"></span></div>
            <span class="num">${fmtPct(prog.pct)}</span>
          </div>
          <div class="text-muted" style="font-size:13px;">${prog.dominado + prog.emRevisao}/${prog.total} tópicos cobertos</div>
        </div>`;
      }).join('')}
    </div>`;
    $$('[data-edital]', wrap).forEach(card => {
      card.addEventListener('click', () => { location.hash = `#/editais/${card.dataset.edital}`; });
    });
  }
}

