/**
 * editais.js
 * Módulo de Importação Inteligente de Editais.
 *
 * Responsabilidades:
 *  - Extrair texto de PDF (pdf.js) ou receber texto colado.
 *  - Localizar automaticamente onde começa o conteúdo programático.
 *  - Identificar disciplinas e tópicos por heurística de formatação.
 *  - Mesclar o resultado em um edital existente sem apagar histórico/status.
 *  - Renderizar o quadro Kanban (colunas = disciplinas, cards = tópicos),
 *    com drag-and-drop, filtros e integração com as tentativas registradas.
 *  - Alimentar a seção "Progresso do Edital" do Dashboard.
 *
 * Depende de utilitários globais já definidos em database.js (db, STATUS_TOPICO,
 * STATUS_TOPICO_LABEL), charts.js (renderStatusDoughnutChart) e app.js
 * ($, $$, state, escapeHtml, toBRDate, fmtPct, showToast, calcResumo,
 * calcTendencia, reloadState, openModal/closeModal, router). Esses arquivos
 * são carregados antes deste no index.html, mas mesmo se não fossem, funções
 * só são resolvidas em tempo de chamada — a ordem de <script> não é um problema
 * aqui.
 */

/* ============================================================
   HELPERS DE TEXTO
   ============================================================ */

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function _norm(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function _cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ============================================================
   LEITURA DE PDF (pdf.js)
   ============================================================ */

async function extrairTextoPDF(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let texto = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let linhaAtualY = null;
    let linha = '';
    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (linhaAtualY === null) linhaAtualY = y;
      if (Math.abs(y - linhaAtualY) > 3) {
        texto += linha.trim() + '\n';
        linha = '';
        linhaAtualY = y;
      }
      linha += item.str + ' ';
    });
    if (linha.trim()) texto += linha.trim() + '\n';
    texto += '\n';
  }
  return texto;
}

/* ============================================================
   DETECÇÃO DO INÍCIO DO CONTEÚDO PROGRAMÁTICO
   ============================================================ */

const HEADERS_CONTEUDO_PROGRAMATICO = [
  'conteudo programatico por cargo',
  'conteudo programatico',
  'programa de provas',
  'conteudo das provas',
  'conhecimentos basicos',
  'conhecimentos especificos',
  'anexo i',
  'anexo ii'
];

/** Procura a primeira linha que pareça o início do conteúdo programático. */
function encontrarInicioConteudoProgramatico(texto) {
  const linhas = texto.split('\n');
  let offset = 0;
  for (let i = 0; i < linhas.length; i++) {
    const linhaNorm = _norm(linhas[i]);
    if (linhaNorm.length > 0 && linhaNorm.length <= 80) {
      for (const h of HEADERS_CONTEUDO_PROGRAMATICO) {
        if (linhaNorm.includes(h)) {
          return { index: offset, header: linhas[i].trim() };
        }
      }
    }
    offset += linhas[i].length + 1;
  }
  return null;
}

/* ============================================================
   EXTRAÇÃO DE DISCIPLINAS E TÓPICOS (heurística)
   ============================================================ */

function _pareceTopico(linha) {
  return /^\s*(?:[-•▪◦●*]|\d{1,3}(?:\.\d{1,3})*[.\)]?)\s+\S/.test(linha);
}

function _extrairTextoTopico(linha) {
  return linha.replace(/^\s*(?:[-•▪◦●*]|\d{1,3}(?:\.\d{1,3})*[.\)]?)\s+/, '').trim();
}

function _pareceDisciplina(linha) {
  const t = linha.trim();
  if (!t || t.length > 70) return false;
  if (_pareceTopico(linha)) return false;
  if (/^(https?:\/\/|www\.)/i.test(t)) return false;
  if (/pagina\s*\d+/i.test(_norm(t))) return false;
  if (/^\d+$/.test(t)) return false;
  if (/[,;]$/.test(t)) return false;
  return /^[A-ZÀ-Ý]/.test(t);
}

/** A partir de um texto (já recortado a partir do início do conteúdo programático),
 *  identifica disciplinas (colunas) e tópicos (cards) dentro de cada uma, usando
 *  marcadores/numeração como pista (bom para textos brutos de edital em PDF). */
function _parseHeuristicaMarcadores(texto) {
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const disciplinas = [];
  let atual = null;

  linhas.forEach(linha => {
    if (linha.length > 140) return; // parágrafo longo — provavelmente não é título nem tópico

    if (_pareceTopico(linha)) {
      const nomeTopico = _extrairTextoTopico(linha);
      if (!nomeTopico) return;
      if (!atual) {
        atual = { nome: 'Geral', topicos: [] };
        disciplinas.push(atual);
      }
      const jaExiste = atual.topicos.some(t => _norm(t.nome) === _norm(nomeTopico));
      if (!jaExiste) atual.topicos.push({ nome: nomeTopico });
    } else if (_pareceDisciplina(linha)) {
      const existente = disciplinas.find(d => _norm(d.nome) === _norm(linha));
      atual = existente || { nome: linha, topicos: [] };
      if (!existente) disciplinas.push(atual);
    }
    // linhas que não se encaixam em nenhum padrão são ruído do edital (cronograma, regras etc.) e são ignoradas
  });

  return disciplinas.filter(d => d.topicos.length > 0);
}

const _PALAVRAS_CABECALHO_TABELA = ['disciplina', 'disciplinas', 'topico', 'topicos', 'tópico', 'tópicos', 'assunto', 'assuntos'];

/** Formato 1 (recomendado): uma disciplina por linha, no formato
 *  "Nome da disciplina: tópico 1; tópico 2; tópico 3" (aceita ; ou , como separador). */
function _parseFormatoDoisPontos(texto) {
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  const disciplinas = [];
  let linhasReconhecidas = 0;

  linhas.forEach(linha => {
    const m = linha.match(/^([^:\n]{2,90}):\s*(.+)$/);
    if (!m) return;
    const nome = m[1].trim();
    const topicosStr = m[2].trim();
    if (!nome || !topicosStr) return;

    const topicos = topicosStr.split(/[;,]/).map(s => s.trim()).filter(Boolean);
    if (!topicos.length) return;

    linhasReconhecidas++;
    let disciplina = disciplinas.find(d => _norm(d.nome) === _norm(nome));
    if (!disciplina) { disciplina = { nome, topicos: [] }; disciplinas.push(disciplina); }
    topicos.forEach(tp => {
      if (!disciplina.topicos.some(t => _norm(t.nome) === _norm(tp))) disciplina.topicos.push({ nome: tp });
    });
  });

  // Só aceita este formato se a maioria das linhas realmente bateu no padrão
  // (evita interpretar errado um texto bruto de edital que tenha ":" em outro contexto).
  if (linhasReconhecidas > 0 && linhasReconhecidas >= linhas.length * 0.6) return disciplinas;
  return [];
}

/** Formato 2 (também aceito): disciplina em uma linha sozinha, seguida
 *  imediatamente pela linha com os tópicos separados por ; — o mesmo formato
 *  de quando se cola uma tabela de duas colunas (Disciplina / Tópicos) copiada
 *  do Word, Google Sheets etc. */
function _parseFormatoPares(texto) {
  const linhas = texto.split('\n').map(l => l.trim())
    .filter(Boolean)
    .filter(l => !_PALAVRAS_CABECALHO_TABELA.includes(_norm(l)));

  const disciplinas = [];
  let paresEncontrados = 0;
  let i = 0;
  while (i < linhas.length - 1) {
    const possivelNome = linhas[i];
    const possivelTopicos = linhas[i + 1];
    if (!possivelNome.includes(';') && possivelTopicos.includes(';')) {
      const topicos = possivelTopicos.split(';').map(s => s.trim()).filter(Boolean);
      if (topicos.length >= 2) {
        let disciplina = disciplinas.find(d => _norm(d.nome) === _norm(possivelNome));
        if (!disciplina) { disciplina = { nome: possivelNome, topicos: [] }; disciplinas.push(disciplina); }
        topicos.forEach(tp => {
          if (!disciplina.topicos.some(t => _norm(t.nome) === _norm(tp))) disciplina.topicos.push({ nome: tp });
        });
        paresEncontrados++;
        i += 2;
        continue;
      }
    }
    i++;
  }
  return paresEncontrados > 0 ? disciplinas : [];
}

/** Ponto de entrada da análise de texto: tenta primeiro os dois formatos
 *  simples e confiáveis (colar uma lista organizada); só cai na heurística
 *  de marcadores/números (menos precisa) se o texto parecer mesmo um
 *  despejo bruto de PDF de edital. */
function parseDisciplinasTopicos(texto) {
  const porDoisPontos = _parseFormatoDoisPontos(texto);
  if (porDoisPontos.length) return porDoisPontos;

  const porPares = _parseFormatoPares(texto);
  if (porPares.length) return porPares;

  return _parseHeuristicaMarcadores(texto);
}

/* ============================================================
   MESCLA (não apaga histórico/status já existentes)
   ============================================================ */

/** Mescla disciplinas/tópicos novos dentro de um edital já existente (ou recém-criado),
 *  preservando status e progresso de tópicos que já existiam. */
function mergeEditalTopicos(edital, disciplinasNovas) {
  edital.materias = edital.materias || [];
  let disciplinasAdicionadas = 0;
  let topicosAdicionados = 0;

  disciplinasNovas.forEach(dn => {
    let materia = edital.materias.find(m => _norm(m.nome) === _norm(dn.nome));
    if (!materia) {
      materia = { nome: dn.nome, topicos: [] };
      edital.materias.push(materia);
      disciplinasAdicionadas++;
    }
    (dn.topicos || []).forEach(tp => {
      const existe = materia.topicos.some(t => _norm(t.nome) === _norm(tp.nome));
      if (!existe) {
        materia.topicos.push({
          nome: tp.nome,
          status: (tp.status && STATUS_TOPICO.includes(tp.status)) ? tp.status : 'nao_iniciado'
        });
        topicosAdicionados++;
      }
    });
  });

  return { disciplinasAdicionadas, topicosAdicionados };
}

/* ============================================================
   TELA: IMPORTAR EDITAL (wizard)
   ============================================================ */

let _importParsedDisciplinas = [];

function renderImportarEdital(view) {
  _importParsedDisciplinas = [];

  view.innerHTML = `
    <div class="card mb-12">
      <div class="card-title">Dados do edital</div>
      <div class="form-grid-2">
        <div class="form-row"><label>Nome do edital</label><input type="text" id="imp-nome" placeholder="Ex: Edital TCU 2026"></div>
        <div class="form-row"><label>Concurso</label><input type="text" id="imp-concurso" placeholder="Ex: Tribunal de Contas da União"></div>
      </div>
      <p class="text-muted" style="font-size:13px;margin:0;">Se já existir um edital com o mesmo nome, os tópicos novos serão adicionados a ele — nada do seu histórico é apagado.</p>
    </div>

    <div class="import-tabs">
      <button class="import-tab active" data-tab="texto">Colar texto</button>
      <button class="import-tab" data-tab="pdf">Upload de PDF</button>
      <button class="import-tab" data-tab="json">Importar JSON</button>
    </div>

    <div class="import-panel" data-panel="texto">
      <div class="card mb-12" style="background:var(--surface-2);">
        <div class="card-title" style="font-size:14px;">Formatos aceitos</div>
        <p class="text-muted" style="font-size:13px;margin:0 0 8px;">
          <strong>1) Uma linha por disciplina</strong> — nome, dois-pontos e os tópicos separados por ; ou ,
        </p>
        <pre style="font-size:12.5px;background:var(--surface);padding:8px 10px;border-radius:8px;overflow-x:auto;margin:0 0 10px;">Direito Administrativo: Atos Administrativos; Licitações; Contratos
Direito Constitucional: Poder Constituinte; Controle de Constitucionalidade</pre>
        <p class="text-muted" style="font-size:13px;margin:0 0 8px;">
          <strong>2) Tabela de duas colunas colada</strong> (Disciplina numa linha, tópicos na linha de baixo separados por ;)
        </p>
        <pre style="font-size:12.5px;background:var(--surface);padding:8px 10px;border-radius:8px;overflow-x:auto;margin:0;">Língua Portuguesa
Interpretação de textos; Ortografia; Concordância
Direito Constitucional
Poder Constituinte; Controle de Constitucionalidade</pre>
      </div>
      <div class="form-row">
        <label>Cole aqui o texto (nesse formato)</label>
        <textarea id="imp-texto" rows="10" placeholder="Direito Administrativo: Atos Administrativos; Licitações; Contratos&#10;Direito Constitucional: Poder Constituinte; Controle de Constitucionalidade&#10;..."></textarea>
      </div>
      <button class="btn btn-primary" id="btn-analisar-texto">Analisar texto</button>
    </div>

    <div class="import-panel" data-panel="pdf" hidden>
      <p class="text-muted" style="font-size:13px;">
        A leitura automática de PDF é menos confiável, porque a formatação varia muito de edital para edital.
        Se puder, prefira copiar o conteúdo programático do PDF e colar na aba "Colar texto" no formato acima —
        funciona muito melhor.
      </p>
      <div class="form-row">
        <label>Selecione o arquivo PDF do edital</label>
        <input type="file" id="imp-pdf" accept="application/pdf">
      </div>
      <button class="btn btn-primary" id="btn-analisar-pdf">Extrair do PDF</button>
    </div>

    <div class="import-panel" data-panel="json" hidden>
      <div class="form-row">
        <label>Selecione o arquivo JSON exportado pelo sistema</label>
        <input type="file" id="imp-json" accept="application/json">
      </div>
      <button class="btn btn-primary" id="btn-analisar-json">Importar JSON</button>
    </div>

    <div id="import-preview-root" class="mt-12"></div>
  `;

  $$('.import-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.import-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.import-panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });

  $('#btn-analisar-texto').addEventListener('click', () => {
    const texto = $('#imp-texto').value;
    if (!texto.trim()) { showToast('Cole o texto do edital antes de analisar.', 'danger'); return; }
    iniciarAnalise(texto);
  });

  $('#btn-analisar-pdf').addEventListener('click', async () => {
    const file = $('#imp-pdf').files[0];
    if (!file) { showToast('Selecione um arquivo PDF.', 'danger'); return; }
    if (typeof pdfjsLib === 'undefined') { showToast('Leitor de PDF não carregou. Verifique sua conexão e tente novamente.', 'danger'); return; }
    showToast('Lendo PDF...', '');
    try {
      const texto = await extrairTextoPDF(file);
      iniciarAnalise(texto);
    } catch (err) {
      showToast('Não foi possível ler este PDF.', 'danger');
    }
  });

  $('#btn-analisar-json').addEventListener('click', async () => {
    const file = $('#imp-json').files[0];
    if (!file) { showToast('Selecione um arquivo JSON.', 'danger'); return; }
    try {
      const texto = await file.text();
      const data = JSON.parse(texto);
      const origem = data.materias || data.disciplinas || [];
      const disciplinas = origem.map(m => ({
        nome: m.nome,
        topicos: (m.topicos || []).map(t => (typeof t === 'string' ? { nome: t } : { nome: t.nome, status: t.status }))
      })).filter(d => d.nome);

      if (!disciplinas.length) { showToast('Este JSON não contém disciplinas/tópicos reconhecíveis.', 'danger'); return; }

      _importParsedDisciplinas = disciplinas;
      if (!$('#imp-nome').value) $('#imp-nome').value = data.nome || '';
      if (!$('#imp-concurso').value) $('#imp-concurso').value = data.concurso || '';
      renderPreview(null);
    } catch (err) {
      showToast('Arquivo JSON inválido.', 'danger');
    }
  });

  function iniciarAnalise(texto) {
    // Primeiro tenta os formatos simples e confiáveis (lista organizada colada
    // diretamente) — não depende de achar "onde começa o edital".
    const limpo = _parseFormatoDoisPontos(texto).length ? _parseFormatoDoisPontos(texto) : _parseFormatoPares(texto);
    if (limpo.length) {
      _importParsedDisciplinas = limpo;
      renderPreview(null);
      return;
    }

    // Só cai aqui para texto bruto de edital em PDF (com cronograma, cabeçalhos
    // de página etc. misturados) — tenta achar o início do conteúdo programático.
    const achado = encontrarInicioConteudoProgramatico(texto);
    if (achado) {
      _importParsedDisciplinas = _parseHeuristicaMarcadores(texto.slice(achado.index));
      renderPreview(achado.header);
    } else {
      renderEscolhaInicio(texto);
    }
  }

  function renderEscolhaInicio(texto) {
    const linhas = texto.split('\n');
    const root = $('#import-preview-root');
    root.innerHTML = `
      <div class="card">
        <div class="card-title">Onde começa o conteúdo programático?</div>
        <p class="text-muted" style="font-size:13.5px;margin-top:0;">Não encontramos automaticamente o início do conteúdo programático neste texto. Clique na linha em que ele começa.</p>
        <div class="import-lines">
          ${linhas.map((l, i) => `<div class="import-line" data-linha="${i}">${escapeHtml(l) || '&nbsp;'}</div>`).join('')}
        </div>
      </div>
    `;
    $$('.import-line', root).forEach(el => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.linha);
        const textoRestante = linhas.slice(i).join('\n');
        _importParsedDisciplinas = _parseHeuristicaMarcadores(textoRestante);
        renderPreview(linhas[i].trim());
      });
    });
  }

  function renderPreview(headerDetectado) {
    const root = $('#import-preview-root');
    if (!_importParsedDisciplinas.length) {
      root.innerHTML = `<div class="empty-state"><p>Não conseguimos identificar disciplinas e tópicos automaticamente. Tente colar um texto mais completo do edital, ou cadastre manualmente na tela de Editais.</p></div>`;
      return;
    }

    const totalTopicos = _importParsedDisciplinas.reduce((acc, d) => acc + d.topicos.length, 0);

    root.innerHTML = `
      <div class="card mb-12">
        <div class="card-title">Revisar antes de importar</div>
        ${headerDetectado ? `<p class="text-muted" style="font-size:13px;margin-top:0;">Conteúdo programático localizado a partir de: <strong>${escapeHtml(headerDetectado)}</strong></p>` : ''}
        <p class="text-muted" style="font-size:13.5px;">${_importParsedDisciplinas.length} disciplina(s) e ${totalTopicos} tópico(s) identificados. Ajuste os nomes ou remova o que não for relevante antes de confirmar.</p>
      </div>
      <div id="preview-disciplinas"></div>
      <div class="flex gap-8 mt-12" style="flex-wrap:wrap;">
        <button class="btn" id="btn-add-disciplina-preview">+ Adicionar disciplina</button>
        <button class="btn btn-primary btn-block" id="btn-confirmar-import" style="flex:1;min-width:220px;">Confirmar e importar</button>
      </div>
    `;

    desenharListaPreview();

    $('#btn-add-disciplina-preview').addEventListener('click', () => {
      _importParsedDisciplinas.push({ nome: 'Nova disciplina', topicos: [] });
      desenharListaPreview();
    });

    $('#btn-confirmar-import').addEventListener('click', async () => {
      coletarEdicoesDoDOM();
      const disciplinasFinal = _importParsedDisciplinas
        .map(d => ({
          nome: d.nome.trim(),
          topicos: d.topicos.filter(t => t.nome.trim()).map(t => ({ nome: t.nome.trim(), status: t.status }))
        }))
        .filter(d => d.nome && d.topicos.length);

      if (!disciplinasFinal.length) { showToast('Adicione ao menos uma disciplina com tópicos.', 'danger'); return; }

      const nome = $('#imp-nome').value.trim() || 'Edital sem nome';
      const concurso = $('#imp-concurso').value.trim();

      let edital = state.editais.find(e => _norm(e.nome) === _norm(nome));
      let novo = false;
      if (!edital) {
        edital = { nome, concurso, materias: [] };
        novo = true;
      }
      const { disciplinasAdicionadas, topicosAdicionados } = mergeEditalTopicos(edital, disciplinasFinal);

      if (novo) {
        edital.id = await db.editais.add(edital);
      } else {
        if (concurso) edital.concurso = concurso;
        await db.editais.update(edital);
      }

      await reloadState();
      showToast(`Edital importado: ${disciplinasAdicionadas} disciplina(s) e ${topicosAdicionados} tópico(s) novo(s).`, 'success');
      location.hash = `#/editais/${edital.id}`;
    });
  }

  function desenharListaPreview() {
    const wrap = $('#preview-disciplinas');
    wrap.innerHTML = _importParsedDisciplinas.map((d, di) => `
      <div class="card mb-12" data-disciplina-idx="${di}">
        <div class="flex gap-8 mb-12" style="justify-content:space-between;">
          <input type="text" class="preview-disciplina-nome" value="${escapeHtml(d.nome)}" style="font-weight:700;font-family:var(--font-display);border:none;background:transparent;font-size:15px;flex:1;">
          <button class="icon-btn" data-remove-disciplina="${di}" title="Remover disciplina">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7zM9 4h6l1 2H8zM9 10v8M12 10v8M15 10v8"/></svg>
          </button>
        </div>
        <div class="preview-topicos">
          ${d.topicos.map((t, ti) => `
            <div class="preview-topico-row" data-topico-idx="${ti}">
              <input type="text" class="preview-topico-nome" value="${escapeHtml(t.nome)}">
              <button class="icon-btn" data-remove-topico="${di}:${ti}" title="Remover tópico">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-add-topico="${di}">+ Adicionar tópico</button>
      </div>
    `).join('');

    $$('[data-remove-disciplina]', wrap).forEach(btn => btn.addEventListener('click', () => {
      coletarEdicoesDoDOM();
      _importParsedDisciplinas.splice(Number(btn.dataset.removeDisciplina), 1);
      desenharListaPreview();
    }));
    $$('[data-remove-topico]', wrap).forEach(btn => btn.addEventListener('click', () => {
      coletarEdicoesDoDOM();
      const [di, ti] = btn.dataset.removeTopico.split(':').map(Number);
      _importParsedDisciplinas[di].topicos.splice(ti, 1);
      desenharListaPreview();
    }));
    $$('[data-add-topico]', wrap).forEach(btn => btn.addEventListener('click', () => {
      coletarEdicoesDoDOM();
      _importParsedDisciplinas[Number(btn.dataset.addTopico)].topicos.push({ nome: 'Novo tópico' });
      desenharListaPreview();
    }));
  }

  function coletarEdicoesDoDOM() {
    const wrap = $('#preview-disciplinas');
    if (!wrap) return;
    $$('[data-disciplina-idx]', wrap).forEach(card => {
      const di = Number(card.dataset.disciplinaIdx);
      const nomeInput = $('.preview-disciplina-nome', card);
      if (nomeInput && _importParsedDisciplinas[di]) _importParsedDisciplinas[di].nome = nomeInput.value;
      $$('.preview-topico-row', card).forEach((row, ti) => {
        const input = $('.preview-topico-nome', row);
        if (input && _importParsedDisciplinas[di] && _importParsedDisciplinas[di].topicos[ti]) {
          _importParsedDisciplinas[di].topicos[ti].nome = input.value;
        }
      });
    });
  }
}

/* ============================================================
   ESTATÍSTICAS POR TÓPICO (integração com as tentativas)
   ============================================================ */

/** Estatísticas de um tópico a partir das tentativas cujo "assunto" bate com o nome do tópico. */
function calcTopicoStats(nomeTopico) {
  const lista = state.tentativas.filter(t => _norm(t.assunto) === _norm(nomeTopico));
  if (!lista.length) return null;
  const ordenada = [...lista].sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.id - b.id));
  const resumo = calcResumo(lista);
  const melhor = ordenada.reduce((m, x) => (x.taxa > m.taxa ? x : m), ordenada[0]).taxa;
  const ultima = ordenada[ordenada.length - 1];
  const tendencia = calcTendencia(ordenada);
  return {
    tentativas: resumo.tentativas,
    questoes: resumo.total,
    taxa: resumo.taxa,
    melhor,
    ultima: ultima.taxa,
    ultimaData: ultima.data,
    tendencia
  };
}

/* ============================================================
   PROGRESSO (por edital e geral, para o Dashboard)
   ============================================================ */

function calcProgressoEdital(edital) {
  let total = 0, naoIniciado = 0, emEstudo = 0, emRevisao = 0, dominado = 0;
  (edital.materias || []).forEach(m => {
    (m.topicos || []).forEach(t => {
      total++;
      if (t.status === 'em_estudo') emEstudo++;
      else if (t.status === 'em_revisao') emRevisao++;
      else if (t.status === 'dominado') dominado++;
      else naoIniciado++;
    });
  });
  const pct = total ? (dominado / total) * 100 : 0;
  return { total, naoIniciado, emEstudo, emRevisao, dominado, pct };
}

function calcProgressoGeralEditais() {
  let disciplinas = 0, total = 0, naoIniciado = 0, emEstudo = 0, emRevisao = 0, dominado = 0;
  state.editais.forEach(e => {
    disciplinas += (e.materias || []).length;
    const p = calcProgressoEdital(e);
    total += p.total; naoIniciado += p.naoIniciado; emEstudo += p.emEstudo; emRevisao += p.emRevisao; dominado += p.dominado;
  });
  const pct = total ? (dominado / total) * 100 : 0;
  return { disciplinas, total, naoIniciado, emEstudo, emRevisao, dominado, estudados: total - naoIniciado, pendentes: naoIniciado, pct };
}

/** HTML da seção "Progresso do Edital" a ser inserida no Dashboard (app.js chama isso). */
function buildDashboardEditalHTML() {
  if (!state.editais.length) return '';
  const p = calcProgressoGeralEditais();
  if (!p.total) return '';
  return `
    <div class="section-title">Progresso do Edital</div>
    <div class="grid-2 mb-12">
      <div class="stat-grid" style="margin-bottom:0;">
        <div class="stat-card"><div class="label">Disciplinas</div><div class="value">${p.disciplinas}</div></div>
        <div class="stat-card"><div class="label">Total de tópicos</div><div class="value">${p.total}</div></div>
        <div class="stat-card info"><div class="label">Tópicos estudados</div><div class="value">${p.estudados}</div></div>
        <div class="stat-card success"><div class="label">Tópicos dominados</div><div class="value">${p.dominado}</div></div>
        <div class="stat-card danger"><div class="label">Tópicos pendentes</div><div class="value">${p.pendentes}</div></div>
        <div class="stat-card gold"><div class="label">% concluído</div><div class="value">${fmtPct(p.pct)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Status dos tópicos</div>
        <div class="chart-wrap"><canvas id="chart-progresso-edital"></canvas></div>
      </div>
    </div>
  `;
}

/** Desenha o gráfico da seção acima. Precisa ser chamado depois do HTML estar no DOM. */
function initDashboardEditalChart() {
  if (!$('#chart-progresso-edital')) return;
  const p = calcProgressoGeralEditais();
  renderStatusDoughnutChart('chart-progresso-edital', {
    labels: [STATUS_TOPICO_LABEL.nao_iniciado, STATUS_TOPICO_LABEL.em_estudo, STATUS_TOPICO_LABEL.em_revisao, STATUS_TOPICO_LABEL.dominado],
    values: [p.naoIniciado, p.emEstudo, p.emRevisao, p.dominado],
    colors: [_cssVar('--text-faint'), _cssVar('--info'), _cssVar('--gold'), _cssVar('--success')]
  });
}

/* ============================================================
   TELA: DETALHE DO EDITAL — QUADRO KANBAN
   ============================================================ */

let _kanbanEditalId = null;
let _kanbanFiltro = { busca: '', disciplina: 'todas', status: 'todos', percentual: 'todos' };

function renderEditalDetalhe(view, idStr) {
  const id = Number(idStr);
  if (_kanbanEditalId !== id) {
    _kanbanFiltro = { busca: '', disciplina: 'todas', status: 'todos', percentual: 'todos' };
    _kanbanEditalId = id;
  }

  const edital = state.editais.find(e => e.id === id);
  if (!edital) {
    view.innerHTML = '<div class="empty-state"><p>Edital não encontrado.</p></div>';
    return;
  }
  edital.materias = edital.materias || [];
  const prog = calcProgressoEdital(edital);

  view.innerHTML = `
    <div class="flex mb-12" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <a href="#/editais" class="btn btn-ghost btn-sm">&larr; Voltar</a>
      <div class="flex gap-8" style="flex-wrap:wrap;">
        <a href="#/importar-edital" class="btn btn-sm">Importar mais tópicos</a>
        <button class="btn btn-sm" id="btn-exportar-edital">Exportar JSON</button>
        <button class="btn btn-danger btn-sm" id="btn-del-edital">Excluir edital</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="label">Disciplinas</div><div class="value">${edital.materias.length}</div></div>
      <div class="stat-card"><div class="label">Tópicos</div><div class="value">${prog.total}</div></div>
      <div class="stat-card info"><div class="label">Em estudo</div><div class="value">${prog.emEstudo}</div></div>
      <div class="stat-card gold"><div class="label">Em revisão</div><div class="value">${prog.emRevisao}</div></div>
      <div class="stat-card success"><div class="label">Dominados</div><div class="value">${prog.dominado}</div></div>
      <div class="stat-card gold"><div class="label">% concluído</div><div class="value">${fmtPct(prog.pct)}</div></div>
    </div>

    <div class="kanban-toolbar">
      <input type="text" id="kanban-busca" class="search-input" placeholder="Pesquisar tópico..." value="${escapeHtml(_kanbanFiltro.busca)}">
      <select id="kanban-filtro-disciplina">
        <option value="todas">Todas as disciplinas</option>
        ${edital.materias.map(m => `<option value="${escapeHtml(m.nome)}" ${_kanbanFiltro.disciplina === m.nome ? 'selected' : ''}>${escapeHtml(m.nome)}</option>`).join('')}
      </select>
      <select id="kanban-filtro-status">
        <option value="todos">Todos os status</option>
        ${STATUS_TOPICO.map(s => `<option value="${s}" ${_kanbanFiltro.status === s ? 'selected' : ''}>${STATUS_TOPICO_LABEL[s]}</option>`).join('')}
      </select>
      <select id="kanban-filtro-percentual">
        <option value="todos">Qualquer % de acerto</option>
        <option value="80-100" ${_kanbanFiltro.percentual === '80-100' ? 'selected' : ''}>80% ou mais</option>
        <option value="50-79" ${_kanbanFiltro.percentual === '50-79' ? 'selected' : ''}>Entre 50% e 79%</option>
        <option value="0-49" ${_kanbanFiltro.percentual === '0-49' ? 'selected' : ''}>Abaixo de 50%</option>
        <option value="sem-dados" ${_kanbanFiltro.percentual === 'sem-dados' ? 'selected' : ''}>Sem tentativas ainda</option>
      </select>
    </div>

    <div class="kanban-board" id="kanban-board"></div>
  `;

  $('#btn-del-edital').addEventListener('click', async () => {
    if (!confirm('Excluir este edital? O quadro será apagado (as tentativas registradas continuam preservadas nas estatísticas).')) return;
    await db.editais.remove(id);
    await reloadState();
    showToast('Edital excluído.', 'danger');
    location.hash = '#/editais';
  });

  $('#btn-exportar-edital').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(edital, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edital-${_norm(edital.nome).replace(/\s+/g, '-') || 'edital'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Edital exportado.', 'success');
  });

  $('#kanban-busca').addEventListener('input', (e) => { _kanbanFiltro.busca = e.target.value; desenharBoard(); });
  $('#kanban-filtro-disciplina').addEventListener('change', (e) => { _kanbanFiltro.disciplina = e.target.value; desenharBoard(); });
  $('#kanban-filtro-status').addEventListener('change', (e) => { _kanbanFiltro.status = e.target.value; desenharBoard(); });
  $('#kanban-filtro-percentual').addEventListener('change', (e) => { _kanbanFiltro.percentual = e.target.value; desenharBoard(); });

  desenharBoard();

  function passaFiltro(topico, stats) {
    const termo = _kanbanFiltro.busca.trim().toLowerCase();
    if (termo && !topico.nome.toLowerCase().includes(termo)) return false;
    if (_kanbanFiltro.status !== 'todos' && topico.status !== _kanbanFiltro.status) return false;
    if (_kanbanFiltro.percentual !== 'todos') {
      if (_kanbanFiltro.percentual === 'sem-dados') {
        if (stats) return false;
      } else {
        if (!stats) return false;
        const [min, max] = _kanbanFiltro.percentual.split('-').map(Number);
        if (stats.taxa < min || stats.taxa > max) return false;
      }
    }
    return true;
  }

  function desenharBoard() {
    const board = $('#kanban-board');
    const scrollLeftAnterior = board.scrollLeft;

    const materiasFiltradas = _kanbanFiltro.disciplina === 'todas'
      ? edital.materias
      : edital.materias.filter(m => m.nome === _kanbanFiltro.disciplina);

    board.innerHTML = materiasFiltradas.map((m) => {
      const mi = edital.materias.indexOf(m);
      const cardsHtml = m.topicos.map((t, ti) => {
        const stats = calcTopicoStats(t.nome);
        if (!passaFiltro(t, stats)) return '';
        return renderKanbanCard(t, mi, ti, stats);
      }).join('');
      return `
        <div class="kanban-col">
          <div class="kanban-col-head">
            <h3>${escapeHtml(m.nome)}</h3>
            <div class="kanban-col-head-right">
              <span class="kanban-col-count">${m.topicos.length}</span>
              <button class="kanban-col-add-btn" data-add-topico-mi="${mi}" title="Adicionar novo tópico">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
              </button>
              <button class="kanban-col-menu-btn" data-menu-mi="${mi}" title="Opções da disciplina">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z"/></svg>
              </button>
              <div class="kanban-col-menu" data-menu-alvo="${mi}">
                <button data-renomear-mi="${mi}">Renomear disciplina</button>
                <button class="danger" data-remover-mi="${mi}">Remover disciplina</button>
              </div>
            </div>
          </div>
          <div class="kanban-col-body" data-drop-mi="${mi}">${cardsHtml || '<div class="kanban-col-empty">Nenhum tópico neste filtro.</div>'}</div>
        </div>
      `;
    }).join('') || '<div class="empty-state"><p>Nenhuma disciplina cadastrada neste edital ainda.</p></div>';

    board.scrollLeft = scrollLeftAnterior;

    $$('.kanban-status-select', board).forEach(sel => {
      sel.addEventListener('change', async () => {
        const mi = Number(sel.dataset.mi), ti = Number(sel.dataset.ti);
        edital.materias[mi].topicos[ti].status = sel.value;
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });

    // ===== EDIÇÃO INLINE DE TÍTULO =====
    $$('.kanban-card-titulo', board).forEach(span => {
      span.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const mi = Number(span.dataset.mi), ti = Number(span.dataset.ti);
        const topicoAtual = edital.materias[mi].topicos[ti].nome;
        const novoNome = prompt('Editar nome do tópico:', topicoAtual);
        if (novoNome && novoNome.trim() && novoNome.trim() !== topicoAtual) {
          edital.materias[mi].topicos[ti].nome = novoNome.trim();
          await db.editais.update(edital);
          await reloadState();
          desenharBoard();
          showToast('Tópico renomeado.', 'success');
        }
      });
    });

    // ===== MENU DE CARD (Deletar, Editar Nome, Mover, Estudar) =====
    $$('.kanban-card-menu-btn', board).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.menuCardMi), ti = Number(btn.dataset.menuCardTi);
        const menu = $(`[data-menu-alvo-card="${mi}-${ti}"]`, board);
        if (menu) menu.classList.toggle('active');
      });
    });

    $$('[data-deletar-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.deletarMi), ti = Number(btn.dataset.deletarTi);
        const nomeTopico = edital.materias[mi].topicos[ti].nome;
        if (!confirm(`Deletar tópico "${nomeTopico}"? Esta ação não pode ser desfeita.`)) return;
        edital.materias[mi].topicos.splice(ti, 1);
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
        showToast('Tópico deletado.', 'danger');
      });
    });

    $$('[data-editar-nome-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.editarNomeMi), ti = Number(btn.dataset.editarNomeTi);
        const topicoAtual = edital.materias[mi].topicos[ti].nome;
        const novoNome = prompt('Novo nome:', topicoAtual);
        if (novoNome && novoNome.trim() && novoNome.trim() !== topicoAtual) {
          edital.materias[mi].topicos[ti].nome = novoNome.trim();
          await db.editais.update(edital);
          await reloadState();
          desenharBoard();
          showToast('Tópico renomeado.', 'success');
        }
      });
    });

    $$('[data-mover-para-cima-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.moverParaCimaMi), ti = Number(btn.dataset.moverParaCimaTi);
        if (ti === 0) {
          showToast('Já é o primeiro tópico desta disciplina.', 'info');
          return;
        }
        const temp = edital.materias[mi].topicos[ti];
        edital.materias[mi].topicos[ti] = edital.materias[mi].topicos[ti - 1];
        edital.materias[mi].topicos[ti - 1] = temp;
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });

    $$('[data-mover-para-baixo-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.moverParaBaixoMi), ti = Number(btn.dataset.moverParaBaixoTi);
        if (ti === edital.materias[mi].topicos.length - 1) {
          showToast('Já é o último tópico desta disciplina.', 'info');
          return;
        }
        const temp = edital.materias[mi].topicos[ti];
        edital.materias[mi].topicos[ti] = edital.materias[mi].topicos[ti + 1];
        edital.materias[mi].topicos[ti + 1] = temp;
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });

    $$('[data-estudar-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.estudarMi), ti = Number(btn.dataset.estudarTi);
        const topico = edital.materias[mi].topicos[ti];
        const disciplina = edital.materias[mi].nome;
        showToast(`Iniciando sessão de estudo: ${disciplina} > ${topico.nome}`, 'success');
        // Quando houver integração com Ciclo de Estudos, chamar a função pra iniciar sessão aqui
        // Por enquanto, só notifica
      });
    });

    $$('.kanban-checkbox', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.checkMi), ti = Number(btn.dataset.checkTi);
        const topico = edital.materias[mi].topicos[ti];
        topico.status = topico.status === 'dominado' ? 'nao_iniciado' : 'dominado';
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });

    $$('[data-expand-mi]', board).forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const mi = el.dataset.expandMi, ti = el.dataset.expandTi;
        const detalhe = $(`#kb-detalhe-${mi}-${ti}`, board);
        if (detalhe) detalhe.hidden = !detalhe.hidden;
      });
    });

    $$('.kanban-col-menu-btn', board).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = $(`.kanban-col-menu[data-menu-alvo="${btn.dataset.menuMi}"]`, board);
        const jaAberto = menu.classList.contains('show');
        $$('.kanban-col-menu', board).forEach(m => m.classList.remove('show'));
        if (!jaAberto) menu.classList.add('show');
      });
    });
    document.addEventListener('click', () => $$('.kanban-col-menu', board).forEach(m => m.classList.remove('show')));

    $$('[data-renomear-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.renomearMi);
        const materia = edital.materias[mi];
        const novoNome = prompt('Novo nome da disciplina:', materia.nome);
        if (!novoNome || !novoNome.trim() || novoNome.trim() === materia.nome) return;
        materia.nome = novoNome.trim();
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });

    $$('[data-remover-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.removerMi);
        const materia = edital.materias[mi];
        if (!confirm(`Remover a disciplina "${materia.nome}" e todos os seus ${materia.topicos.length} tópico(s) deste edital? As tentativas registradas continuam preservadas nas estatísticas.`)) return;
        edital.materias.splice(mi, 1);
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });

    // ===== CRIAR NOVO TÓPICO =====
    $$('[data-add-topico-mi]', board).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.addTopicoMi);
        const novoNome = prompt('Nome do novo tópico:');
        if (!novoNome || !novoNome.trim()) return;
        edital.materias[mi].topicos.push({
          nome: novoNome.trim(),
          status: 'nao_iniciado'
        });
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
        showToast('Tópico criado.', 'success');
      });
    });

    // ===== FECHAR MENUS DE CARD AO CLICAR FORA =====
    document.addEventListener('click', () => $$('.kanban-card-menu', board).forEach(m => m.classList.remove('active')));

    // ===== DRAG-AND-DROP COM REORDENAÇÃO VERTICAL =====
    let dragSource = null;
    $$('.kanban-card', board).forEach(card => {
      card.addEventListener('dragstart', (e) => {
        dragSource = { mi: Number(card.dataset.mi), ti: Number(card.dataset.ti) };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify(dragSource));
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        dragSource = null;
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSource && dragSource.mi === Number(card.dataset.mi)) {
          // Reordenação vertical dentro da mesma coluna
          const rect = card.getBoundingClientRect();
          const meio = rect.top + rect.height / 2;
          if (e.clientY < meio) {
            card.classList.add('drag-over-top');
            card.classList.remove('drag-over-bottom');
          } else {
            card.classList.remove('drag-over-top');
            card.classList.add('drag-over-bottom');
          }
        }
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drag-over-top', 'drag-over-bottom');
        
        if (!dragSource) return;
        const destMi = Number(card.dataset.mi);
        const destTi = Number(card.dataset.ti);
        
        if (dragSource.mi === destMi) {
          // Reordenação vertical na mesma coluna
          const topicos = edital.materias[destMi].topicos;
          if (dragSource.ti !== destTi) {
            const [moved] = topicos.splice(dragSource.ti, 1);
            const novoIndice = dragSource.ti < destTi ? destTi - 1 : destTi;
            topicos.splice(novoIndice, 0, moved);
            await db.editais.update(edital);
            await reloadState();
            desenharBoard();
          }
        } else {
          // Movimento entre colunas
          const [topico] = edital.materias[dragSource.mi].topicos.splice(dragSource.ti, 1);
          edital.materias[destMi].topicos.push(topico);
          await db.editais.update(edital);
          await reloadState();
          desenharBoard();
        }
      });
    });

    $$('.kanban-col-body', board).forEach(colBody => {
      colBody.addEventListener('dragover', (e) => { 
        e.preventDefault(); 
        colBody.classList.add('drag-over'); 
      });
      colBody.addEventListener('dragleave', () => colBody.classList.remove('drag-over'));
      colBody.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        colBody.classList.remove('drag-over');
        const destMi = Number(colBody.dataset.dropMi);
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
        if (!payload || destMi === payload.mi) return;
        const [topico] = edital.materias[payload.mi].topicos.splice(payload.ti, 1);
        edital.materias[destMi].topicos.push(topico);
        await db.editais.update(edital);
        await reloadState();
        desenharBoard();
      });
    });
  }
}

function renderKanbanCard(t, mi, ti, stats) {
  const marcado = t.status === 'dominado';
  const pct = stats ? stats.taxa : 0;
  
  // Buscar conexão com Ciclo de Estudos (por nome normalizado)
  const materiasCiclo = state.ciclos.flatMap(c => c.materias || []);
  const materiaCiclo = materiasCiclo.find(m => _norm(m.nome) === _norm(edital.materias[mi]?.nome));
  const tempoEstudado = materiaCiclo ? _formatarMinutos(materiaCiclo.minutosFeitos || 0) : '—';
  
  return `
    <div class="kanban-card status-${t.status}" draggable="true" data-mi="${mi}" data-ti="${ti}" data-ordem="${t.ordem || ti}">
      <div class="kanban-card-top">
        <button type="button" class="kanban-checkbox ${marcado ? 'checked' : ''}" data-check-mi="${mi}" data-check-ti="${ti}" title="${marcado ? 'Desmarcar como dominado' : 'Marcar como dominado'}">
          ${marcado ? '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="#0B0F14" d="M9 16.2l-3.5-3.6L4 14.1l5 5.1L20 8.1l-1.5-1.5z"/></svg>' : ''}
        </button>
        <span class="kanban-card-titulo" data-mi="${mi}" data-ti="${ti}" title="Clique duas vezes para editar">${escapeHtml(t.nome)}</span>
        <button class="kanban-card-menu-btn" data-menu-card-mi="${mi}" data-menu-card-ti="${ti}" title="Opções do tópico">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z"/></svg>
        </button>
      </div>
      <div class="kanban-card-badges">
        ${stats ? `<span class="kb-badge" title="Você já estudou este tópico"><svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11.5A4.5 4.5 0 1112 7.5a4.5 4.5 0 010 9zM12 10a2 2 0 100 4 2 2 0 000-4z"/></svg></span>` : ''}
        <span class="kb-badge kb-badge-clicavel" data-expand-mi="${mi}" data-expand-ti="${ti}" title="Ver detalhes e mudar status">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z"/></svg>
        </span>
        ${stats ? `<span class="kb-badge" title="Tentativas registradas"><svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg> ${stats.tentativas}</span>` : ''}
        ${stats ? `<span class="kb-badge kb-badge-pct" title="Taxa de acertos">${fmtPct(pct)}</span>` : ''}
        ${materiaCiclo ? `<span class="kb-badge kb-badge-tempo" title="Tempo estudado no Ciclo">⏱️ ${tempoEstudado}</span>` : ''}
      </div>
      <div class="kanban-card-detalhe" id="kb-detalhe-${mi}-${ti}" hidden>
        <select class="kanban-status-select" data-mi="${mi}" data-ti="${ti}">
          ${STATUS_TOPICO.map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${STATUS_TOPICO_LABEL[s]}</option>`).join('')}
        </select>
        ${stats ? `
          <div class="kanban-card-stats">
            <span>Melhor: <strong>${fmtPct(stats.melhor)}</strong></span>
            <span>Última: <strong>${fmtPct(stats.ultima)}</strong></span>
            <span>${stats.questoes} questões</span>
          </div>
          <div class="kanban-card-foot">Última vez: ${toBRDate(stats.ultimaData)} ${stats.tendencia.icone}</div>
        ` : `<div class="kanban-card-stats"><span class="text-muted">Nenhuma tentativa registrada ainda</span></div>`}
      </div>
      <div class="kanban-card-menu" data-menu-alvo-card="${mi}-${ti}">
        <button data-estudar-mi="${mi}" data-estudar-ti="${ti}">▶ Estudar este tópico</button>
        <button data-editar-nome-mi="${mi}" data-editar-nome-ti="${ti}">✏️ Editar nome</button>
        <button data-mover-para-cima-mi="${mi}" data-mover-para-cima-ti="${ti}">⬆️ Mover para cima</button>
        <button data-mover-para-baixo-mi="${mi}" data-mover-para-baixo-ti="${ti}">⬇️ Mover para baixo</button>
        <button class="danger" data-deletar-mi="${mi}" data-deletar-ti="${ti}">🗑️ Deletar tópico</button>
      </div>
    </div>
  `;
}
