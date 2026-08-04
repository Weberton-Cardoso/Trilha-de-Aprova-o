/**
 * cloud-sync.js
 * Sincronização entre dispositivos — login com Firebase Auth (Google),
 * dados guardados no Cloudflare D1 através de um Worker (worker.js).
 *
 * Arquitetura híbrida: o login continua 100% no Firebase (Auth), só o
 * ARMAZENAMENTO dos dados migrou do Firestore para o D1 — motivo principal:
 * o D1 tem "Time Travel" (recuperação a qualquer ponto dos últimos 30 dias)
 * de graça, enquanto o Firestore só oferece algo parecido no plano pago.
 *
 * Estratégia simples e segura para um app de uso pessoal:
 * - O IndexedDB continua sendo a fonte de dados usada pelo app no dia a dia
 *   (rápido, funciona offline).
 * - Sempre que os dados mudam localmente (evento 'ta:mudou', disparado pelo
 *   database.js), fazemos PUT /dados no Worker com tudo (tentativas,
 *   editais, simulados...). Isso reaproveita as funções
 *   exportAll()/importAll() que já existiam para backup manual.
 * - Ao logar (ou abrir o app já logado), buscamos esse pacote via
 *   GET /dados e substituímos o conteúdo local por ele (importAll com
 *   substituir:true), trazendo os dados para o dispositivo atual.
 *
 * Isso é suficiente para "um usuário, vários aparelhos". Não foi pensado
 * para edição simultânea nos dois aparelhos ao mesmo tempo.
 *
 * REDE DE SEGURANÇA (adicionada após um incidente de perda de dados):
 * - O Worker guarda uma cópia do pacote anterior em backups_historico ANTES
 *   de qualquer PUT /dados sobrescrever o atual — não precisa fazer esse
 *   snapshot manualmente aqui como fazíamos com o Firestore.
 * - Antes de puxar da nuvem (que substitui o banco local), o app cria um
 *   backup automático local do que já existe no aparelho.
 * - Se a nuvem estiver vazia mas o aparelho tiver dados, o app NÃO
 *   substitui o local pelo vazio (e avisa). Se o aparelho estiver vazio
 *   mas a nuvem tiver dados, o app NÃO sobrescreve a nuvem com o vazio.
 * - Trava por VOLUME: se a nuvem tem bem menos itens que o aparelho local,
 *   pede confirmação explícita antes de baixar (não confia só em timestamp).
 * - Trava por TROCA DE CONTA: se este aparelho sincronizou por último com
 *   outra conta do Google, pede confirmação antes de misturar dados.
 */

const firebaseConfig = {
  apiKey: "AIzaSyBk64IEbSZakYbtcBMvId0iITFA5Xuis8g",
  authDomain: "analisedequestoes-e963c.firebaseapp.com",
  projectId: "analisedequestoes-e963c",
  storageBucket: "analisedequestoes-e963c.firebasestorage.app",
  messagingSenderId: "376267857062",
  appId: "1:376267857062:web:b0613b88922551b0a7e867"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

// URL do Worker que fala com o D1 (ver worker.js). Só muda se um dia você
// recriar o Worker com outro nome/subdomínio.
const WORKER_URL = 'https://trilha-sync-worker.webertoncardoso4.workers.dev';

// --- Backup rotativo no Google Drive (terceira rede de segurança,
//     independente do D1 — ver backupParaDrive() mais abaixo) ---
const DRIVE_MAX_BACKUPS = 10;
const DRIVE_PASTA_NOME = 'Trilha de Aprovação — Backups';
const DRIVE_INTERVALO_MIN_MS = 60 * 60 * 1000; // no máximo 1 backup por hora
const DRIVE_CHAVE_ULTIMO_BACKUP = 'trilha_ultimo_backup_drive';

const cloudSync = {
  usuarioAtual: null,
  _pushTimer: null,
  _ignorarProximosEventos: false,
  _driveAccessToken: null, // só existe na sessão em que o usuário logou (ver entrarComGoogle)
  _driveFolderId: null,    // cache do id da pasta de backups, pra não buscar toda vez

  /** Chama isso uma vez, ao carregar o app. */
  init(onStatusChange) {
    this._onStatusChange = onStatusChange || (() => {});

    auth.onAuthStateChanged(async (user) => {
      this.usuarioAtual = user;
      this._onStatusChange(user);

      if (user) {
        await this._puxarDaNuvem(user.uid);
      }
    });

    window.addEventListener('ta:mudou', () => {
      if (this._ignorarProximosEventos) return;
      if (!this.usuarioAtual) return;
      this._pendente = true;
      this._agendarEnvio();
    });

    // Reforço extra: se a página for escondida/recarregada (ex.: logo após
    // um deploy) antes do envio programado terminar, manda na hora em vez
    // de esperar o atraso de 1,5s — reduz a chance de um reload acontecer
    // no meio do caminho e deixar a nuvem desatualizada.
    const flush = () => { if (this._pendente) this._enviarImediatamente(); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  },

  async entrarComGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Escopo estreito: só dá acesso a arquivos que O PRÓPRIO APP criou no
    // Drive do usuário (nunca o Drive inteiro) — usado só pelo backup
    // rotativo no Drive (ver backupParaDrive() mais abaixo).
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    try {
      const result = await auth.signInWithPopup(provider);
      const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
      // O access token do Google (diferente do ID token do Firebase) só
      // fica disponível aqui, logo após o login — não é renovado sozinho
      // depois. Por isso o backup no Drive só funciona enquanto essa
      // sessão do navegador durar; expira ~1h e some de vez ao recarregar
      // a página. É uma limitação aceitável pra um app de uso pessoal —
      // basta logar de novo de vez em quando pra renovar.
      this._driveAccessToken = credential?.accessToken || null;
    } catch (err) {
      console.error('Erro ao entrar com Google:', err);
      showToast('Não foi possível entrar. Tente novamente.', 'error');
    }
  },

  async sair() {
    await auth.signOut();
  },

  /** Chave no localStorage (não no IndexedDB — precisa sobreviver mesmo se
   *  os dados forem zerados/importados) com o uid da última conta Google
   *  que sincronizou neste aparelho. Usado pra detectar troca de conta. */
  _CHAVE_ULTIMO_UID: 'trilha_ultimo_uid_sincronizado',

  /** Se este aparelho já sincronizou antes com uma conta DIFERENTE da atual
   *  (e tem dados locais), isso é um sinal de risco: como o IndexedDB é
   *  compartilhado por todas as abas/contas do mesmo navegador, sincronizar
   *  agora pode misturar dados de duas contas do Google diferentes. Pede
   *  confirmação explícita nesse caso, em vez de seguir em frente sozinho. */
  async _confirmarSeTrocouDeConta(uidAtual, totalLocalAtual) {
    const ultimoUid = localStorage.getItem(this._CHAVE_ULTIMO_UID);
    if (!ultimoUid || ultimoUid === uidAtual || totalLocalAtual === 0) {
      localStorage.setItem(this._CHAVE_ULTIMO_UID, uidAtual);
      return true; // ok, pode continuar
    }

    const confirmar = confirm(
      `Este aparelho tem dados salvos localmente que foram sincronizados por outra conta do Google da última vez.\n\n` +
      `Sincronizar agora com a conta atual pode MISTURAR dados de contas diferentes (o banco de dados local é compartilhado entre todas as abas/contas deste navegador).\n\n` +
      `Só confirme se tiver certeza de que é isso mesmo que você quer. Cancelando, a sincronização desta vez é pulada.`
    );
    if (confirmar) localStorage.setItem(this._CHAVE_ULTIMO_UID, uidAtual);
    return confirmar;
  },

  /** Chama uma rota do Worker (worker.js), sempre anexando o ID token do
   *  Firebase Auth como prova de login. Lança erro com a mensagem que o
   *  Worker devolveu, se houver. */
  async _workerFetch(path, options = {}) {
    if (!this.usuarioAtual) throw new Error('Não há usuário logado.');
    const idToken = await this.usuarioAtual.getIdToken();
    const resp = await fetch(`${WORKER_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${idToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    if (!resp.ok) {
      const corpoErro = await resp.json().catch(() => ({}));
      throw new Error(corpoErro.erro || `O servidor respondeu ${resp.status}`);
    }
    return resp.json();
  },

  /** Junta tudo (db.exportAll) e sobe pro Worker/D1, com pequeno atraso
   *  para agrupar várias mudanças seguidas em um único envio. */
  _agendarEnvio() {
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this._enviarImediatamente(), 1500);
  },

  /** Dispara o envio agora mesmo, cancelando qualquer atraso programado. */
  _enviarImediatamente() {
    clearTimeout(this._pushTimer);
    this._pendente = false;
    this._enviarParaNuvem();
  },

  /** Soma quantos itens (tentativas + editais + simulados + ciclos +
   *  cicloMaterias + cicloSessoes) um pacote de dados tem, pra detectar
   *  se ele está "essencialmente vazio". */
  _totalItens(dados) {
    if (!dados) return 0;
    const chaves = ['tentativas', 'editais', 'simulados', 'ciclos', 'cicloMaterias', 'cicloSessoes'];
    return chaves.reduce((soma, chave) => soma + (Array.isArray(dados[chave]) ? dados[chave].length : 0), 0);
  },

  /** Lista os backups salvos no D1 (mais recentes primeiro), para a
   *  tela de Configurações mostrar e permitir restaurar. */
  async listarBackupsNuvem(limite = 20) {
    if (!this.usuarioAtual) return [];
    try {
      return await this._workerFetch(`/backups?limite=${limite}`);
    } catch (err) {
      console.error('Erro ao listar backups da nuvem:', err);
      return [];
    }
  },

  /** Restaura um backup específico da nuvem (por id numérico) direto no
   *  banco local do perfil ativo. Não mexe na nuvem — se depois disso o
   *  app sincronizar de novo, o backup restaurado é que sobe. */
  async restaurarBackupNuvem(backupId) {
    if (!this.usuarioAtual) throw new Error('Não há usuário logado.');
    const resposta = await this._workerFetch(`/backups/${backupId}`);
    const dados = resposta.dados;

    this._ignorarProximosEventos = true;
    await db.criarBackupLocalAutomatico('antes_de_restaurar_backup_nuvem').catch(() => {});
    await db.importAll(dados, { substituir: true });
    this._ignorarProximosEventos = false;
  },

  async _enviarParaNuvem() {
    if (!this.usuarioAtual) return;
    try {
      const dados = await db.exportAll();
      const totalLocal = this._totalItens(dados);

      if (totalLocal === 0) {
        // Confere se a nuvem já tem dados antes de decidir se é seguro
        // enviar um pacote vazio (evita apagar a nuvem sem querer).
        let totalNuvemAtual = 0;
        try {
          const respostaAtual = await this._workerFetch('/dados');
          if (respostaAtual.existe) totalNuvemAtual = this._totalItens(respostaAtual.dados);
        } catch (_) { /* se falhar em checar, segue com cautela abaixo mesmo assim */ }

        if (totalNuvemAtual > 0) {
          console.warn('[cloud-sync] Envio abortado: dados locais vazios, mas a nuvem tem dados. Preservando a nuvem.');
          showToast('Sincronização pulada: este aparelho está sem dados locais. A nuvem foi preservada.', 'warning');
          return;
        }
      }

      // O Worker já guarda um backup do estado anterior automaticamente
      // antes de sobrescrever (ver worker.js, rota PUT /dados) — não
      // precisa fazer esse snapshot manualmente aqui como fazíamos com o
      // Firestore.
      await this._workerFetch('/dados', { method: 'PUT', body: JSON.stringify(dados) });

      // Dispara em paralelo, sem esperar nem deixar erro subir — tem seu
      // próprio throttle (1x/hora) e nunca deve travar a sincronização
      // principal caso falhe por qualquer motivo (token expirado, etc.).
      this.backupParaDrive();
    } catch (err) {
      console.error('Erro ao enviar dados para a nuvem:', err);
    }
  },

  // ------------------------------------------------------------
  // BACKUP ROTATIVO NO GOOGLE DRIVE
  // ------------------------------------------------------------
  // Terceira rede de segurança, independente do Firestore/D1: guarda os
  // últimos DRIVE_MAX_BACKUPS snapshots numa pasta própria do app no Drive
  // do usuário. Útil mesmo se o problema for na conta/projeto do Firebase
  // inteiro, não só num bug do app. Nunca lança erro pra fora — se falhar,
  // só registra no console e segue a vida (best-effort).

  async _driveFetch(path, options = {}) {
    if (!this._driveAccessToken) throw new Error('sem token de acesso ao Drive');
    const resp = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${this._driveAccessToken}` }
    });
    if (!resp.ok) throw new Error(`Drive API respondeu ${resp.status}`);
    return resp.json();
  },

  async _obterOuCriarPastaDrive() {
    if (this._driveFolderId) return this._driveFolderId;
    const q = `name='${DRIVE_PASTA_NOME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const busca = await this._driveFetch(`files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    if (busca.files && busca.files.length) {
      this._driveFolderId = busca.files[0].id;
      return this._driveFolderId;
    }
    const criada = await this._driveFetch('files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_PASTA_NOME, mimeType: 'application/vnd.google-apps.folder' })
    });
    this._driveFolderId = criada.id;
    return this._driveFolderId;
  },

  async _rotacionarBackupsDrive(folderId) {
    const q = `'${folderId}' in parents and trashed=false`;
    const lista = await this._driveFetch(`files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime desc`);
    const arquivos = lista.files || [];
    if (arquivos.length <= DRIVE_MAX_BACKUPS) return;
    for (const arq of arquivos.slice(DRIVE_MAX_BACKUPS)) {
      await this._driveFetch(`files/${arq.id}`, { method: 'DELETE' }).catch(() => {});
    }
  },

  /** Envia um backup completo pro Drive, no máximo 1x por hora, e apaga os
   *  mais antigos além do limite. Pode ser chamada a qualquer momento —
   *  ela mesma decide se é cedo demais ou se falta permissão. */
  async backupParaDrive() {
    if (!this._driveAccessToken) {
      console.warn('[cloud-sync] Backup no Drive pulado: sem token de acesso (faça login de novo pra renovar).');
      return;
    }

    const agora = Date.now();
    const ultimoBackup = Number(localStorage.getItem(DRIVE_CHAVE_ULTIMO_BACKUP) || 0);
    if (agora - ultimoBackup < DRIVE_INTERVALO_MIN_MS) return;

    try {
      const folderId = await this._obterOuCriarPastaDrive();
      const dados = await db.exportAll();
      const nomeArquivo = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      const metadata = { name: nomeArquivo, parents: [folderId] };
      const boundary = 'trilha_' + Math.random().toString(36).slice(2);
      const corpo =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(dados)}\r\n--${boundary}--`;

      const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._driveAccessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: corpo
      });
      if (!resp.ok) throw new Error(`upload falhou (${resp.status})`);

      localStorage.setItem(DRIVE_CHAVE_ULTIMO_BACKUP, String(agora));
      console.log('[cloud-sync] Backup enviado ao Google Drive:', nomeArquivo);

      await this._rotacionarBackupsDrive(folderId);
    } catch (err) {
      console.warn('[cloud-sync] Não foi possível fazer backup no Drive agora:', err.message);
    }
  },

  async _puxarDaNuvem(uid) {
    try {
      const totalLocalAntesDeChecar = this._totalItens(await db.exportAll());
      const podeContinuar = await this._confirmarSeTrocouDeConta(uid, totalLocalAntesDeChecar);
      if (!podeContinuar) {
        console.warn('[cloud-sync] Sincronização pulada: usuário cancelou por causa de troca de conta detectada.');
        return;
      }

      const resposta = await this._workerFetch('/dados');
      if (!resposta.existe) {
        // Primeiro login deste usuário: sobe o que já existe localmente.
        await this._enviarParaNuvem();
        return;
      }

      const dadosNuvem = resposta.dados;
      const totalNuvem = this._totalItens(dadosNuvem);
      const totalLocalAtual = this._totalItens(await db.exportAll());

      if (totalNuvem === 0 && totalLocalAtual > 0) {
        console.warn('[cloud-sync] Sincronização abortada: a nuvem está vazia, mas este aparelho tem dados. Preservando os dados locais.');
        showToast('Sincronização pulada: a nuvem está vazia. Seus dados locais foram preservados.', 'warning');
        return;
      }

      // Trava por horário: compara quando o dado local foi alterado pela
      // última vez com o timestamp que a nuvem registrou na última vez que
      // recebeu um envio.
      //
      // Casos possíveis:
      //  1. Local mais novo que nuvem  → envia (não baixa)
      //  2. Nuvem mais nova que local  → baixa normalmente
      //  3. Local tem timestamp, nuvem não tem (dados antigos na nuvem,
      //     de antes dessa proteção existir) → envia (dados locais mais completos)
      //  4. Nenhum tem timestamp (instalação nova ou localStorage limpo)
      //     → deixa passar, vai verificar pelo volume abaixo
      const alteracaoLocal = db.getUltimaAlteracaoLocal();
      const alteracaoNuvem = dadosNuvem.alteradoEm;

      if (alteracaoLocal && !alteracaoNuvem) {
        // Caso 3: nuvem antiga sem timestamp — local é mais confiável
        console.warn('[cloud-sync] Nuvem sem timestamp de alteração, mas local tem. Enviando local para a nuvem.');
        await this._enviarParaNuvem();
        return;
      }

      if (alteracaoLocal && alteracaoNuvem && new Date(alteracaoLocal) > new Date(alteracaoNuvem)) {
        // Caso 1: local mais recente
        console.warn('[cloud-sync] Sincronização (baixar) pulada: os dados locais são mais recentes que os da nuvem. Enviando o local para a nuvem em vez de sobrescrevê-lo.');
        await this._enviarParaNuvem();
        return;
      }

      // Trava por VOLUME de dados — não confia só no timestamp. Se a nuvem
      // tem bem menos itens que este aparelho (ex.: menos da metade), isso
      // é sinal forte de dado desatualizado na nuvem (ex.: outro aparelho
      // nunca sincronizou, ou um reload disparado pela atualização do
      // Service Worker chegou aqui com o relógio/timestamp local
      // momentaneamente errado). Em vez de confiar cegamente e apagar
      // dados locais bons, pede confirmação explícita antes de continuar.
      if (totalLocalAtual > 0 && totalNuvem < totalLocalAtual * 0.5) {
        console.warn(`[cloud-sync] Sincronização (baixar) pausada: a nuvem tem bem menos itens (${totalNuvem}) que este aparelho (${totalLocalAtual}). Pedindo confirmação.`);
        const confirmar = confirm(
          `Atenção: a nuvem tem ${totalNuvem} item(ns) registrados, mas este aparelho tem ${totalLocalAtual}.\n\n` +
          `Baixar da nuvem agora vai SUBSTITUIR os dados deste aparelho pelos da nuvem — e a nuvem parece estar desatualizada.\n\n` +
          `Só confirme se tiver certeza de que os dados da nuvem são os corretos. Cancelando, os dados deste aparelho serão enviados para a nuvem em vez disso.`
        );
        if (!confirmar) {
          console.warn('[cloud-sync] Usuário cancelou o download da nuvem — enviando os dados locais para a nuvem em vez disso.');
          await this._enviarParaNuvem();
          return;
        }
      }

      // Backup de segurança do que já existe localmente, antes de substituir.
      await db.criarBackupLocalAutomatico('antes_de_puxar_da_nuvem').catch(() => {});

      // Evita que a importação (que dispara 'ta:mudou' várias vezes)
      // gere um novo envio para a nuvem logo em seguida.
      this._ignorarProximosEventos = true;
      await db.importAll(dadosNuvem, { substituir: true });
      this._ignorarProximosEventos = false;

      // Recarrega a tela atual para refletir os dados sincronizados.
      if (typeof router === 'function') router();
      showToast('Dados sincronizados.', 'success');
    } catch (err) {
      this._ignorarProximosEventos = false;
      console.error('Erro ao baixar dados da nuvem:', err);
    }
  }
};
