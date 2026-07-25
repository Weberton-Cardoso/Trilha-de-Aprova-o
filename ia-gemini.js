/**
 * ia-gemini.js
 * Ponte entre o app e o Firebase AI Logic (Gemini), usada só pela tela
 * "Resolver com IA" (renderResolverIA em app.js) pra gerar o resumo de
 * cada questão.
 *
 * POR QUE ESTE ARQUIVO É SEPARADO E É type="module":
 * O resto do app (database.js, ciclo.js, cloud-sync.js, app.js...) usa o
 * SDK "compat" do Firebase na versão 10.12.2, carregado como <script>
 * normal (variável global `firebase`), porque é o que o Auth+Firestore de
 * cloud-sync.js já usava. O Firebase AI Logic, porém, só existe no SDK
 * MODULAR (pacote "firebase/ai") — não tem versão compat. Em vez de migrar
 * o app inteiro pro SDK modular (risco alto de quebrar a sincronização que
 * já funciona), este arquivo cria uma SEGUNDA instância do app Firebase,
 * isolada, só pra IA, usando uma versão modular recente do SDK via CDN.
 * As duas convivem sem conflito: cada uma carrega seu próprio bundle,
 * versionado por URL, e não compartilham estado entre si.
 *
 * Se um dia quiser subir a versão do SDK compat (10.12.2 -> 12.x) pra
 * simplificar e ter só uma instância do Firebase, dá pra apagar esse
 * arquivo e usar getApp() do pacote modular pra pegar o mesmo app do
 * cloud-sync.js — mas isso exigiria reescrever cloud-sync.js pro SDK
 * modular também, o que não foi feito aqui de propósito (ir um passo de
 * cada vez).
 *
 * APP CHECK:
 * Desde o início de julho/2026 o próprio fluxo de configuração do AI Logic
 * no Console passou a EXIGIR App Check pra proteger o Gemini API — sem
 * isso, toda chamada é bloqueada. Por isso este arquivo já inicializa o
 * App Check com reCAPTCHA v3 antes de criar o "ai". Pra funcionar, o site
 * key abaixo precisa ser trocado pelo que você gerar no console do
 * reCAPTCHA (ver passo a passo que a IA te mandou no chat).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-ai.js';

// Mesma config de projeto do cloud-sync.js (é pública/client-side, não é
// segredo — a proteção de verdade é feita pelo App Check + regras do
// Firestore). Duplicada aqui de propósito, pra este arquivo não depender
// de nada carregado por cloud-sync.js.
const firebaseConfigIA = {
  apiKey: "AIzaSyBk64IEbSZakYbtcBMvId0iITFA5Xuis8g",
  authDomain: "analisedequestoes-e963c.firebaseapp.com",
  projectId: "analisedequestoes-e963c",
  storageBucket: "analisedequestoes-e963c.firebasestorage.app",
  messagingSenderId: "376267857062",
  appId: "1:376267857062:web:b0613b88922551b0a7e867"
};

// Nome "ia" pra não colidir com o app "[DEFAULT]" que o SDK compat cria.
const appIA = initializeApp(firebaseConfigIA, 'ia');

// ------------------------------------------------------------------
// APP CHECK (reCAPTCHA v3) — troque a string abaixo pela SITE KEY (a
// pública, não a secreta) que você gerar no console do reCAPTCHA.
// ------------------------------------------------------------------
const RECAPTCHA_SITE_KEY = '6Le_22QtAAAAACJ_bVsfo1yZKf0y4quRg0pQbyNX';

// Durante desenvolvimento local (localhost), o reCAPTCHA v3 às vezes não
// valida direito. Descomente as 2 linhas abaixo SÓ enquanto estiver
// testando local — pegue o token que aparece no console do navegador e
// cadastre em Firebase Console > App Check > (seu app) > Gerenciar tokens
// de depuração. NUNCA deixe isso descomentado no código publicado.
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

initializeAppCheck(appIA, {
  provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true
});

// Backend "Gemini Developer API" = gratuito, sem precisar de billing no
// projeto (diferente do backend Vertex AI, que cobra por uso de infra do
// Google Cloud). É o que foi decidido usar (ver Console -> AI Logic).
const ai = getAI(appIA, { backend: new GoogleAIBackend() });

// gemini-3.5-flash: modelo atual (GA) recomendado pra este caso de uso,
// sem exigir billing no projeto. Se um dia parar de funcionar (aviso de
// descontinuação no Console), troque por outro nome vigente em
// AI Logic -> Modelos.
const model = getGenerativeModel(ai, { model: 'gemini-3.5-flash' });

/**
 * Chamada usada por gerarResumoIA() em app.js. Recebe o prompt já pronto
 * (montado em _montarPromptResumo) e devolve só o texto da resposta —
 * quem chamou é responsável por tentar fazer JSON.parse nesse texto.
 * Deixa o erro original subir (não faz try/catch aqui) pra gerarResumoIA
 * decidir a mensagem amigável exibida na tela.
 */
window.chamarGeminiResumo = async function (prompt) {
  const resultado = await model.generateContent(prompt);
  return resultado.response.text();
};
