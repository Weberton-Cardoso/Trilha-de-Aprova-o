/**
 * tts-modulo.js — Text-to-Speech para mobile (Chrome Android)
 *
 * ESTRATÉGIA: sem keepAlive (pause/resume é instável no Chrome Android).
 * O texto é dividido em frases curtas (<= 200 chars) ANTES de falar.
 * Cada frase vira uma utterance separada — o onend de uma dispara a próxima.
 * Isso evita completamente o bug do Chrome que corta a fala após ~15s,
 * porque nenhuma utterance individual dura tempo suficiente pra ser cortada.
 */

const tts = (() => {
  const synth = window.speechSynthesis;

  let emLeitura  = false;
  let emPausa    = false;
  let _parar     = false;  // sinaliza que a fila deve ser abortada

  let _utteranciaAtual = null;
  let _textoRestante   = '';   // guardado pra retomar após pausa

  let vozesDisponiveis = [];

  const config = {
    velocidade: 1,
    tom: 1,
    volume: 1,
    idioma: 'pt-BR',
    onStart:  null,
    onEnd:    null,
    onPause:  null,
    onResume: null,
    onStop:   null,
    onError:  null,
    onItem:   null,
  };

  /* ── Vozes ─────────────────────────────────────────────── */
  function _carregarVozes() {
    const lista = synth ? synth.getVoices() : [];
    if (lista.length) vozesDisponiveis = lista;
  }
  _carregarVozes();
  if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = _carregarVozes;

  function _voz() {
    if (!vozesDisponiveis.length) _carregarVozes();
    return (
      vozesDisponiveis.find(v => v.lang === 'pt-BR') ||
      vozesDisponiveis.find(v => v.lang.startsWith('pt')) ||
      vozesDisponiveis[0] || null
    );
  }

  /* ── Divisor de texto em frases curtas ─────────────────── */
  function _emFrases(texto) {
    // Limpa marcações de Markdown e normaliza espaços
    const limpo = texto
      .replace(/[#*_~`>]/g, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();

    const frases = [];
    // Divide nos pontos naturais de pausa: . ! ? ; — quebra de linha
    const partes = limpo.split(/(?<=[.!?;])\s+/);

    for (const parte of partes) {
      if (!parte.trim()) continue;
      if (parte.length <= 200) {
        frases.push(parte.trim());
      } else {
        // Parte muito longa: quebra em vírgulas, depois por espaço
        const sub = parte.split(/,\s+/);
        let acum = '';
        for (const s of sub) {
          if ((acum + s).length > 200) {
            if (acum) frases.push(acum.trim());
            acum = s;
          } else {
            acum = acum ? acum + ', ' + s : s;
          }
        }
        if (acum.trim()) frases.push(acum.trim());
      }
    }
    return frases.filter(Boolean);
  }

  /* ── Utterance única ────────────────────────────────────── */
  function _falarFrase(frase, onFim) {
    if (!synth || _parar) { onFim(); return; }

    const u = new SpeechSynthesisUtterance(frase);
    u.rate   = config.velocidade;
    u.pitch  = config.tom;
    u.volume = config.volume;
    u.lang   = config.idioma;
    const v = _voz();
    if (v) u.voice = v;

    _utteranciaAtual = u;

    u.onend   = () => { _utteranciaAtual = null; onFim(); };
    u.onerror = (e) => {
      _utteranciaAtual = null;
      if (e.error === 'interrupted' || e.error === 'canceled') { onFim(); return; }
      console.warn('[TTS] erro na frase:', e.error, '|', frase.slice(0, 60));
      onFim(); // continua mesmo com erro, não trava a fila
    };

    synth.speak(u);
  }

  /* ── Executor de fila de frases ─────────────────────────── */
  function _executarFila(frases, idxInicial, onFim) {
    let idx = idxInicial;

    function proximo() {
      if (_parar || idx >= frases.length) {
        onFim(idx); // retorna onde parou
        return;
      }
      _falarFrase(frases[idx++], () => setTimeout(proximo, 80));
    }

    proximo();
  }

  /* ── API pública ─────────────────────────────────────────── */

  /** Fala um único bloco de texto, dividindo em frases curtas. */
  function falar(texto, callback) {
    if (!synth) return;
    parar();

    const frases = _emFrases(texto);
    if (!frases.length) { if (callback) callback(); return; }

    _parar = false;
    emLeitura = true; emPausa = false;
    if (config.onStart) config.onStart();

    _executarFila(frases, 0, () => {
      if (!_parar) {
        emLeitura = false;
        if (config.onEnd) config.onEnd();
      }
      if (callback) callback();
    });
  }

  /** Fala uma lista de textos, um após o outro. */
  function falarFila(textos, callback) {
    if (!synth) return;
    parar();

    const lista = (Array.isArray(textos) ? textos : [textos]).filter(Boolean);
    if (!lista.length) { if (callback) callback(); return; }

    _parar = false;
    emLeitura = true; emPausa = false;
    if (config.onStart) config.onStart();

    // Achata tudo em frases de uma vez — mais robusto que encadear callbacks
    const todasFrases = lista.flatMap((t, i) => {
      const fs = _emFrases(t);
      // Marca onde começa cada item da lista pra poder disparar onItem
      if (fs.length) fs[0].__itemIdx = i;
      return fs;
    });

    let itemAtual = -1;
    let idxFrase  = 0;

    function proximaFrase() {
      if (_parar || idxFrase >= todasFrases.length) {
        if (!_parar) {
          emLeitura = false;
          if (config.onEnd) config.onEnd();
          if (callback) callback();
        }
        return;
      }
      const frase = todasFrases[idxFrase];
      if (frase.__itemIdx !== undefined && frase.__itemIdx !== itemAtual) {
        itemAtual = frase.__itemIdx;
        if (config.onItem) config.onItem(itemAtual, lista.length);
      }
      idxFrase++;
      _falarFrase(frase, () => setTimeout(proximaFrase, 80));
    }

    proximaFrase();
  }

  function pausar() {
    if (!synth || !emLeitura || emPausa) return;
    _parar = true;   // para a fila sem cancelar utterance atual
    emPausa = true;
    // Guarda o texto que estava sendo falado pra retomar
    if (_utteranciaAtual) {
      _textoRestante = _utteranciaAtual.text || '';
      synth.cancel();
    }
    if (config.onPause) config.onPause();
  }

  function retomar() {
    if (!emPausa) return;
    emPausa = false; _parar = false;
    if (config.onResume) config.onResume();
    if (_textoRestante) {
      falar(_textoRestante);
      _textoRestante = '';
    }
  }

  function parar() {
    _parar = true;
    emLeitura = false; emPausa = false;
    _textoRestante = '';
    _utteranciaAtual = null;
    if (synth) synth.cancel();
    if (config.onStop) config.onStop();
  }

  function suportado() { return !!synth; }

  return {
    suportado,
    falar,
    falarFila,
    pausar,
    retomar,
    parar,
    definirVelocidade: (v) => { config.velocidade = Math.max(0.5, Math.min(2, v)); },
    definirTom:        (t) => { config.tom        = Math.max(0.5, Math.min(2, t)); },
    definirVolume:     (v) => { config.volume      = Math.max(0,   Math.min(1, v)); },
    definirIdioma:     (i) => { config.idioma = i; },
    definirCallbacks:  (cbs) => Object.assign(config, cbs),
    estaFalando:  () => emLeitura && !emPausa,
    estaPausado:  () => emPausa,
    obterVozes:   () => vozesDisponiveis,
    config
  };
})();

window.tts = tts;
