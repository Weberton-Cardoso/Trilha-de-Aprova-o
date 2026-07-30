/**
 * tts-modulo.js
 * Text-to-Speech usando Web Speech API com suporte a mobile (Chrome Android).
 *
 * Correções específicas pra mobile:
 * - DOMContentLoaded não é confiável quando o script carrega no final do body;
 *   a inicialização agora acontece imediatamente E no onvoiceschanged, que é o
 *   único evento garantido no Chrome Android quando as vozes chegam de forma
 *   assíncrona.
 * - Chrome Android fica em silêncio quando nenhuma voz é explicitamente
 *   definida; o módulo agora tenta pt-BR, depois pt, depois qualquer voz
 *   disponível pra garantir que algo seja atribuído.
 * - Chrome Android tem um bug onde o speechSynthesis para sozinho depois de
 *   ~15s em textos longos; resolvido com um keepAlive que chama resume()
 *   a cada 10s enquanto estiver em leitura.
 * - O `if (!window.tts)` no app.js era a checagem errada (o objeto sempre
 *   existe); checagem correta é `!window.speechSynthesis` (capacidade real).
 */

const tts = (() => {
  const synth = window.speechSynthesis;
  let emLeitura = false;
  let emPausa = false;
  let _keepAliveTimer = null;
  let _filaAtiva = false; // impede que onend de um item cancele a fila inteira

  let config = {
    velocidade: 1,
    tom: 1,
    volume: 1,
    idioma: 'pt-BR'
  };

  let vozesDisponiveis = [];

  function _carregarVozes() {
    const lista = synth ? synth.getVoices() : [];
    if (lista.length) vozesDisponiveis = lista;
  }

  _carregarVozes();
  if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = _carregarVozes;
  }

  function _escolherVoz() {
    if (!vozesDisponiveis.length) _carregarVozes();
    return (
      vozesDisponiveis.find(v => v.lang === 'pt-BR') ||
      vozesDisponiveis.find(v => v.lang.startsWith('pt')) ||
      vozesDisponiveis[0] ||
      null
    );
  }

  function _iniciarKeepAlive() {
    _pararKeepAlive();
    // Chrome Android para a fala depois de ~15s — resume() força continuação.
    // Usamos um flag interno pra garantir que pause/resume do keepAlive não
    // aciona os callbacks de onPause/onResume visíveis ao usuário.
    _keepAliveTimer = setInterval(() => {
      if (synth && emLeitura && !emPausa) {
        // pausa/retoma internamente sem alterar estado lógico
        synth.pause();
        setTimeout(() => { if (synth && emLeitura && !emPausa) synth.resume(); }, 50);
      }
    }, 10000);
  }

  function _pararKeepAlive() {
    if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  }

  /** Fala um único texto. Se _filaAtiva=true não chama parar() no início
   *  (porque a fila já gerencia o estado) — só cancela se for chamada solta. */
  function _falarUmItem(texto, callback) {
    if (!synth) { if (callback) callback(); return; }

    // Limita utterance a 2000 chars — Chrome Android rejeita textos muito longos
    if (texto.length > 2000) {
      const pedacos = _dividirEmPedacos(texto, 2000);
      // insere os pedaços "à frente" sem resetar _filaAtiva
      let idx = 0;
      const lerPedaco = () => {
        if (idx >= pedacos.length) { if (callback) callback(); return; }
        _falarUmItem(pedacos[idx++], () => setTimeout(lerPedaco, 100));
      };
      lerPedaco();
      return;
    }

    const u = new SpeechSynthesisUtterance(texto);
    u.rate   = config.velocidade;
    u.pitch  = config.tom;
    u.volume = config.volume;
    u.lang   = config.idioma;
    const voz = _escolherVoz();
    if (voz) u.voice = voz;

    u.onstart = () => {
      emLeitura = true; emPausa = false;
      _iniciarKeepAlive();
      if (!_filaAtiva && config.onStart) config.onStart();
    };

    u.onend = () => {
      // onend é chamado inclusive pelo keepAlive pause/resume no Android —
      // só encerra o estado se NÃO tivermos mais fila pendente
      if (!_filaAtiva) {
        emLeitura = false; emPausa = false;
        _pararKeepAlive();
        if (config.onEnd) config.onEnd();
      }
      if (callback) callback();
    };

    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') {
        // erro gerado pelo próprio cancel() interno — não propaga
        if (callback && !_filaAtiva) callback();
        return;
      }
      console.error('[TTS] erro:', e.error);
      emLeitura = false; emPausa = false;
      _pararKeepAlive();
      if (config.onError) config.onError(e);
    };

    synth.speak(u);
  }

  function _dividirEmPedacos(texto, maxLen) {
    const pedacos = [];
    let restante = texto.trim();
    while (restante.length > maxLen) {
      let corte = restante.lastIndexOf('.', maxLen);
      if (corte < maxLen * 0.5) corte = restante.lastIndexOf(' ', maxLen);
      if (corte < 0) corte = maxLen;
      pedacos.push(restante.slice(0, corte + 1).trim());
      restante = restante.slice(corte + 1).trim();
    }
    if (restante) pedacos.push(restante);
    return pedacos;
  }

  function falarTexto(texto, callback = null) {
    if (!synth) return;
    parar(); // chamada solta — reseta tudo
    _falarUmItem(texto, () => {
      if (callback) callback();
    });
  }

  function falarFila(textos, callback = null) {
    if (!synth) return;
    parar();
    const fila = (Array.isArray(textos) ? textos : [textos]).filter(t => t && t.trim());
    if (!fila.length) { if (callback) callback(); return; }

    _filaAtiva = true;
    emLeitura = true;
    emPausa = false;
    if (config.onStart) config.onStart();
    _iniciarKeepAlive();

    let idx = 0;

    function lerProximo() {
      if (!_filaAtiva) return; // foi parado externamente

      if (idx >= fila.length) {
        // Fila acabou normalmente
        _filaAtiva = false;
        emLeitura = false;
        emPausa = false;
        _pararKeepAlive();
        if (config.onEnd) config.onEnd();
        if (callback) callback();
        return;
      }

      const t = fila[idx];
      if (config.onItem) config.onItem(idx, fila.length);
      idx++;

      _falarUmItem(t, () => {
        if (_filaAtiva) setTimeout(lerProximo, 150);
      });
    }

    lerProximo();
  }

  function pausar() {
    if (synth && emLeitura && !emPausa) {
      synth.pause();
      emPausa = true;
      _pararKeepAlive();
      if (config.onPause) config.onPause();
    }
  }

  function retomar() {
    if (synth && emPausa) {
      synth.resume();
      emPausa = false;
      _iniciarKeepAlive();
      if (config.onResume) config.onResume();
    }
  }

  function parar() {
    _pararKeepAlive();
    _filaAtiva = false;
    emLeitura = false;
    emPausa = false;
    if (synth) synth.cancel();
    if (config.onStop) config.onStop();
  }

  function suportado() { return !!synth; }

  return {
    suportado,
    falar: falarTexto,
    falarFila,
    pausar,
    retomar,
    parar,
    definirVelocidade: (v) => { config.velocidade = Math.max(0.5, Math.min(2, v)); },
    definirTom:        (t) => { config.tom        = Math.max(0.5, Math.min(2, t)); },
    definirVolume:     (v) => { config.volume      = Math.max(0,   Math.min(1, v)); },
    definirIdioma:     (i) => { config.idioma = i; },
    definirCallbacks:  (cbs) => Object.assign(config, cbs),
    estaFalando:  () => emLeitura,
    estaPausado:  () => emPausa,
    obterVozes:   () => vozesDisponiveis,
    config
  };
})();

window.tts = tts;
