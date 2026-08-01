/**
 * configuracoes.js
 * Tela de Configurações, backups locais/nuvem e ferramentas de reparo.
 *
 * Extraído do app.js em 2026-07-31 como parte da refatoração.
 *
 * Depende de (carregados antes no index.html):
 *  database.js  — db.*, BACKUP_AUTO_MAX_ITENS
 *  cloud-sync.js — cloudSync.*
 *  app.js       — state, todayISO, toBRDate, escapeHtml, $, $$,
 *                 showToast, reloadState, router, openModal, closeModal,
 *                 applyTheme, settings
 */

/* ============================================================
   TELA: CONFIGURAÇÕES
   ============================================================ */

function renderConfiguracoes(view) {
  view.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Aparência</div>
        <div class="form-row">
          <label>Tema</label>
          <div class="toggle-group">
            <button type="button" id="tema-escuro" class="${settings.theme === 'dark' ? 'on correta' : ''}">Escuro</button>
            <button type="button" id="tema-claro" class="${settings.theme === 'light' ? 'on correta' : ''}">Claro</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Backup</div>
        <p class="text-muted" style="font-size:13.5px;margin-top:0;">Exporte todos os seus dados (tentativas, editais e simulados) em um arquivo JSON, ou restaure a partir de um backup anterior.</p>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-exportar">Exportar backup (.json)</button>
          <button class="btn" id="btn-importar">Importar backup</button>
          <input type="file" id="input-importar" accept="application/json" style="display:none;">
        </div>
      </div>
    </div>

    <div class="card mt-12" id="card-backups-locais">
      <div class="card-title">Backups automáticos deste aparelho</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        O app guarda automaticamente um retrato completo (todos os perfis) sempre que algo muda,
        e também logo antes de importações e sincronizações. Se algo der errado, você pode
        voltar para um desses pontos no tempo. Restaurar aqui substitui TODOS os perfis e dados
        atuais neste aparelho.
      </p>
      <div id="lista-backups-locais">Carregando...</div>
    </div>

    <div class="card mt-12" id="card-backups-nuvem" style="display:none;">
      <div class="card-title">Backups na nuvem</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Antes de cada sincronização com a nuvem, uma cópia do estado anterior é guardada aqui.
        Restaurar aqui substitui os dados do perfil ativo pelos do backup escolhido.
      </p>
      <div class="flex" style="gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm" id="btn-buscar-todos-backups-nuvem">🔎 Buscar todos os backups (não só os mais recentes)</button>
        <label class="flex" style="gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer;">
          <input type="checkbox" id="chk-so-com-ciclo"> Mostrar só os que têm ciclo(s)
        </label>
      </div>
      <div id="lista-backups-nuvem">Carregando...</div>
    </div>

    <div class="card mt-12">
      <div class="card-title">Consolidar tentativas duplicadas</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Junta em um único registro as tentativas com a mesma disciplina, assunto, tipo e data
        — útil se você registrou várias rodadas separadas do mesmo assunto no mesmo dia antes
        dessa opção existir. Essa ação não pode ser desfeita.
      </p>
      <button class="btn" id="btn-consolidar">Consolidar agora</button>
    </div>

    <div class="card mt-12">
      <div class="card-title">Reparar sessões do Ciclo de Estudos</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Corrige sessões do Ciclo de Estudos que ficaram sem ligação com a disciplina certa
        (isso podia acontecer em sincronizações antigas). Usa o nome já salvo em cada sessão
        para reencontrar a disciplina certa — não apaga nada, só religa o que já existe.
      </p>
      <button class="btn" id="btn-reparar-sessoes">Reparar agora</button>
    </div>

    <div class="card mt-12">
      <div class="card-title">Recuperar registros invisíveis</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">
        Corrige tentativas, editais, simulados e dados do Ciclo de Estudos que ficaram sem
        vínculo com nenhum perfil (isso podia acontecer ao editar um registro, por um bug já
        corrigido) — o registro continuava existindo, só ficava fora da lista. Cria um backup
        antes de reparar.
      </p>
      <button class="btn" id="btn-reparar-perfil">Recuperar agora</button>
    </div>

    <div class="card mt-12">
      <div class="card-title">Zona de risco</div>
      <p class="text-muted" style="font-size:13.5px;margin-top:0;">Isto apaga permanentemente as tentativas, editais, ciclos e simulados do perfil ativo (${escapeHtml(state.perfis.find(p => p.id === db.perfilAtivoId)?.nome || '')}) neste dispositivo. Outros perfis não são afetados.</p>
      <button class="btn btn-danger" id="btn-zerar">Zerar estatísticas deste perfil</button>
    </div>
  `;

  $('#tema-escuro').addEventListener('click', () => { settings.theme = 'dark'; applyTheme(); router(); });
  $('#tema-claro').addEventListener('click', () => { settings.theme = 'light'; applyTheme(); router(); });

  $('#btn-exportar').addEventListener('click', async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trilha-aprovacao-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exportado.', 'success');
  });

  const fileInput = $('#input-importar');
  $('#btn-importar').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!confirm('Importar este backup vai substituir todos os dados atuais. Continuar?')) return;
      await db.importAll(data, { substituir: true });
      await reloadState();
      showToast('Backup importado com sucesso.', 'success');
      router();
    } catch (err) {
      showToast('Arquivo inválido. Verifique o backup.', 'danger');
    }
    fileInput.value = '';
  });

  renderListaBackupsLocais();
  renderListaBackupsNuvem();

  $('#btn-consolidar').addEventListener('click', async () => {
    const grupos = new Map();
    state.tentativas.forEach(t => {
      const chave = [t.data, t.tipo, t.disciplina.trim().toLowerCase(), t.assunto.trim().toLowerCase()].join('|');
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(t);
    });

    const gruposComDuplicata = Array.from(grupos.values()).filter(g => g.length > 1);
    if (!gruposComDuplicata.length) {
      showToast('Nenhuma tentativa duplicada encontrada.', '');
      return;
    }

    const totalDuplicatas = gruposComDuplicata.reduce((s, g) => s + g.length, 0);
    if (!confirm(`Encontrei ${gruposComDuplicata.length} assunto(s) com registros repetidos no mesmo dia (${totalDuplicatas} tentativas ao todo). Elas serão somadas em ${gruposComDuplicata.length} registro(s) único(s). Continuar?`)) return;

    for (const grupo of gruposComDuplicata) {
      const numQuestoes = grupo.reduce((s, t) => s + t.numQuestoes, 0);
      const acertos = grupo.reduce((s, t) => s + t.acertos, 0);
      const erros = numQuestoes - acertos;
      const taxa = numQuestoes ? (acertos / numQuestoes) * 100 : 0;
      const observacoes = grupo.map(t => t.observacoes).filter(Boolean).join(' | ');
      const base = grupo[0];

      await db.tentativas.update({
        ...base,
        numQuestoes, acertos, erros, taxa, observacoes,
        banca: grupo.map(t => t.banca).find(Boolean) || '',
        concurso: grupo.map(t => t.concurso).find(Boolean) || ''
      });
      for (const t of grupo.slice(1)) {
        await db.tentativas.remove(t.id);
      }
    }

    await reloadState();
    showToast(`${gruposComDuplicata.length} registro(s) consolidado(s).`, 'success');
    router();
  });

  $('#btn-reparar-sessoes').addEventListener('click', async () => {
    if (typeof db.criarBackupLocalAutomatico === 'function') {
      await db.criarBackupLocalAutomatico('antes_de_reparar_sessoes_orfas').catch(() => {});
    }

    const norm = (s) => (s || '').trim().toLowerCase();
    const materias = await db.getAll('cicloMaterias');
    const sessoes = await db.getAll('cicloSessoes');
    const idsValidos = new Set(materias.map(m => m.id));

    let religadas = 0;
    let semCorrespondencia = 0;

    for (const s of sessoes) {
      if (idsValidos.has(s.cicloMateriaId)) continue;
      const materiaCorreta = materias.find(m => norm(m.nome) === norm(s.nome));
      if (materiaCorreta) {
        await db.cicloSessoes.update({ ...s, cicloMateriaId: materiaCorreta.id });
        religadas++;
      } else {
        semCorrespondencia++;
      }
    }

    await reloadState();
    if (religadas === 0 && semCorrespondencia === 0) {
      showToast('Nenhuma sessão órfã encontrada — está tudo certo.', 'success');
    } else {
      showToast(
        `${religadas} sessão(ões) religada(s).` +
        (semCorrespondencia ? ` ${semCorrespondencia} sem disciplina correspondente.` : ''),
        'success'
      );
    }
    router();
  });

  $('#btn-reparar-perfil').addEventListener('click', async () => {
    const { totalReparados, porStore } = await db.repararPerfilIdAusente();
    await reloadState();
    if (totalReparados === 0) {
      showToast('Nenhum registro invisível encontrado — está tudo certo.', 'success');
    } else {
      const detalhe = Object.entries(porStore).map(([loja, n]) => `${n} em ${loja}`).join(', ');
      showToast(`${totalReparados} registro(s) recuperado(s) (${detalhe}).`, 'success');
    }
    router();
  });

  $('#btn-zerar').addEventListener('click', async () => {
    if (!confirm('Tem certeza? Todos os dados serão apagados permanentemente.')) return;
    await db.zerarTudo();
    await reloadState();
    showToast('Estatísticas zeradas.', 'danger');
    router();
  });
}

function _formatarDataHoraBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const _MOTIVO_BACKUP_LABEL = {
  alteracao_automatica: 'Alteração no app',
  antes_de_importar: 'Antes de importar um backup',
  antes_de_zerar: 'Antes de zerar estatísticas',
  antes_de_puxar_da_nuvem: 'Antes de sincronizar (baixando da nuvem)',
  antes_de_restaurar_backup_nuvem: 'Antes de restaurar backup da nuvem',
  antes_de_enviar: 'Antes de sincronizar (enviando para a nuvem)',
  auto: 'Automático'
};

async function renderListaBackupsLocais() {
  const container = $('#lista-backups-locais');
  if (!container) return;

  const backups = await db.backupsLocais.getAll();
  if (!backups.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:13.5px;">Nenhum backup automático ainda — assim que algo mudar no app, o primeiro será criado.</p>';
    return;
  }

  container.innerHTML = backups.map(b => {
    const totalTentativas = (b.dados?.tentativas || []).length;
    const totalCiclos = (b.dados?.ciclos || []).length;
    const motivo = _MOTIVO_BACKUP_LABEL[b.motivo] || b.motivo || 'Automático';
    return `
      <div class="flex" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;">${_formatarDataHoraBR(b.criadoEm)}</div>
          <div class="text-muted" style="font-size:12.5px;">${escapeHtml(motivo)} — ${totalTentativas} tentativa(s), ${totalCiclos} ciclo(s)</div>
        </div>
        <button class="btn" data-restaurar-local="${b.id}">Restaurar</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-restaurar-local]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.restaurarLocal);
      const backup = backups.find(b => b.id === id);
      if (!backup) return;
      if (!confirm(`Restaurar este backup de ${_formatarDataHoraBR(backup.criadoEm)}? Isso substitui TODOS os perfis e dados atuais neste aparelho.`)) return;
      await db.importAllRaw(backup.dados);
      await reloadState();
      showToast('Backup restaurado com sucesso.', 'success');
      router();
    });
  });
}

let _backupsNuvemCache = null; // guarda a última lista buscada, pra filtrar sem rebuscar

async function renderListaBackupsNuvem() {
  const card = $('#card-backups-nuvem');
  const container = $('#lista-backups-nuvem');
  if (!card || !container) return;
  if (typeof cloudSync === 'undefined' || !cloudSync.usuarioAtual) return;

  card.style.display = '';

  const btnBuscarTudo = $('#btn-buscar-todos-backups-nuvem');
  const chkSoComCiclo = $('#chk-so-com-ciclo');

  async function carregar(limite) {
    try {
      container.innerHTML = 'Carregando...';
      _backupsNuvemCache = await cloudSync.listarBackupsNuvem(limite);
      desenhar();
    } catch (err) {
      container.innerHTML = '<p class="text-muted" style="font-size:13.5px;">Não foi possível carregar os backups da nuvem agora.</p>';
    }
  }

  function desenhar() {
    let backups = _backupsNuvemCache || [];
    if (!backups.length) {
      container.innerHTML = '<p class="text-muted" style="font-size:13.5px;">Nenhum backup na nuvem ainda.</p>';
      return;
    }

    const soComCiclo = chkSoComCiclo?.checked;
    const listaExibida = soComCiclo
      ? backups.filter(b => ((b.dados?.ciclos || []).length > 0))
      : backups;

    if (!listaExibida.length) {
      container.innerHTML = `<p class="text-muted" style="font-size:13.5px;">Nenhum desses ${backups.length} backup(s) carregado(s) tem ciclo salvo. Tente "Buscar todos" primeiro, se ainda não buscou.</p>`;
      return;
    }

    container.innerHTML = `
      <p class="text-muted" style="font-size:12px;margin:0 0 10px;">${backups.length} backup(s) carregado(s)${soComCiclo ? `, ${listaExibida.length} com ciclo` : ''}.</p>
      ${listaExibida.map(b => {
        const totalTentativas = (b.dados?.tentativas || []).length;
        const totalCiclos = (b.dados?.ciclos || []).length;
        const temCiclo = totalCiclos > 0;
        const motivo = _MOTIVO_BACKUP_LABEL[b.motivo] || b.motivo || 'Automático';
        const criadoEm = b.criadoEm && b.criadoEm.toDate ? b.criadoEm.toDate().toISOString() : b.criadoEm;
        return `
          <div class="flex" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap;${temCiclo ? 'background:var(--success-soft);border-radius:8px;padding-left:8px;padding-right:8px;' : ''}">
            <div>
              <div style="font-weight:600;">${_formatarDataHoraBR(criadoEm)} ${temCiclo ? '<span class="badge success">tem ciclo</span>' : ''}</div>
              <div class="text-muted" style="font-size:12.5px;">${escapeHtml(motivo)} — ${totalTentativas} tentativa(s), ${totalCiclos} ciclo(s) (perfil ativo)</div>
            </div>
            <button class="btn" data-restaurar-nuvem="${b.id}">Restaurar</button>
          </div>
        `;
      }).join('')}
    `;

    container.querySelectorAll('[data-restaurar-nuvem]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.restaurarNuvem;
        if (!confirm('Restaurar este backup da nuvem? Isso substitui os dados do perfil ativo neste aparelho.')) return;
        try {
          await cloudSync.restaurarBackupNuvem(id);
          await reloadState();
          showToast('Backup da nuvem restaurado com sucesso.', 'success');
          router();
        } catch (err) {
          showToast('Não foi possível restaurar esse backup.', 'danger');
        }
      });
    });
  }

  btnBuscarTudo?.addEventListener('click', () => {
    btnBuscarTudo.disabled = true;
    btnBuscarTudo.textContent = 'Buscando...';
    carregar(500).finally(() => {
      btnBuscarTudo.disabled = false;
      btnBuscarTudo.textContent = '🔎 Buscar todos os backups (não só os mais recentes)';
    });
  });
  chkSoComCiclo?.addEventListener('change', desenhar);

  await carregar(20);
}

