/**
 * ciclo.js
 * Ciclo de Estudos — metodologia usada em apps como o "Estude Aqui":
 * você lista as disciplinas com um peso (prioridade) e um tempo total do
 * ciclo; o app distribui o tempo proporcionalmente ao peso de cada uma.
 * Você vai estudando (cronômetro) até bater a meta de cada disciplina;
 * quando todas terminam, fecha-se o ciclo (uma "volta") e tudo recomeça.
 *
 * Suporta VÁRIOS ciclos nomeados ao mesmo tempo (ex.: um ciclo "TCDF" com
 * até 5 disciplinas e outro "Português avulso" separado).
 *
 * Dados: db.ciclos (cada ciclo: nome, tempo total, voltas fechadas),
 * db.cicloMaterias (disciplinas de um ciclo, via cicloId, + progresso da
 * volta atual) e db.cicloSessoes (histórico de sessões estudadas).
 */

let _cicloTimerInterval = null;

// Tipos de estudo que podem ser marcados numa sessão/registro de tempo do
// Ciclo de Estudos (ex.: PDF, Videoaula, Exercícios...). Fica salvo junto
// com a sessão em db.cicloSessoes, no campo tipoEstudo.
const TIPOS_ESTUDO_CICLO = [
  'PDF', 'Livro', 'Vídeo', 'Revisão', 'Exercícios', 'Simulado',
  'Aula presencial', 'Lei Seca', 'Jurisprudência', 'Doutrina', 'Áudio',
  'Discursivas', 'Prática Forense', 'Fase Oral', 'Flashcards', 'Súmula', 'Outros'
];

const _CORES_TIPO_ESTUDO = [
  '#E8B14D', '#60A5FA', '#34D399', '#F87171', '#A78BFA', '#F472B6',
  '#38BDF8', '#FB923C', '#4ADE80', '#C084FC', '#FBBF24', '#22D3EE',
  '#F97316', '#84CC16', '#EC4899', '#10B981', '#94A3B8'
];

// Cores para diferenciar visualmente cada disciplina na lista do Ciclo de
// Estudos (borda lateral, bolinha ao lado do nome, barra de progresso).
// Repete em loop se o ciclo tiver mais disciplinas do que cores na lista.
const _CORES_MATERIA_CICLO = [
  '#E8B14D', '#60A5FA', '#F87171', '#34D399', '#C084FC', '#FB923C',
  '#38BDF8', '#F472B6', '#4ADE80', '#FBBF24', '#A78BFA', '#22D3EE'
];

/** Soma os minutos estudados (db.cicloSessoes) de todas as disciplinas de
 *  um ciclo NUM DIA ESPECÍFICO (padrão: hoje), agrupados por tipo de
 *  estudo. Sessões sem tipo informado entram no grupo "Não informado". */
function _tempoPorTipoEstudo(materiasDoCiclo, data = todayISO()) {
  const idsMateria = new Set(materiasDoCiclo.map(m => m.id));
  const totais = {};
  for (const s of state.cicloSessoes) {
    if (!idsMateria.has(s.cicloMateriaId)) continue;
    if (s.data !== data) continue;
    const tipo = s.tipoEstudo || 'Não informado';
    totais[tipo] = (totais[tipo] || 0) + (s.minutos || 0);
  }
  return Object.entries(totais)
    .filter(([, minutos]) => minutos > 0)
    .sort((a, b) => b[1] - a[1]);
}

function _perguntarTopico(materiaNome, valorAtual = '') {
  const conhecidos = _topicosConhecidosCiclo(materiaNome);
  const dica = conhecidos.length
    ? `\n\nJá usados antes nessa disciplina (digite o número pra reaproveitar, ou escreva um novo):\n${conhecidos.map((t, i) => `${i + 1}) ${t}`).join('\n')}`
    : '';
  const resposta = prompt(
    `Tópico/assunto estudado em "${materiaNome}" (opcional):${dica}`,
    valorAtual
  );
  if (resposta === null) return undefined; // cancelou
  const texto = resposta.trim();
  if (!texto) return null;
  const indice = Number(texto) - 1;
  if (Number.isInteger(indice) && conhecidos[indice]) return conhecidos[indice];
  return texto;
}

function _perguntarTipoEstudo() {
  const lista = TIPOS_ESTUDO_CICLO.map((t, i) => `${i + 1}) ${t}`).join('\n');
  const resposta = prompt(
    `Tipo de estudo (opcional) — digite o número, ou deixe em branco pra não informar:\n${lista}`,
    ''
  );
  if (resposta === null || resposta.trim() === '') return null;
  const indice = Number(resposta.trim()) - 1;
  return TIPOS_ESTUDO_CICLO[indice] || null;
}

/** Sugestões de tópico/assunto para o autocomplete do Ciclo de Estudos:
 *  junta os tópicos já cadastrados no Edital (se a disciplina tiver um
 *  correspondente lá) com os tópicos já usados antes em sessões do ciclo
 *  para essa mesma disciplina — evita duplicar "Atos Administrativos" e
 *  "atos administrativos" como coisas diferentes. */
function _topicosConhecidosCiclo(materiaNome) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const alvo = norm(materiaNome);
  const vistos = new Map(); // chave normalizada -> texto original (primeira grafia usada)

  (state.editais || []).forEach(e => (e.materias || []).forEach(m => {
    if (norm(m.nome) === alvo) {
      (m.topicos || []).forEach(tp => {
        if (tp.nome && !vistos.has(norm(tp.nome))) vistos.set(norm(tp.nome), tp.nome);
      });
    }
  }));

  const materiasComEsseNome = new Set(
    state.cicloMaterias.filter(m => norm(m.nome) === alvo).map(m => m.id)
  );
  state.cicloSessoes.forEach(s => {
    if (s.topico && materiasComEsseNome.has(s.cicloMateriaId) && !vistos.has(norm(s.topico))) {
      vistos.set(norm(s.topico), s.topico);
    }
  });

  return Array.from(vistos.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function _formatarMinutos(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return `${h}h${m > 0 ? ' ' + m + 'min' : ''}`;
  return `${m}min`;
}

function _formatarCronometro(segundosTotais) {
  const h = Math.floor(segundosTotais / 3600);
  const m = Math.floor((segundosTotais % 3600) / 60);
  const s = Math.floor(segundosTotais % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function _materiasDoCiclo(cicloId) {
  return state.cicloMaterias.filter(m => m.cicloId === cicloId);
}

function _cicloSomaPesos(materias) {
  return materias.reduce((s, m) => s + m.peso, 0) || 1;
}

function _cicloMetaMinutos(materia, materiasDoCiclo, minutosCicloTotal) {
  return Math.round((materia.peso / _cicloSomaPesos(materiasDoCiclo)) * minutosCicloTotal);
}

/** Tempo decorrido (ms) de uma sessão ativa, descontando o tempo em pausa
 *  (inclusive a pausa em andamento agora, se houver). */
function _cicloElapsedMs(sessaoAtiva, agora = Date.now()) {
  let pausadoTotal = sessaoAtiva.tempoPausadoAcumulado || 0;
  if (sessaoAtiva.pausadoEm) pausadoTotal += (agora - sessaoAtiva.pausadoEm);
  return Math.max(0, agora - sessaoAtiva.inicio - pausadoTotal);
}

/** Formata segundos para exibição no cronômetro (MM:SS ou HH:MM:SS) */
function formatarCronometroParaExibicao(segundosTotais) {
  const h = Math.floor(segundosTotais / 3600);
  const m = Math.floor((segundosTotais % 3600) / 60);
  const s = Math.floor(segundosTotais % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Renderiza um banner com o cronômetro do ciclo ativo para usar em outras telas */
function renderRelogioCicloAtivo() {
  const sessaoAtiva = settings.cicloSessaoAtiva;
  if (!sessaoAtiva) return '';
  
  const materia = state.cicloMaterias.find(m => m.id === sessaoAtiva.materiaId);
  const ciclo = materia ? state.ciclos.find(c => c.id === materia.cicloId) : null;
  if (!materia || !ciclo) return '';
  
  const pausado = !!sessaoAtiva.pausadoEm;
  const seg = Math.floor(_cicloElapsedMs(sessaoAtiva) / 1000);
  const tempoFormatado = formatarCronometroParaExibicao(seg);
  
  return `
    <div class="card mb-12" style="background:var(--surface-2); border-left:4px solid ${pausado ? '#F59E0B' : '#10B981'};">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="flex:1; min-width:200px;">
          <div style="font-size:12px; color:var(--text-muted);">🕐 Ciclo de Estudos em andamento</div>
          <div style="font-weight:600; font-size:14px;">${escapeHtml(ciclo.nome)} · ${escapeHtml(materia.nome)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:monospace; font-size:22px; font-weight:700; color:${pausado ? '#F59E0B' : '#10B981'};">${tempoFormatado}</div>
          <div style="font-size:11px; color:var(--text-muted);">${pausado ? '⏸ Pausado' : '▶ Em progresso'}</div>
        </div>
        <a href="#/ciclo/${ciclo.id}" class="btn btn-sm btn-primary">Ver ciclo</a>
      </div>
    </div>
  `;
}

/* ---- Lista de todos os ciclos (#/ciclo) ---- */
function renderCiclosLista(view) {
  clearInterval(_cicloTimerInterval);

  const sessaoAtiva = settings.cicloSessaoAtiva;
  let bannerSessao = '';
  if (sessaoAtiva) {
    const materia = state.cicloMaterias.find(m => m.id === sessaoAtiva.materiaId);
    const ciclo = materia ? state.ciclos.find(c => c.id === materia.cicloId) : null;
    if (materia && ciclo) {
      bannerSessao = `
        <div class="card mb-16 ciclo-sessao-ativa" style="cursor:pointer;" id="banner-sessao-ativa">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <div class="card-title" style="margin-bottom:2px;">Sessão em andamento</div>
              <span class="text-muted" style="font-size:13px;">${escapeHtml(ciclo.nome)} · ${escapeHtml(materia.nome)}</span>
            </div>
            <span class="btn btn-sm btn-primary">Voltar</span>
          </div>
        </div>
      `;
    }
  }

  const cards = state.ciclos.map(ciclo => {
    const materias = _materiasDoCiclo(ciclo.id);
    const totalFeito = materias.reduce((s, m) => s + m.minutosFeitos, 0);
    const pct = ciclo.minutosCicloTotal ? Math.min(100, (totalFeito / ciclo.minutosCicloTotal) * 100) : 0;
    return `
      <div class="card ciclo-card-lista" data-abrir-ciclo="${ciclo.id}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <div class="card-title" style="margin-bottom:2px;">${escapeHtml(ciclo.nome)}</div>
            <span class="text-muted" style="font-size:12.5px;">
              ${materias.length} disciplina${materias.length === 1 ? '' : 's'} · Ciclos completos: ${ciclo.ciclosCompletos}
            </span>
          </div>
          <button class="btn btn-sm btn-ghost" data-editar-ciclo="${ciclo.id}" title="Editar disciplinas">Editar</button>
        </div>
        <div class="pct-bar-wrap mt-12" style="min-width:auto;">
          <div class="pct-bar" style="flex:1;"><span style="width:${pct}%"></span></div>
          <span class="num">${fmtPct(pct)}</span>
        </div>
      </div>
    `;
  }).join('');

  view.innerHTML = `
    ${bannerSessao}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <span class="text-muted" style="font-size:13.5px;">Você pode manter vários ciclos separados (ex.: um por concurso ou bloco de disciplinas).</span>
      <button class="btn btn-primary btn-sm" id="btn-novo-ciclo">+ Novo ciclo</button>
    </div>
    ${state.ciclos.length ? `<div class="ciclos-grid">${cards}</div>` : `
      <div class="empty-state">
        <p>Você ainda não criou nenhum ciclo de estudos.</p>
      </div>
    `}
  `;

  if (sessaoAtiva) {
    const btnBanner = $('#banner-sessao-ativa');
    if (btnBanner) {
      const materia = state.cicloMaterias.find(m => m.id === sessaoAtiva.materiaId);
      btnBanner.addEventListener('click', () => { location.hash = `#/ciclo/${materia.cicloId}`; });
    }
  }

  $('#btn-novo-ciclo').addEventListener('click', () => renderCicloSetup(view, null));

  $$('[data-abrir-ciclo]', view).forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-editar-ciclo]')) return;
      location.hash = `#/ciclo/${card.dataset.abrirCiclo}`;
    });
  });

  $$('[data-editar-ciclo]', view).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ciclo = state.ciclos.find(c => c.id === Number(btn.dataset.editarCiclo));
      if (ciclo) renderCicloSetup(view, ciclo);
    });
  });
}

/* ---- Tela de configuração (criação ou edição de UM ciclo) ---- */
function renderCicloSetup(view, cicloExistente) {
  clearInterval(_cicloTimerInterval);
  const materiasExistentes = cicloExistente ? _materiasDoCiclo(cicloExistente.id) : [];
  const linhasIniciais = cicloExistente
    ? materiasExistentes.map(m => `${m.nome}: ${m.peso}`).join('\n')
    : '';
  const nomeInicial = cicloExistente ? cicloExistente.nome : '';
  const horasIniciais = cicloExistente ? (cicloExistente.minutosCicloTotal / 60) : 20;

  view.innerHTML = `
    <div class="card">
      <div class="card-title">${cicloExistente ? 'Editar ciclo' : 'Novo ciclo de estudos'}</div>
      <div class="form-row">
        <label>Nome do ciclo</label>
        <input type="text" id="ciclo-nome" placeholder="Ex: TCDF, Português avulso, Bloco de exatas..." value="${escapeHtml(nomeInicial)}">
      </div>
      <p class="text-muted" style="font-size:13.5px;">
        Liste as disciplinas deste ciclo, uma por linha, com o peso (prioridade) depois de dois-pontos.
        Disciplinas com peso maior recebem mais tempo dentro do ciclo. Se não informar o peso, o padrão é 1.
        <br><em>Dica: muita gente prefere manter até 5 disciplinas por ciclo — mas fique à vontade.</em>
      </p>
      <pre style="font-size:12.5px;background:var(--surface-2);padding:8px 10px;border-radius:8px;overflow-x:auto;margin:0 0 14px;">Direito Constitucional: 5
Direito Administrativo: 5
Língua Portuguesa: 3
Raciocínio Lógico: 2</pre>
      <div class="form-row">
        <label>Disciplinas e pesos</label>
        <textarea id="ciclo-texto" rows="8" placeholder="Direito Constitucional: 5&#10;Português: 3&#10;...">${escapeHtml(linhasIniciais)}</textarea>
      </div>
      <div class="form-row" style="max-width:260px;">
        <label>Tempo total do ciclo (em horas)</label>
        <input type="number" id="ciclo-horas" min="1" step="0.5" value="${horasIniciais}">
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-salvar-ciclo">${cicloExistente ? 'Salvar alterações' : 'Criar ciclo'}</button>
        <button class="btn btn-ghost" id="btn-cancelar-edicao-ciclo">Cancelar</button>
        ${cicloExistente ? '<button class="btn btn-danger" id="btn-excluir-ciclo-setup" style="margin-left:auto;">Excluir este ciclo</button>' : ''}
      </div>
    </div>
  `;

  $('#btn-cancelar-edicao-ciclo').addEventListener('click', () => {
    if (cicloExistente) location.hash = `#/ciclo/${cicloExistente.id}`;
    else renderCiclosLista(view);
  });

  if (cicloExistente) {
    $('#btn-excluir-ciclo-setup').addEventListener('click', async () => {
      if (!confirm(`Excluir o ciclo "${cicloExistente.nome}" e todo o seu progresso? As tentativas registradas nas Estatísticas não são afetadas.`)) return;
      for (const m of materiasExistentes) await db.cicloMaterias.remove(m.id);
      await db.ciclos.remove(cicloExistente.id);
      const sessaoAtiva = settings.cicloSessaoAtiva;
      if (sessaoAtiva && materiasExistentes.some(m => m.id === sessaoAtiva.materiaId)) {
        settings.cicloSessaoAtiva = null;
      }
      await reloadState();
      location.hash = '#/ciclo';
    });
  }

  $('#btn-salvar-ciclo').addEventListener('click', async () => {
    const nome = $('#ciclo-nome').value.trim();
    if (!nome) { showToast('Dê um nome para o ciclo.', 'error'); return; }

    const texto = $('#ciclo-texto').value;
    const horas = Number($('#ciclo-horas').value) || 20;
    const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    if (!linhas.length) { showToast('Adicione ao menos uma disciplina.', 'error'); return; }

    const novasMaterias = linhas.map(linha => {
      const m = linha.match(/^(.+?)(?::\s*([\d.,]+))?$/);
      const nomeM = (m ? m[1] : linha).trim();
      const pesoStr = m && m[2] ? m[2].replace(',', '.') : '1';
      const peso = Number(pesoStr);
      return { nome: nomeM, peso: peso > 0 ? peso : 1 };
    }).filter(m => m.nome);

    if (novasMaterias.length > 5) {
      showToast('Ciclo salvo com mais de 5 disciplinas — sem problema, é só um lembrete do seu costume.', '');
    }

    let cicloId;
    if (cicloExistente) {
      cicloId = cicloExistente.id;
      await db.ciclos.update({ ...cicloExistente, nome, minutosCicloTotal: Math.round(horas * 60) });

      const restantes = [];
      for (const nova of novasMaterias) {
        const antiga = materiasExistentes.find(a => _norm(a.nome) === _norm(nova.nome));
        restantes.push(antiga ? { ...antiga, nome: nova.nome, peso: nova.peso } : { nome: nova.nome, peso: nova.peso, minutosFeitos: 0, cicloId });
      }
      for (const antiga of materiasExistentes) {
        if (!novasMaterias.some(n => _norm(n.nome) === _norm(antiga.nome))) {
          await db.cicloMaterias.remove(antiga.id);
        }
      }
      for (let i = 0; i < restantes.length; i++) {
        const mat = { ...restantes[i], cicloId, ordem: i };
        if (mat.id) await db.cicloMaterias.update(mat);
        else await db.cicloMaterias.add(mat);
      }
    } else {
      cicloId = await db.ciclos.add({
        nome, minutosCicloTotal: Math.round(horas * 60), ciclosCompletos: 0, ordem: state.ciclos.length
      });
      for (let i = 0; i < novasMaterias.length; i++) {
        await db.cicloMaterias.add({ ...novasMaterias[i], cicloId, ordem: i, minutosFeitos: 0 });
      }
    }

    await reloadState();
    showToast('Ciclo de estudos salvo!', 'success');
    location.hash = `#/ciclo/${cicloId}`;
  });
}

/* ---- Painel de UM ciclo específico (#/ciclo/<id>) ---- */
function renderCicloPainelRoute(view, cicloId) {
  clearInterval(_cicloTimerInterval);

  const ciclo = state.ciclos.find(c => c.id === cicloId);
  if (!ciclo) {
    view.innerHTML = '<div class="empty-state"><p>Ciclo não encontrado. <a href="#/ciclo">Voltar para a lista</a>.</p></div>';
    return;
  }

  const materias = _materiasDoCiclo(cicloId).sort((a, b) => a.ordem - b.ordem);
  const totalFeito = materias.reduce((s, m) => s + m.minutosFeitos, 0);
  const totalMeta = ciclo.minutosCicloTotal;
  const pctGeral = totalMeta ? Math.min(100, (totalFeito / totalMeta) * 100) : 0;
  const todasConcluidas = materias.length > 0 && materias.every(m => m.minutosFeitos >= _cicloMetaMinutos(m, materias, totalMeta) - 0.5);
  const sessaoAtiva = settings.cicloSessaoAtiva;
  const sessaoAtivaEhDesteCiclo = sessaoAtiva && materias.some(m => m.id === sessaoAtiva.materiaId);

  view.innerHTML = `
    <a href="#/ciclo" class="text-muted" style="font-size:13px; display:inline-block; margin-bottom:12px;">&larr; Todos os ciclos</a>

    <div class="card mb-16">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div class="card-title" style="margin-bottom:4px;">${escapeHtml(ciclo.nome)}</div>
          <span class="text-muted" style="font-size:13px;">
            ${_formatarMinutos(totalFeito)} de ${_formatarMinutos(totalMeta)} · Ciclos completos: <strong>${ciclo.ciclosCompletos}</strong>
          </span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-sm" id="btn-editar-ciclo">Editar disciplinas</button>
          <button class="btn btn-sm btn-ghost" id="btn-reiniciar-ciclo">Reiniciar</button>
        </div>
      </div>
      <div class="pct-bar-wrap mt-12" style="min-width:auto;">
        <div class="pct-bar" style="flex:1;"><span style="width:${pctGeral}%"></span></div>
        <span class="num">${fmtPct(pctGeral)}</span>
      </div>
      ${todasConcluidas ? `<button class="btn btn-primary mt-12" id="btn-fechar-ciclo">🎉 Fechar ciclo e começar nova volta</button>` : ''}
    </div>

    <div class="card mb-16" id="card-tempo-por-tipo"></div>

    ${sessaoAtivaEhDesteCiclo ? _renderCicloSessaoAtivaCard(sessaoAtiva) : ''}

    <div class="card">
      <div class="card-title">Disciplinas deste ciclo</div>
      <div class="ciclo-lista mt-12">
        ${materias.map((m, i) => _renderCicloLinhaMateria(m, materias, totalMeta, sessaoAtiva, i, ciclo.nome)).join('')}
      </div>
    </div>
  `;

  $('#btn-editar-ciclo').addEventListener('click', () => renderCicloSetup(view, ciclo));

  _renderCardTempoPorTipo(materias);

  $('#btn-reiniciar-ciclo').addEventListener('click', async () => {
    if (!confirm(`Reiniciar o ciclo "${ciclo.nome}" agora? O tempo já estudado em cada disciplina volta a zero e isso NÃO conta como uma volta completa. As disciplinas e pesos continuam os mesmos.`)) return;
    if (sessaoAtivaEhDesteCiclo) {
      settings.cicloSessaoAtiva = null;
      clearInterval(_cicloTimerInterval);
    }
    for (const m of materias) {
      m.minutosFeitos = 0;
      await db.cicloMaterias.update(m);
    }
    await reloadState();
    showToast(`Ciclo "${ciclo.nome}" reiniciado.`, 'success');
    renderCicloPainelRoute(view, cicloId);
  });

  const btnFechar = $('#btn-fechar-ciclo');
  if (btnFechar) {
    btnFechar.addEventListener('click', async () => {
      if (!confirm('Fechar este ciclo e começar uma nova volta? O progresso de cada disciplina será zerado (o histórico de sessões estudadas é mantido).')) return;
      for (const m of materias) {
        m.minutosFeitos = 0;
        await db.cicloMaterias.update(m);
      }
      await db.ciclos.update({ ...ciclo, ciclosCompletos: ciclo.ciclosCompletos + 1 });
      await reloadState();
      showToast('Ciclo concluído! Nova volta iniciada. 🎉', 'success');
      renderCicloPainelRoute(view, cicloId);
    });
  }

  if (sessaoAtivaEhDesteCiclo) {
    _iniciarCronometroVisual();
    $('#btn-concluir-sessao').addEventListener('click', () => _concluirSessaoCiclo(view, cicloId));
    $('#btn-cancelar-sessao').addEventListener('click', () => _cancelarSessaoCiclo(view, cicloId));
    const btnPausar = $('#btn-pausar-sessao');
    if (btnPausar) btnPausar.addEventListener('click', () => _pausarSessaoCiclo(view, cicloId));
    const btnRetomar = $('#btn-retomar-sessao');
    if (btnRetomar) btnRetomar.addEventListener('click', () => _retomarSessaoCiclo(view, cicloId));
    const selTipo = $('#ciclo-tipo-estudo');
    if (selTipo) selTipo.addEventListener('change', () => {
      settings.cicloSessaoAtiva = { ...settings.cicloSessaoAtiva, tipoEstudo: selTipo.value || null };
    });
    const inputTopico = $('#ciclo-topico-estudo');
    if (inputTopico) {
      inputTopico.addEventListener('change', () => {
        settings.cicloSessaoAtiva = { ...settings.cicloSessaoAtiva, topico: inputTopico.value.trim() || null };
      });
      const materiaAtiva = state.cicloMaterias.find(m => m.id === sessaoAtiva.materiaId);
      if (typeof attachAutocomplete === 'function' && materiaAtiva) {
        attachAutocomplete(inputTopico, () => _topicosConhecidosCiclo(materiaAtiva.nome));
      }
    }
  }

  $$('[data-iniciar]', view).forEach(btn => {
    btn.addEventListener('click', () => {
      if (settings.cicloSessaoAtiva) { showToast('Finalize a sessão atual antes de iniciar outra.', 'error'); return; }
      settings.cicloSessaoAtiva = { materiaId: Number(btn.dataset.iniciar), inicio: Date.now(), ativo: true };
      saveSettings();
      // Inicia o timer global
      if (typeof _iniciarTimerCiclo === 'function') {
        _iniciarTimerCiclo();
      }
      renderCicloPainelRoute(view, cicloId);
    });
  });

  $$('[data-manual]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const materia = state.cicloMaterias.find(m => m.id === Number(btn.dataset.manual));
      if (!materia) return;
      const resposta = prompt(
        `Quantos minutos você quer ADICIONAR ao tempo já estudado em "${materia.nome}"?\n` +
        `(Já tem ${_formatarMinutos(materia.minutosFeitos)} registrado — o app soma automaticamente. ` +
        `Use um número negativo se precisar corrigir/subtrair.)`,
        ''
      );
      if (resposta === null || resposta.trim() === '') return;
      const minutosAdicionados = Number(resposta.replace(',', '.'));
      if (isNaN(minutosAdicionados)) { showToast('Digite um número válido de minutos.', 'error'); return; }

      const novoTotal = Math.max(0, materia.minutosFeitos + minutosAdicionados);
      const diferenca = novoTotal - materia.minutosFeitos;
      const tipoEstudo = diferenca !== 0 ? _perguntarTipoEstudo() : null;
      const topico = diferenca !== 0 ? _perguntarTopico(materia.nome) || null : null;
      materia.minutosFeitos = novoTotal;
      await db.cicloMaterias.update(materia);
      if (diferenca !== 0) {
        await db.cicloSessoes.add({
          cicloMateriaId: materia.id, nome: materia.nome, data: todayISO(),
          minutos: diferenca, inicio: new Date().toISOString(), fim: new Date().toISOString(),
          ajusteManual: true, tipoEstudo, topico
        });
      }
      await reloadState();
      showToast(`Tempo de ${materia.nome} agora é ${_formatarMinutos(novoTotal)}.`, 'success');
      renderCicloPainelRoute(view, cicloId);
    });
  });

  $$('[data-manual-total]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const materia = state.cicloMaterias.find(m => m.id === Number(btn.dataset.manualTotal));
      if (!materia) return;
      const resposta = prompt(
        `Corrigir o tempo TOTAL exato já estudado em "${materia.nome}" (em minutos):`,
        String(Math.round(materia.minutosFeitos))
      );
      if (resposta === null) return;
      const novoTotal = Number(resposta.replace(',', '.'));
      if (isNaN(novoTotal) || novoTotal < 0) { showToast('Digite um número válido de minutos.', 'error'); return; }

      const diferenca = novoTotal - materia.minutosFeitos;
      materia.minutosFeitos = novoTotal;
      await db.cicloMaterias.update(materia);
      if (diferenca !== 0) {
        await db.cicloSessoes.add({
          cicloMateriaId: materia.id, nome: materia.nome, data: todayISO(),
          minutos: diferenca, inicio: new Date().toISOString(), fim: new Date().toISOString(),
          ajusteManual: true
        });
      }
      await reloadState();
      showToast(`Tempo de ${materia.nome} corrigido para ${_formatarMinutos(novoTotal)}.`, 'success');
      renderCicloPainelRoute(view, cicloId);
    });
  });

  $$('[data-editar-tipo]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const materia = state.cicloMaterias.find(m => m.id === Number(btn.dataset.editarTipo));
      if (!materia) return;
      await _registrarRodadaCiclo(materia, view, cicloId);
    });
  });

  $$('[data-editar-topico]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const materia = state.cicloMaterias.find(m => m.id === Number(btn.dataset.editarTopico));
      if (!materia) return;
      await _registrarRodadaCiclo(materia, view, cicloId);
    });
  });

  $$('[data-vincular-nomes]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const materia = state.cicloMaterias.find(m => m.id === Number(btn.dataset.vincularNomes));
      if (!materia) return;

      const resposta = prompt(
        `Quais outros nomes você já usou (ou vai usar) nas Tentativas pra "${materia.nome}"?\n` +
        `Separe por vírgula se for mais de um. Ex.: AFO, Administração Financeira\n\n` +
        `Isso NÃO muda o nome da disciplina no Ciclo — só ensina o app a reconhecer esses` +
        ` outros nomes como sendo a mesma disciplina, pra contar certo a taxa de acerto e o histórico.`,
        materia.apelidos || ''
      );
      if (resposta === null) return;

      const apelidos = resposta.split(',').map(a => a.trim()).filter(Boolean).join(', ');
      await db.cicloMaterias.update({ ...materia, apelidos: apelidos || null });
      await reloadState();
      showToast(apelidos ? 'Nomes vinculados com sucesso.' : 'Vínculos removidos.', 'success');
      renderCicloPainelRoute(view, cicloId);
    });
  });
}

/**
 * Registra uma nova rodada de estudo pra uma disciplina, dentro do ciclo:
 * pergunta os minutos, o tipo de estudo e o tópico, e SEMPRE cria um novo
 * registro em db.cicloSessoes (nunca sobrescreve um já existente). Assim,
 * "fiz vídeo, depois fiz exercícios, depois revisão" vira 3 registros
 * separados de hoje — e o gráfico "Tempo por tipo de estudo" soma cada um
 * pelo seu próprio tipo, sem nada se perder ou ser substituído.
 */
async function _registrarRodadaCiclo(materia, view, cicloId) {
  const resposta = prompt(
    `Quantos minutos você quer registrar agora para "${materia.nome}"?\n` +
    `(Isso soma ao tempo já estudado — não substitui nada. Pode deixar 0 se só quer marcar o tipo/tópico.)`,
    ''
  );
  if (resposta === null || resposta.trim() === '') return;
  const minutos = Number(resposta.replace(',', '.'));
  if (isNaN(minutos) || minutos < 0) { showToast('Digite um número válido de minutos.', 'error'); return; }

  const topico = _perguntarTopico(materia.nome);
  if (topico === undefined) return; // cancelou
  const tipoEstudo = _perguntarTipoEstudo();

  if (minutos > 0) {
    materia.minutosFeitos += minutos;
    await db.cicloMaterias.update(materia);
  }
  await db.cicloSessoes.add({
    cicloMateriaId: materia.id, nome: materia.nome, data: todayISO(),
    minutos, inicio: new Date().toISOString(), fim: new Date().toISOString(),
    ajusteManual: true, tipoEstudo, topico
  });
  await reloadState();
  showToast(`Registrado: ${_formatarMinutos(minutos)} em ${materia.nome}.`, 'success');
  renderCicloPainelRoute(view, cicloId);
}

/** Card com o total de minutos estudados por tipo (PDF, Vídeo, Exercícios…)
 *  dentro deste ciclo NO DIA DE HOJE, com um gráfico de rosca + lista com percentuais. */
function _renderCardTempoPorTipo(materiasDoCiclo) {
  const container = $('#card-tempo-por-tipo');
  if (!container) return;

  const totais = _tempoPorTipoEstudo(materiasDoCiclo, todayISO());
  if (!totais.length) {
    container.innerHTML = `
      <div class="card-title">Tempo por tipo de estudo (hoje)</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Ainda não há sessões de hoje com tipo de estudo registrado. Escolha um tipo ao concluir
        uma sessão, no ajuste manual de tempo, ou no botão "Editar tipo" de cada disciplina.
      </p>
    `;
    return;
  }

  const totalGeral = totais.reduce((soma, [, minutos]) => soma + minutos, 0);
  container.innerHTML = `
    <div class="card-title">Tempo por tipo de estudo (hoje)</div>
    <div class="chart-wrap" style="max-width:280px;margin:8px auto;"><canvas id="chart-tipo-estudo"></canvas></div>
    <div class="mt-8">
      ${totais.map(([tipo, minutos], i) => `
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

  renderStatusDoughnutChart('chart-tipo-estudo', {
    labels: totais.map(([tipo]) => tipo),
    values: totais.map(([, minutos]) => Math.round(minutos)),
    colors: totais.map((_, i) => _CORES_TIPO_ESTUDO[i % _CORES_TIPO_ESTUDO.length])
  });
}

function _renderCicloSessaoAtivaCard(sessaoAtiva) {
  const materia = state.cicloMaterias.find(m => m.id === sessaoAtiva.materiaId);
  const pausado = !!sessaoAtiva.pausadoEm;
  return `
    <div class="card mb-16 ciclo-sessao-ativa">
      <div class="card-title" style="margin-bottom:2px;">${pausado ? 'Pausado' : 'Estudando agora'}</div>
      <div style="font-size:15px; font-weight:700;">${escapeHtml(materia ? materia.nome : '')}</div>
      <div class="ciclo-cronometro ${pausado ? 'pausado' : ''}" id="ciclo-cronometro">00:00</div>
      <div class="form-row mt-8" style="max-width:260px;margin-left:auto;margin-right:auto;">
        <label>Tipo de estudo (opcional)</label>
        <select id="ciclo-tipo-estudo">
          <option value="">— não informar —</option>
          ${TIPOS_ESTUDO_CICLO.map(t => `<option value="${escapeHtml(t)}" ${sessaoAtiva.tipoEstudo === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row mt-8" style="max-width:260px;margin-left:auto;margin-right:auto;">
        <label>Tópico/assunto estudado (opcional)</label>
        <div class="autocomplete-wrap">
          <input type="text" id="ciclo-topico-estudo" autocomplete="off" placeholder="Ex: Atos administrativos" value="${escapeHtml(sessaoAtiva.topico || '')}">
        </div>
      </div>
      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        ${pausado
          ? `<button class="btn btn-primary" id="btn-retomar-sessao">Retomar</button>`
          : `<button class="btn" id="btn-pausar-sessao">Pausar</button>`
        }
        <button class="btn btn-primary" id="btn-concluir-sessao">Concluir sessão</button>
        <button class="btn btn-ghost" id="btn-cancelar-sessao">Cancelar</button>
      </div>
    </div>
  `;
}

/**
 * Compara o nome de uma disciplina de tentativa com uma disciplina do
 * Ciclo de Estudos, considerando também os APELIDOS que o usuário tiver
 * cadastrado para ela (ex.: disciplina do ciclo = "Administração
 * Financeira e Orçamentária - AFO", apelido = "AFO"). Isso resolve o caso
 * comum de usar um nome mais curto/abreviado ao registrar tentativas.
 */
function _materiaCasaComDisciplina(materia, nomeDisciplina) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const alvo = norm(nomeDisciplina);
  if (!alvo) return false;
  if (norm(materia.nome) === alvo) return true;
  const apelidos = (materia.apelidos || '').split(',').map(a => norm(a)).filter(Boolean);
  return apelidos.includes(alvo);
}

function _renderCicloLinhaMateria(m, materiasDoCiclo, minutosCicloTotal, sessaoAtiva, indice = 0, nomeConcurso = '') {
  const meta = _cicloMetaMinutos(m, materiasDoCiclo, minutosCicloTotal);
  const pct = meta ? Math.min(100, (m.minutosFeitos / meta) * 100) : 0;
  const concluida = meta > 0 && m.minutosFeitos >= meta;
  const emAndamento = sessaoAtiva && sessaoAtiva.materiaId === m.id;
  const cor = _CORES_MATERIA_CICLO[indice % _CORES_MATERIA_CICLO.length];

  // Taxa de acerto geral dessa disciplina, casando pelo nome (ou apelido)
  // com as tentativas já registradas — e SÓ dentro do concurso deste ciclo
  // (ex.: "TCDF"), pra não misturar com registros de outros concursos ou
  // com o histórico importado em massa do Gran Questões (sem concurso).
  const norm = (s) => (s || '').trim().toLowerCase();
  const tentativasDaMateria = state.tentativas.filter(t =>
    _materiaCasaComDisciplina(m, t.disciplina) &&
    (nomeConcurso ? norm(t.concurso) === norm(nomeConcurso) : true)
  );
  const totalQuestoesMateria = tentativasDaMateria.reduce((soma, t) => soma + (t.numQuestoes || 0), 0);
  const totalAcertosMateria = tentativasDaMateria.reduce((soma, t) => soma + (t.acertos || 0), 0);
  const taxaMateria = totalQuestoesMateria > 0 ? (totalAcertosMateria / totalQuestoesMateria) * 100 : null;

  // Conta quantas vezes essa disciplina já foi estudada de verdade (em
  // qualquer volta do ciclo, não só a atual — por isso usa o histórico de
  // sessões, já que minutosFeitos zera a cada volta nova). "Já estudada"
  // considera QUALQUER evidência: sessões do ciclo, minutosFeitos da volta
  // atual, OU questões já registradas — mesmo que você nunca tenha usado
  // o cronômetro do Ciclo de Estudos nessa disciplina.
  const sessoesComTempo = state.cicloSessoes.filter(s => s.cicloMateriaId === m.id && (s.minutos || 0) > 0);
  const vezesVista = sessoesComTempo.length;
  const tempoHistoricoSessoes = sessoesComTempo.reduce((soma, s) => soma + s.minutos, 0);
  const jaEstudou = vezesVista > 0 || m.minutosFeitos > 0 || totalQuestoesMateria > 0;

  return `
    <div class="ciclo-materia-row ${emAndamento ? 'ativa' : ''}" style="border-left:4px solid ${cor};">
      <div class="ciclo-materia-topo">
        <span class="ciclo-materia-nome">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${cor};margin-right:7px;"></span>
          ${escapeHtml(m.nome)}
        </span>
        <span class="badge ${concluida ? 'success' : 'muted'}">${concluida ? 'Concluído' : `peso ${m.peso}`}</span>
      </div>
      <div class="mt-4" style="font-size:12px;">
        ${vezesVista > 0
          ? `<span class="text-muted">👁 Vista ${vezesVista}x nesta disciplina · ${_formatarMinutos(tempoHistoricoSessoes)} ao todo (todas as voltas)</span>`
          : m.minutosFeitos > 0
            ? `<span class="text-muted">👁 Já estudada · ${_formatarMinutos(m.minutosFeitos)} registrados nesta volta</span>`
            : totalQuestoesMateria > 0
              ? `<span class="text-muted">👁 Já fez ${totalQuestoesMateria} questão(ões) desta disciplina (sem tempo registrado no Ciclo ainda)</span>`
              : `<span style="color:var(--danger);font-weight:600;">⚠ Ainda não estudada nenhuma vez</span>`
        }
      </div>
      <div class="mt-4" style="font-size:12px;">
        ${taxaMateria !== null
          ? `<span class="text-muted">🎯 Taxa de acertos${nomeConcurso ? ` em ${escapeHtml(nomeConcurso)}` : ''}: <strong style="color:var(--gold);">${fmtPct(taxaMateria)}</strong> (${totalAcertosMateria}/${totalQuestoesMateria} questões)</span>`
          : `<span class="text-muted">🎯 Nenhuma questão registrada ainda${nomeConcurso ? ` para o concurso ${escapeHtml(nomeConcurso)}` : ''} nessa disciplina</span>`
        }
        ${m.apelidos ? `<div class="text-muted" style="margin-top:2px;">🔗 Também conta como: ${escapeHtml(m.apelidos)}</div>` : ''}
      </div>
      <div class="pct-bar-wrap mt-8" style="min-width:auto;">
        <div class="pct-bar" style="flex:1;"><span style="width:${pct}%;background:${cor};"></span></div>
        <span class="num">${_formatarMinutos(m.minutosFeitos)} / ${_formatarMinutos(meta)}</span>
      </div>
      <div class="ciclo-materia-acoes">
        ${emAndamento
          ? `<span class="text-muted" style="font-size:12.5px;align-self:center;">Em andamento…</span>`
          : `<button class="btn btn-sm" data-iniciar="${m.id}" ${sessaoAtiva ? 'disabled' : ''}>Iniciar</button>
             <button class="btn btn-sm btn-ghost" data-manual="${m.id}">Editar tempo</button>
             <button class="btn btn-sm btn-ghost" data-manual-total="${m.id}" title="Corrigir o valor exato, sem somar">Corrigir total</button>
             <button class="btn btn-sm btn-ghost" data-editar-tipo="${m.id}" title="Registra uma nova rodada de estudo, somando ao tempo e marcando o tipo">Registrar tipo</button>
             <button class="btn btn-sm btn-ghost" data-editar-topico="${m.id}" title="Registra uma nova rodada de estudo, somando ao tempo e marcando o tópico">Registrar tópico</button>
             <button class="btn btn-sm btn-ghost" data-vincular-nomes="${m.id}" title="Vincula nomes diferentes usados nas Tentativas a esta disciplina">Vincular nomes</button>`
        }
      </div>
    </div>
  `;
}

function _iniciarCronometroVisual() {
  clearInterval(_cicloTimerInterval);
  function tick() {
    const sessaoAtiva = settings.cicloSessaoAtiva;
    const span = $('#ciclo-cronometro');
    if (!sessaoAtiva || !span) { clearInterval(_cicloTimerInterval); return; }
    const seg = Math.floor(_cicloElapsedMs(sessaoAtiva) / 1000);
    span.textContent = _formatarCronometro(seg);
  }
  tick();
  _cicloTimerInterval = setInterval(tick, 1000);
}

function _pausarSessaoCiclo(view, cicloId) {
  const sessaoAtiva = settings.cicloSessaoAtiva;
  if (!sessaoAtiva || sessaoAtiva.pausadoEm) return;
  settings.cicloSessaoAtiva = { ...sessaoAtiva, pausadoEm: Date.now(), ativo: false };
  saveSettings();
  // Para o timer global
  if (typeof _pararTimerCiclo === 'function') {
    _pararTimerCiclo();
  }
  renderCicloPainelRoute(view, cicloId);
}

function _retomarSessaoCiclo(view, cicloId) {
  const sessaoAtiva = settings.cicloSessaoAtiva;
  if (!sessaoAtiva || !sessaoAtiva.pausadoEm) return;
  const pausadoAgora = Date.now() - sessaoAtiva.pausadoEm;
  settings.cicloSessaoAtiva = {
    ...sessaoAtiva,
    pausadoEm: null,
    tempoPausadoAcumulado: (sessaoAtiva.tempoPausadoAcumulado || 0) + pausadoAgora,
    ativo: true
  };
  saveSettings();
  // Reinicia o timer global
  if (typeof _iniciarTimerCiclo === 'function') {
    _iniciarTimerCiclo();
  }
  renderCicloPainelRoute(view, cicloId);
}

async function _concluirSessaoCiclo(view, cicloId) {
  const sessaoAtiva = settings.cicloSessaoAtiva;
  if (!sessaoAtiva) return;
  clearInterval(_cicloTimerInterval);
  const minutos = _cicloElapsedMs(sessaoAtiva) / 60000;
  const materia = state.cicloMaterias.find(m => m.id === sessaoAtiva.materiaId);
  if (materia && minutos > 0) {
    materia.minutosFeitos += minutos;
    await db.cicloMaterias.update(materia);
    await db.cicloSessoes.add({
      cicloMateriaId: materia.id, nome: materia.nome, data: todayISO(),
      minutos, inicio: new Date(sessaoAtiva.inicio).toISOString(), fim: new Date().toISOString(),
      tipoEstudo: sessaoAtiva.tipoEstudo || null, topico: sessaoAtiva.topico || null
    });
  }
  settings.cicloSessaoAtiva = null;
  saveSettings();
  // Para o timer global
  if (typeof _pararTimerCiclo === 'function') {
    _pararTimerCiclo();
  }
  await reloadState();
  showToast(`Sessão registrada: ${_formatarMinutos(minutos)}`, 'success');
  renderCicloPainelRoute(view, cicloId);
}

function _cancelarSessaoCiclo(view, cicloId) {
  if (!confirm('Cancelar esta sessão sem salvar o tempo estudado?')) return;
  clearInterval(_cicloTimerInterval);
  settings.cicloSessaoAtiva = null;
  renderCicloPainelRoute(view, cicloId);
}
