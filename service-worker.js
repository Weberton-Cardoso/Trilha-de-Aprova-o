/**
 * Service Worker - Trilha de Aprovação
 * Faz cache dos arquivos estáticos para o app funcionar 100% offline
 * (dados ficam no IndexedDB, não no cache).
 */

const CACHE_NAME = 'trilha-aprovacao-v87';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './database.js',
  './charts.js',
  './editais.js',
  './importar-historico.js',
  './ciclo.js',
  './perfis.js',
  './cloud-sync.js',
  './ia-gemini.js',
  './revisao.js',
  './simulados.js',
  './estatisticas.js',
  './caderno.js',
  './learning-engine.js',
  './mentor-ia.js',
  './analise-erros.js',
  './configuracoes.js',
  './tts-modulo.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// Instala o SW e guarda os arquivos essenciais em cache.
// Cada arquivo é adicionado individualmente (em vez de cache.addAll, que é
// tudo-ou-nada): se um arquivo faltar ou der 404, os demais continuam sendo
// cacheados normalmente e a instalação do Service Worker não falha por causa dele.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          ASSETS_TO_CACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[service-worker] não foi possível cachear', url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// Remove caches antigos quando uma nova versão do SW assume
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Estratégia: cache-first para os arquivos do app, com fallback de rede.
// Bibliotecas externas (Chart.js, fontes, Firebase modular) usam network-first
// para não travar caso o CDN atualize, mas caem para cache se estiver offline.
// Importante: só GET pode ser guardado em cache (a Cache API não suporta
// POST/PUT/etc — é assim que o Firestore, por exemplo, envia dados).
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') {
    // Deixa passar direto pra rede, sem tentar cachear (evita o erro
    // "Request method 'POST' is unsupported" em chamadas do Firestore).
    return;
  }

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  } else {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
