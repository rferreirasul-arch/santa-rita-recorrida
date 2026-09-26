"use strict";

const CFG = window.APP_CONFIG || {};
const DEMO = !CFG.API_URL || !CFG.CLIENT_ID;
const DIAS_LOTACAO_VELHA = 30; // lotação conferida há mais tempo que isso aparece em destaque
const DIAS_SEM_MINERAL = 30;   // idem para cocho sem abastecer
const DIAS_MINERAIS_SUGERIDOS = 15; // minerais usados no potreiro nesse período já vêm na recorrida

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Listas iniciais (as mesmas do Code.gs). Valem até a primeira sincronização
// e no modo demonstração; depois, o que vale é a planilha.
const CATALOGO_INICIAL = {
  potreiros: [
    ["Açudezinho"], ["Alto Grande"], ["Andreu arroio"], ["Aruana Banheiro"], ["Aruana Sinuelo"], ["Banhado"],
    ["Banhado Sudão"], ["Banhado trevinho"], ["Banheiro"], ["Brachiaria Banheiro"], ["Brachiaria Capororoca"],
    ["Brachiaria Sinuelo"], ["Campo Novo"], ["Capororoca"], ["Chico"], ["Chico arroio (sarandy)", "chico arroio; sarandi"],
    ["Chico miroca (silencio)", "chico miroca; silêncio"], ["Chico sinuelo (sementeira)", "chico sementeira; chico sinuelo"],
    ["Elbio"], ["Felomena", "filomena"], ["Felomena Banhado", "filomena banhado"], ["Felomena Meio", "filomena meio"],
    ["Festuca"], ["Fundo"], ["Frente"], ["Gelia Banhado"], ["Gelia Frente"], ["Gelia Fundo"], ["Gelia Umbu"], ["Gomos"],
    ["JC"], ["Lucia Helena"], ["Miroca"], ["Miroca cerro"], ["Miroca açude"], ["Miroca fundo"], ["Nina"], ["Nina frente"],
    ["Pastagem Banhado"], ["Pastagem Felomena", "pastagem filomena"], ["Pastagem Sinuelo"], ["Potreirinho", "potrerinho"],
    ["Ratão Alto"], ["Ratão Frente"], ["Ratão Fundo"], ["Ratinho"], ["Rodizio Sinuelo"], ["Rodizio"],
    ["Rodizio Potreirinho", "rodízios potreirinho"], ["Rodizio frente"], ["Sementeira", "sementera"], ["Sinuelo"], ["Umbu"], ["Zuri"],
  ].map(([nome, alternativos = ""]) => ({ nome, alternativos, ativo: true, cochos: [null, null], contorno: "" })),
  minerais: [
    ["Advance", "avanço", ""], ["Aveia Azevém", "AA", 30], ["Bovigold Pasto", "", 30], ["Energético 25 M", "PE25", 30],
    ["Engorda", "", 30], ["Fosbovinho ADE", "fós bovinho; fosbovin", 25], ["Pampero", "pampeiro", 30],
    ["Proteico 30 M", "proteico; P30", 30], ["Reprodução", "", 30], ["Seca", "", 30], ["Pasto Crina", "pasto e crina", 25],
    ["Ração", "rasão", ""],
  ].map(([nome, alternativos, kg]) => ({ nome, alternativos, kg, ativo: true })),
  categorias: [
    ["Vacas", "vaca; vc"], ["Vacas com cria", "vaca com cria; vacas c cria; vc com cria"], ["Novilhas", "vaq; vaquilhona; vq"],
    ["Novilhos", "boi; bois"], ["Terneiros", "ternero; terneira"], ["Touros", "boluti; toro; touro"],
    ["Ovelhas", ""], ["Cordeiros", ""], ["Borregas", ""], ["Carneiros", ""],
  ].map(([nome, alternativos]) => ({ nome, alternativos, ativo: true })),
};

let registros = [];   // recorridas guardadas no aparelho (inclusive excluídas)
let catalogo = CATALOGO_INICIAL;
let alteracoes = [];  // cadastros feitos no aparelho e ainda não enviados (potreiro novo, cocho, categoria, mineral)
let faltas = [];      // faltas de mineral no depósito (aba Faltas da planilha)
let usuario = null;   // { email, nome, chave }
let editId = null;
let sincronizando = false;
let limiteLista = 60;

// =====================================================================
// Banco local (IndexedDB): é aqui que os registros ficam quando não há sinal
// =====================================================================
const db = (() => {
  let conexao;
  const abrir = () => conexao ||= new Promise((ok, falha) => {
    const r = indexedDB.open("santa-rita-recorrida", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("registros", { keyPath: "id" });
      r.result.createObjectStore("meta");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
  const tx = async (loja, modo, fn) => {
    const d = await abrir();
    return new Promise((ok, falha) => {
      const t = d.transaction(loja, modo);
      const req = fn(t.objectStore(loja));
      t.oncomplete = () => ok(req?.result);
      t.onerror = () => falha(t.error);
    });
  };
  return {
    todos: () => tx("registros", "readonly", (s) => s.getAll()),
    gravar: (r) => tx("registros", "readwrite", (s) => s.put(r)),
    gravarVarios: (rs) => tx("registros", "readwrite", (s) => { rs.forEach((r) => s.put(r)); }),
    apagar: (ids) => tx("registros", "readwrite", (s) => { ids.forEach((id) => s.delete(id)); }),
    ler: (k) => tx("meta", "readonly", (s) => s.get(k)),
    salvar: (k, v) => tx("meta", "readwrite", (s) => s.put(v, k)),
  };
})();

// =====================================================================
// Utilidades
// =====================================================================
const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const somaDias = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fmtData = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
// Data e hora completas (ex.: marcação do cocho) no fuso do aparelho
const fmtMomento = (iso) => { const d = new Date(iso); return isNaN(d) ? fmtData(iso) : d.toLocaleDateString("pt-BR"); };
const fmtNum = (n, casas = 0) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtQ = (n) => fmtNum(n, Number(n) % 1 ? 1 : 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Busca: ignora acentos, maiúsculas e espaços repetidos
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const mesmoNome = (a, b) => norm(a) === norm(b);
const numero = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : NaN; };
const ativos = () => registros.filter((r) => !r.excluido);
const pendentes = () => registros.filter((r) => r._pendente);
const faltasAtivas = () => faltas.filter((f) => !f.excluido);
const faltasAbertas = () => faltasAtivas().filter((f) => !f.reposto_em);
const faltasPendentes = () => faltas.filter((f) => f._pendente);
const totalPendente = () => pendentes().length + alteracoes.length + faltasPendentes().length;
const quem = (email) => String(email || "").split("@")[0];
const haDias = (iso) => {
  const d = diasEntre(iso, hojeISO());
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), ms);
}

// Todos os termos digitados precisam aparecer no nome ou num nome alternativo
function combina(item, q) {
  const termos = norm(q).split(" ").filter(Boolean);
  if (!termos.length) return true;
  const alvo = norm(`${item.nome} ; ${item.alternativos || ""}`);
  return termos.every((t) => alvo.includes(t));
}
const acharItem = (lista, nome) => lista.find((i) => mesmoNome(i.nome, nome))
  || lista.find((i) => String(i.alternativos || "").split(/[;,]/).some((a) => a.trim() && mesmoNome(a, nome)));
const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
const kgDoMineral = (nome) => Number(acharItem(catalogo.minerais, nome)?.kg) || 0;

// =====================================================================
// Login: Google só na primeira vez em cada aparelho. A planilha devolve uma
// chave permanente deste aparelho, usada em todos os envios seguintes.
// O administrador bloqueia um aparelho na aba "Aparelhos" (Ativo = NÃO).
// =====================================================================
const aparelhoLiberado = () => !!usuario?.chave;

function lerJwt(token) {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

function nomeAparelho() {
  const ua = navigator.userAgent;
  const tipo = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Outro";
  const nav = /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "navegador";
  const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `${tipo} · ${instalado ? "app instalado" : nav}`;
}

function guardarUsuario() {
  localStorage.setItem("srr_usuario", JSON.stringify(usuario));
}

async function aoReceberCredencial(resp) {
  const info = lerJwt(resp.credential);
  const primeiroAcesso = !usuario;
  if (primeiroAcesso) $("#login-msg").textContent = "Liberando este aparelho…";
  try {
    const r = await chamarApi({ action: "registrar", token: resp.credential, aparelho: nomeAparelho() });
    usuario = { email: r.usuario.email, nome: info.given_name || r.usuario.nome, chave: r.chave };
    guardarUsuario();
    $("#relogin").hidden = true;
    $("#login-msg").textContent = "";
    entrarNoApp();
    mostrarQuem();
    sincronizar();
  } catch (e) {
    if (primeiroAcesso) {
      $("#login-msg").textContent = e.message;
      usuario = null;
      google.accounts.id.disableAutoSelect();
    } else toast(e.message, 6000);
  }
}

window.onGoogleLibraryLoad = () => {
  if (DEMO) return;
  google.accounts.id.initialize({
    client_id: CFG.CLIENT_ID,
    callback: aoReceberCredencial,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
  });
  const opcoes = { theme: "filled_blue", size: "large", text: "signin_with", shape: "pill", locale: "pt-BR" };
  google.accounts.id.renderButton($("#gbtn"), opcoes);
  google.accounts.id.renderButton($("#relogin-btn"), { ...opcoes, size: "medium" });
  if (!aparelhoLiberado() && navigator.onLine) google.accounts.id.prompt();
};

async function sair() {
  const n = totalPendente();
  if (n && !confirm(`Há ${n} registro(s) ainda não enviados à planilha. Se sair agora, eles continuam guardados neste aparelho e serão enviados no próximo login. Sair mesmo assim?`)) return;
  if (usuario?.chave && navigator.onLine) {
    await Promise.race([chamarApi({ action: "sair", chave: usuario.chave }).catch(() => {}), new Promise((ok) => setTimeout(ok, 4000))]);
  }
  localStorage.removeItem("srr_usuario");
  window.google?.accounts?.id?.disableAutoSelect();
  location.reload();
}

// =====================================================================
// Sincronização com a planilha (Google Apps Script)
// =====================================================================
async function chamarApi(corpo) {
  const r = await fetch(CFG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita a checagem CORS extra
    body: JSON.stringify(corpo),
  });
  const j = await r.json();
  if (!j.ok) {
    const erro = new Error(j.erro || "Erro no servidor");
    erro.codigo = j.codigo;
    throw erro;
  }
  return j;
}

const semCampoLocal = ({ _pendente, ...r }) => r;

async function sincronizar(manual = false) {
  if (sincronizando) return;
  if (DEMO) { if (manual) toast("Modo demonstração: configure o config.js para ligar a planilha."); return; }
  if (!navigator.onLine) { if (manual) toast("Sem sinal. Os registros estão guardados neste aparelho."); atualizarStatus(); return; }

  sincronizando = true;
  atualizarStatus();
  try {
    if (!aparelhoLiberado()) {
      $("#relogin").hidden = false;
      window.google?.accounts?.id?.prompt();
      if (manual) toast("Entre com o Google uma última vez para liberar este aparelho.");
      return;
    }

    const envio = pendentes().map(semCampoLocal);
    const envioAlt = alteracoes.slice();
    const envioFaltas = faltasPendentes().map(semCampoLocal);
    const resp = await chamarApi({ action: "sync", chave: usuario.chave, registros: envio, alteracoes: envioAlt, faltas: envioFaltas });

    // Junta o que veio da planilha com o que está no aparelho.
    // Um registro editado aqui durante o envio (mais novo) continua pendente.
    const locais = new Map((await db.todos()).map((r) => [r.id, r]));
    const doServidor = new Set();
    const gravar = [];
    for (const s of resp.registros) {
      doServidor.add(s.id);
      const l = locais.get(s.id);
      if (l?._pendente && l.atualizado_em > s.atualizado_em) continue;
      gravar.push({ ...s, _pendente: false });
    }
    const remover = [...locais.values()].filter((l) => !doServidor.has(l.id) && !l._pendente).map((l) => l.id);
    await db.gravarVarios(gravar);
    await db.apagar(remover);

    // Cadastros: vale a planilha, mais o que foi feito aqui durante o envio
    if (resp.catalogo) {
      const enviados = new Set(envioAlt.map((a) => a.id));
      alteracoes = alteracoes.filter((a) => !enviados.has(a.id));
      catalogo = resp.catalogo;
      alteracoes.forEach((a) => aplicarAlteracao(catalogo, a));
      await db.salvar("catalogo", catalogo);
      await db.salvar("alteracoes", alteracoes);
    }
    // Faltas: vale a planilha, exceto o que foi alterado aqui depois do envio
    if (resp.faltas) {
      const locais = new Map(faltas.map((f) => [f.id, f]));
      const novas = resp.faltas.map((sv) => {
        const l = locais.get(sv.id);
        return l?._pendente && l.atualizado_em > sv.atualizado_em ? l : { ...sv, _pendente: false };
      });
      const ids = new Set(novas.map((f) => f.id));
      faltas.filter((f) => f._pendente && !ids.has(f.id)).forEach((f) => novas.push(f));
      faltas = novas;
      await db.salvar("faltas", faltas);
    }
    await db.salvar("ultimo_sync", Date.now());
    registros = await db.todos();
    renderTudo();
    const n = envio.length + envioAlt.length + envioFaltas.length;
    if (manual || n) toast(n ? `${n} registro(s) enviado(s) à planilha.` : "Tudo sincronizado.");
  } catch (e) {
    if (e.codigo === "APARELHO") {
      usuario.chave = "";
      guardarUsuario();
      $("#relogin").hidden = false;
      toast(e.message, 6000);
    }
    else if (e.codigo === "NEGADO") toast(e.message, 6000);
    else if (manual) toast("Não foi possível sincronizar agora. Tentaremos de novo automaticamente.");
    console.warn("Sincronização:", e);
  } finally {
    sincronizando = false;
    atualizarStatus();
  }
}

function atualizarStatus() {
  const el = $("#sync-status");
  const n = totalPendente();
  el.className = "pill";
  if (DEMO) { el.textContent = "Demonstração"; return; }
  if (sincronizando) { el.textContent = "Sincronizando…"; return; }
  if (!navigator.onLine) {
    el.classList.add("off");
    el.textContent = n ? `Sem sinal · ${n} pendente${n > 1 ? "s" : ""}` : "Sem sinal";
    return;
  }
  if (!aparelhoLiberado()) { el.classList.add("pend"); el.textContent = n ? `${n} pendente${n > 1 ? "s" : ""} · falta login` : "Falta login"; return; }
  if (n) { el.classList.add("pend"); el.textContent = `${n} pendente${n > 1 ? "s" : ""}`; return; }
  el.classList.add("ok");
  el.textContent = "Sincronizado";
}

// =====================================================================
// Cadastros feitos no aparelho (potreiro novo, cocho, categoria, mineral)
// =====================================================================
function aplicarAlteracao(cat, a) {
  const lista = { potreiro: cat.potreiros, mineral: cat.minerais, categoria: cat.categorias }[a.tipo];
  if (lista) {
    if (!lista.some((i) => mesmoNome(i.nome, a.nome))) {
      lista.push(a.tipo === "potreiro"
        ? { nome: a.nome, alternativos: "", ativo: true, cochos: [null, null], contorno: "" }
        : { nome: a.nome, alternativos: "", ativo: true, kg: "" });
    }
    return;
  }
  if (a.tipo === "cocho") {
    let p = cat.potreiros.find((i) => mesmoNome(i.nome, a.potreiro));
    if (!p) cat.potreiros.push(p = { nome: a.potreiro, alternativos: "", ativo: true, cochos: [null, null], contorno: "" });
    p.cochos ||= [null, null];
    p.cochos[a.n - 1] = { lat: a.lat, lon: a.lon, precisao: a.precisao, por: a.por, em: a.em, pendente: true };
  }
}

async function registrarAlteracao(a) {
  a = { id: novoId(), por: usuario?.email || "demo", ...a };
  alteracoes.push(a);
  aplicarAlteracao(catalogo, a);
  await db.salvar("alteracoes", alteracoes);
  await db.salvar("catalogo", catalogo);
  atualizarStatus();
  sincronizar();
}

// =====================================================================
// Localização (GPS)
// =====================================================================
let pos = null;           // { lat, lon, acc, t }
let gpsMsg = "";
let buscandoGps = false;
let autoEscolhaFeita = false;

function atualizarGps(forcar = false) {
  if (!navigator.geolocation) { gpsMsg = "Este aparelho não informa a localização."; renderGps(); return; }
  if (buscandoGps) return;
  if (!forcar && pos && Date.now() - pos.t < 60_000) return;
  buscandoGps = true;
  gpsMsg = "Procurando sua localização…";
  renderGps();
  navigator.geolocation.getCurrentPosition(
    (p) => {
      buscandoGps = false;
      pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      gpsMsg = "";
      renderGps();
      renderPotLista();
      escolherPelaLocalizacao();
    },
    (e) => {
      buscandoGps = false;
      gpsMsg = e.code === 1
        ? "Localização não liberada. Permita nas configurações do navegador para ver os potreiros próximos."
        : "Sem sinal de GPS agora. Use a busca.";
      renderGps();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: forcar ? 0 : 30000 },
  );
}

function renderGps() {
  $("#gps-txt").textContent = gpsMsg || (pos ? `Sua localização: precisão de ±${Math.round(pos.acc)} m` : "Localização: aguardando…");
  $("#btn-gps").hidden = buscandoGps;
}

// Coordenadas locais em metros (suficiente para distâncias dentro da fazenda)
function paraMetros(lat, lon, ref) {
  return { x: (lon - ref.lon) * 111320 * Math.cos((ref.lat * Math.PI) / 180), y: (lat - ref.lat) * 110540 };
}
function distanciaM(a, b) {
  const p = paraMetros(b.lat, b.lon, a);
  return Math.hypot(p.x, p.y);
}

// Contorno no formato do KML: "lon,lat[,alt] lon,lat …" (vários polígonos separados por "|")
const contornos = new Map();
function lerContorno(txt) {
  if (!txt) return [];
  if (contornos.has(txt)) return contornos.get(txt);
  const polis = String(txt).split("|").map((parte) => parte.trim().split(/[\s;]+/)
    .map((c) => c.split(",").map(Number))
    .filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]))
    .map(([lon, lat]) => ({ lat, lon })))
    .filter((p) => p.length >= 3);
  contornos.set(txt, polis);
  return polis;
}

function dentroDoPoligono(pt, poli) {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i], b = poli[j];
    if ((a.lat > pt.lat) !== (b.lat > pt.lat)
      && pt.lon < ((b.lon - a.lon) * (pt.lat - a.lat)) / (b.lat - a.lat) + a.lon) dentro = !dentro;
  }
  return dentro;
}

function distanciaAoContorno(pt, poli) {
  let min = Infinity;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = paraMetros(poli[j].lat, poli[j].lon, pt), b = paraMetros(poli[i].lat, poli[i].lon, pt);
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
    min = Math.min(min, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return min;
}

// Distância da pessoa até o potreiro: 0 se está dentro do contorno;
// senão, o menor valor entre a divisa do contorno e os cochos marcados
function distanciaPotreiro(p) {
  if (!pos) return null;
  const polis = lerContorno(p.contorno);
  if (polis.some((poli) => dentroDoPoligono(pos, poli))) return { m: 0, aqui: true };
  let m = Infinity;
  polis.forEach((poli) => { m = Math.min(m, distanciaAoContorno(pos, poli)); });
  (p.cochos || []).forEach((c) => { if (c) m = Math.min(m, distanciaM(pos, c)); });
  return isFinite(m) ? { m, aqui: false } : null;
}
const fmtDist = (d) => (!d ? "" : d.aqui ? "Você está aqui"
  : d.m < 1000 ? `~${Math.max(10, Math.round(d.m / 10) * 10)} m` : `${fmtNum(d.m / 1000, 1)} km`);

// =====================================================================
// Lotação e mineral: o que já se sabe de cada potreiro
// =====================================================================
const ordenar = (a, b) => (b.data || "").localeCompare(a.data || "") || (b.criado_em || "").localeCompare(a.criado_em || "");

function ultimoDoPotreiro(nome, tipo, excluirId = null) {
  return ativos()
    .filter((r) => r.id !== excluirId && mesmoNome(r.potreiro, nome) && (tipo === "lotacao" ? r.lotacao : r.minerais?.length))
    .sort(ordenar)[0] || null;
}

// Situação atual de cada potreiro (última lotação conferida e último mineral)
function estadoPotreiros() {
  const mapa = new Map();
  const doPot = (nome) => {
    const k = norm(nome);
    if (!mapa.has(k)) mapa.set(k, { lotacao: null, mineral: null });
    return mapa.get(k);
  };
  ativos().sort(ordenar).forEach((r) => {
    const e = doPot(r.potreiro);
    if (r.lotacao && !e.lotacao) e.lotacao = r;
    if (r.minerais?.length && !e.mineral) e.mineral = r;
  });
  return mapa;
}

const totalAnimais = (r) => (r?.lotacao === "conferida" ? (r.animais || []).reduce((s, a) => s + Number(a.qtd || 0), 0) : 0);
const txtAnimais = (r) => (r.lotacao === "vazio" ? "Potreiro vazio" : (r.animais || []).map((a) => `${fmtQ(a.qtd)} ${a.categoria}`).join(" · "));
const txtMinerais = (r) => (r.minerais || []).map((m) => `${fmtQ(m.sacos)} sc ${m.mineral}`).join(" · ");

// =====================================================================
// Registro: escolha do potreiro
// =====================================================================
let potSel = null; // nome do potreiro escolhido

function renderPotLista() {
  const q = $("#pot-q").value;
  const estado = estadoPotreiros();
  const lista = catalogo.potreiros.filter((p) => p.ativo !== false).map((p) => ({ p, d: distanciaPotreiro(p) }));
  const item = ({ p, d }) => {
    const lot = estado.get(norm(p.nome))?.lotacao;
    const sub = lot ? (lot.lotacao === "vazio" ? "Vazio" : `${fmtNum(totalAnimais(lot))} animais`) : "";
    return `<button type="button" class="pot-item ${d?.aqui ? "aqui" : ""}" data-pot="${esc(p.nome)}">
      <span><b>${esc(p.nome)}</b>${sub ? `<small>${sub}</small>` : ""}</span>
      <span class="dist">${fmtDist(d)}</span></button>`;
  };
  const sec = (t) => `<div class="pot-sec">${t}</div>`;
  let html = "";

  if (!norm(q)) {
    const prox = lista.filter((x) => x.d).sort((a, b) => a.d.m - b.d.m).slice(0, 5);
    if (prox.length) html += sec("Mais próximos") + prox.map(item).join("") + sec("Todos os potreiros");
    html += lista.slice().sort((a, b) => porNome(a.p, b.p)).map(item).join("");
  } else {
    const nq = norm(q);
    const achados = lista.filter((x) => combina(x.p, q)).sort((a, b) =>
      (norm(b.p.nome).startsWith(nq) - norm(a.p.nome).startsWith(nq))
      || ((a.d?.m ?? Infinity) - (b.d?.m ?? Infinity))
      || porNome(a.p, b.p));
    html += achados.length ? achados.map(item).join("") : `<p class="pot-vazio">Nenhum potreiro com “${esc(q.trim())}”.</p>`;
    if (!achados.some((x) => mesmoNome(x.p.nome, q))) {
      html += `<button type="button" class="pot-add" data-novo-pot>+ Adicionar potreiro “${esc(q.trim())}”</button>`;
    }
  }
  $("#pot-lista").innerHTML = html;
}

function escolherPotreiro(nome, { auto = false, preencher = true } = {}) {
  const p = catalogo.potreiros.find((i) => mesmoNome(i.nome, nome));
  potSel = p ? p.nome : nome;
  $("#pot-busca").hidden = true;
  $("#pot-escolhido").hidden = false;
  $("#pe-nome").textContent = potSel;
  const d = p && distanciaPotreiro(p);
  $("#pe-info").textContent = auto ? "Escolhido pela sua localização" : d ? fmtDist(d) : "";
  $("#pot-q").classList.remove("erro");

  const lot = ultimoDoPotreiro(potSel, "lotacao", editId);
  const min = ultimoDoPotreiro(potSel, "mineral", editId);
  $("#pe-ultima").innerHTML = [
    lot ? `<b>Lotação</b> (${fmtData(lot.data)}, ${haDias(lot.data)}): ${esc(txtAnimais(lot))}` : "",
    min ? `<b>Mineral</b> (${fmtData(min.data)}, ${haDias(min.data)}): ${esc(txtMinerais(min))}` : "",
    ...faltasAbertas().filter((f) => mesmoNome(f.potreiro, potSel))
      .map((f) => `<b class="txt-falta">Falta no depósito</b>: ${esc(f.mineral)} (desde ${fmtData(f.data)})`),
  ].filter(Boolean).join("<br>") || "Ainda sem recorridas registradas neste potreiro.";
  renderBotaoCochos();
  if (preencher) preencherPeloHistorico(lot, min);
  renderFaltas();
}

function trocarPotreiro() {
  potSel = null;
  $("#pot-escolhido").hidden = true;
  $("#pot-busca").hidden = false;
  $("#pot-q").value = "";
  renderPotLista();
  atualizarGps();
  $("#pot-q").focus();
}

// Se a pessoa está dentro do contorno de um único potreiro, ele já vem escolhido
function escolherPelaLocalizacao() {
  if (autoEscolhaFeita || potSel || editId || !pos || pos.acc > 50) return;
  const dentro = catalogo.potreiros.filter((p) => p.ativo !== false && distanciaPotreiro(p)?.aqui);
  if (dentro.length !== 1) return;
  autoEscolhaFeita = true;
  escolherPotreiro(dentro[0].nome, { auto: true });
}

function renderBotaoCochos() {
  const p = catalogo.potreiros.find((i) => mesmoNome(i.nome, potSel));
  const n = (p?.cochos || []).filter(Boolean).length;
  $("#btn-cochos-txt").textContent = n ? `Cochos: ${n} de 2 marcados` : "Marcar localização do cocho";
}

// ---------- Novo potreiro ----------
function abrirNovoPotreiro() {
  const q = $("#pot-q").value.trim().replace(/\s+/g, " ");
  $("#np-nome").value = q ? q[0].toUpperCase() + q.slice(1) : "";
  $("#np-aviso").hidden = true;
  $("#dlg-potreiro").showModal();
  $("#np-nome").focus();
}

function conferirNovoPotreiro() {
  const nome = $("#np-nome").value.trim();
  const existe = nome && acharItem(catalogo.potreiros, nome);
  $("#np-aviso").hidden = !existe;
  if (existe) $("#np-aviso").textContent = `Já existe o potreiro “${existe.nome}”. Ao confirmar, ele será escolhido.`;
  return existe;
}

async function salvarNovoPotreiro(ev) {
  ev.preventDefault();
  const nome = $("#np-nome").value.trim().replace(/\s+/g, " ");
  if (!nome) { $("#np-nome").classList.add("erro"); return; }
  const existe = conferirNovoPotreiro();
  $("#dlg-potreiro").close();
  if (existe) { escolherPotreiro(existe.nome); return; }
  await registrarAlteracao({ tipo: "potreiro", nome });
  escolherPotreiro(nome);
  toast(`Potreiro “${nome}” adicionado.`);
}

// =====================================================================
// Cochos: marcar a localização com o GPS
// =====================================================================
let cap = null; // captura em andamento

function abrirCochos() {
  if (!potSel) return;
  $("#dc-nome").textContent = potSel;
  renderCochos();
  $("#dlg-cochos").showModal();
}

function renderCochos() {
  const p = catalogo.potreiros.find((i) => mesmoNome(i.nome, potSel));
  $("#dc-lista").innerHTML = [0, 1].map((i) => {
    const c = p?.cochos?.[i];
    const dist = c && pos ? ` · você está a ~${Math.round(distanciaM(pos, c))} m` : "";
    const quem = c?.por ? ` por ${esc(String(c.por).split("@")[0])}` : "";
    return `<div class="cocho">
      <div class="cocho-topo"><b>Cocho ${i + 1}</b>
        <button type="button" class="btn-light" data-marcar="${i + 1}" ${cap ? "disabled" : ""}>${c ? "Substituir" : "Marcar aqui"}</button></div>
      <p>${c ? `<span class="ok">✓ Marcado</span>${c.em ? ` em ${fmtMomento(c.em)}` : ""}${quem}${c.precisao ? ` · ±${Math.round(c.precisao)} m` : ""}${dist}
        ${c.pendente ? " · <i>aguardando envio</i>" : ""}
        · <a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}" target="_blank" rel="noopener">ver no mapa</a>`
        : "Ainda não marcado."}</p>
    </div>`;
  }).join("");
}

// Junta as leituras do GPS: usa as mais precisas, com peso maior para as melhores
function estimativa(leituras) {
  if (!leituras.length) return null;
  const melhor = Math.min(...leituras.map((l) => l.acc));
  const boas = leituras.filter((l) => l.acc <= Math.max(melhor * 1.5, melhor + 3));
  let sp = 0, lat = 0, lon = 0;
  boas.forEach((l) => { const w = 1 / (l.acc * l.acc); sp += w; lat += l.lat * w; lon += l.lon * w; });
  return { lat: lat / sp, lon: lon / sp, acc: melhor, n: boas.length };
}

function iniciarCaptura(n) {
  if (!navigator.geolocation) { toast("Este aparelho não informa a localização."); return; }
  cap = { n, leituras: [], ini: Date.now(), erro: "" };
  cap.watch = navigator.geolocation.watchPosition(
    (p) => cap?.leituras.push({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
    (e) => { if (cap) cap.erro = e.code === 1 ? "Localização não liberada neste navegador." : "Sem sinal de GPS. Tente num lugar mais aberto."; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  );
  cap.timer = setInterval(atualizarCaptura, 500);
  $("#cap-titulo").textContent = `Marcando o Cocho ${n}: fique ao lado dele`;
  $("#dc-captura").hidden = false;
  renderCochos();
  atualizarCaptura();
}

function atualizarCaptura() {
  if (!cap) return;
  const seg = (Date.now() - cap.ini) / 1000;
  const e = estimativa(cap.leituras);
  const pronto = e && e.acc <= 10 && cap.leituras.length >= 3;
  const aceitavel = e && (e.acc <= 25 || (seg > 20 && e.acc <= 50));
  $("#cap-i").style.width = `${pronto ? 100 : Math.min(95, (seg / 25) * 100)}%`;
  $("#cap-gravar").disabled = !aceitavel;
  $("#cap-gravar").textContent = e ? `Gravar (±${Math.round(e.acc)} m)` : "Gravar";
  $("#cap-info").textContent = cap.erro && !e ? cap.erro
    : !e ? "Procurando sinal do GPS…"
    : pronto ? `Pronto: precisão de ±${Math.round(e.acc)} m. Pode gravar.`
    : `Precisão atual: ±${Math.round(e.acc)} m. Aguarde alguns segundos para melhorar${aceitavel ? " ou grave agora" : ""}.`;
  if (seg > 45) navigator.geolocation.clearWatch(cap.watch);
}

function pararCaptura() {
  if (!cap) return;
  navigator.geolocation.clearWatch(cap.watch);
  clearInterval(cap.timer);
  cap = null;
  $("#dc-captura").hidden = true;
  if ($("#dlg-cochos").open) renderCochos();
}

async function gravarCaptura() {
  const e = cap && estimativa(cap.leituras);
  if (!e) return;
  const n = cap.n;
  const p = catalogo.potreiros.find((i) => mesmoNome(i.nome, potSel));
  if (p?.cochos?.[n - 1] && !confirm(`Substituir a localização do Cocho ${n} de ${potSel}?`)) return;
  pararCaptura();
  await registrarAlteracao({
    tipo: "cocho", potreiro: potSel, n,
    lat: Number(e.lat.toFixed(6)), lon: Number(e.lon.toFixed(6)), precisao: Math.round(e.acc), em: new Date().toISOString(),
  });
  renderCochos();
  renderBotaoCochos();
  toast(`Cocho ${n} de ${potSel} marcado (±${Math.round(e.acc)} m).`);
}

// =====================================================================
// Caixa de seleção com filtro (categoria e mineral)
// =====================================================================
const listaDoTipo = (tipo) => (tipo === "categoria" ? catalogo.categorias : catalogo.minerais);

function combo(tipo, valor = "") {
  const d = document.createElement("div");
  d.className = "combo";
  d.dataset.tipo = tipo;
  d.innerHTML = `<input type="text" class="combo-in" placeholder="${tipo === "categoria" ? "Categoria" : "Mineral"}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">`;
  d.firstChild.value = valor;
  return d;
}

function abrirCombo(inp, filtrar) {
  const box = inp.parentElement;
  const tipo = box.dataset.tipo;
  const q = filtrar ? inp.value : "";
  const itens = listaDoTipo(tipo).filter((i) => i.ativo !== false && combina(i, q)).sort(porNome);
  let html = itens.map((i) => {
    const extra = tipo === "mineral" && i.kg ? `<small>${i.kg} kg/sc</small>` : "";
    return `<button type="button" data-opcao="${esc(i.nome)}" class="${mesmoNome(i.nome, inp.value) ? "sel" : ""}">${esc(i.nome)}${extra}</button>`;
  }).join("");
  const v = inp.value.trim();
  if (filtrar && v && !acharItem(listaDoTipo(tipo), v)) {
    html += `<button type="button" class="novo" data-novo-item="${esc(v)}">+ Adicionar ${tipo === "categoria" ? "categoria" : "mineral"} “${esc(v)}”</button>`;
  }
  if (!html) html = `<button type="button" disabled>Nada encontrado</button>`;
  let lista = $(".combo-lista", box);
  if (!lista) {
    lista = document.createElement("div");
    lista.className = "combo-lista";
    box.appendChild(lista);
  }
  lista.innerHTML = html;
}

function fecharCombos(exceto) {
  $$(".combo-lista").forEach((l) => { if (l.parentElement !== exceto) l.remove(); });
}

// Ao sair do campo, troca o que foi digitado pelo nome oficial (ex.: "vq" → "Novilhas")
function acertarCombo(inp) {
  const achado = inp.value.trim() && acharItem(listaDoTipo(inp.parentElement.dataset.tipo), inp.value);
  if (achado) inp.value = achado.nome;
  inp.classList.toggle("erro", !!inp.value.trim() && !achado);
}

async function adicionarItem(tipo, nome) {
  nome = nome.trim().replace(/\s+/g, " ");
  nome = nome[0].toUpperCase() + nome.slice(1);
  if (!acharItem(listaDoTipo(tipo), nome)) {
    await registrarAlteracao({ tipo, nome });
    toast(`${tipo === "categoria" ? "Categoria" : "Mineral"} “${nome}” adicionado à lista.`);
  }
  return nome;
}

// =====================================================================
// Registro: animais e mineral
// =====================================================================
let vazio = false;

function linhaAnimal(a = {}) {
  const d = document.createElement("div");
  d.className = "linha linha-animal";
  d.innerHTML = `<input type="text" class="qtd" inputmode="numeric" placeholder="Qtd." aria-label="Quantidade" autocomplete="off">
    <span></span><button type="button" class="btn-x" data-remover aria-label="Remover">×</button>`;
  d.querySelector(".qtd").value = a.qtd ?? "";
  d.replaceChild(combo("categoria", a.categoria || ""), d.children[1]);
  return d;
}

function linhaMineral(m = {}) {
  const d = document.createElement("div");
  d.className = "linha linha-mineral";
  d.innerHTML = `<div class="passo">
      <button type="button" data-passo="-1" aria-label="Menos um saco">−</button>
      <input type="text" class="qtd" inputmode="decimal" placeholder="0" aria-label="Sacos" autocomplete="off">
      <button type="button" data-passo="1" aria-label="Mais um saco">+</button>
    </div><span></span><button type="button" class="btn-x" data-remover aria-label="Remover">×</button>`;
  d.querySelector(".qtd").value = m.sacos ?? "";
  d.replaceChild(combo("mineral", m.mineral || ""), d.children[1]);
  return d;
}

function passo(btn) {
  const inp = btn.parentElement.querySelector("input");
  const atual = numero(inp.value) || 0;
  inp.value = fmtQ(Math.max(0, Math.floor(atual + Number(btn.dataset.passo) + (Number(btn.dataset.passo) < 0 && atual % 1 ? 1 : 0)))).replace(/^0$/, "");
  inp.classList.remove("erro");
}

function ligarBloco(qual, ligado) {
  const chave = $(`#chave-${qual}`);
  chave.setAttribute("aria-pressed", String(ligado));
  $(`#corpo-${qual}`).hidden = !ligado;
  if (qual === "falta") { renderFaltas(); return; }
  const linhas = $(`#linhas-${qual === "animais" ? "animais" : "mineral"}`);
  if (ligado && !linhas.children.length && !(qual === "animais" && vazio)) {
    linhas.appendChild(qual === "animais" ? linhaAnimal() : linhaMineral());
  }
}
const blocoLigado = (qual) => $(`#chave-${qual}`).getAttribute("aria-pressed") === "true";

function marcarVazio(v) {
  vazio = v;
  $("#linhas-animais").hidden = v;
  $("#add-animal").parentElement.hidden = v;
  $("#aviso-vazio").hidden = !v;
  $("#btn-vazio").classList.toggle("on", v);
  $("#btn-vazio").textContent = v ? "Desfazer: o potreiro tem animais" : "Potreiro vazio";
  if (!v && !$("#linhas-animais").children.length) $("#linhas-animais").appendChild(linhaAnimal());
}

// Pré-preenche com a última recorrida do potreiro (continua editável)
function preencherPeloHistorico(lot, min) {
  $("#linhas-animais").innerHTML = "";
  marcarVazio(false);
  $("#linhas-animais").innerHTML = "";
  if (lot?.lotacao === "conferida" && lot.animais?.length) {
    lot.animais.forEach((a) => $("#linhas-animais").appendChild(linhaAnimal(a)));
    $("#dica-animais").textContent = `Preenchido com a lotação de ${fmtData(lot.data)}. Confira e ajuste.`;
  } else {
    $("#linhas-animais").appendChild(linhaAnimal());
    $("#dica-animais").textContent = lot?.lotacao === "vazio" ? `Na recorrida de ${fmtData(lot.data)} o potreiro estava vazio.` : "";
  }
  $("#linhas-mineral").innerHTML = "";
  const recentes = mineraisRecentes(potSel, min);
  if (recentes.length) {
    recentes.forEach((m) => $("#linhas-mineral").appendChild(linhaMineral({ mineral: m.mineral })));
    $("#dica-mineral").textContent = `Minerais usados aqui: ${recentes.map((m) => `${m.mineral} (${fmtData(m.data).slice(0, 5)})`).join(", ")}. `
      + `Informe os sacos colocados agora. O que não precisou repor pode ficar em branco.`;
  } else {
    $("#linhas-mineral").appendChild(linhaMineral());
    $("#dica-mineral").textContent = "";
  }
}

// Minerais usados no potreiro nos últimos dias (ex.: um para as vacas e outro para os
// terneiros), mesmo que na última recorrida só um deles tenha sido reposto.
// Sem nada no período, vale o mineral da última recorrida com mineral.
function mineraisRecentes(pot, ultimo) {
  const ref = campo("data").value || hojeISO();
  const desde = somaDias(ref, -DIAS_MINERAIS_SUGERIDOS);
  const vistos = new Map();
  ativos()
    .filter((r) => r.id !== editId && mesmoNome(r.potreiro, pot) && r.minerais?.length && r.data >= desde && r.data <= ref)
    .sort(ordenar)
    .forEach((r) => r.minerais.forEach((m) => { if (!vistos.has(m.mineral)) vistos.set(m.mineral, { mineral: m.mineral, data: r.data }); }));
  if (!vistos.size && ultimo) ultimo.minerais.forEach((m) => vistos.set(m.mineral, { mineral: m.mineral, data: ultimo.data }));
  return [...vistos.values()];
}

function lerLinhas(qual) {
  const itens = [];
  let erro = null;
  $$(`#linhas-${qual} .linha`).forEach((l) => {
    const qInp = l.querySelector(".qtd");
    const cInp = l.querySelector(".combo-in");
    const q = numero(qInp.value);
    const nomeDigitado = cInp.value.trim();
    if (!qInp.value.trim() && !nomeDigitado) return; // linha em branco: ignora
    const item = nomeDigitado && acharItem(listaDoTipo(qual === "animais" ? "categoria" : "mineral"), nomeDigitado);
    // Mineral sugerido que não precisou repor: sacos em branco ou zero, a linha é ignorada
    if (qual === "mineral" && item && (!qInp.value.trim() || q === 0)) { qInp.classList.remove("erro"); cInp.classList.remove("erro"); return; }
    const qOk = qInp.value.trim() && q > 0 && (qual !== "animais" || Number.isInteger(q));
    qInp.classList.toggle("erro", !qOk);
    cInp.classList.toggle("erro", !item);
    if (!qOk || !item) { erro ||= !item ? cInp : qInp; return; }
    const chave = qual === "animais" ? "categoria" : "mineral";
    const ja = itens.find((i) => i[chave] === item.nome);
    if (ja) ja[qual === "animais" ? "qtd" : "sacos"] += q; // mesma categoria/mineral em duas linhas: soma
    else itens.push(qual === "animais" ? { categoria: item.nome, qtd: q } : { mineral: item.nome, sacos: q });
  });
  return { itens, erro };
}

// =====================================================================
// Falta de mineral no depósito
// =====================================================================
let faltaSel = new Set(); // minerais marcados como em falta nesta recorrida

// Mostra os minerais do potreiro (em falta, usados nos últimos dias ou nas linhas
// de mineral acima) com uma chave liga/desliga cada
function renderFaltas() {
  const abertas = faltasAbertas().filter((f) => potSel && mesmoNome(f.potreiro, potSel) && f.recorrida_id !== editId);
  const nomes = [];
  const add = (n) => { if (n && !nomes.some((x) => mesmoNome(x, n))) nomes.push(n); };
  abertas.forEach((f) => add(f.mineral));
  if (potSel) mineraisRecentes(potSel, ultimoDoPotreiro(potSel, "mineral", editId)).forEach((m) => add(m.mineral));
  $$("#linhas-mineral .combo-in").forEach((i) => add(acharItem(catalogo.minerais, i.value)?.nome));
  faltaSel.forEach(add);
  $("#faltas-lista").innerHTML = nomes.map((n) => {
    const aberta = abertas.find((f) => mesmoNome(f.mineral, n));
    const on = !!aberta || faltaSel.has(n);
    const info = aberta ? `<small>em falta desde ${fmtData(aberta.data)} · para tirar, marque “Reposto” no Painel</small>` : "";
    return `<button type="button" class="falta-item ${aberta ? "aberta" : ""}" data-falta="${esc(n)}" ${aberta ? 'data-aberta="1"' : ""} aria-pressed="${on}">
      <span class="fi-nome">${esc(n)}${info}</span><span class="interruptor" aria-hidden="true"></span></button>`;
  }).join("") || `<p class="muted-s">Nenhum mineral usado aqui recentemente. Escolha abaixo.</p>`;
}

function alternarFalta(btn) {
  if (btn.dataset.aberta) { toast("Já está registrado como em falta. Quando repuser, marque “Reposto” no Painel."); return; }
  const n = btn.dataset.falta;
  if (faltaSel.has(n)) faltaSel.delete(n); else faltaSel.add(n);
  renderFaltas();
}

function adicionarFaltaDoCombo(inp) {
  const item = inp.value.trim() && acharItem(catalogo.minerais, inp.value);
  if (!item) return;
  faltaSel.add(item.nome);
  inp.value = "";
  inp.classList.remove("erro");
  renderFaltas();
}

// Grava as faltas marcadas nesta recorrida (uma por mineral) e desfaz as desmarcadas
function gravarFaltasDaRecorrida(rec, sel, agora) {
  faltas.filter((f) => f.recorrida_id === rec.id && !f.excluido && !sel.has(f.mineral))
    .forEach((f) => Object.assign(f, { excluido: true, atualizado_em: agora, _pendente: true }));
  sel.forEach((mineral) => {
    const id = `${rec.id}|${mineral}`;
    const f = faltas.find((x) => x.id === id);
    if (!f) {
      faltas.push({ id, recorrida_id: rec.id, data: rec.data, potreiro: rec.potreiro, mineral,
        registrado_por: usuario?.email || "demo", criado_em: agora, reposto_em: "", reposto_por: "",
        atualizado_em: agora, excluido: false, _pendente: true });
    } else if (f.excluido || f.data !== rec.data || f.potreiro !== rec.potreiro) {
      Object.assign(f, { excluido: false, data: rec.data, potreiro: rec.potreiro, atualizado_em: agora, _pendente: true });
    }
  });
  return db.salvar("faltas", faltas);
}

async function marcarReposto(id) {
  const f = faltas.find((x) => x.id === id);
  if (!f || !confirm(`${f.mineral} já foi reposto no depósito de ${f.potreiro}?`)) return;
  const agora = new Date().toISOString();
  Object.assign(f, { reposto_em: agora, reposto_por: usuario?.email || "demo", atualizado_em: agora, _pendente: true });
  await db.salvar("faltas", faltas);
  renderTudo();
  toast(`${f.mineral} (${f.potreiro}) marcado como reposto.`);
  sincronizar();
}

function renderFaltasPainel() {
  const abertas = faltasAbertas().sort((a, b) => a.mineral.localeCompare(b.mineral, "pt-BR") || a.data.localeCompare(b.data));
  if (!abertas.length) { $("#p-faltas").innerHTML = `<p class="vazio">Nenhum mineral em falta no depósito.</p>`; return; }
  const grupos = {};
  abertas.forEach((f) => (grupos[f.mineral] ||= []).push(f));
  $("#p-faltas").innerHTML = Object.entries(grupos).map(([mineral, fs]) => `
    <div class="pf-grupo">
      <div class="pf-min">${esc(mineral)} <span class="muted-s">(${fs.length} potreiro${fs.length > 1 ? "s" : ""})</span></div>
      ${fs.map((f) => `<div class="pf-linha">
        <span>${esc(f.potreiro)}<small>desde ${fmtData(f.data)} (${haDias(f.data)}) · ${esc(quem(f.registrado_por))}${f._pendente ? ' · <span class="pend">aguardando envio</span>' : ""}</small></span>
        <button type="button" class="btn-light" data-reposto="${esc(f.id)}">Reposto</button>
      </div>`).join("")}
    </div>`).join("");
}

// =====================================================================
// Formulário
// =====================================================================
const form = () => $("#form");
const campo = (nome) => form().elements[nome];

function limparForm() {
  editId = null;
  form().reset();
  campo("data").value = hojeISO();
  potSel = null;
  autoEscolhaFeita = false;
  $("#pot-escolhido").hidden = true;
  $("#pot-busca").hidden = false;
  $("#pot-q").value = "";
  $("#linhas-animais").innerHTML = "";
  $("#linhas-mineral").innerHTML = "";
  $("#dica-animais").textContent = "";
  $("#dica-mineral").textContent = "";
  marcarVazio(false);
  $("#linhas-animais").innerHTML = "";
  ligarBloco("animais", false);
  ligarBloco("mineral", false);
  faltaSel = new Set();
  ligarBloco("falta", false);
  $("#form-titulo").textContent = "Nova recorrida";
  $("#btn-salvar").textContent = "Salvar recorrida";
  $("#btn-cancelar").hidden = true;
  $("#btn-limpar").hidden = false;
  $$(".erro", form()).forEach((e) => e.classList.remove("erro"));
  renderPotLista();
  if (!$("#app").hidden && !$("#tab-registro").hidden) atualizarGps(true);
}

function editar(id) {
  const r = registros.find((x) => x.id === id);
  if (!r) return;
  limparForm();
  editId = id;
  campo("data").value = r.data;
  campo("obs").value = r.obs || "";
  escolherPotreiro(r.potreiro, { preencher: false });
  $("#linhas-animais").innerHTML = "";
  $("#linhas-mineral").innerHTML = "";
  (r.animais || []).forEach((a) => $("#linhas-animais").appendChild(linhaAnimal(a)));
  (r.minerais || []).forEach((m) => $("#linhas-mineral").appendChild(linhaMineral(m)));
  marcarVazio(r.lotacao === "vazio");
  ligarBloco("animais", !!r.lotacao);
  ligarBloco("mineral", !!r.minerais?.length);
  faltaSel = new Set(faltasAtivas().filter((f) => f.recorrida_id === id).map((f) => f.mineral));
  ligarBloco("falta", faltaSel.size > 0);
  if (!r.lotacao) { $("#linhas-animais").innerHTML = ""; }
  $("#form-titulo").textContent = `Editando: ${r.potreiro} (${fmtData(r.data)})`;
  $("#btn-salvar").textContent = "Salvar alterações";
  $("#btn-cancelar").hidden = false;
  $("#btn-limpar").hidden = true;
  mostrarAba("registro");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function excluir(id) {
  const r = registros.find((x) => x.id === id);
  if (!r || !confirm(`Excluir a recorrida de ${r.potreiro} (${fmtData(r.data)})?`)) return;
  Object.assign(r, { excluido: true, atualizado_em: new Date().toISOString(), _pendente: true });
  await db.gravar(r);
  await gravarFaltasDaRecorrida(r, new Set(), r.atualizado_em);
  if (editId === id) limparForm();
  renderTudo();
  toast("Recorrida excluída.");
  sincronizar();
}

async function salvar(ev) {
  ev.preventDefault();
  $$(".erro", form()).forEach((e) => e.classList.remove("erro"));
  const falha = (msg, el) => { toast(msg); if (el) { el.classList.add("erro"); el.focus(); } };

  if (!campo("data").value) return falha("Informe a data.", campo("data"));
  if (campo("data").value > hojeISO()) return falha("A data não pode ser no futuro.", campo("data"));
  if (!potSel) { window.scrollTo({ top: 0, behavior: "smooth" }); return falha("Escolha o potreiro.", $("#pot-q")); }

  const comAnimais = blocoLigado("animais");
  const comMineral = blocoLigado("mineral");
  const comFalta = blocoLigado("falta");
  if (!comAnimais && !comMineral && !comFalta) return falha("Ligue pelo menos uma opção: animais, mineral no cocho ou falta no depósito.");
  if (comFalta && !faltaSel.size) return falha("Marque o mineral que está faltando no depósito (ou desligue a opção 4).");

  let animais = [];
  if (comAnimais && !vazio) {
    const r = lerLinhas("animais");
    if (r.erro) return falha("Confira as linhas de animais: quantidade inteira e categoria da lista.", r.erro);
    if (!r.itens.length) return falha("Informe os animais ou toque em “Potreiro vazio”.");
    animais = r.itens;
  }
  let minerais = [];
  if (comMineral) {
    const r = lerLinhas("mineral");
    if (r.erro) return falha("Confira as linhas de mineral: número de sacos e mineral da lista.", r.erro);
    if (!r.itens.length) return falha("Informe os sacos de pelo menos um mineral (ou desligue “Coloquei mineral no cocho”).", $("#linhas-mineral .qtd"));
    minerais = r.itens;
  }

  const agora = new Date().toISOString();
  const antigo = editId ? registros.find((r) => r.id === editId) : null;
  const rec = {
    ...(antigo || {}),
    id: editId || novoId(),
    data: campo("data").value,
    potreiro: potSel,
    lotacao: comAnimais ? (vazio ? "vazio" : "conferida") : "",
    animais,
    minerais,
    obs: campo("obs").value.trim(),
    registrado_por: antigo?.registrado_por || usuario?.email || "demo",
    criado_em: antigo?.criado_em || agora,
    atualizado_em: agora,
    excluido: false,
    _pendente: true,
  };
  await db.gravar(rec);
  await gravarFaltasDaRecorrida(rec, comFalta ? faltaSel : new Set(), agora);
  registros = await db.todos();
  toast(antigo ? "Alterações salvas." : `Recorrida de ${rec.potreiro} registrada.`);
  limparForm();
  renderTudo();
  window.scrollTo({ top: 0, behavior: "smooth" });
  sincronizar();
}

// =====================================================================
// Listas (últimas recorridas e consulta)
// =====================================================================
function cartao(r) {
  const [a, m, d] = (r.data || "--").split("-");
  const badges = [
    r.lotacao === "conferida" ? `<span class="badge">Lotação</span>` : "",
    r.lotacao === "vazio" ? `<span class="badge vazio">Vazio</span>` : "",
    r.minerais?.length ? `<span class="badge min">Mineral</span>` : "",
  ].join("");
  const fs = faltasAtivas().filter((f) => f.recorrida_id === r.id);
  const tot = totalAnimais(r);
  return `
    <article class="reg">
      <div class="reg-data"><b>${d}/${m}</b><span>${a}</span></div>
      <div>
        <div class="reg-pot">${esc(r.potreiro)} ${badges}${fs.length ? `<span class="badge falta">Falta</span>` : ""}</div>
        ${r.lotacao ? `<div class="reg-linha"><i>Animais</i>${esc(txtAnimais(r))}${r.animais?.length > 1 ? ` <b>(${fmtNum(tot)})</b>` : ""}</div>` : ""}
        ${r.minerais?.length ? `<div class="reg-linha"><i>Mineral</i>${esc(txtMinerais(r))}</div>` : ""}
        ${fs.length ? `<div class="reg-linha"><i>Falta no depósito</i>${fs.map((f) => esc(f.mineral) + (f.reposto_em ? " (reposto)" : "")).join(" · ")}</div>` : ""}
        ${r.obs ? `<div class="reg-obs">${esc(r.obs)}</div>` : ""}
      </div>
      <div class="reg-dir">
        <span class="estado ${r._pendente ? "pend" : ""}">${r._pendente ? "⏳ aguardando envio" : "✓ sincronizado"}</span>
        <div class="btns">
          <button class="btn-light" data-editar="${r.id}">Editar</button>
          <button class="btn-light perigo" data-excluir="${r.id}">Excluir</button>
        </div>
      </div>
    </article>`;
}

function filtrados() {
  const q = $("#busca").value;
  const tipo = $("#f-tipo").value;
  const dias = $("#f-periodo").value;
  const desde = dias ? somaDias(hojeISO(), -Number(dias)) : "";
  return ativos().filter((r) => {
    if (desde && r.data < desde) return false;
    if (tipo === "animais" && !r.lotacao) return false;
    if (tipo === "mineral" && !r.minerais?.length) return false;
    if (norm(q)) {
      const texto = { nome: `${r.potreiro} ${txtAnimais(r)} ${txtMinerais(r)} ${r.obs || ""}` };
      if (!combina(texto, q)) return false;
    }
    return true;
  }).sort(ordenar);
}

function renderListas() {
  const ult = ativos().sort(ordenar).slice(0, 5);
  $("#ultimos").innerHTML = ult.length ? ult.map(cartao).join("") : `<p class="vazio">Nenhuma recorrida registrada ainda.</p>`;

  const lista = filtrados();
  $("#contagem").textContent = `${lista.length} recorrida${lista.length === 1 ? "" : "s"}`;
  $("#lista").innerHTML = lista.length
    ? lista.slice(0, limiteLista).map(cartao).join("")
    : `<p class="vazio card">Nenhuma recorrida encontrada com esses filtros.</p>`;
  $("#btn-mais").hidden = lista.length <= limiteLista;
}

function baixarCsv() {
  const cab = ["Data", "Potreiro", "Lotação", "Total animais", "Animais", "Sacos", "Kg", "Mineral", "Observações", "Registrado por"];
  const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = (n) => String(n).replace(".", ",");
  const linhas = filtrados().map((r) => {
    const sacos = (r.minerais || []).reduce((s, m) => s + Number(m.sacos), 0);
    const kg = (r.minerais || []).reduce((s, m) => s + Number(m.sacos) * kgDoMineral(m.mineral), 0);
    return [
      fmtData(r.data), r.potreiro, { conferida: "Conferida", vazio: "Vazio" }[r.lotacao] || "Não conferida",
      r.lotacao ? totalAnimais(r) : "", r.lotacao ? txtAnimais(r) : "",
      sacos ? num(sacos) : "", kg ? num(kg) : "", txtMinerais(r), r.obs, r.registrado_por,
    ].map(cel).join(";");
  });
  const blob = new Blob(["﻿" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `recorridas-${hojeISO()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// =====================================================================
// Aba Lotação
// =====================================================================
function renderLotacao() {
  const estado = estadoPotreiros();
  const hoje = hojeISO();
  const linhas = catalogo.potreiros.filter((p) => p.ativo !== false).map((p) => {
    const e = estado.get(norm(p.nome)) || {};
    const lot = e.lotacao;
    return { p, lot, min: e.mineral, total: totalAnimais(lot), grupo: !lot ? "sem" : lot.lotacao === "vazio" ? "vazios" : "ocupados" };
  });
  // Recorridas de potreiros que não estão mais na lista também contam
  estado.forEach((e, k) => {
    if (e.lotacao && !linhas.some((l) => norm(l.p.nome) === k)) {
      linhas.push({ p: { nome: e.lotacao.potreiro }, lot: e.lotacao, min: e.mineral, total: totalAnimais(e.lotacao), grupo: e.lotacao.lotacao === "vazio" ? "vazios" : "ocupados" });
    }
  });

  const ocupados = linhas.filter((l) => l.grupo === "ocupados");
  const total = ocupados.reduce((s, l) => s + l.total, 0);
  const kpi = (v, r, extra = "") => `<div class="kpi"><b>${v}</b><span>${r}</span>${extra ? `<small>${extra}</small>` : ""}</div>`;
  $("#lot-kpis").innerHTML = [
    kpi(fmtNum(total), "Animais"),
    kpi(ocupados.length, "Ocupados"),
    kpi(linhas.filter((l) => l.grupo === "vazios").length, "Vazios"),
    kpi(linhas.filter((l) => l.grupo === "sem").length, "Sem info"),
  ].join("");

  const porCat = {};
  ocupados.forEach((l) => l.lot.animais.forEach((a) => { porCat[a.categoria] = (porCat[a.categoria] || 0) + Number(a.qtd); }));
  $("#lot-cats").innerHTML = Object.entries(porCat).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<span>${esc(c)}: <b>${fmtNum(n)}</b></span>`).join("");

  const q = $("#lot-q").value;
  const f = $("#lot-f").value;
  const vis = linhas.filter((l) => (!f || l.grupo === f) && combina(l.p, q)).sort((a, b) => porNome(a.p, b.p));
  // Tabela compacta: Potreiro | Animais | Última atualização (tocar na linha abre o registro)
  const linha = (l) => {
    const animais = l.grupo === "ocupados"
      ? `<b>${fmtNum(l.total)}</b>${l.lot.animais.length ? `<small>${esc(txtAnimais(l.lot))}</small>` : ""}`
      : l.grupo === "vazios" ? `<span class="t-vazio">Vazio</span>` : "–";
    const velho = l.lot && diasEntre(l.lot.data, hoje) > DIAS_LOTACAO_VELHA;
    const data = l.lot ? `${fmtData(l.lot.data).slice(0, 6)}${l.lot.data.slice(2, 4)}<small class="${velho ? "velho" : ""}">${haDias(l.lot.data)}</small>` : "–";
    return `<tr data-ir="${esc(l.p.nome)}"><td class="t-pot">${esc(l.p.nome)}</td><td class="t-ani">${animais}</td><td class="t-data">${data}</td></tr>`;
  };
  const tabela = (titulo, ls) => ls.length ? `
    <div class="card card-tab">
      <h3>${titulo} <small>(${ls.length})</small></h3>
      <table class="t-lot">
        <thead><tr><th>Potreiro</th><th>Animais</th><th class="t-data">Última atualização</th></tr></thead>
        <tbody>${ls.map(linha).join("")}</tbody>
      </table>
    </div>` : "";
  $("#lot-lista").innerHTML = vis.length
    ? tabela("Com informação", vis.filter((l) => l.grupo !== "sem")) + tabela("Sem informação", vis.filter((l) => l.grupo === "sem"))
    : `<p class="vazio card">Nenhum potreiro encontrado.</p>`;
}

function irParaPotreiro(nome) {
  if (editId) { toast("Termine ou cancele a edição antes."); mostrarAba("registro"); return; }
  limparForm();
  escolherPotreiro(nome);
  mostrarAba("registro");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =====================================================================
// Painel
// =====================================================================
function barras(pares, cls = "", fmt = fmtQ) {
  const max = Math.max(1, ...pares.map((p) => p[1]));
  return pares.length
    ? pares.map(([rot, n]) => `<div class="barra ${cls}"><span title="${esc(rot)}">${esc(rot)}</span><div class="trilho"><i style="width:${(n / max) * 100}%"></i></div><b>${fmt(n)}</b></div>`).join("")
    : `<p class="vazio">Sem registros no período.</p>`;
}

// Soma animais × dias de um potreiro entre duas datas, com a lotação em vigor em cada dia
function cabecasDia(nome, ini, fim) {
  const lots = ativos().filter((r) => r.lotacao && mesmoNome(r.potreiro, nome)).sort((a, b) => -ordenar(a, b));
  let soma = 0, dias = 0, i = 0, atual = null;
  for (let d = ini; d <= fim; d = somaDias(d, 1)) {
    while (i < lots.length && lots[i].data <= d) atual = lots[i++];
    if (!atual) continue;
    soma += totalAnimais(atual);
    dias++;
  }
  return { soma, dias };
}

function renderPainel() {
  renderFaltasPainel();
  const hoje = hojeISO();
  const nDias = Number($("#p-periodo").value);
  const ini = somaDias(hoje, -nDias + 1);
  const base = ativos().filter((r) => r.data >= ini && r.data <= hoje);
  const comMin = base.filter((r) => r.minerais?.length);
  const estado = estadoPotreiros();

  let sacos = 0, kg = 0, sacosSemKg = 0;
  const porMin = {};
  const porPot = {};
  comMin.forEach((r) => r.minerais.forEach((m) => {
    const s = Number(m.sacos), k = kgDoMineral(m.mineral);
    sacos += s;
    kg += s * k;
    if (!k) sacosSemKg += s;
    porMin[m.mineral] = (porMin[m.mineral] || 0) + s;
    const p = (porPot[r.potreiro] ||= { sacos: 0, kg: 0, semKg: false });
    p.sacos += s;
    p.kg += s * k;
    if (!k) p.semKg = true;
  }));

  let animaisHoje = 0, ocupados = 0;
  const porCat = {};
  estado.forEach((e) => {
    if (e.lotacao?.lotacao !== "conferida") return;
    ocupados++;
    e.lotacao.animais.forEach((a) => { animaisHoje += Number(a.qtd); porCat[a.categoria] = (porCat[a.categoria] || 0) + Number(a.qtd); });
  });

  const kpi = (v, r, extra = "") => `<div class="kpi"><b>${v}</b><span>${r}</span>${extra ? `<small>${extra}</small>` : ""}</div>`;
  $("#kpis").innerHTML = [
    kpi(fmtNum(animaisHoje), "Animais hoje", `em ${ocupados} potreiros`),
    kpi(base.length, "Recorridas", "no período"),
    kpi(fmtQ(sacos), "Sacos de mineral", "no período"),
    kpi(fmtNum(kg), "Kg de mineral", sacosSemKg ? `${fmtQ(sacosSemKg)} sc sem kg/saco` : "no período"),
  ].join("");

  $("#g-min").innerHTML = barras(Object.entries(porMin).sort((a, b) => b[1] - a[1]));
  $("#g-cat").innerHTML = barras(Object.entries(porCat).sort((a, b) => b[1] - a[1]), "cat", (n) => fmtNum(n));

  // Consumo: o mineral de cada abastecimento dura até o abastecimento seguinte.
  // Soma o que foi colocado do 1º ao penúltimo abastecimento do período e divide
  // pelos animais × dias desse intervalo (precisa de pelo menos 2 abastecimentos).
  const linhas = Object.entries(porPot).map(([nome, p]) => {
    const media = cabecasDia(nome, ini, hoje);
    const abast = comMin.filter((r) => mesmoNome(r.potreiro, nome)).sort((a, b) => -ordenar(a, b));
    let gcd = null;
    if (abast.length >= 2 && !p.semKg) {
      const kgCons = abast.slice(0, -1).reduce((s, r) => s + r.minerais.reduce((t, m) => t + Number(m.sacos) * kgDoMineral(m.mineral), 0), 0);
      const cd = cabecasDia(nome, abast[0].data, somaDias(abast.at(-1).data, -1));
      if (cd.soma) gcd = (kgCons * 1000) / cd.soma;
    }
    return { nome, ...p, media: media.dias ? media.soma / media.dias : null, gcd };
  }).sort((a, b) => b.kg - a.kg || b.sacos - a.sacos);
  $("#t-consumo").innerHTML = linhas.length ? `
    <table>
      <thead><tr><th>Potreiro</th><th class="n">Sacos</th><th class="n">Kg</th><th class="n">Cab. média</th><th class="n">g/cab/dia</th></tr></thead>
      <tbody>${linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td class="n">${fmtQ(l.sacos)}</td>
        <td class="n">${l.semKg ? "–" : fmtNum(l.kg)}</td><td class="n">${l.media != null ? fmtNum(l.media) : "–"}</td>
        <td class="n">${l.gcd != null ? fmtNum(l.gcd) : "–"}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="vazio">Nenhum mineral registrado no período.</p>`;

  const semMin = [];
  estado.forEach((e) => {
    if (e.lotacao?.lotacao !== "conferida") return;
    semMin.push({ nome: e.lotacao.potreiro, total: totalAnimais(e.lotacao), ult: e.mineral?.data || "", dias: e.mineral ? diasEntre(e.mineral.data, hoje) : Infinity });
  });
  semMin.sort((a, b) => b.dias - a.dias);
  $("#t-dias").innerHTML = semMin.length ? `
    <table>
      <thead><tr><th>Potreiro</th><th class="n">Animais</th><th class="n">Último mineral</th><th class="n">Dias</th></tr></thead>
      <tbody>${semMin.map((l) => `<tr><td>${esc(l.nome)}</td><td class="n">${fmtNum(l.total)}</td>
        <td class="n">${l.ult ? fmtData(l.ult) : "nunca"}</td>
        <td class="n ${l.dias > DIAS_SEM_MINERAL ? "alerta" : ""}">${isFinite(l.dias) ? l.dias : "–"}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="vazio">Nenhum potreiro com animais registrados.</p>`;
}

// =====================================================================
// Navegação e inicialização
// =====================================================================
const TITULOS = { registro: "Recorrida", lotacao: "Lotação dos potreiros", consulta: "Consulta", painel: "Painel" };

function mostrarAba(nome) {
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${nome}`));
  $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === nome));
  $("#titulo").textContent = TITULOS[nome];
  if (nome === "registro") atualizarGps();
  else window.scrollTo(0, 0);
}

function renderTudo() {
  renderListas();
  renderLotacao();
  renderPainel();
  if (!potSel) renderPotLista();
  atualizarStatus();
}

function mostrarQuem() {
  $("#quem").textContent = DEMO ? "Modo demonstração" : `Conectado como ${usuario.nome} (${usuario.email}) ·`;
}

function entrarNoApp() {
  if (!$("#app").hidden) return;
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#demo").hidden = !DEMO;
  $("#btn-sair").hidden = DEMO;
  mostrarQuem();
  atualizarGps();
}

function ligarEventos() {
  form().addEventListener("submit", salvar);
  $("#btn-cancelar").addEventListener("click", limparForm);
  // Limpar: descarta o que foi preenchido e não salvo
  $("#btn-limpar").addEventListener("click", () => {
    limparForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Formulário limpo.");
  });

  // Potreiro
  $("#pot-q").addEventListener("input", renderPotLista);
  $("#pot-q").addEventListener("focus", () => atualizarGps());
  $("#pot-q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const primeiro = $("#pot-lista [data-pot]");
    if (primeiro && norm($("#pot-q").value)) { escolherPotreiro(primeiro.dataset.pot); $("#pot-q").blur(); }
  });
  $("#pot-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pot],[data-novo-pot]");
    if (!b) return;
    if (b.dataset.pot) { escolherPotreiro(b.dataset.pot); $("#pot-q").blur(); }
    else abrirNovoPotreiro();
  });
  $("#btn-gps").addEventListener("click", () => atualizarGps(true));
  $("#btn-trocar").addEventListener("click", trocarPotreiro);
  $("#btn-cochos").addEventListener("click", abrirCochos);

  // Janelas
  $$("[data-fechar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#dlg-cochos").addEventListener("close", pararCaptura);
  $("#dc-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-marcar]"); if (b) iniciarCaptura(Number(b.dataset.marcar)); });
  $("#cap-cancelar").addEventListener("click", pararCaptura);
  $("#cap-gravar").addEventListener("click", gravarCaptura);
  $("#form-pot").addEventListener("submit", salvarNovoPotreiro);
  $("#np-nome").addEventListener("input", () => { $("#np-nome").classList.remove("erro"); conferirNovoPotreiro(); });

  // Blocos de animais e mineral
  $("#chave-animais").addEventListener("click", () => ligarBloco("animais", !blocoLigado("animais")));
  $("#chave-mineral").addEventListener("click", () => ligarBloco("mineral", !blocoLigado("mineral")));
  $("#add-animal").addEventListener("click", () => { const l = linhaAnimal(); $("#linhas-animais").appendChild(l); l.querySelector(".qtd").focus(); });
  $("#add-mineral").addEventListener("click", () => { const l = linhaMineral(); $("#linhas-mineral").appendChild(l); l.querySelector(".combo-in").focus(); });
  $("#btn-vazio").addEventListener("click", () => marcarVazio(!vazio));
  $("#chave-falta").addEventListener("click", () => ligarBloco("falta", !blocoLigado("falta")));
  $("#faltas-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-falta]"); if (b) alternarFalta(b); });
  $("#p-faltas").addEventListener("click", (e) => { const b = e.target.closest("[data-reposto]"); if (b) marcarReposto(b.dataset.reposto); });
  form().addEventListener("click", (e) => {
    const rem = e.target.closest("[data-remover]");
    if (rem) { rem.closest(".linha").remove(); return; }
    const p = e.target.closest("[data-passo]");
    if (p) passo(p);
  });

  // Caixas de seleção com filtro
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.(".combo-in")) { fecharCombos(e.target.parentElement); abrirCombo(e.target, false); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches?.(".combo-in")) { e.target.classList.remove("erro"); abrirCombo(e.target, true); }
    if (e.target.matches?.(".linha .qtd")) e.target.classList.remove("erro");
  });
  document.addEventListener("focusout", (e) => {
    if (!e.target.matches?.(".combo-in")) return;
    const inp = e.target;
    setTimeout(() => {
      if (document.activeElement === inp) return;
      acertarCombo(inp);
      fecharCombos();
      if (inp.closest("#falta-combo")) adicionarFaltaDoCombo(inp);
    }, 150);
  });
  // Tocar numa opção não tira o foco do campo antes da escolha
  document.addEventListener("pointerdown", (e) => { if (e.target.closest(".combo-lista")) e.preventDefault(); });
  document.addEventListener("click", async (e) => {
    const op = e.target.closest("[data-opcao],[data-novo-item]");
    if (!op) return;
    const inp = op.closest(".combo").querySelector(".combo-in");
    inp.value = op.dataset.opcao || await adicionarItem(op.closest(".combo").dataset.tipo, op.dataset.novoItem);
    inp.classList.remove("erro");
    fecharCombos();
    inp.blur();
    if (inp.closest("#falta-combo")) adicionarFaltaDoCombo(inp);
  });

  // Listas
  $("#btn-sync").addEventListener("click", () => sincronizar(true));
  $("#btn-sair").addEventListener("click", sair);
  $("#btn-csv").addEventListener("click", baixarCsv);
  $("#btn-mais").addEventListener("click", () => { limiteLista += 60; renderListas(); });
  // Tocar na aba em que já está volta para o topo da página
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => {
    if (b.classList.contains("on")) window.scrollTo({ top: 0, behavior: "smooth" });
    else mostrarAba(b.dataset.tab);
  }));
  ["#busca", "#f-tipo", "#f-periodo"].forEach((s) => $(s).addEventListener("input", () => { limiteLista = 60; renderListas(); }));
  ["#lot-q", "#lot-f"].forEach((s) => $(s).addEventListener("input", renderLotacao));
  $("#lot-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) irParaPotreiro(b.dataset.ir); });
  $("#p-periodo").addEventListener("change", renderPainel);
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-editar],[data-excluir]");
    if (b?.dataset.editar) editar(b.dataset.editar);
    if (b?.dataset.excluir) excluir(b.dataset.excluir);
  });

  // iPhone: com o teclado aberto a barra de abas "sobe" junto e cobre os campos.
  // Escondemos a barra enquanto algum campo está em edição.
  const ehCampo = (el) => el?.matches?.("input, textarea, select");
  document.addEventListener("focusin", (e) => { if (ehCampo(e.target)) document.body.classList.add("digitando"); });
  document.addEventListener("focusout", () => setTimeout(() => {
    if (!ehCampo(document.activeElement)) document.body.classList.remove("digitando");
  }, 150));
  window.addEventListener("online", () => sincronizar());
  window.addEventListener("offline", atualizarStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    sincronizar();
    if (!$("#tab-registro").hidden && !potSel) atualizarGps(true);
  });
  setInterval(() => totalPendente() && sincronizar(), 2 * 60_000);
}

async function iniciar() {
  try { usuario = JSON.parse(localStorage.getItem("srr_usuario")); } catch { usuario = null; }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(console.warn);
  if (navigator.storage?.persist) navigator.storage.persist();

  registros = await db.todos();
  catalogo = (await db.ler("catalogo")) || structuredClone(CATALOGO_INICIAL);
  alteracoes = (await db.ler("alteracoes")) || [];
  faltas = (await db.ler("faltas")) || [];
  $("#falta-combo").appendChild(combo("mineral"));
  ligarEventos();
  limparForm();
  renderTudo();

  if (DEMO || usuario) {
    // Quem já entrou uma vez usa o app mesmo sem sinal; a planilha confere o acesso a cada envio
    entrarNoApp();
    sincronizar();
  } else {
    $("#login").hidden = false;
    if (!navigator.onLine) $("#login-msg").textContent = "Conecte-se à internet para o primeiro acesso. Depois o app funciona sem sinal.";
  }
}

iniciar();
