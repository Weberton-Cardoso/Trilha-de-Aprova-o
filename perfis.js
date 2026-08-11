/**
 * perfis.js
 * Perfis de Estatísticas — permite manter várias preparações independentes
 * (ex.: "Histórico Geral", "TCDF 2026", "TCU 2027", "Estudos Livres") sob o
 * mesmo usuário. Cada perfil tem seus próprios dados de Dashboard,
 * Estatísticas, Ciclo de Estudos, Editais e Simulados — tudo isolado.
 *
 * O isolamento em si (filtrar/marcar por perfilId) acontece na camada
 * database.js; este arquivo cuida só da UI: o seletor no topo e a tela de
 * gerenciamento "Perfis".
 */

/** Garante que sempre exista pelo menos um perfil e que o perfil ativo
 *  (db.perfilAtivoId) aponte para um perfil que realmente existe. Roda uma
 *  vez, antes da primeira renderização do app. */
async function garantirPerfilAtivo() {
  let perfis = await db.perfis.getAll();

  if (!perfis.length) {
    await db.perfis.add({ nome: 'Histórico Geral', ordem: 0, criadoEm: new Date().toISOString() });
    perfis = await db.perfis.getAll();
  }

  perfis.sort((a, b) => a.ordem - b.ordem);

  if (db.perfilAtivoId == null || !perfis.some(p => p.id === db.perfilAtivoId)) {
    db.perfilAtivoId = perfis[0].id;
  }
}

/** Liga o botão/menu de troca de perfil na topbar. Chamado uma vez no boot. */
function initPerfilSelector() {
  const btn = $('#perfil-selector-btn');
  const menu = $('#perfil-selector-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _montarMenuSeletorPerfil(menu);
    menu.classList.toggle('show');
  });

  document.addEventListener('click', () => menu.classList.remove('show'));
}

function _montarMenuSeletorPerfil(menu) {
  const perfis = [...state.perfis].sort((a, b) => a.ordem - b.ordem);
  menu.innerHTML = `
    ${perfis.map(p => `
      <button data-selecionar-perfil="${p.id}" class="${p.id === db.perfilAtivoId ? 'ativo' : ''}">
        ${escapeHtml(p.nome)} ${p.id === db.perfilAtivoId ? '✓' : ''}
      </button>
    `).join('')}
    <div class="divisor"></div>
    <button class="gerenciar" id="menu-gerenciar-perfis">Gerenciar perfis</button>
  `;

  $$('[data-selecionar-perfil]', menu).forEach(b => {
    b.addEventListener('click', async () => {
      const id = Number(b.dataset.selecionarPerfil);
      if (id === db.perfilAtivoId) { menu.classList.remove('show'); return; }
      db.perfilAtivoId = id;
      menu.classList.remove('show');
      await router();
    });
  });

  $('#menu-gerenciar-perfis', menu).addEventListener('click', () => {
    menu.classList.remove('show');
    location.hash = '#/perfis';
  });
}

/** Atualiza só o texto do botão do seletor (nome do perfil ativo) — chamado
 *  no fim de cada navegação, já que os dados podem ter mudado. */
function atualizarSeletorPerfilUI() {
  const span = $('#perfil-selector-nome');
  if (!span) return;
  const ativo = state.perfis.find(p => p.id === db.perfilAtivoId);
  span.textContent = ativo ? ativo.nome : 'Perfil';
}

/* ---- Tela "Perfis" (#/perfis) ---- */
function renderPerfisPage(view) {
  const perfis = [...state.perfis].sort((a, b) => a.ordem - b.ordem);

  function contagem(perfilId) {
    return {
      tentativas: state.tentativas.length && perfilId === db.perfilAtivoId ? state.tentativas.length : null,
      editais: perfilId === db.perfilAtivoId ? state.editais.length : null,
      ciclos: perfilId === db.perfilAtivoId ? state.ciclos.length : null
    };
  }

  view.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
      <p class="text-muted" style="font-size:13.5px; margin:0;">
        Cada perfil tem seu próprio Dashboard, Estatísticas, Ciclo de Estudos, Editais e Simulados — totalmente separados.
      </p>
      <button class="btn btn-primary btn-sm" id="btn-criar-perfil">+ Criar perfil</button>
    </div>

    <div class="perfis-lista">
      ${perfis.map(p => {
        const ehAtivo = p.id === db.perfilAtivoId;
        const c = contagem(p.id);
        return `
        <div class="card perfil-card ${ehAtivo ? 'ativo' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div>
              <div class="card-title" style="margin-bottom:2px;">
                ${escapeHtml(p.nome)} ${ehAtivo ? '<span class="badge success">Ativo</span>' : ''}
              </div>
              ${ehAtivo ? `<span class="text-muted" style="font-size:12.5px;">
                ${c.tentativas ?? 0} tentativa(s) · ${c.editais ?? 0} edital(is) · ${c.ciclos ?? 0} ciclo(s)
              </span>` : `<span class="text-muted" style="font-size:12.5px;">Selecione para ver os dados</span>`}
            </div>
          </div>
          <div class="perfil-card-acoes">
            ${!ehAtivo ? `<button class="btn btn-sm btn-primary" data-selecionar="${p.id}">Selecionar</button>` : ''}
            <button class="btn btn-sm" data-editar="${p.id}">Editar</button>
            <button class="btn btn-sm btn-ghost" data-excluir="${p.id}" ${perfis.length <= 1 ? 'disabled title="Precisa existir ao menos um perfil"' : ''}>Excluir</button>
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `;

  $('#btn-criar-perfil').addEventListener('click', async () => {
    const nome = prompt('Nome do novo perfil (ex: "TCU 2027", "Estudos Livres"):');
    if (!nome || !nome.trim()) return;
    const novoId = await db.perfis.add({ nome: nome.trim(), ordem: state.perfis.length, criadoEm: new Date().toISOString() });
    db.perfilAtivoId = novoId;
    showToast(`Perfil "${nome.trim()}" criado e selecionado.`, 'success');
    await router();
  });

  $$('[data-selecionar]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      db.perfilAtivoId = Number(btn.dataset.selecionar);
      await router();
    });
  });

  $$('[data-editar]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      const perfil = state.perfis.find(p => p.id === Number(btn.dataset.editar));
      if (!perfil) return;
      const novoNome = prompt('Novo nome do perfil:', perfil.nome);
      if (!novoNome || !novoNome.trim() || novoNome.trim() === perfil.nome) return;
      await db.perfis.update({ ...perfil, nome: novoNome.trim() });
      await reloadState();
      renderPerfisPage(view);
      atualizarSeletorPerfilUI();
    });
  });

  $$('[data-excluir]', view).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const perfil = state.perfis.find(p => p.id === Number(btn.dataset.excluir));
      if (!perfil) return;
      if (!confirm(`Excluir o perfil "${perfil.nome}" e TODOS os seus dados (tentativas, editais, ciclos, simulados)? Isso não pode ser desfeito.`)) return;

      const perfilExcluidoId = perfil.id;
      const eraAtivo = perfilExcluidoId === db.perfilAtivoId;

      // Apaga os dados do perfil: como o CRUD genérico só filtra pelo perfil
      // ATIVO, precisamos temporariamente "entrar" nele para limpar direito.
      const perfilAtivoOriginal = db.perfilAtivoId;
      db.perfilAtivoId = perfilExcluidoId;
      await Promise.all([
        db.tentativas.clear(), db.editais.clear(), db.simulados.clear(),
        db.cicloMaterias.clear(), db.cicloSessoes.clear(), db.ciclos.clear()
      ]);
      db.perfilAtivoId = perfilAtivoOriginal;

      await db.perfis.remove(perfilExcluidoId);

      if (eraAtivo) {
        const restantes = (await db.perfis.getAll()).sort((a, b) => a.ordem - b.ordem);
        db.perfilAtivoId = restantes[0].id;
      }

      showToast(`Perfil "${perfil.nome}" excluído.`, 'success');
      await router();
    });
  });
}
