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

/* ============================================================
   BÚSSOLA DO EDITAL — visão verticalizada com status automático
   Status calculado a partir de tentativas reais + ciclo de estudos.
   Substitui o antigo Kanban manual.
   ============================================================ */

/** Calcula o status automático de um tópico com base nos dados reais.
 *  Hierarquia: Dominado > Bom > Revisar > Crítico > Não visto.
 *  Critérios:
 *   - Não visto: sem nenhuma tentativa por assunto
 *   - Crítico: taxa < 50% OU > 30 dias sem tentativa
 *   - Revisar: taxa 50–69% OU > 15 dias sem tentativa
 *   - Bom: taxa 70–84% E ≤ 15 dias
 *   - Dominado: taxa ≥ 85% E ≤ 30 dias
 *  "Coberto" (conta no % do edital): pelo menos 1 tentativa E taxa ≥ 50%.
 */
function calcStatusAutomaticoTopico(nomeTopico, nomeDisciplina) {
  const hoje = new Date().toISOString().slice(0, 10);

  // 1) Tentativas por assunto (match exato normalizado)
  const porAssunto = state.tentativas.filter(t => _norm(t.assunto) === _norm(nomeTopico));

  // 2) Tentativas por disciplina (fallback quando não há por assunto)
  const porDisciplina = nomeDisciplina
    ? state.tentativas.filter(t => _norm(t.disciplina) === _norm(nomeDisciplina))
    : [];

  const lista = porAssunto.length ? porAssunto : [];

  if (!lista.length) {
    // Sem nenhuma tentativa vinculada ao tópico
    return { status: 'nao_visto', taxa: null, dias: null, tentativas: 0, questoes: 0, coberto: false };
  }

  const resumo = calcResumo(lista);
  const ordenada = [...lista].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const ultimaData = ordenada[0]?.data;
  const dias = ultimaData
    ? Math.round((new Date(hoje) - new Date(ultimaData + 'T12:00:00')) / 86400000)
    : 999;

  const taxa = resumo.taxa;
  const coberto = taxa >= 50;

  let status;
  if (taxa >= 85 && dias <= 30)       status = 'dominado';
  else if (taxa >= 70 && dias <= 15)  status = 'bom';
  else if (taxa < 50 || dias > 30)    status = 'critico';
  else                                 status = 'revisar';

  return { status, taxa, dias, tentativas: resumo.tentativas, questoes: resumo.total, coberto };
}

/** Calcula o status automático de toda uma disciplina (agregado de tópicos). */
function calcStatusDisciplina(materia) {
  const topicosComDados = (materia.topicos || []).map(t =>
    calcStatusAutomaticoTopico(t.nome, materia.nome)
  );
  const comTentativa = topicosComDados.filter(s => s.tentativas > 0);
  if (!comTentativa.length) return { taxa: null, coberto: 0, total: topicosComDados.length };

  const taxaMedia = comTentativa.reduce((s, x) => s + x.taxa, 0) / comTentativa.length;
  const coberto   = topicosComDados.filter(s => s.coberto).length;
  return { taxa: taxaMedia, coberto, total: topicosComDados.length };
}

const _STATUS_BUSSOLA = {
  dominado:  { label: 'Dominado',   cor: 'var(--success)', icone: '⭐', ordem: 4 },
  bom:       { label: 'Bom',        cor: 'var(--info)',    icone: '✅', ordem: 3 },
  revisar:   { label: 'Revisar',    cor: 'var(--gold)',    icone: '⚠️', ordem: 2 },
  critico:   { label: 'Crítico',    cor: 'var(--danger)',  icone: '🔴', ordem: 1 },
  nao_visto: { label: 'Não visto',  cor: 'var(--border)',  icone: '○',  ordem: 0 }
};

let _bussolaEditalId  = null;
let _bussolaFiltro    = 'todos';   // 'todos' | 'critico' | 'revisar' | 'nao_visto'
let _bussolaExpandido = new Set(); // ids de disciplinas expandidas

function renderEditalDetalhe(view, idStr) {
  const id = Number(idStr);
  if (_bussolaEditalId !== id) {
    _bussolaFiltro    = 'todos';
    _bussolaExpandido = new Set();
    _bussolaEditalId  = id;
  }

  const edital = state.editais.find(e => e.id === id);
  if (!edital) { view.innerHTML = '<div class="empty-state"><p>Edital não encontrado.</p></div>'; return; }

  // Calcular resumo geral
  let totalTopicos = 0, cobertos = 0, criticos = 0, naoVistos = 0;
  (edital.materias || []).forEach(m => {
    (m.topicos || []).forEach(t => {
      totalTopicos++;
      const s = calcStatusAutomaticoTopico(t.nome, m.nome);
      if (s.coberto)               cobertos++;
      if (s.status === 'critico')  criticos++;
      if (s.status === 'nao_visto') naoVistos++;
    });
  });
  const pctCoberto = totalTopicos ? Math.round((cobertos / totalTopicos) * 100) : 0;

  view.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap;">
      <a href="#/editais" class="btn btn-ghost btn-sm">← Todos os editais</a>
      <h2 style="margin:0;font-size:18px;font-family:var(--font-display);">${escapeHtml(edital.nome)}</h2>
    </div>

    <!-- Resumo geral -->
    <div class="stat-grid" style="margin-bottom:20px;">
      <div class="stat-card info">
        <div class="label">Edital coberto</div>
        <div class="value">${pctCoberto}%</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">${cobertos} de ${totalTopicos} tópicos</div>
      </div>
      <div class="stat-card danger">
        <div class="label">Tópicos críticos</div>
        <div class="value">${criticos}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">taxa &lt; 50% ou &gt;30 dias</div>
      </div>
      <div class="stat-card">
        <div class="label">Não vistos</div>
        <div class="value">${naoVistos}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">sem tentativas ainda</div>
      </div>
      <div class="stat-card">
        <div class="label">Total de tópicos</div>
        <div class="value">${totalTopicos}</div>
      </div>
    </div>

    <!-- Barra de progresso geral -->
    <div class="pct-bar-wrap" style="margin-bottom:20px;">
      <div class="pct-bar" style="flex:1;height:8px;border-radius:4px;">
        <span style="width:${pctCoberto}%;background:var(--success);border-radius:4px;"></span>
      </div>
      <span class="num" style="font-size:13px;">${pctCoberto}% coberto</span>
    </div>

    <!-- Filtros rápidos -->
    <div class="filter-bar" id="bussola-filtros" style="margin-bottom:20px;">
      <button class="chip ${_bussolaFiltro === 'todos'     ? 'active' : ''}" data-filtro-bussola="todos">Todos</button>
      <button class="chip ${_bussolaFiltro === 'critico'   ? 'active' : ''}" data-filtro-bussola="critico">🔴 Críticos</button>
      <button class="chip ${_bussolaFiltro === 'revisar'   ? 'active' : ''}" data-filtro-bussola="revisar">⚠️ Revisar</button>
      <button class="chip ${_bussolaFiltro === 'nao_visto' ? 'active' : ''}" data-filtro-bussola="nao_visto">○ Não vistos</button>
    </div>

    <!-- Lista de disciplinas -->
    <div id="bussola-lista"></div>
  `;

  function desenharLista() {
    const lista = $('#bussola-lista');
    if (!lista) return;

    lista.innerHTML = (edital.materias || []).map((m, mi) => {
      const discStats = calcStatusDisciplina(m);
      const taxaDisc  = discStats.taxa != null ? fmtPct(discStats.taxa) : '—';
      const cobPct    = discStats.total ? Math.round((discStats.coberto / discStats.total) * 100) : 0;
      const expandido = _bussolaExpandido.has(mi);

      // Filtra tópicos
      const topicosFiltrados = (m.topicos || []).map((t, ti) => ({
        t, ti, s: calcStatusAutomaticoTopico(t.nome, m.nome)
      })).filter(({ s }) =>
        _bussolaFiltro === 'todos' || s.status === _bussolaFiltro
      );

      // Se filtro ativo e nenhum tópico da disciplina passa → oculta a disciplina
      if (_bussolaFiltro !== 'todos' && !topicosFiltrados.length) return '';

      return `
        <div class="card mb-12 bussola-disc" data-mi="${mi}">
          <!-- Cabeçalho da disciplina (clicável pra expandir) -->
          <div class="bussola-disc-header" data-toggle-disc="${mi}" style="cursor:pointer;">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
              <svg class="bussola-chev ${expandido ? 'open' : ''}" viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M7 10l5 5 5-5z"/>
              </svg>
              <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:700;font-family:var(--font-display);">${escapeHtml(m.nome)}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  <span>${discStats.coberto}/${discStats.total} tópicos cobertos${discStats.taxa != null ? ` · taxa média ${taxaDisc}` : ''}</span>
                  ${(() => {
                    const mc = _resolverMateriaCiclo(m);
                    if (!mc) return `<span class="bussola-ciclo-vinculo sem-vinculo" data-vincular-mi="${mi}" title="Vincular ao Ciclo de Estudos">⬡ sem vínculo com ciclo</span>`;
                    const auto = !m.cicloMateriaId;
                    const tempo = _formatarMinutos(mc.minutosFeitos || 0);
                    return `<span class="bussola-ciclo-vinculo com-vinculo" data-vincular-mi="${mi}" title="${auto ? 'Vínculo automático com ciclo (clique para alterar)' : 'Clique para alterar vínculo'}">
                      ⏱️ ${escapeHtml(mc.nome)} · ${tempo}${auto ? ' <small style="opacity:.7">(auto)</small>' : ''}
                    </span>`;
                  })()}
                </div>
              </div>
            </div>
            <!-- Mini barra de progresso da disciplina -->
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <div class="pct-bar-wrap" style="width:80px;margin:0;">
                <div class="pct-bar" style="width:80px;height:5px;border-radius:3px;">
                  <span style="width:${cobPct}%;background:var(--success);border-radius:3px;"></span>
                </div>
              </div>
              <span style="font-size:12px;color:var(--text-muted);min-width:30px;">${cobPct}%</span>
            </div>
          </div>

          <!-- Tópicos (visíveis só se expandido) -->
          ${expandido ? `
            <div class="bussola-topicos" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
              ${topicosFiltrados.length ? topicosFiltrados.map(({ t, ti, s }) => {
                const cfg    = _STATUS_BUSSOLA[s.status];
                const taxaTxt = s.taxa != null ? fmtPct(s.taxa) : '—';
                const diasTxt = s.dias != null
                  ? (s.dias === 0 ? 'Hoje' : `${s.dias}d atrás`)
                  : '—';
                return `
                  <div class="bussola-topico" style="border-left:3px solid ${cfg.cor};">
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13.5px;font-weight:600;">${escapeHtml(t.nome)}</div>
                      <div style="font-size:12px;color:var(--text-muted);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap;">
                        ${s.tentativas ? `<span>${s.tentativas} tent. · ${s.questoes} q.</span>` : ''}
                        ${s.taxa != null ? `<span>Taxa: <b style="color:${cfg.cor}">${taxaTxt}</b></span>` : ''}
                        ${s.dias != null ? `<span>Último: ${diasTxt}</span>` : ''}
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                      <span class="badge" style="background:${cfg.cor}22;color:${cfg.cor};font-size:11.5px;">
                        ${cfg.icone} ${cfg.label}
                      </span>
                      <button class="btn btn-sm" data-estudar-mi="${mi}" data-estudar-ti="${ti}"
                        title="Iniciar sessão de estudo no Ciclo para ${escapeHtml(t.nome)}">▶ Estudar</button>
                    </div>
                  </div>`;
              }).join('') : `<p class="text-muted" style="font-size:13px;padding:8px 0;">Nenhum tópico com este filtro.</p>`}

              <!-- Botão pra adicionar tópico novo -->
              <button class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%;" data-add-topico="${mi}">
                + Adicionar tópico
              </button>
            </div>
          ` : ''}
        </div>`;
    }).join('');

    // Listeners dos chips de filtro
    $$('[data-filtro-bussola]').forEach(btn => {
      btn.addEventListener('click', () => {
        _bussolaFiltro = btn.dataset.filtroBussola;
        $$('[data-filtro-bussola]').forEach(b => b.classList.toggle('active', b.dataset.filtroBussola === _bussolaFiltro));
        desenharLista();
      });
    });

    // Toggle expansão de disciplina
    $$('[data-toggle-disc]', lista).forEach(el => {
      el.addEventListener('click', () => {
        const mi = Number(el.dataset.toggleDisc);
        if (_bussolaExpandido.has(mi)) _bussolaExpandido.delete(mi);
        else _bussolaExpandido.add(mi);
        desenharLista();
      });
    });

    // Vincular / alterar vínculo com matéria do ciclo
    $$('[data-vincular-mi]', lista).forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(el.dataset.vincularMi);
        const matEdital = edital.materias[mi];
        const cicloMaterias = state.cicloMaterias || [];

        if (!cicloMaterias.length) {
          showToast('Você não tem matérias cadastradas em nenhum Ciclo de Estudos.', '');
          return;
        }

        // Abre modal de seleção com score de similaridade
        const candidatos = cicloMaterias
          .map(m => ({ m, score: _calcScoreSimilaridade(matEdital.nome, m.nome) }))
          .sort((a, b) => b.score - a.score);

        const cicloNomeMap = new Map(
          state.ciclos.map(c => [c.id, c.nome])
        );

        const opcoesHtml = candidatos.map(({ m, score }) => {
          const cicloNome = cicloNomeMap.get(m.cicloId) || '';
          const tempoTxt  = _formatarMinutos(m.minutosFeitos || 0);
          const scoreBar  = score >= 0.5 ? `<span style="color:var(--gold);font-size:11px;margin-left:4px;">★ ${Math.round(score * 100)}% de semelhança</span>` : '';
          const isAtual   = matEdital.cicloMateriaId === m.id ||
                            (!matEdital.cicloMateriaId && score >= 0.5 && candidatos[0].m.id === m.id);
          return `
            <label style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;border:1px solid ${isAtual ? 'var(--gold)' : 'var(--border)'};background:${isAtual ? 'var(--gold-soft)' : 'var(--surface)'};margin-bottom:8px;">
              <input type="radio" name="ciclo-vinculo" value="${m.id}" ${isAtual ? 'checked' : ''} style="accent-color:var(--gold);">
              <div style="flex:1;">
                <div style="font-weight:600;font-size:13.5px;">${escapeHtml(m.nome)}</div>
                <div style="font-size:12px;color:var(--text-muted);">${cicloNome ? escapeHtml(cicloNome) + ' · ' : ''}⏱️ ${tempoTxt}${scoreBar}</div>
              </div>
            </label>`;
        }).join('');

        const mc = _resolverMateriaCiclo(matEdital);

        openModal(`
          <h2>🔗 Vincular "${escapeHtml(matEdital.nome)}" ao Ciclo</h2>
          <p class="text-muted" style="font-size:13px;margin-top:0;">
            Selecione qual matéria do seu Ciclo de Estudos corresponde a esta disciplina do edital.
            O vínculo permite exibir o tempo estudado e sincronizar o progresso.
          </p>
          <div style="max-height:320px;overflow-y:auto;padding-right:4px;">
            ${opcoesHtml}
            <label style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;border:1px solid var(--border);background:var(--surface);margin-bottom:8px;">
              <input type="radio" name="ciclo-vinculo" value="__nenhum__" ${!mc ? 'checked' : ''} style="accent-color:var(--gold);">
              <div><div style="font-weight:600;font-size:13.5px;color:var(--text-muted);">Sem vínculo</div><div style="font-size:12px;color:var(--text-faint);">Não mostrar tempo do ciclo para esta disciplina</div></div>
            </label>
          </div>
          <div class="modal-actions" style="margin-top:16px;">
            <button class="btn btn-ghost" id="btn-vincular-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="btn-vincular-salvar">Salvar vínculo</button>
          </div>
        `);

        $('#btn-vincular-cancelar')?.addEventListener('click', closeModal);
        $('#btn-vincular-salvar')?.addEventListener('click', async () => {
          const selecionado = document.querySelector('input[name="ciclo-vinculo"]:checked')?.value;
          if (!selecionado) return;
          matEdital.cicloMateriaId = selecionado === '__nenhum__' ? null : Number(selecionado);
          await db.editais.update(edital);
          await reloadState();
          closeModal();
          showToast(selecionado === '__nenhum__' ? 'Vínculo removido.' : 'Vínculo salvo! ✓', 'success');
          desenharLista();
        });
      });
    });

    // Botão Estudar → navega pro Ciclo com a disciplina pré-selecionada
    $$('[data-estudar-mi]', lista).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.estudarMi);
        const ti = Number(btn.dataset.estudarTi);
        const disciplina = edital.materias[mi]?.nome || '';
        const topico     = edital.materias[mi]?.topicos[ti]?.nome || '';
        showToast(`Abrindo Ciclo de Estudos para: ${disciplina}`, 'success');
        location.hash = '#/ciclo';
        // Passa disciplina+tópico via sessionStorage pra ciclo.js pegar na inicialização
        try { sessionStorage.setItem('ta_ciclo_sugestao', JSON.stringify({ disciplina, topico })); } catch (_) {}
      });
    });

    // Adicionar tópico novo
    $$('[data-add-topico]', lista).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = Number(btn.dataset.addTopico);
        const nome = prompt('Nome do novo tópico:');
        if (!nome || !nome.trim()) return;
        edital.materias[mi].topicos.push({ nome: nome.trim() });
        await db.editais.update(edital);
        await reloadState();
        desenharLista();
      });
    });
  }

  desenharLista();

  // Expande automaticamente disciplinas com tópicos críticos (primeira abertura)
  if (_bussolaExpandido.size === 0) {
    (edital.materias || []).forEach((m, mi) => {
      const temCritico = (m.topicos || []).some(t =>
        calcStatusAutomaticoTopico(t.nome, m.nome).status === 'critico'
      );
      if (temCritico) _bussolaExpandido.add(mi);
    });
    if (_bussolaExpandido.size > 0) desenharLista();
  }
}

/* ============================================================
   MATCHING EDITAL ↔ CICLO
   Tenta vincular automaticamente uma disciplina do edital a uma
   matéria do ciclo de estudos usando quatro estratégias em cascata:
   1. Vínculo manual já salvo no edital (cicloMateriaId)
   2. Nome normalizado idêntico
   3. Um nome contém o outro (e.g. "AFO" dentro de "Administração
      Financeira e Orçamentária")
   4. Sigla: iniciais das palavras principais (≥4 letras) formam a sigla
   5. Maior interseção de palavras-chave (≥ 50% de coincidência)
   ============================================================ */

function _extrairSigla(nome) {
  return _norm(nome)
    .split(/\s+/)
    .filter(w => w.length >= 4 && !/^(de|da|do|das|dos|e|em|por|para|com|sem|que|uma|uns|umas|os|as|no|na|nos|nas|ao|aos|pelo|pela|pelos|pelas)$/.test(w))
    .map(w => w[0])
    .join('');
}

function _calcScoreSimilaridade(a, b) {
  const na = _norm(a), nb = _norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  // Sigla: verifica se um é a sigla do outro
  const siglaA = _extrairSigla(a), siglaB = _extrairSigla(b);
  if (siglaA === nb || siglaB === na || siglaA === siglaB) return 0.85;

  // Palavras-chave em comum (≥ 4 letras, sem stopwords)
  const stopwords = new Set(['de','da','do','das','dos','e','em','por','para','com','sem','ao','no','na']);
  const palavrasA = na.split(/\s+/).filter(w => w.length >= 4 && !stopwords.has(w));
  const palavrasB = nb.split(/\s+/).filter(w => w.length >= 4 && !stopwords.has(w));
  if (!palavrasA.length || !palavrasB.length) return 0;
  const comuns = palavrasA.filter(w => palavrasB.includes(w)).length;
  return comuns / Math.max(palavrasA.length, palavrasB.length);
}

/**
 * Dado uma matéria do edital, retorna a matéria do ciclo mais provável.
 * Usa vínculo manual salvo (cicloMateriaId) ou matching automático por score.
 * Retorna null se não encontrar nada com score >= 0.5.
 */
function _resolverMateriaCiclo(materiaEdital) {
  if (!materiaEdital) return null;
  const cicloMaterias = state.cicloMaterias || [];
  if (!cicloMaterias.length) return null;

  // 1. Vínculo manual salvo
  if (materiaEdital.cicloMateriaId) {
    const vinculada = cicloMaterias.find(m => m.id === materiaEdital.cicloMateriaId);
    if (vinculada) return vinculada;
  }

  // 2. Matching automático por score
  let melhor = null, melhorScore = 0;
  for (const m of cicloMaterias) {
    const score = _calcScoreSimilaridade(materiaEdital.nome, m.nome);
    if (score > melhorScore) { melhorScore = score; melhor = m; }
  }
  return melhorScore >= 0.5 ? melhor : null;
}

function renderKanbanCard(t, mi, ti, stats) {
  const marcado = t.status === 'dominado';
  const pct = stats ? stats.taxa : 0;

  // Busca a matéria vinculada ao ciclo usando a lógica de matching inteligente.
  // Prioridade: vínculo manual salvo → matching automático por nome.
  const materiaCiclo = _resolverMateriaCiclo(edital.materias[mi]);
  const tempoEstudado = materiaCiclo
    ? _formatarMinutos(materiaCiclo.minutosFeitos || 0)
    : null;
  
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
        ${materiaCiclo ? `<span class="kb-badge kb-badge-tempo" title="Tempo estudado no Ciclo: ${materiaCiclo.nome}">⏱️ ${tempoEstudado}</span>` : ''}
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

/* ============================================================
   TELA: LISTA DE EDITAIS
   Exibe todos os editais do perfil ativo com progresso,
   opção de abrir o detalhe, exportar JSON e deletar.
   ============================================================ */

function renderEditais(view) {
  function desenhar() {
    if (!state.editais.length) {
      view.innerHTML = `
        <div class="empty-state">
          <p>Nenhum edital cadastrado ainda.</p>
          <a href="#/editais/importar" class="btn btn-primary">Importar edital</a>
        </div>
      `;
      return;
    }

    view.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
        <a href="#/editais/importar" class="btn btn-primary">+ Importar edital</a>
      </div>
      <div id="editais-lista"></div>
    `;

    const lista = $('#editais-lista');

    lista.innerHTML = state.editais.map(edital => {
      const p = calcProgressoEdital(edital);
      const pct = Math.round(p.pct);
      return `
        <div class="card mb-12" style="cursor:default;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
            <div>
              <div style="font-family:var(--font-display);font-size:16px;font-weight:700;">${escapeHtml(edital.nome)}</div>
              ${edital.concurso ? `<div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${escapeHtml(edital.concurso)}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <a href="#/editais/${edital.id}" class="btn btn-ghost btn-sm">Ver edital</a>
              <button class="btn btn-ghost btn-sm" data-exportar-id="${edital.id}" title="Exportar como JSON">⬇️ Exportar</button>
              <button class="btn btn-ghost btn-sm danger" data-deletar-id="${edital.id}" title="Deletar edital">🗑️</button>
            </div>
          </div>
          <div class="stat-grid" style="margin-bottom:10px;">
            <div class="stat-card"><div class="label">Disciplinas</div><div class="value">${(edital.materias || []).length}</div></div>
            <div class="stat-card"><div class="label">Tópicos</div><div class="value">${p.total}</div></div>
            <div class="stat-card success"><div class="label">Dominados</div><div class="value">${p.dominado}</div></div>
            <div class="stat-card gold"><div class="label">% concluído</div><div class="value">${pct}%</div></div>
          </div>
          <div class="pct-bar-wrap">
            <div class="pct-bar" style="flex:1;height:6px;border-radius:4px;">
              <span style="width:${pct}%;background:var(--success);border-radius:4px;"></span>
            </div>
            <span class="num" style="font-size:12px;">${pct}%</span>
          </div>
        </div>
      `;
    }).join('');

    // Botão exportar JSON
    $$('[data-exportar-id]', lista).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.exportarId);
        const edital = state.editais.find(e => e.id === id);
        if (!edital) return;
        const blob = new Blob([JSON.stringify(edital, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${edital.nome.replace(/[^a-z0-9]/gi, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Edital exportado com sucesso.', 'success');
      });
    });

    // Botão deletar edital
    $$('[data-deletar-id]', lista).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.deletarId);
        const edital = state.editais.find(e => e.id === id);
        if (!edital) return;

        openModal(`
          <div style="padding:8px 0;">
            <div style="font-family:var(--font-display);font-size:17px;font-weight:700;margin-bottom:10px;">Deletar edital</div>
            <p style="margin:0 0 18px;color:var(--text-muted);font-size:14px;">
              Tem certeza que deseja deletar o edital <strong>${escapeHtml(edital.nome)}</strong>?
              Esta ação não pode ser desfeita. Suas tentativas registradas <strong>não</strong> serão afetadas.
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button class="btn btn-ghost" id="btn-confirma-cancelar">Cancelar</button>
              <button class="btn danger" id="btn-confirma-deletar">Sim, deletar</button>
            </div>
          </div>
        `);

        $('#btn-confirma-cancelar')?.addEventListener('click', closeModal);

        $('#btn-confirma-deletar')?.addEventListener('click', async () => {
          try {
            await db.editais.delete(id);
            await reloadState();
            closeModal();
            showToast('Edital deletado.', 'success');
            desenhar();
          } catch (err) {
            showToast('Erro ao deletar edital.', 'danger');
            console.error(err);
          }
        });
      });
    });
  }

  desenhar();
}
