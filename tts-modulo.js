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
  let utteranceAtual = null;
  let emLeitura = false;
  let emPausa = false;
  let _keepAliveTimer = null;

  let config = {
    velocidade: 1,
    tom: 1,
    volume: 1,
    idioma: 'pt-BR'
  };

  let vozesDisponiveis = [];

  // Carrega vozes imediatamente (funciona no Safari e Firefox)
  // e também no onvoiceschanged (Chrome, especialmente no Android)
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
    // Chrome Android para a fala depois de ~15s — resume() faz ela continuar
    _keepAliveTimer = setInterval(() => {
      if (synth && emLeitura && !emPausa) {
        synth.pause();
        synth.resume();
      }
    }, 10000);
  }

  function _pararKeepAlive() {
    if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  }

  function falarTexto(texto, callback = null) {
    if (!synth) return;
    parar();

    // Chrome Android às vezes recusa textos muito longos numa só utterance.
    // Limita a 2000 caracteres por utterance — se o texto for maior, usa
    // falarFila com pedaços de no máximo 2000 chars separados em frases.
    if (texto.length > 2000) {
      const pedacos = _dividirEmPedacos(texto, 2000);
      falarFila(pedacos, callback);
      return;
    }

    const u = new SpeechSynthesisUtterance(texto);
    u.rate = config.velocidade;
    u.pitch = config.tom;
    u.volume = config.volume;
    u.lang = config.idioma;

    const voz = _escolherVoz();
    if (voz) u.voice = voz;

    u.onstart = () => {
      emLeitura = true; emPausa = false;
      _iniciarKeepAlive();
      if (config.onStart) config.onStart();
    };

    u.onend = () => {
      emLeitura = false; emPausa = false;
      _pararKeepAlive();
      if (callback) callback();
      if (config.onEnd) config.onEnd();
    };

    u.onerror = (e) => {
      // 'interrupted' é gerado pelo próprio cancel() — não é erro real
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.error('[TTS] erro:', e.error);
      emLeitura = false;
      _pararKeepAlive();
      if (config.onError) config.onError(e);
    };

    utteranceAtual = u;
    synth.speak(u);
  }

  /** Divide um texto longo em pedaços de até maxLen caracteres,
   *  quebrando preferencialmente em fim de frase (. ! ?). */
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

  function falarFila(textos, callback = null) {
    if (!synth) return;
    parar();
    const fila = (Array.isArray(textos) ? textos : [textos]).filter(Boolean);
    if (!fila.length) { if (callback) callback(); return; }
    let idx = 0;

    function lerProximo() {
      if (idx >= fila.length) { if (callback) callback(); return; }
      const t = fila[idx++];
      falarTexto(t, () => setTimeout(lerProximo, 150));
    }
    lerProximo();
  }

  function pausar() {
    if (synth && emLeitura && !emPausa) {
      synth.pause(); emPausa = true;
      _pararKeepAlive();
      if (config.onPause) config.onPause();
    }
  }

  function retomar() {
    if (synth && emPausa) {
      synth.resume(); emPausa = false;
      _iniciarKeepAlive();
      if (config.onResume) config.onResume();
    }
  }

  function parar() {
    _pararKeepAlive();
    if (synth) synth.cancel();
    emLeitura = false; emPausa = false;
    if (config.onStop) config.onStop();
  }

  function suportado() {
    return !!synth;
  }

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
