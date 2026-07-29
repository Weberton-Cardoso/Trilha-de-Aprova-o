/**
 * TTS para Caderno de Resumos
 * Botões de controle, UI de playback, leitura de múltiplos cards
 * 
 * Adicionar ao app.js dentro da função renderCaderno()
 */

function setupTTSCaderno(view) {
  // Elementos da UI
  const ttsControls = `
    <div class="caderno-tts-controls">
      <div class="caderno-tts-top">
        <h3>🔊 Leitor de Resumos</h3>
        <button class="btn btn-sm caderno-tts-close" data-fechar-tts>✕</button>
      </div>

      <div class="caderno-tts-playback">
        <button id="tts-btn-play" class="btn caderno-tts-btn" disabled>
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
          <span>Ler resumos</span>
        </button>
        <button id="tts-btn-pause" class="btn caderno-tts-btn" hidden disabled>
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
          <span>Pausar</span>
        </button>
        <button id="tts-btn-stop" class="btn caderno-tts-btn" disabled>
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>
          <span>Parar</span>
        </button>
      </div>

      <div class="caderno-tts-settings">
        <label>Velocidade:
          <input type="range" id="tts-speed" min="0.5" max="2" step="0.1" value="1">
          <span id="tts-speed-label">1.0x</span>
        </label>
        <label>Tom:
          <input type="range" id="tts-pitch" min="0.5" max="2" step="0.1" value="1">
          <span id="tts-pitch-label">Normal</span>
        </label>
        <label>Volume:
          <input type="range" id="tts-volume" min="0" max="1" step="0.1" value="1">
          <span id="tts-volume-label">100%</span>
        </label>
      </div>

      <div id="tts-progress" class="caderno-tts-progress" hidden>
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
        <div class="progress-text">
          <span id="tts-current">0</span> / <span id="tts-total">0</span>
        </div>
      </div>

      <div id="tts-status" class="caderno-tts-status">
        Selecione resumos para ler. <small>Dica: selecione um tópico na esquerda primeiro</small>
      </div>
    </div>
  `;

  // Injetar controles na view
  const cadernoBotoes = `<div class="caderno-top-buttons">
    <button class="btn btn-outline caderno-btn-tts">🔊 Ler em voz alta</button>
  </div>`;

  // Adicionar checkbox em cada resumo pra seleção
  const setupCheckboxesResumos = () => {
    $$('[data-resumo-id]', view).forEach(card => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.class = 'resumo-checkbox';
      checkbox.dataset.resumoId = card.dataset.resumoId;
      
      const titulo = $('.caderno-card-titulo', card);
      if (titulo) {
        const checkboxContainer = document.createElement('span');
        checkboxContainer.style.marginRight = '8px';
        checkboxContainer.appendChild(checkbox);
        titulo.parentElement.insertBefore(checkboxContainer, titulo);
      }
    });
  };

  // Callbacks do TTS
  tts.definirCallbacks({
    onStart: () => {
      $('#tts-status').textContent = '🔊 Lendo...';
      $('#tts-btn-play').hidden = true;
      $('#tts-btn-pause').hidden = false;
    },
    onPause: () => {
      $('#tts-status').textContent = '⏸️ Pausado';
      $('#tts-btn-play').hidden = false;
      $('#tts-btn-pause').hidden = true;
    },
    onResume: () => {
      $('#tts-status').textContent = '🔊 Lendo...';
      $('#tts-btn-play').hidden = true;
      $('#tts-btn-pause').hidden = false;
    },
    onEnd: () => {
      $('#tts-status').textContent = '✓ Leitura concluída';
      $('#tts-btn-play').hidden = false;
      $('#tts-btn-pause').hidden = true;
    },
    onError: (e) => {
      $('#tts-status').textContent = `❌ Erro: ${e.error}`;
    }
  });

  // Event listeners
  $('#tts-btn-play', view)?.addEventListener('click', () => {
    const resumosSelecionados = $$('input.resumo-checkbox:checked', view)
      .map(cb => state.resumos.find(r => r.id === Number(cb.dataset.resumoId)))
      .filter(Boolean);

    if (!resumosSelecionados.length) {
      showToast('Selecione pelo menos um resumo', 'info');
      return;
    }

    const textos = resumosSelecionados.map(r => 
      `${r.materia || 'Resumo'}: ${r.textoBruto || ''}`
    );

    $('#tts-progress').hidden = false;
    $('#tts-total').textContent = textos.length;
    $('#tts-current').textContent = '0';

    tts.falarFila(textos, () => {
      showToast('Leitura concluída!', 'success');
    });
  });

  $('#tts-btn-pause', view)?.addEventListener('click', () => {
    if (tts.estaPausado()) {
      tts.retomar();
    } else {
      tts.pausar();
    }
  });

  $('#tts-btn-stop', view)?.addEventListener('click', () => {
    tts.parar();
    $('#tts-progress').hidden = true;
    $('#tts-status').textContent = 'Parado';
    $('#tts-btn-play').hidden = false;
    $('#tts-btn-pause').hidden = true;
  });

  $('#tts-speed', view)?.addEventListener('input', (e) => {
    const vel = parseFloat(e.target.value);
    tts.definirVelocidade(vel);
    $('#tts-speed-label').textContent = `${vel.toFixed(1)}x`;
  });

  $('#tts-pitch', view)?.addEventListener('input', (e) => {
    const ton = parseFloat(e.target.value);
    tts.definirTom(ton);
    const label = ton < 1 ? 'Grave' : ton > 1 ? 'Agudo' : 'Normal';
    $('#tts-pitch-label').textContent = label;
  });

  $('#tts-volume', view)?.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    tts.definirVolume(vol);
    $('#tts-volume-label').textContent = `${Math.round(vol * 100)}%`;
  });

  $('.caderno-btn-tts', view)?.addEventListener('click', () => {
    const controls = $('#caderno-tts-controls');
    if (controls) {
      controls.hidden = !controls.hidden;
    }
  });

  $('.caderno-tts-close', view)?.addEventListener('click', () => {
    $('#caderno-tts-controls').hidden = true;
    tts.parar();
  });
}

// Exportar pra usar no renderCaderno()
window.setupTTSCaderno = setupTTSCaderno;
