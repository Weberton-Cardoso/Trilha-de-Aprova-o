/**
 * Módulo TTS (Text-to-Speech)
 * Permite ler textos em voz alta usando Web Speech API
 * Suporta: pausa, resume, stop, velocidade, seleção de idioma
 */

const tts = (() => {
  const synth = window.speechSynthesis;
  let utteranceAtual = null;
  let fila = [];
  let indiceAtual = 0;
  let emLeitura = false;
  let emPausa = false;

  // Configurações
  let config = {
    velocidade: 1,
    tom: 1,
    volume: 1,
    idioma: 'pt-BR',
    highlightCallback: null // callback pra destacar o texto sendo lido
  };

  // Vozes disponíveis (vai preencher ao carregar)
  let vozesDisponiveis = [];

  function inicializar() {
    if (!synth) {
      console.warn('Web Speech API não suportada neste navegador');
      return false;
    }

    vozesDisponiveis = synth.getVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = () => {
        vozesDisponiveis = synth.getVoices();
      };
    }
    return true;
  }

  function falarTexto(texto, callback = null) {
    if (!synth) {
      console.warn('TTS não suportado');
      return;
    }

    // Parar leitura anterior se houver
    parar();

    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.rate = config.velocidade;
    utterance.pitch = config.tom;
    utterance.volume = config.volume;
    utterance.lang = config.idioma;

    // Tentar encontrar voz portuguesa
    const vozPT = vozesDisponiveis.find(v => v.lang.includes('pt'));
    if (vozPT) utterance.voice = vozPT;

    utterance.onstart = () => {
      emLeitura = true;
      emPausa = false;
      if (config.onStart) config.onStart();
    };

    utterance.onend = () => {
      emLeitura = false;
      emPausa = false;
      if (callback) callback();
      if (config.onEnd) config.onEnd();
    };

    utterance.onerror = (e) => {
      console.error('Erro ao falar:', e);
      emLeitura = false;
      if (config.onError) config.onError(e);
    };

    utteranceAtual = utterance;
    synth.speak(utterance);
  }

  function falarFila(textos, callback = null) {
    if (!synth) {
      console.warn('TTS não suportado');
      return;
    }

    parar();
    fila = Array.isArray(textos) ? textos : [textos];
    indiceAtual = 0;

    function _lerProximo() {
      if (indiceAtual >= fila.length) {
        emLeitura = false;
        if (callback) callback();
        return;
      }

      const textoAtual = fila[indiceAtual];
      indiceAtual++;

      falarTexto(textoAtual, () => {
        setTimeout(_lerProximo, 200); // pequeno delay entre items
      });
    }

    _lerProximo();
  }

  function pausar() {
    if (synth && emLeitura && !emPausa) {
      synth.pause();
      emPausa = true;
      if (config.onPause) config.onPause();
    }
  }

  function retomar() {
    if (synth && emLeitura && emPausa) {
      synth.resume();
      emPausa = false;
      if (config.onResume) config.onResume();
    }
  }

  function parar() {
    if (synth) {
      synth.cancel();
      emLeitura = false;
      emPausa = false;
      fila = [];
      indiceAtual = 0;
      if (config.onStop) config.onStop();
    }
  }

  function definirVelocidade(vel) {
    config.velocidade = Math.max(0.5, Math.min(2, vel));
  }

  function definirTom(t) {
    config.tom = Math.max(0.5, Math.min(2, t));
  }

  function definirVolume(vol) {
    config.volume = Math.max(0, Math.min(1, vol));
  }

  function definirIdioma(idioma) {
    config.idioma = idioma;
  }

  function definirCallbacks(callbacks) {
    Object.assign(config, callbacks);
  }

  function estaFalando() {
    return emLeitura;
  }

  function estaPausado() {
    return emPausa;
  }

  function obterVozes() {
    return vozesDisponiveis.filter(v => v.lang.includes(config.idioma));
  }

  return {
    inicializar,
    falar: falarTexto,
    falarFila,
    pausar,
    retomar,
    parar,
    definirVelocidade,
    definirTom,
    definirVolume,
    definirIdioma,
    definirCallbacks,
    estaFalando,
    estaPausado,
    obterVozes,
    config
  };
})();

// Inicializar TTS quando o app carrega
document.addEventListener('DOMContentLoaded', () => {
  if (window.tts) tts.inicializar();
});
