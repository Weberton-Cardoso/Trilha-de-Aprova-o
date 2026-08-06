/**
 * mentor.js — Mentor da Trilha
 *
 * Tela #/mentor: Coach de Alto Desempenho do Trilha de Aprovação.
 * Consome o window.IE (intelligenceEngine.js) para todos os cálculos.
 * Depende de: database.js, app.js (state, helpers), intelligenceEngine.js,
 *             ia-gemini.js (chamarGeminiResumoStream).
 *
 * Stores usados: learningProfile (v12, 1 doc por perfil).
 */

/* ============================================================
   HELPERS DE FORMATAÇÃO LOCAIS
   ============================================================ */

function _fmtMin(m) {
  const h = Math.floor(m / 60), mn = Math.round(m % 60);
  return h > 0 ? `${h}h${mn > 0 ? mn + 'min' : ''}` : `${mn}min`;
}

function _fmtPct(v) {
  return v !== null && v !== undefined ? `${Math.round(v * 100)}%` : '—';
}

function _corIndice(v) {
  if (v >= 75) return '#4ADE80';
  if (v >= 50) return '#E8B14D';
  return '#F87171';
}

function _labelIndice(v) {
  if (v >= 80) return 'Excelente';
  if (v >= 65) return 'Bom';
  if (v >= 50) return 'Regular';
  if (v >= 30) return 'Atenção';
  return 'Crítico';
}

function _corEvo(dir) {
  return dir === 'subindo' ? '#4ADE80' : dir === 'caindo' ? '#F87171' : '#94A3B8';
}

/* ============================================================
   PERFIL DO ALUNO (learningProfile no IndexedDB)
   ============================================================ */

async function _getPerfil() {
  try {
    const todos = await db.learningProfile.getAll();
    return todos[0] || null;
  } catch { return null; }
}

async function _salvarPerfil(dados) {
  try {
    const existente = await _getPerfil();
    if (existente) {
      await db.learningProfile.update({ ...existente, ...dados, atualizadoEm: new Date().toISOString() });
    } else {
      await db.learningProfile.add({ ...dados, atualizadoEm: new Date().toISOString() });
    }
  } catch (e) {
    console.error('[mentor] erro ao salvar perfil:', e);
  }
}

/* ============================================================
   RENDERIZAÇÃO PRINCIPAL
   ============================================================ */

async function renderMentor(view) {
  view.innerHTML = `<div class="mentor-loading"><span class="spinner"></span> Calculando seu perfil…</div>`;

  const [perfil] = await Promise.all([_getPerfil()]);

  const fase = IE.calcFase();
  const { indice, componentes } = IE.calcIndiceAprovacao();
  const dna = IE.calcDNA();
  const evo = IE.calcEvolucao();
  const cons = IE.calcConsistencia();
  const tempo = IE.calcTempo();
  const cobertura = IE.calcCobertura();
  const lacunas = IE.calcLacunas();
  const caderno = IE.calcCoberturaCaderno();
  const snapshot = IE.calcSnapshotHoje();

  // Diário (últimas 5 entradas do learningProfile)
  const diario = (perfil?.diarioEntradas || []).slice(-5).reverse();

  view.innerHTML = `
    <!-- ── CABEÇALHO DO MENTOR ── -->
    <div class="mentor-hero">
      <div class="mentor-hero-info">
        <div class="mentor-nome">🎯 Mentor da Trilha</div>
        <div class="mentor-fase">${fase.label}${fase.diasRestantes ? ` · ${fase.diasRestantes} dias para a prova` : ''}</div>
        ${perfil?.concursoAlvo
          ? `<div class="mentor-concurso">${escapeHtml(perfil.concursoAlvo)}</div>`
          : `<button class="btn btn-ghost btn-sm" id="btn-mentor-config">⚙️ Configurar meu perfil</button>`}
      </div>

      <!-- Dial do Índice de Aprovação -->
      <div class="mentor-indice-wrap">
        <svg class="mentor-dial" viewBox="0 0 120 120" width="120" height="120">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface-2,#2a2a2a)" stroke-width="12"/>
          <circle cx="60" cy="60" r="50" fill="none"
            stroke="${_corIndice(indice)}" stroke-width="12"
            stroke-dasharray="${Math.round(indice * 3.14)} 314"
            stroke-dashoffset="78.5"
            stroke-linecap="round"
            transform="rotate(-90 60 60)"
            style="transition:stroke-dasharray .6s ease"/>
          <text x="60" y="56" text-anchor="middle" fill="var(--text-primary,#fff)"
            font-size="22" font-weight="700" font-family="'Sora',sans-serif">${indice}</text>
          <text x="60" y="72" text-anchor="middle" fill="var(--text-muted,#888)"
            font-size="9" font-family="'Inter',sans-serif">/ 100</text>
        </svg>
        <div class="mentor-indice-label" style="color:${_corIndice(indice)}">${_labelIndice(indice)}</div>
        <div class="mentor-indice-desc">Índice de Aprovação</div>
      </div>
    </div>

    <!-- ── COMPONENTES DO ÍNDICE ── -->
    <div class="mentor-section">
      <div class="mentor-section-title">Componentes do Índice</div>
      <div class="mentor-componentes">
        ${Object.entries(componentes).filter(([, c]) => c.peso > 0).map(([nome, c]) => `
          <div class="mentor-comp-item">
            <div class="mentor-comp-nome">${_nomeComponente(nome)}</div>
            <div class="mentor-comp-barra-wrap">
              <div class="mentor-comp-barra" style="width:${c.valor}%;background:${_corIndice(c.valor)}"></div>
            </div>
            <div class="mentor-comp-valor">${c.valor}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- ── DNA DO ESTUDANTE ── -->
    <div class="mentor-section">
      <div class="mentor-section-title">🧬 DNA do Estudante</div>
      <div class="stat-grid">
        ${_dnaCard('🏆 Melhor disciplina', dna.melhorDisc ? `${dna.melhorDisc.nome} (${_fmtPct(dna.melhorDisc.taxa)})` : '—')}
        ${_dnaCard('⚠️ Maior dificuldade', dna.piorDisc ? `${dna.piorDisc.nome} (${_fmtPct(dna.piorDisc.taxa)})` : '—')}
        ${_dnaCard('📅 Melhor dia da semana', dna.melhorDia)}
        ${dna.temDadosHorario ? _dnaCard('⏰ Melhor faixa horária', dna.melhorFaixa) : ''}
        ${_dnaCard('📈 Tendência', _labelEvolucao(evo.direcao, evo.delta))}
        ${_dnaCard('🔥 Sequência atual', `${cons.streak} dias`)}
        ${_dnaCard('📊 Consistência', _fmtPct(cons.taxaConsistencia))}
        ${_dnaCard('❓ Questões/dia', dna.questoesPorDia.toString())}
        ${_dnaCard('⏱️ Tempo total', _fmtMin(tempo.minTotal))}
        ${_dnaCard('⏱️ Média por dia', _fmtMin(tempo.mediaMinDia))}
        ${cobertura.temEdital ? _dnaCard('📋 Cobertura do edital', _fmtPct(cobertura.pct)) : ''}
        ${_dnaCard('📓 Caderno de resumos', _fmtPct(caderno.pct))}
        ${dna.tipoPredominante ? _dnaCard('🎓 Método predominante', dna.tipoPredominante) : ''}
      </div>
    </div>

    <!-- ── LACUNAS URGENTES ── -->
    ${lacunas.length ? `
    <div class="mentor-section">
      <div class="mentor-section-title">🚨 Revisão Urgente</div>
      <div class="mentor-lacunas">
        ${lacunas.map(l => `
          <div class="mentor-lacuna-item">
            <div class="mentor-lacuna-nome">${escapeHtml(l.nome)}</div>
            <div class="mentor-lacuna-detalhes">
              Taxa: <strong>${_fmtPct(l.taxa)}</strong> ·
              Há <strong>${l.diasSemRevisar}</strong> dias sem revisar
            </div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- ── HOJE ── -->
    ${snapshot.questoes > 0 || snapshot.minutos > 0 ? `
    <div class="mentor-section">
      <div class="mentor-section-title">📆 Hoje (${toBRDate(snapshot.data)})</div>
      <div class="stat-grid">
        ${_dnaCard('Questões respondidas', snapshot.questoes.toString())}
        ${snapshot.taxa !== null ? _dnaCard('Taxa de acerto', _fmtPct(snapshot.taxa)) : ''}
        ${snapshot.minutos > 0 ? _dnaCard('Tempo estudado', _fmtMin(snapshot.minutos)) : ''}
        ${snapshot.melhorDiscHoje ? _dnaCard('Melhor disciplina', snapshot.melhorDiscHoje) : ''}
        ${snapshot.piorDiscHoje && snapshot.piorDiscHoje !== snapshot.melhorDiscHoje
          ? _dnaCard('Mais difícil hoje', snapshot.piorDiscHoje) : ''}
      </div>
    </div>` : ''}

    <!-- ── PERFIL / CONFIGURAÇÃO ── -->
    <div class="mentor-section" id="mentor-perfil-section">
      <div class="mentor-section-title">⚙️ Meu Perfil de Estudos</div>
      <div class="mentor-form">
        <label class="form-label">Concurso-alvo</label>
        <input class="form-input" id="mf-concurso" value="${escapeHtml(perfil?.concursoAlvo || '')}" placeholder="Ex: TCDF 2026"/>

        <label class="form-label">Concurso secundário</label>
        <input class="form-input" id="mf-sec" value="${escapeHtml(perfil?.concursoSec || '')}" placeholder="Ex: TCU"/>

        <label class="form-label">Data da prova (se souber)</label>
        <input class="form-input" type="date" id="mf-data" value="${perfil?.dataProva || ''}"/>

        <label class="form-label">Objetivo (em suas palavras)</label>
        <textarea class="form-textarea" id="mf-objetivo" rows="2" placeholder="Ex: Aprovação em auditoria, foco na área fiscal">${escapeHtml(perfil?.objetivo || '')}</textarea>

        <label class="form-label">Pontos fortes (você pode editar)</label>
        <textarea class="form-textarea" id="mf-fortes" rows="2" placeholder="Ex: Direito Constitucional, Controle Externo">${escapeHtml(perfil?.pontosFortes || (dna.melhorDisc ? dna.melhorDisc.nome : ''))}</textarea>

        <label class="form-label">Pontos fracos (você pode editar)</label>
        <textarea class="form-textarea" id="mf-fracos" rows="2" placeholder="Ex: Direito Administrativo, Auditoria Governamental">${escapeHtml(perfil?.pontosFracos || (dna.piorDisc ? dna.piorDisc.nome : ''))}</textarea>

        <button class="btn btn-primary" id="btn-salvar-perfil-mentor">Salvar perfil</button>
      </div>
    </div>

    <!-- ── ANÁLISE DA IA ── -->
    <div class="mentor-section">
      <div class="mentor-section-title">🤖 Análise do Mentor da Trilha</div>
      <div id="mentor-ia-output" class="mentor-ia-output" style="display:none"></div>
      <button class="btn btn-primary" id="btn-mentor-analisar">✨ Gerar análise personalizada</button>
      <button class="btn btn-secondary" id="btn-mentor-diario" style="margin-left:.5rem">📔 Salvar no Diário</button>
    </div>

    <!-- ── DIÁRIO DO MENTOR ── -->
    <div class="mentor-section">
      <div class="mentor-section-title">📔 Diário do Mentor</div>
      ${diario.length === 0
        ? `<p class="text-muted">Nenhuma entrada ainda. Gere uma análise e salve no diário para começar a construir seu histórico.</p>`
        : diario.map(e => `
          <div class="mentor-diario-entrada">
            <div class="mentor-diario-data">${toBRDate(e.data)} · Índice ${e.indice ?? '—'}/100</div>
            <div class="mentor-diario-texto">${renderizarMarkdownBasico(escapeHtml(e.texto))}</div>
          </div>
        `).join('')}
    </div>
  `;

  // --- Listeners ---

  // Botão config (se ainda não tem perfil configurado)
  $('#btn-mentor-config')?.addEventListener('click', () => {
    document.getElementById('mentor-perfil-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Salvar perfil
  $('#btn-salvar-perfil-mentor')?.addEventListener('click', async () => {
    await _salvarPerfil({
      concursoAlvo:  $('#mf-concurso').value.trim(),
      concursoSec:   $('#mf-sec').value.trim(),
      dataProva:     $('#mf-data').value || null,
      objetivo:      $('#mf-objetivo').value.trim(),
      pontosFortes:  $('#mf-fortes').value.trim(),
      pontosFracos:  $('#mf-fracos').value.trim(),
    });
    showToast('Perfil salvo! ✓', 'success');
  });

  // Gerar análise da IA
  let _ultimaAnalise = '';
  $('#btn-mentor-analisar')?.addEventListener('click', async () => {
    const btn = $('#btn-mentor-analisar');
    const out = $('#mentor-ia-output');
    btn.disabled = true;
    btn.textContent = '⏳ Analisando…';
    out.style.display = 'block';
    out.innerHTML = `<span class="spinner"></span> O Mentor da Trilha está analisando seu perfil…`;

    const perfilAtual = await _getPerfil();
    const contexto = IE.buildContextoMentor(perfilAtual);

    const prompt = `Você é o Mentor da Trilha, um coach de alto desempenho especializado em concursos públicos.
Você possui acesso completo ao histórico de estudos do aluno e deve agir como um mentor pessoal experiente.

Analise os dados abaixo e gere uma análise personalizada com:
1. Uma avaliação direta da situação atual (sem rodeios)
2. Os 2-3 pontos mais críticos que precisam de atenção AGORA
3. Uma estratégia concreta para os próximos 7 dias
4. Uma frase motivacional específica para a situação do aluno (não genérica)

Use linguagem direta, clara e encorajadora. Seja específico — mencione disciplinas, números e datas reais dos dados.
Formate com **negrito** para pontos-chave e listas com "- " para ações. Sem cabeçalhos com #.

--- DADOS DO ALUNO ---
${contexto}
--- FIM DOS DADOS ---`;

    try {
      _ultimaAnalise = '';
      if (typeof window.chamarGeminiResumoStream === 'function') {
        await window.chamarGeminiResumoStream(prompt, (textoAcum) => {
          _ultimaAnalise = textoAcum;
          out.innerHTML = renderizarMarkdownBasico(escapeHtml(textoAcum));
        });
      } else {
        _ultimaAnalise = await window.chamarGeminiResumo(prompt);
        out.innerHTML = renderizarMarkdownBasico(escapeHtml(_ultimaAnalise));
      }
    } catch (e) {
      out.innerHTML = `<span style="color:var(--red)">Erro ao gerar análise. Tente novamente.</span>`;
    }

    btn.disabled = false;
    btn.textContent = '✨ Gerar nova análise';
  });

  // Salvar no diário
  $('#btn-mentor-diario')?.addEventListener('click', async () => {
    if (!_ultimaAnalise) {
      showToast('Gere uma análise primeiro.', 'warning');
      return;
    }
    const perfilAtual = await _getPerfil();
    const entradas = perfilAtual?.diarioEntradas || [];
    const { indice } = IE.calcIndiceAprovacao();
    const novaEntrada = {
      data: todayISO(),
      indice,
      texto: _ultimaAnalise,
      snapshot: IE.calcSnapshotHoje()
    };
    // Evita duplicata do mesmo dia (substitui se já existe)
    const idx = entradas.findIndex(e => e.data === todayISO());
    if (idx >= 0) entradas[idx] = novaEntrada;
    else entradas.push(novaEntrada);
    // Mantém só os últimos 90 dias
    const recentes = entradas.sort((a, b) => a.data.localeCompare(b.data)).slice(-90);
    await _salvarPerfil({ diarioEntradas: recentes });
    showToast('Entrada salva no Diário do Mentor! 📔', 'success');
    // Re-renderiza o diário inline
    const secDiario = view.querySelector('.mentor-section:last-child');
    if (secDiario) {
      const entradas2 = recentes.slice(-5).reverse();
      const div = secDiario.querySelector('.mentor-diario-entrada')?.parentElement
        || (() => { const d = document.createElement('div'); secDiario.appendChild(d); return d; })();
      secDiario.innerHTML = `
        <div class="mentor-section-title">📔 Diário do Mentor</div>
        ${entradas2.map(e => `
          <div class="mentor-diario-entrada">
            <div class="mentor-diario-data">${toBRDate(e.data)} · Índice ${e.indice ?? '—'}/100</div>
            <div class="mentor-diario-texto">${renderizarMarkdownBasico(escapeHtml(e.texto))}</div>
          </div>
        `).join('')}
      `;
    }
  });
}

/* ============================================================
   AUXILIARES DE TEMPLATE
   ============================================================ */

function _dnaCard(label, valor) {
  return `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value" style="font-size:1.1rem">${escapeHtml(valor ?? '—')}</div>
    </div>`;
}

function _nomeComponente(chave) {
  return {
    questoes: '❓ Questões', consistencia: '🔥 Consistência',
    cobertura: '📋 Cobertura', revisao: '🔁 Revisão',
    simulados: '📝 Simulados', tempo: '⏱️ Tempo', caderno: '📓 Caderno'
  }[chave] || chave;
}

function _labelEvolucao(dir, delta) {
  const seta = dir === 'subindo' ? '↑' : dir === 'caindo' ? '↓' : '→';
  const pp = delta !== null ? ` (${delta > 0 ? '+' : ''}${Math.round(delta)} p.p.)` : '';
  return `${seta} ${dir.charAt(0).toUpperCase() + dir.slice(1)}${pp}`;
}

/* ============================================================
   COACH PÓS-SESSÃO
   Chamado por ciclo.js após concluir sessão (via evento global).
   Injeta um card flutuante no dashboard ou na tela atual.
   ============================================================ */

function _renderCoachPosSessao(sessao) {
  // Remove card anterior se existir
  document.getElementById('coach-pos-sessao-card')?.remove();

  const msgs = IE.gerarCoachPosSessao(sessao);
  if (!msgs.length) return;

  const card = document.createElement('div');
  card.id = 'coach-pos-sessao-card';
  card.className = 'coach-card';
  card.innerHTML = `
    <div class="coach-card-header">
      <span>🎯 Mentor da Trilha</span>
      <button class="btn-close-coach" aria-label="Fechar">✕</button>
    </div>
    <div class="coach-card-body">
      ${msgs.map(m => `<p>${escapeHtml(m)}</p>`).join('')}
    </div>
    <div class="coach-card-footer">
      <a href="#/mentor" class="btn btn-ghost btn-sm">Ver análise completa →</a>
    </div>
  `;

  // Injeta no body (posicionado fixo via CSS)
  document.body.appendChild(card);

  card.querySelector('.btn-close-coach').addEventListener('click', () => card.remove());
  // Auto-remove após 15s
  setTimeout(() => card?.remove(), 15000);
}

// Escuta o evento global disparado quando cicloSessoes tem nova entrada
window.addEventListener('ta:mudou', (e) => {
  if (e.detail?.storeName !== 'cicloSessoes') return;
  // Pega a sessão mais recente do state
  const sessoes = state.cicloSessoes || [];
  if (!sessoes.length) return;
  const ultima = sessoes[sessoes.length - 1];
  // Só dispara se a sessão é de hoje e não é ajuste manual
  if (ultima?.data === todayISO() && !ultima?.ajusteManual && (ultima?.minutos || 0) >= 1) {
    // Pequeno delay para o state já ter sido recarregado
    setTimeout(() => _renderCoachPosSessao(ultima), 800);
  }
});
