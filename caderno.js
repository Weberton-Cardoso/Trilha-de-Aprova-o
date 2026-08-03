/**
 * caderno.js
 * Tela do Caderno de Resumos: árvore Matéria→Tópico, busca, CRUD
 * de anotações e envio pro Anki.
 *
 * Extraído do app.js em 2026-07-31 como parte da refatoração.
 *
 * Depende de (carregados antes no index.html):
 *  database.js  — db.resumos.*
 *  app.js       — state, todayISO, toBRDate, escapeHtml, $, $$,
 *                 showToast, reloadState, _mdParaHtml, _norm,
 *                 valoresAssuntoParaDisciplina, valoresUnicos
 *  tts-modulo.js, tts-caderno-integracao.js — setupTTSCaderno (opcional)
 */

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
let _cadernoBusca = '';

/** Agrupa state.resumos em { materia -> { topico -> [resumos] } }, com
 *  contagem por nó, pronta pra desenhar a árvore da sidebar do Caderno. */
function calcCadernoArvore() {
  const norm = (s) => (s || '').trim().toLowerCase();
  const arvore = new Map(); // chaveNorm materia -> { nome, topicos: Map(chaveNorm topico -> {nome, resumos:[]}) }

  state.resumos.forEach(r => {
    const nomeMateria = (r.materia || '').trim() || '(Sem matéria)';
    const nomeTopico = (r.topico || '').trim() || '(Sem tópico)';
    const chaveMateria = norm(nomeMateria);
    const chaveTopico = norm(nomeTopico);

    if (!arvore.has(chaveMateria)) arvore.set(chaveMateria, { nome: nomeMateria, topicos: new Map() });
    const materiaNode = arvore.get(chaveMateria);

    if (!materiaNode.topicos.has(chaveTopico)) materiaNode.topicos.set(chaveTopico, { nome: nomeTopico, resumos: [] });
    materiaNode.topicos.get(chaveTopico).resumos.push(r);
  });

  return arvore;
}

function renderCaderno(view) {
  const arvore = calcCadernoArvore();
  const materias = Array.from(arvore.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  if (!materias.length) {
    view.innerHTML = `
      <div class="empty-state">
        <p>Nenhum resumo no Caderno ainda.</p>
        <p class="text-muted" style="font-size:13px;">Resolva questões na tela "Resolver com IA" para começar a preencher o Caderno automaticamente.</p>
        <button class="btn btn-primary" id="empty-ir-resolver-ia">Ir para Resolver com IA</button>
      </div>
    `;
    $('#empty-ir-resolver-ia').addEventListener('click', () => { location.hash = '#/resolver-ia'; });
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


    function norm2(s) { return (s || '').trim().toLowerCase(); }

  function renderSidebar() {
    const sidebar = $('#caderno-sidebar');
    sidebar.innerHTML = materias.map(m => {
      const aberta = norm2(m.nome) === norm2(_cadernoSelecao.materia);
      const topicos = Array.from(m.topicos.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return `
        <div class="caderno-materia">
          <div class="caderno-materia-head" data-materia="${escapeHtml(m.nome)}">
            <span class="arrow">${aberta ? '▾' : '▸'}</span> ${escapeHtml(m.nome)}
          </div>
          ${aberta ? `
            <div class="caderno-topicos">
              ${topicos.map(t => `
                <div class="caderno-topico ${norm2(t.nome) === norm2(_cadernoSelecao.topico) ? 'active' : ''}" data-topico="${escapeHtml(t.nome)}">
                  <span>${escapeHtml(t.nome)}</span><span class="count">${t.resumos.length}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    $$('.caderno-materia-head', sidebar).forEach(el => el.addEventListener('click', () => {
      const nome = el.dataset.materia;
      _cadernoSelecao = norm2(_cadernoSelecao.materia) === norm2(nome)
        ? { materia: null, topico: null }
        : { materia: nome, topico: null };
      renderSidebar();
      renderMain();
    }));
    $$('.caderno-topico', sidebar).forEach(el => el.addEventListener('click', () => {
      _cadernoSelecao.topico = el.dataset.topico;
      renderSidebar();
      renderMain();
    }));
  }

  function renderMain() {
    const main = $('#caderno-main');
    const materiaNode = materias.find(m => norm2(m.nome) === norm2(_cadernoSelecao.materia));

    if (!materiaNode) { main.innerHTML = `<p class="text-muted">Selecione uma matéria ao lado.</p>`; return; }

    const topicoNode = _cadernoSelecao.topico
      ? materiaNode.topicos.get(norm2(_cadernoSelecao.topico))
      : null;

    let resumos = topicoNode
      ? topicoNode.resumos
      : Array.from(materiaNode.topicos.values()).flatMap(t => t.resumos);

    const termo = _cadernoBusca.trim().toLowerCase();
    if (termo) {
      resumos = resumos.filter(r =>
        (r.textoBruto || '').toLowerCase().includes(termo) ||
        (r.textoCondensado || '').toLowerCase().includes(termo)
      );
    }

    resumos = [...resumos].sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.id - a.id));

    // Agrupa por data só pra exibição (sessão = mesmo dia).
    const porData = new Map();
    resumos.forEach(r => {
      const d = r.data || '(sem data)';
      if (!porData.has(d)) porData.set(d, []);
      porData.get(d).push(r);
    });

    main.innerHTML = `
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <div>
          <div class="text-muted" style="font-size:12.5px;">${escapeHtml(materiaNode.nome)}</div>
          <h2 style="margin:2px 0 0;font-size:19px;">${escapeHtml(topicoNode ? topicoNode.nome : 'Todos os tópicos')}</h2>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-sm" id="caderno-btn-tts" style="display:flex;align-items:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
            Áudio ▾
          </button>
          <button class="btn btn-primary btn-sm" id="btn-nova-anotacao-caderno">✏️ Nova Anotação</button>
          <input type="text" id="caderno-busca" class="search-input" style="max-width:220px;" placeholder="🔍 Buscar nos resumos..." value="${escapeHtml(_cadernoBusca)}">
        </div>
      </div>

      <!-- Painel TTS: colapsável inline, sem position fixed -->
      <div id="caderno-tts-painel" hidden style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button id="tts-btn-play" class="btn btn-sm tts-btn-play" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>Ler
          </button>
          <button id="tts-btn-pause" class="btn btn-sm tts-btn-ctrl" hidden style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>Pausar
          </button>
          <button id="tts-btn-stop" class="btn btn-sm tts-btn-ctrl" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>Parar
          </button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--surface);border-radius:6px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);">
            Velocidade
            <input type="range" id="tts-speed" min="0.5" max="2" step="0.1" value="1" style="flex:1;">
            <span id="tts-speed-label" style="min-width:36px;text-align:right;font-weight:700;color:var(--gold);">1.0x</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);">
            Volume
            <input type="range" id="tts-volume" min="0" max="1" step="0.1" value="1" style="flex:1;">
            <span id="tts-volume-label" style="min-width:36px;text-align:right;font-weight:700;color:var(--gold);">100%</span>
          </label>
        </div>
        <div id="tts-status" style="font-size:12px;color:var(--text-muted);text-align:center;">Selecione resumos para ler (✅ no card).</div>
      </div>

      ${!resumos.length ? `<p class="text-muted">Nenhum resumo encontrado.</p>` : Array.from(porData.entries()).map(([data, itens]) => `
        <div class="sessao" style="margin-bottom:22px;">
          <div class="flex" style="align-items:center;gap:10px;margin-bottom:10px;">
            <span style="font-size:12px;color:var(--text-muted);background:var(--surface-2);padding:3px 10px;border-radius:999px;">${data === todayISO() ? 'Hoje' : toBRDate(data)}</span>
            <div style="flex:1;height:1px;background:var(--border);"></div>
          </div>
          ${itens.map(r => {
            const t = state.tentativas.find(x => x.id === r.tentativaId);
            const enunciado = r.enunciado || (t && t.enunciado) || '';
            return `
            <div class="card mb-12" data-resumo-card="${r.id}">
              <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" class="resumo-checkbox" data-resumo-id="${r.id}" title="Selecionar para leitura TTS" style="width:15px;height:15px;cursor:pointer;accent-color:var(--gold);">
                  <div style="font-size:12px;color:var(--text-muted);">
                    ${t ? `<b style="color:var(--text)">${escapeHtml(t.disciplina)}</b> · <span class="badge ${t.resultado === 'certa' ? 'success' : t.resultado === 'errada' ? 'danger' : 'muted'}">${t.resultado === 'certa' ? 'Certa' : t.resultado === 'errada' ? 'Errada' : 'Branco'}</span>` : '<span class="badge muted">Anotação Geral</span>'}
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  <button class="btn btn-sm btn-ghost" data-tts-card="${r.id}" title="Ler este resumo em voz alta">🔊</button>
                  <button class="btn btn-sm btn-ghost" data-grifar-resumo="${r.id}" title="Selecione um texto no card e clique para grifar">🖍️ Grifar</button>
                  <button class="btn btn-sm" data-editar-resumo="${r.id}">✏️ Editar</button>
                  <button class="btn btn-sm btn-ghost" data-excluir-resumo="${r.id}">🗑 Excluir</button>
                  <button class="btn btn-sm ${r.enviadoAnki ? 'enviado' : ''}" data-enviar-anki="${r.id}" ${r.enviadoAnki ? 'disabled' : ''}>
                    ${r.enviadoAnki ? '✓ Enviado ao Anki' : 'Enviar pro Anki'}
                  </button>
                </div>
              </div>
              ${enunciado ? `
                <details style="margin:6px 0 10px;" ${enunciado.length < 500 ? 'open' : ''}>
                  <summary style="cursor:pointer;font-size:12.5px;color:var(--primary);font-weight:600;user-select:none;">📋 Enunciado da Questão</summary>
                  <div class="caderno-enunciado-box">
                    ${_mdParaHtml(enunciado)}
                  </div>
                </details>
              ` : ''}
              <div style="line-height:1.6;font-size:13.5px;color:var(--text);margin:8px 0;">${_mdParaHtml(r.textoBruto)}</div>
              ${r.textoCondensado ? `<div style="border-left:2px solid var(--gold);padding-left:10px;color:var(--text-muted);font-size:13px;margin-top:10px;">📎 ${escapeHtml(r.textoCondensado)}</div>` : ''}
            </div>
          `; }).join('')}
        </div>
      `).join('')}
    `;

    $('#caderno-busca').addEventListener('input', (e) => {
      _cadernoBusca = e.target.value;
      renderMain();
    });

    $('#btn-nova-anotacao-caderno')?.addEventListener('click', () => {
      openModal(`
        <h2>✏️ Nova Anotação no Caderno</h2>
        <form id="form-nova-anotacao">
          <div class="form-row">
            <label>Matéria / Disciplina</label>
            <input type="text" id="anotacao-materia" value="${escapeHtml(_cadernoSelecao.materia || '')}" required placeholder="Ex: Direito Constitucional">
          </div>
          <div class="form-row">
            <label>Tópico / Assunto</label>
            <input type="text" id="anotacao-topico" value="${escapeHtml(_cadernoSelecao.topico || '')}" placeholder="Ex: Direitos Fundamentais">
          </div>
          <div class="form-row">
            <label>Conteúdo da Anotação (aceita **negrito** e ==grifado==)</label>
            <textarea id="anotacao-texto" rows="7" required placeholder="Escreva suas anotações aqui..."></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="btn-cancelar-anotacao">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar no Caderno</button>
          </div>
        </form>
      `);
      $('#btn-cancelar-anotacao').addEventListener('click', closeModal);
      $('#form-nova-anotacao').addEventListener('submit', async (e) => {
        e.preventDefault();
        const materia = $('#anotacao-materia').value.trim();
        const topico = $('#anotacao-topico').value.trim();
        const textoBruto = $('#anotacao-texto').value.trim();
        if (!materia || !textoBruto) return;

        await db.resumos.add({
          tentativaId: null,
          materia,
          topico,
          data: todayISO(),
          textoBruto,
          textoCondensado: '',
          enunciado: '',
          enviadoAnki: false,
          ankiDeck: null
        });
        closeModal();
        await reloadState();
        showToast('Anotação salva no Caderno!', 'success');
        renderCaderno(view);
      });
    });

    $$('[data-grifar-resumo]', main).forEach(btn => btn.addEventListener('click', async () => {
      // FIX: dataset usa camelCase — data-grifar-resumo → dataset.grifarResumo
      const id = Number(btn.dataset.grifarResumo);
      const resumo = state.resumos.find(r => r.id === id);
      if (!resumo) return;

      const sel = window.getSelection();
      const selectedText = sel ? sel.toString().trim() : '';
      if (!selectedText) {
        showToast('Selecione um trecho de texto com o mouse no card e clique em 🖍️ Grifar.', 'danger');
        return;
      }

      // Salva como ==texto== em vez de <mark>texto</mark> — o _mdParaHtml já converte
      // isso na exibição, e manter markdown puro no banco evita HTML solto no textoBruto.
      const grifado = `==${selectedText}==`;
      let alterou = false;

      // Tenta encontrar o texto selecionado no bruto original (antes de converter pra HTML),
      // pois o usuário seleciona o texto já renderizado — precisamos achar o trecho
      // correspondente no markdown cru. Prioridade: textoBruto → textoCondensado.
      if (resumo.textoBruto && resumo.textoBruto.includes(selectedText)) {
        resumo.textoBruto = resumo.textoBruto.replace(selectedText, grifado);
        alterou = true;
      } else if (resumo.textoCondensado && resumo.textoCondensado.includes(selectedText)) {
        resumo.textoCondensado = resumo.textoCondensado.replace(selectedText, grifado);
        alterou = true;
      }

      if (alterou) {
        await db.resumos.update(resumo);
        await reloadState();
        renderCaderno(view);
        showToast('Trecho grifado! ✨', 'success');
      } else {
        showToast('Não consegui localizar o trecho selecionado no texto original. Tente selecionar um pedaço menor, sem incluir formatação.', 'danger');
      }
    }));

    $$('[data-enviar-anki]', main).forEach(btn => btn.addEventListener('click', () => {
      // Fase 2 do roadmap (AnkiConnect) ainda não está plugada — placeholder por enquanto.
      showToast('Integração com Anki ainda não configurada nesta tela (próxima fase do roadmap).', '');
    }));

    // ── TTS: leitura individual por card ──────────────────────────────────
    $$('[data-tts-card]', main).forEach(btn => btn.addEventListener('click', () => {
      const id = Number(btn.dataset.ttsCard);
      const r = state.resumos.find(x => x.id === id);
      if (!r) return;
      // Checagem defensiva: funciona com tts-modulo novo (tem suportado()) e o original (não tem)
      const ttsOk = window.tts && (
        typeof window.tts.suportado === 'function' ? window.tts.suportado() : !!window.speechSynthesis
      );
      if (!ttsOk) { showToast('Leitura em voz alta não disponível neste navegador.', 'danger'); return; }
      const t = state.tentativas.find(x => x.id === r.tentativaId);
      const cabecalho = t ? `${t.disciplina}. ` : '';
      window.tts.falar(cabecalho + (r.textoBruto || '').replace(/[#*=~`]/g, '').replace(/\n+/g, '. '));
      const status = $('#tts-status');
      if (status) status.textContent = '🔊 Lendo este card...';
    }));

    $$('[data-excluir-resumo]', main).forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Excluir este resumo do Caderno? Essa ação não pode ser desfeita.')) return;
      await db.resumos.remove(Number(btn.dataset.excluirResumo));
      await reloadState();
      renderCaderno(view);
      showToast('Resumo excluído.', 'danger');
    }));

    $$('[data-editar-resumo]', main).forEach(btn => btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.editarResumo);
      const resumo = state.resumos.find(r => r.id === id);
      if (!resumo) return;
      openModal(`
        <h2>Editar resumo</h2>
        <form id="form-editar-resumo">
          <div class="form-row">
            <label>Explicação completa</label>
            <textarea name="textoBruto" rows="12" style="font-size:13px;">${escapeHtml(resumo.textoBruto || '')}</textarea>
          </div>
          <div class="form-row">
            <label>Versão condensada</label>
            <textarea name="textoCondensado" rows="3" style="font-size:13px;">${escapeHtml(resumo.textoCondensado || '')}</textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="btn-cancelar-editar-resumo">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar alterações</button>
          </div>
        </form>
      `);
      $('#btn-cancelar-editar-resumo').addEventListener('click', closeModal);
      $('#form-editar-resumo').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await db.resumos.update({
          ...resumo,
          textoBruto: fd.get('textoBruto').trim(),
          textoCondensado: fd.get('textoCondensado').trim()
        });
        closeModal();
        await reloadState();
        renderCaderno(view);
        showToast('Resumo atualizado.', 'success');
      });
    }));
  }

  renderSidebar();
  renderMain();

  // ── Painel TTS — controles do painel fixo ──────────────────────────────
  // Detecta suporte TTS de forma defensiva — funciona com qualquer versão
  // do tts-modulo.js: se tiver suportado(), usa; se não tiver (versão
  // antiga ainda no ar), verifica diretamente window.speechSynthesis.
  const _ttsSuportado = window.tts && (
    typeof window.tts.suportado === 'function' ? window.tts.suportado() : !!window.speechSynthesis
  );
  const _tts = _ttsSuportado ? window.tts : null;
  const atualizarEstadoTTS = (msg) => {
    const s = $('#tts-status'); if (s) s.textContent = msg;
    const play = $('#tts-btn-play'), pause = $('#tts-btn-pause');
    if (!play || !pause) return;
    if (_tts && _tts.estaFalando() && !_tts.estaPausado()) {
      play.hidden = true; pause.hidden = false;
    } else {
      play.hidden = false; pause.hidden = true;
    }
  };

  if (_tts) {
    _tts.definirCallbacks({
      onStart:  () => atualizarEstadoTTS('🔊 Lendo...'),
      onPause:  () => atualizarEstadoTTS('⏸️ Pausado — clique em ▶ pra retomar'),
      onResume: () => atualizarEstadoTTS('🔊 Lendo...'),
      onEnd:    () => atualizarEstadoTTS('✅ Leitura concluída'),
      onError:  (e) => atualizarEstadoTTS(`❌ Erro: ${e.error || 'desconhecido'}`)
    });
  }

  // ── Botão 🔊 Áudio — toggle dropdown ──────────────────────
  // O botão fica no main.innerHTML mas o dropdown no body, então
  // usamos delegação de evento no document para fechar ao clicar fora.
  const _fecharTTSDropdown = () => {
    const p = $('#caderno-tts-painel');
    if (p && !p.hidden) p.hidden = true;
  };

  // Registra o listener de fechar NO DOCUMENT uma única vez por renderização
  // usando AbortController para remover quando a view for desmontada
  const _ttsAbort = new AbortController();
  document.addEventListener('click', (e) => {
    const btn = document.getElementById('caderno-btn-tts');
    if (btn && btn.contains(e.target)) return; // clique no próprio botão — deixa o toggle cuidar
    _fecharTTSDropdown();
  }, { signal: _ttsAbort.signal });

  // Quando o usuário sair do Caderno (hash change), remove o listener e o dropdown
  window.addEventListener('hashchange', () => {
    _ttsAbort.abort();
    _fecharTTSDropdown();
    const p = document.getElementById('caderno-tts-controls');
    if (p) p.remove();
  }, { once: true });

  // Delegação no view — toggle simples do painel inline
  view.addEventListener('click', (e) => {
    if (e.target.closest('#caderno-btn-tts')) {
      if (!_tts) { showToast('Leitura em voz alta não suportada neste navegador.', 'danger'); return; }
      const painel = $('#caderno-tts-painel');
      if (painel) painel.hidden = !painel.hidden;
    }
  });

  // Todos os listeners do painel TTS via delegação no view
  // (o painel fica no main.innerHTML que é re-renderizado)
  view.addEventListener('click', (e) => {
    if (!_tts) return;

    // Play
    if (e.target.closest('#tts-btn-play')) {
      if (_tts.estaPausado()) { _tts.retomar(); return; }
      const marcados = $$('input.resumo-checkbox:checked', view).map(cb =>
        state.resumos.find(r => r.id === Number(cb.dataset.resumoId))
      ).filter(Boolean);
      if (!marcados.length) { showToast('Marque pelo menos um resumo (✅) para ler.', 'info'); return; }
      const textos = marcados.map(r => {
        const t = state.tentativas.find(x => x.id === r.tentativaId);
        const cab = t ? t.disciplina + '. ' : '';
        return cab + (r.textoBruto || '').replace(/[#*=~`]/g, '').replace(/\n+/g, '. ');
      });
      const total = textos.length;
      let atual = 0;
      atualizarEstadoTTS('🔊 Lendo resumo 1 de ' + total + '...');
      const lerProximo = () => {
        if (atual >= total) { atualizarEstadoTTS('✅ Leitura concluída'); return; }
        atual++;
        atualizarEstadoTTS('🔊 Lendo resumo ' + atual + ' de ' + total + '...');
        _tts.falar(textos[atual - 1], lerProximo);
      };
      lerProximo();
      return;
    }

    // Pause/Resume
    if (e.target.closest('#tts-btn-pause')) {
      if (_tts.estaPausado()) { _tts.retomar(); } else { _tts.pausar(); }
      return;
    }

    // Stop
    if (e.target.closest('#tts-btn-stop')) {
      _tts.parar();
      atualizarEstadoTTS('Parado. Selecione resumos para ler (✅ no card).');
      return;
    }
  });

  // Sliders via delegação (input não borbulha igual click, mas o alvo correto é garantido)
  view.addEventListener('input', (e) => {
    if (e.target.id === 'tts-speed') {
      const v = parseFloat(e.target.value);
      _tts?.definirVelocidade(v);
      const label = $('#tts-speed-label'); if (label) label.textContent = v.toFixed(1) + 'x';
    }
    if (e.target.id === 'tts-volume') {
      const v = parseFloat(e.target.value);
      _tts?.definirVolume(v);
      const label = $('#tts-volume-label'); if (label) label.textContent = Math.round(v * 100) + '%';
    }
  });
}

