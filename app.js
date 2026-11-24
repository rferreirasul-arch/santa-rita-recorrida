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
  medicamentos: [],
  categorias: [
    ["Vacas", "vaca; vc"], ["Vacas com cria", "vaca com cria; vacas c cria; vc com cria"], ["Novilhas", "vaq; vaquilhona; vq"],
    ["Novilhos", "boi; bois"], ["Terneiros", "ternero; terneira"], ["Touros", "boluti; toro; touro"],
    ["Ovelhas", "", "Ovino"], ["Cordeiros", "", "Ovino"], ["Borregas", "", "Ovino"], ["Carneiros", "", "Ovino"],
  ].map(([nome, alternativos, especie = "Bov"]) => ({ nome, alternativos, ativo: true, especie })),
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
  cat.medicamentos ||= [];
  const lista = { potreiro: cat.potreiros, mineral: cat.minerais, categoria: cat.categorias, medicamento: cat.medicamentos }[a.tipo];
  if (lista) {
    if (!lista.some((i) => mesmoNome(i.nome, a.nome))) {
      const alternativos = a.alternativos || "";
      lista.push(a.tipo === "potreiro"
        ? { nome: a.nome, alternativos, ativo: true, cochos: [null, null], contorno: "" }
        : a.tipo === "medicamento" ? { nome: a.nome, alternativos, ativo: true, unidade: a.unidade || "mL", tipo: a.tipoMed || "" }
        : a.tipo === "categoria" ? { nome: a.nome, alternativos, ativo: true, especie: a.especie || "" }
        : { nome: a.nome, alternativos, ativo: true, kg: a.kg || "" });
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
// Totais da lotação por espécie: { Bovinos: 85, Ovinos: 12 }
function porEspecie(r) {
  const t = {};
  if (r?.lotacao === "conferida") (r.animais || []).forEach((a) => { const e = especieDe(a.categoria); t[e] = (t[e] || 0) + Number(a.qtd || 0); });
  return t;
}
const ORDEM_ESPECIES = ["Bovinos", "Ovinos"];
const ordemEspecie = (a, b) => ((ORDEM_ESPECIES.indexOf(a) + 1) || 99) - ((ORDEM_ESPECIES.indexOf(b) + 1) || 99) || a.localeCompare(b);
const ABREV_ESPECIE = { Bovinos: "bov.", Ovinos: "ov.", Equinos: "eq.", Caprinos: "cap." };
// Só bovinos: base da cabeça média e do consumo g/cab/dia
const totalBovinos = (r) => porEspecie(r).Bovinos || 0;
// "85 bovinos · 12 ovinos" (ou "85 bov. · 12 ov." no formato curto)
function txtEspecies(r, curto = false) {
  const t = porEspecie(r);
  const nomes = Object.keys(t).filter((e) => t[e] > 0).sort(ordemEspecie);
  if (!nomes.length) return `0 ${curto ? "animais" : "animais"}`;
  return nomes.map((e) => `${fmtNum(t[e])} ${curto ? (ABREV_ESPECIE[e] || e.toLowerCase()) : e.toLowerCase()}`).join(" · ");
}
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
    const sub = lot ? (lot.lotacao === "vazio" ? "Vazio" : txtEspecies(lot)) : "";
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
    lot?.faltando?.length ? `<b class="txt-falta">Animais faltando</b>: ${esc(txtFaltando(lot))}` : "",
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
const listaDoTipo = (tipo) => (tipo === "categoria" ? catalogo.categorias : tipo === "medicamento" ? (catalogo.medicamentos ||= []) : catalogo.minerais);
const NOME_TIPO = { categoria: "categoria", mineral: "mineral", medicamento: "medicamento" };
const unidadeDe = (med) => acharItem(catalogo.medicamentos || [], med)?.unidade || "mL";

// Espécie da categoria pela aba Categorias ("Bov" → Bovinos, "Ovino" → Ovinos)
function especieDe(categoria) {
  const c = catalogo.categorias.find((i) => mesmoNome(i.nome, categoria));
  const e = String(c?.especie || "").trim();
  const n = norm(e);
  if (n.startsWith("bov")) return "Bovinos";
  if (n.startsWith("ov")) return "Ovinos";
  if (n.startsWith("equ")) return "Equinos";
  if (n.startsWith("cap")) return "Caprinos";
  return e || "Sem espécie";
}

function combo(tipo, valor = "") {
  const d = document.createElement("div");
  d.className = "combo";
  d.dataset.tipo = tipo;
  d.innerHTML = `<input type="text" class="combo-in" placeholder="${{ categoria: "Categoria", mineral: "Mineral", medicamento: "Medicamento" }[tipo]}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">`;
  d.firstChild.value = valor;
  return d;
}

function abrirCombo(inp, filtrar) {
  const box = inp.parentElement;
  const tipo = box.dataset.tipo;
  const q = filtrar ? inp.value : "";
  // Categorias na sequência da aba Categorias; minerais em ordem alfabética
  const itens = listaDoTipo(tipo).filter((i) => i.ativo !== false && combina(i, q));
  if (tipo !== "categoria") itens.sort(porNome);
  let html = itens.map((i) => {
    const extra = tipo === "mineral" && i.kg ? `<small>${i.kg} kg/sc</small>` : "";
    return `<button type="button" data-opcao="${esc(i.nome)}" class="${mesmoNome(i.nome, inp.value) ? "sel" : ""}">${esc(i.nome)}${extra}</button>`;
  }).join("");
  const v = inp.value.trim();
  if (filtrar && v && !acharItem(listaDoTipo(tipo), v)) {
    html += `<button type="button" class="novo" data-novo-item="${esc(v)}">+ Adicionar ${NOME_TIPO[tipo]} “${esc(v)}”</button>`;
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

const limparNome = (s) => { s = String(s || "").trim().replace(/\s+/g, " "); return s && s[0].toUpperCase() + s.slice(1); };

// Devolve o nome do item adicionado (ou "" se a pessoa cancelar a janela)
async function adicionarItem(tipo, nome) {
  nome = limparNome(nome);
  const existe = acharItem(listaDoTipo(tipo), nome);
  if (existe) return existe.nome;
  return abrirNovoItem(tipo, nome);
}

// ---------- Janela: novo medicamento ou categoria ----------
// Mesmos tipos da validação da aba Medicamentos (Code.gs)
const TIPOS_MEDICAMENTO = ["Vermífugo", "Carrapaticida", "Endectocida", "Antibiótico", "Anti-inflamatório", "Vacina clostridiose", "Vacina reprodutiva", "Vacina", "Suplemento injetável", "Outro"];
const NOVA_OPCAO = "__nova__";

// Valores já usados numa coluna, sem repetir (ignora maiúscula/acento)
function valoresUsados(lista, campo, base = []) {
  const out = [];
  // O Tipo pode ter mais de um, separado por vírgula
  const partes = (i) => (campo === "tipo" ? String(i[campo] || "").split(",") : [i[campo]]);
  [...base, ...lista.flatMap(partes)].forEach((v) => {
    v = String(v).trim();
    if (v && !out.some((o) => mesmoNome(o, v))) out.push(v);
  });
  return out;
}

function encherSelect(sel, valores, padrao, rotNova) {
  sel.innerHTML = (padrao === "" ? `<option value="">Escolha…</option>` : "")
    + valores.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")
    + `<option value="${NOVA_OPCAO}">+ ${esc(rotNova)}…</option>`;
  sel.value = padrao;
  const novo = $("#" + sel.dataset.novoCampo);
  novo.value = "";
  novo.hidden = true;
  sel.classList.remove("erro");
  novo.classList.remove("erro");
}

// Valor escolhido no select (ou o digitado em "+ Nova…")
function valorSelect(sel) {
  if (sel.value !== NOVA_OPCAO) return sel.value;
  const v = $("#" + sel.dataset.novoCampo).value;
  // Unidade fica como digitada (mL, g); tipo e espécie com a primeira letra maiúscula
  return sel.id === "ni-unidade" ? v.trim().replace(/\s+/g, " ") : limparNome(v);
}

let novoItemTipo = null, novoItemFim = null;
const NOVO_TITULO = { medicamento: "Novo medicamento", categoria: "Nova categoria", mineral: "Novo mineral" };

function abrirNovoItem(tipo, nome) {
  novoItemTipo = tipo;
  const med = tipo === "medicamento";
  $("#ni-titulo").textContent = NOVO_TITULO[tipo];
  $("#ni-rot-nome").textContent = { medicamento: "Medicamento", categoria: "Categoria", mineral: "Mineral" }[tipo];
  $("#ni-nome").value = nome;
  $("#ni-alt").value = "";
  $("#ni-alt").placeholder = { medicamento: "ex.: ivomec; ivermectina", categoria: "ex.: terneiro; ternera", mineral: "ex.: proteico; P30" }[tipo];
  $("#ni-campos-med").hidden = !med;
  $("#ni-campos-cat").hidden = tipo !== "categoria";
  $("#ni-campos-min").hidden = tipo !== "mineral";
  $("#ni-kg").value = "";
  $("#ni-kg").classList.remove("erro");
  if (med) {
    const meds = catalogo.medicamentos || [];
    encherSelect($("#ni-unidade"), valoresUsados(meds, "unidade", ["mL"]), "mL", "Nova unidade");
    encherSelect($("#ni-tipo"), valoresUsados(meds, "tipo", TIPOS_MEDICAMENTO), "", "Novo tipo");
  } else if (tipo === "categoria") {
    const esp = valoresUsados(catalogo.categorias, "especie");
    encherSelect($("#ni-especie"), esp, esp[0] || "", "Nova espécie");
  }
  $("#ni-nome").classList.remove("erro");
  conferirNovoItem();
  $("#dlg-item").showModal();
  $("#ni-alt").focus();
  return new Promise((res) => { novoItemFim = res; });
}

function conferirNovoItem() {
  const nome = $("#ni-nome").value.trim();
  const existe = nome && acharItem(listaDoTipo(novoItemTipo), nome);
  $("#ni-aviso").hidden = !existe;
  if (existe) $("#ni-aviso").textContent = `Já existe “${existe.nome}”. Ao confirmar, ele será escolhido.`;
  return existe;
}

async function salvarNovoItem(ev) {
  ev.preventDefault();
  const tipo = novoItemTipo;
  const nome = limparNome($("#ni-nome").value);
  if (!nome) { $("#ni-nome").classList.add("erro"); $("#ni-nome").focus(); return; }
  const existe = conferirNovoItem();
  if (existe) { fecharNovoItem(existe.nome); return; }
  // Kg por saco: opcional (ração a granel fica em branco), mas se preencher tem de ser número
  const kgTxt = $("#ni-kg").value.trim().replace(",", ".");
  const kg = kgTxt ? Number(kgTxt) : "";
  if (tipo === "mineral" && kgTxt && !(kg > 0 && kg <= 1000)) { $("#ni-kg").classList.add("erro"); $("#ni-kg").focus(); return; }
  // Selects obrigatórios (o tipo do medicamento pode ficar em branco)
  const obrig = { medicamento: [$("#ni-unidade")], categoria: [$("#ni-especie")] }[tipo] || [];
  for (const s of obrig) {
    if (!valorSelect(s)) {
      const alvo = s.value === NOVA_OPCAO ? $("#" + s.dataset.novoCampo) : s;
      alvo.classList.add("erro");
      alvo.focus();
      return;
    }
  }
  if ($("#ni-tipo").value === NOVA_OPCAO && !valorSelect($("#ni-tipo")) && tipo === "medicamento") {
    $("#ni-tipo-novo").classList.add("erro"); $("#ni-tipo-novo").focus(); return;
  }
  const alternativos = $("#ni-alt").value.split(/[;,]/).map((s) => s.trim()).filter(Boolean).join("; ");
  const extra = tipo === "medicamento" ? { unidade: valorSelect($("#ni-unidade")), tipoMed: valorSelect($("#ni-tipo")) }
    : tipo === "categoria" ? { especie: valorSelect($("#ni-especie")) }
    : { kg };
  await registrarAlteracao({ tipo, nome, alternativos, ...extra });
  toast(`${{ medicamento: "Medicamento", categoria: "Categoria", mineral: "Mineral" }[tipo]} “${nome}” adicionad${tipo === "categoria" ? "a" : "o"} à lista.`);
  fecharNovoItem(nome);
}

function fecharNovoItem(nome) {
  const fim = novoItemFim;
  novoItemFim = null;
  if ($("#dlg-item").open) $("#dlg-item").close();
  fim?.(nome);
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
  if (qual === "med") { if (ligado) prepararMed(); return; }
  if (qual === "animais") agendarDif();
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
  $("#dica-animais").hidden = v;
  $("#btn-vazio").classList.toggle("on", v);
  $("#btn-vazio").setAttribute("aria-pressed", String(v));
  if (!v && !$("#linhas-animais").children.length) $("#linhas-animais").appendChild(linhaAnimal());
  agendarDif();
}

// Pré-preenche com a última recorrida do potreiro (continua editável)
function preencherPeloHistorico(lot, min) {
  $("#linhas-animais").innerHTML = "";
  marcarVazio(false);
  $("#linhas-animais").innerHTML = "";
  limparDif();
  if (lot?.lotacao === "conferida" && lot.animais?.length) {
    vistosDaLotacao(lot).forEach((a) => $("#linhas-animais").appendChild(linhaAnimal(a)));
    $("#dica-animais").textContent = `Preenchido com a lotação de ${fmtData(lot.data)}${lot.faltando?.length ? " (sem os animais que estavam faltando)" : ""}. Confira e ajuste.`;
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
  agendarDif();
}

// =====================================================================
// Diferença entre a contagem e a lotação anterior (movimentações)
// A pessoa digita o que contou; o app compara com a lotação anterior e pergunta o motivo.
// Lotação de referência = contados + faltando (ainda e novos) - animais de outro potreiro.
// =====================================================================
const TIPOS_MOV = {
  faltando: "Faltando (vão voltar)", morte: "Morte", venda: "Venda/saída", transferencia: "Transferência", mudanca: "Mudou de categoria",
  nascimento: "Nascimento", entrada: "Entrada (compra)", veio: "Vieram (transferência)", visitante: "São de outro potreiro (vão voltar)", ajuste: "Contagem anterior errada",
};
const TIPOS_MENOS = ["faltando", "morte", "venda", "transferencia", "mudanca", "ajuste"];
const TIPOS_MAIS = ["nascimento", "entrada", "veio", "visitante", "ajuste"];
// Movimentos que levam ou trazem animais de outro potreiro
const TROCA_POT = { transferencia: "veio", veio: "transferencia" };
// Desfecho dos animais que estavam faltando
const TIPOS_FALT = { voltaram: "Voltaram", ainda: "Ainda faltam", morto: "Encontrei morto", perda: "Não vão voltar (perda)" };
const NOME_MOV = { faltando: "Faltando", retorno: "Retorno de faltando", perda: "Perda (não voltou)", morte: "Morte", venda: "Venda/saída", mudanca: "Mudança de categoria",
  nascimento: "Nascimento", entrada: "Entrada", visitante: "De outro potreiro", ajuste: "Ajuste de contagem",
  transferencia: "Transferência", veio: "Vieram" };
// Categorias de cria: aumento nelas já vem sugerido como nascimento
const ehCria = (cat) => /^(tern|bezerr|cordeir|potr|cabrit)/.test(norm(cat));

let difEstado = {};  // categoria -> { e, linhas: [{ qtd, tipo, para, brinco, causa }] } (só o que a pessoa mexeu)
let faltEstado = {}; // "categoria|desde" -> { linhas: [{ qtd, tipo, brinco, causa }] } (só o que a pessoa mexeu)
let difAtual = null; // último cálculo (usado ao salvar)
function limparDif() { difEstado = {}; faltEstado = {}; difAtual = null; $("#dif-animais").innerHTML = ""; }

const somaCats = (lista) => {
  const m = {};
  (lista || []).forEach((a) => { if (Number(a.qtd) > 0) m[a.categoria] = (m[a.categoria] || 0) + Number(a.qtd); });
  return m;
};
// Animais vistos na recorrida: a lotação sem os que estavam faltando
function vistosDaLotacao(lot) {
  const m = somaCats(lot.animais);
  (lot.faltando || []).forEach((f) => { m[f.categoria] = Math.max(0, (m[f.categoria] || 0) - Number(f.qtd || 0)); });
  return (lot.animais || []).filter((a) => m[a.categoria] > 0).map((a) => ({ categoria: a.categoria, qtd: m[a.categoria] }))
    .filter((a, i, arr) => arr.findIndex((x) => x.categoria === a.categoria) === i);
}

// Última lotação conferida antes desta recorrida (na edição, a anterior à que está sendo editada)
function anteriorLotacao() {
  if (!potSel) return null;
  const data = campo("data").value || hojeISO();
  const antigo = editId ? registros.find((r) => r.id === editId) : null;
  return ativos().filter((r) => r.id !== editId && r.lotacao && mesmoNome(r.potreiro, potSel)
    && (r.data < data || (r.data === data && (!antigo || (r.criado_em || "") < (antigo.criado_em || "")))))
    .sort(ordenar)[0] || null;
}

// Contagem digitada (ignora linhas incompletas; a validação fica para o salvar)
function contadosAtuais() {
  const m = {};
  $$("#linhas-animais .linha-animal").forEach((l) => {
    const q = numero(l.querySelector(".qtd").value);
    const it = acharItem(catalogo.categorias, l.querySelector(".combo-in").value);
    if (it && q > 0 && Number.isInteger(q)) m[it.nome] = (m[it.nome] || 0) + q;
  });
  return m;
}

function calcDif() {
  if (!blocoLigado("animais")) return null;
  const ant = anteriorLotacao();
  if (!ant || ant.lotacao !== "conferida" || !ant.animais?.length) return null;
  const A = somaCats(ant.animais);
  const C = vazio ? {} : contadosAtuais();
  const cats = [...new Set([...Object.keys(A), ...Object.keys(C)])];
  const D = {};
  cats.forEach((c) => { D[c] = (C[c] || 0) - (A[c] || 0); });

  // Faltando da recorrida anterior: quantos voltaram (automático pela contagem ou escolhido)
  const entradas = (ant.faltando || []).filter((f) => Number(f.qtd) > 0)
    .map((f) => ({ ...f, qtd: Number(f.qtd), key: `${f.categoria}|${f.desde}` }))
    .sort((a, b) => (a.desde || "").localeCompare(b.desde || ""));
  const fCat = {};
  entradas.forEach((f) => { fCat[f.categoria] = (fCat[f.categoria] || 0) + f.qtd; });
  const autoRet = {};
  Object.keys(fCat).forEach((c) => { autoRet[c] = Math.min(fCat[c], Math.max(0, fCat[c] + (D[c] ?? -(A[c] || 0)))); });
  // Cada faltando tem um desfecho: voltaram, ainda faltam, encontrado morto ou perda.
  // Sem escolha da pessoa, vem da contagem (o que passou da contagem anterior voltou).
  const m = {};   // ainda faltando (seguem na lotação)
  const mE = {};  // não voltaram (já explicam a diferença da contagem)
  entradas.forEach((f) => {
    let linhas = faltEstado[f.key]?.linhas;
    if (!linhas) {
      const ret = Math.min(f.qtd, autoRet[f.categoria]);
      autoRet[f.categoria] -= ret;
      linhas = [{ qtd: ret, tipo: "voltaram" }, { qtd: f.qtd - ret, tipo: "ainda" }].filter((l) => l.qtd > 0);
    }
    f.linhas = linhas;
    const soma = { voltaram: 0, ainda: 0, morto: 0, perda: 0 };
    let tot = 0;
    linhas.forEach((l) => {
      const q = Math.floor(numero(l.qtd) || 0);
      if (q > 0 && l.tipo in soma) { soma[l.tipo] += q; tot += q; }
    });
    f.ret = soma.voltaram;
    f.morto = soma.morto;
    f.perda = soma.perda;
    f.resta = soma.ainda + Math.max(0, f.qtd - tot); // o que não foi dito continua faltando
    f.excesso = tot > f.qtd;
    m[f.categoria] = (m[f.categoria] || 0) + f.resta;
    mE[f.categoria] = (mE[f.categoria] || 0) + f.qtd - f.ret;
  });

  // E: diferença ainda sem explicação, por categoria
  const E = {};
  cats.forEach((c) => { E[c] = D[c] + (mE[c] || 0); });
  const ordem = (lista) => lista.sort((a, b) => Math.abs(E[b]) - Math.abs(E[a]) || a.localeCompare(b, "pt-BR"));
  const menos = ordem(cats.filter((c) => E[c] < 0));
  const mais = ordem(cats.filter((c) => E[c] > 0));

  // Escolhas da pessoa: se a diferença muda de tamanho, com uma linha só ela acompanha o novo valor;
  // com várias, ficam como estão (o quadro avisa o que sobra ou passa). Se muda de sinal, recomeça.
  const linhasDe = (c, chave, padrao) => {
    const st = difEstado[c];
    if (st && (st.e === undefined || Math.sign(st.e) === Math.sign(chave))) {
      if (st.e !== undefined && st.e !== chave && st.linhas.length === 1) st.linhas[0].qtd = Math.abs(chave);
      st.e = chave;
      return st.linhas;
    }
    delete difEstado[c];
    return padrao();
  };
  // Diminuiu: sugere mudança para uma categoria da mesma espécie que aumentou (menos as crias),
  // só quando o nome começa igual (Vacas prenhas -> Vacas com cria) ou a quantidade bate
  const prim = (c) => norm(c).split(" ")[0].replace(/s$/, "");
  const sug = {};
  const cap = {};
  mais.forEach((c) => { cap[c] = E[c]; });
  const parear = (ok) => menos.forEach((a) => {
    if (sug[a]) return;
    const b = mais.find((x) => cap[x] > 0 && !ehCria(x) && especieDe(x) === especieDe(a) && ok(a, x));
    if (!b) return;
    sug[a] = { para: b, qtd: Math.min(-E[a], cap[b]) };
    cap[b] -= sug[a].qtd;
  });
  parear((a, x) => prim(a) === prim(x) && -E[a] === E[x]);
  parear((a, x) => prim(a) === prim(x));
  parear((a, x) => -E[a] === E[x]);
  const cards = [];
  menos.forEach((c) => {
    const alvo = -E[c];
    const linhas = linhasDe(c, -alvo, () => {
      const g = sug[c];
      if (!g) return [{ qtd: alvo, tipo: "" }];
      return g.qtd < alvo ? [{ qtd: g.qtd, tipo: "mudanca", para: g.para }, { qtd: alvo - g.qtd, tipo: "" }] : [{ qtd: g.qtd, tipo: "mudanca", para: g.para }];
    });
    cards.push({ c, sinal: -1, alvo, linhas, antes: A[c] || 0, agora: C[c] || 0 });
  });
  // Aumentou: o que veio por mudança de categoria já está explicado
  const veio = {};
  cards.forEach((k) => k.linhas.forEach((l) => { if (l.tipo === "mudanca" && l.para) (veio[l.para] ||= []).push({ de: k.c, qtd: Number(l.qtd) || 0 }); }));
  mais.forEach((c) => {
    const inc = (veio[c] || []).reduce((s, v) => s + v.qtd, 0);
    const alvo = E[c] - inc;
    const linhas = alvo > 0 ? linhasDe(c, alvo, () => [{ qtd: alvo, tipo: ehCria(c) ? "nascimento" : "" }]) : [];
    cards.push({ c, sinal: 1, alvo, linhas, veio: veio[c] || [], antes: A[c] || 0, agora: C[c] || 0 });
  });

  // Lotação de referência e faltando que seguem para a próxima recorrida
  const data = campo("data").value || hojeISO();
  const ref = {};
  cats.forEach((c) => { ref[c] = (C[c] || 0) + (m[c] || 0); });
  const faltando = entradas.filter((f) => f.resta > 0).map((f) => ({ categoria: f.categoria, qtd: f.resta, desde: f.desde }));
  const movimentos = [];
  let erro = null;
  entradas.forEach((f) => {
    if (f.excesso) erro ||= { key: f.key, msg: `${f.categoria}: o desfecho soma mais que os ${f.qtd} que faltavam.` };
    if (f.ret) movimentos.push({ tipo: "retorno", categoria: f.categoria, qtd: f.ret, desde: f.desde });
    f.linhas.forEach((l) => {
      const q = Math.floor(numero(l.qtd) || 0);
      if (q <= 0) return;
      if (l.tipo === "morto") movimentos.push({ tipo: "morte", categoria: f.categoria, qtd: q, desde: f.desde,
        ...(l.brinco ? { brinco: l.brinco } : {}), ...(l.causa ? { causa: l.causa } : {}) });
      if (l.tipo === "perda") movimentos.push({ tipo: "perda", categoria: f.categoria, qtd: q, desde: f.desde });
    });
  });
  cards.forEach((k) => {
    let soma = 0;
    k.linhas.forEach((l) => {
      const q = Math.floor(numero(l.qtd) || 0);
      if (!l.tipo || q <= 0) return;
      soma += q;
      const mv = { tipo: l.tipo, categoria: k.c, qtd: q };
      if (l.tipo === "mudanca") { if (!l.para) erro ||= { c: k.c, msg: `Escolha para qual categoria mudaram os ${k.c}.` }; mv.para = l.para; }
      if (TROCA_POT[l.tipo]) {
        if (!l.outro) erro ||= { c: k.c, msg: `Escolha ${l.tipo === "veio" ? "de qual potreiro vieram" : "para qual potreiro foram"} os ${k.c} (ou "Já atualizado no outro potreiro").` };
        if (l.outro === "*") mv.ja = true; // o outro potreiro já foi atualizado: só registra aqui
        else mv.outro = l.outro;
      }
      if (l.tipo === "morte") { if (l.brinco) mv.brinco = l.brinco; if (l.causa) mv.causa = l.causa; }
      if (l.tipo === "faltando") { ref[k.c] += q; faltando.push({ categoria: k.c, qtd: q, desde: data }); }
      if (l.tipo === "visitante") ref[k.c] -= q;
      movimentos.push(mv);
    });
    if (k.alvo < 0) erro ||= { c: k.c, msg: `${k.c}: as mudanças de categoria passam do aumento contado.` };
    else if (soma > k.alvo) erro ||= { c: k.c, msg: `${k.c}: a explicação soma ${soma}, mas a diferença é ${k.alvo}.` };
    k.semExplicar = Math.max(0, k.alvo - soma);
  });
  const ordemC = Object.keys(C);
  const refLista = [...ordemC, ...cats.filter((c) => !ordemC.includes(c))]
    .filter((c) => ref[c] > 0).map((c) => ({ categoria: c, qtd: ref[c] }));
  return { ant, A, C, entradas, cards, ref: refLista, faltando, movimentos, erro, data };
}

let difTimer = null;
function agendarDif() { clearTimeout(difTimer); difTimer = setTimeout(renderDif, 150); }

function renderDif() {
  const box = $("#dif-animais");
  difAtual = calcDif();
  const d = difAtual;
  if (!d || (!d.entradas.length && !d.cards.length)) { box.innerHTML = ""; return; }
  const opcoes = (k, l) => {
    const tipos = k.sinal < 0 ? TIPOS_MENOS : TIPOS_MAIS;
    const destinos = d.cards.filter((x) => x.sinal > 0).map((x) => x.c);
    return `<option value="">O que aconteceu?</option>` + tipos
      .filter((t) => t !== "mudanca" || destinos.length || l.tipo === "mudanca")
      .map((t) => `<option value="${t}" ${l.tipo === t ? "selected" : ""}>${TIPOS_MOV[t]}</option>`).join("");
  };
  const linha = (k, l, i) => {
    const destinos = d.cards.filter((x) => x.sinal > 0).map((x) => x.c);
    if (l.para && !destinos.includes(l.para)) destinos.push(l.para);
    return `<div class="dif-mov" data-i="${i}">
      <div class="dif-mov-l">
        <input type="text" class="dif-qtd" inputmode="numeric" value="${esc(l.qtd ?? "")}" aria-label="Quantidade">
        <select class="dif-tipo">${opcoes(k, l)}</select>
        ${k.linhas.length > 1 ? `<button type="button" class="btn-x" data-dif-rem aria-label="Remover">×</button>` : ""}
      </div>
      ${TROCA_POT[l.tipo] ? `<label class="dif-extra">${l.tipo === "veio" ? "Vieram de" : "Foram para"} ${selectPotreiro(k.c, l)}</label>` : ""}
      ${l.tipo === "mudanca" ? `<label class="dif-extra">Passaram para <select class="dif-para"><option value="">escolha</option>${destinos.map((c) => `<option ${l.para === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : ""}
      ${l.tipo === "morte" ? `<div class="dif-extra dif-morte">
        <input type="text" class="dif-brinco" placeholder="Brinco (opcional)" value="${esc(l.brinco || "")}" autocomplete="off">
        <input type="text" class="dif-causa" placeholder="Causa provável (opcional)" value="${esc(l.causa || "")}" autocomplete="off"></div>` : ""}
    </div>`;
  };
  const card = (k) => {
    const sinal = k.sinal < 0 ? `−${fmtNum(-(k.agora - k.antes))}` : `+${fmtNum(k.agora - k.antes)}`;
    const veio = (k.veio || []).filter((v) => v.qtd > 0).map((v) => `<small class="dif-veio">${fmtNum(v.qtd)} vieram de ${esc(v.de)}</small>`).join("");
    const resto = k.semExplicar && k.linhas.some((l) => l.tipo)
      ? `<small class="dif-resto">${fmtNum(k.semExplicar)} sem explicação: contam como contagem anterior errada.</small>` : "";
    return `<div class="dif-cat ${d.erro?.c === k.c ? "erro" : ""}" data-cat="${esc(k.c)}">
      <div class="dif-tit"><b>${esc(k.c)}</b> <span class="${k.sinal < 0 ? "dif-menos" : "dif-mais"}">${sinal}</span> <small>${fmtNum(k.antes)} → ${fmtNum(k.agora)}</small></div>
      ${veio}
      ${k.linhas.map((l, i) => linha(k, l, i)).join("")}
      ${k.alvo > 0 ? `<button type="button" class="link dif-add" data-dif-add>+ Dividir em outro motivo</button>` : ""}
      ${resto}
    </div>`;
  };
  const linhaFalt = (f, l, i) => `<div class="dif-mov" data-i="${i}">
      <div class="dif-mov-l">
        <input type="text" class="dif-qtd" inputmode="numeric" value="${esc(l.qtd ?? "")}" aria-label="Quantidade">
        <select class="dif-tipo">${Object.entries(TIPOS_FALT).map(([t, n]) => `<option value="${t}" ${l.tipo === t ? "selected" : ""}>${n}</option>`).join("")}</select>
        ${f.linhas.length > 1 ? `<button type="button" class="btn-x" data-dif-rem aria-label="Remover">×</button>` : ""}
      </div>
      ${l.tipo === "morto" ? `<div class="dif-extra dif-morte">
        <input type="text" class="dif-brinco" placeholder="Brinco (opcional)" value="${esc(l.brinco || "")}" autocomplete="off">
        <input type="text" class="dif-causa" placeholder="Causa provável (opcional)" value="${esc(l.causa || "")}" autocomplete="off"></div>` : ""}
    </div>`;
  const falt = d.entradas.map((f) => `<div class="dif-falt ${d.erro?.key === f.key ? "erro" : ""}" data-key="${esc(f.key)}">
      <div class="dif-tit"><b>${fmtNum(f.qtd)} ${esc(f.categoria)}</b> faltando desde ${fmtData(f.desde)} <small>(${haDias(f.desde)})</small></div>
      ${f.linhas.map((l, i) => linhaFalt(f, l, i)).join("")}
      <button type="button" class="link dif-add" data-dif-add>+ Dividir em outro desfecho</button>
    </div>`).join("");
  const txtRef = d.ref.map((a) => {
    const f = d.faltando.filter((x) => x.categoria === a.categoria).reduce((s, x) => s + x.qtd, 0);
    return `${fmtNum(a.qtd)} ${esc(a.categoria)}${f ? ` <span class="txt-falta">(${fmtNum(f)} faltando)</span>` : ""}`;
  }).join(" · ") || "nenhum animal";
  box.innerHTML = `<div class="dif">
    ${d.entradas.length ? `<div class="dif-sec">Animais faltando na última recorrida</div>${falt}` : ""}
    ${d.cards.length ? `<div class="dif-sec">Diferença com a lotação de ${fmtData(d.ant.data)}</div>${d.cards.map(card).join("")}` : ""}
    <p class="dif-ref"><b>Próxima lotação de referência:</b> ${txtRef}</p>
  </div>`;
}

// Lê as linhas de um cartão do quadro para o estado (a pessoa mexeu nele)
const lerLinhasDif = (el) => $$(".dif-mov", el).map((m) => ({
  qtd: m.querySelector(".dif-qtd").value.trim(),
  tipo: m.querySelector(".dif-tipo").value,
  para: m.querySelector(".dif-para")?.value || "",
  brinco: m.querySelector(".dif-brinco")?.value.trim().toUpperCase() || "",
  causa: m.querySelector(".dif-causa")?.value.trim() || "",
}));
// Cartão do quadro (diferença ou faltando): guarda as linhas como escolha da pessoa
function guardarCard(cardEl) {
  if (cardEl.classList.contains("dif-falt")) return (faltEstado[cardEl.dataset.key] = { linhas: lerLinhasDif(cardEl) });
  const c = cardEl.dataset.cat;
  const k = difAtual?.cards.find((x) => x.c === c);
  difEstado[c] = {
    e: k ? k.sinal * k.alvo : undefined,
    linhas: $$(".dif-mov", cardEl).map((m) => ({
      qtd: m.querySelector(".dif-qtd").value.trim(),
      tipo: m.querySelector(".dif-tipo").value,
      para: m.querySelector(".dif-para")?.value || "",
      outro: (m.querySelector(".dif-outro")?.value || "").replace("+todos", ""),
      todos: m.querySelector(".dif-outro")?.value === "+todos" || m.querySelector(".dif-outro")?.dataset.todos === "1",
      brinco: m.querySelector(".dif-brinco")?.value.trim().toUpperCase() || "",
      causa: m.querySelector(".dif-causa")?.value.trim() || "",
    })),
  };
  return difEstado[c];
}

function ligarEventosDif() {
  const box = $("#dif-animais");
  ["input", "focusout", "click"].forEach((ev) => $("#linhas-animais").addEventListener(ev, agendarDif));
  campo("data").addEventListener("change", agendarDif);
  box.addEventListener("input", (e) => {
    const cardEl = e.target.closest(".dif-cat, .dif-falt");
    if (cardEl) { guardarCard(cardEl); cardEl.classList.remove("erro"); }
  });
  // Quantidade e tipo mudam outros cartões (mudança de categoria) e a lotação de referência: redesenha
  box.addEventListener("change", (e) => {
    const cardEl = e.target.closest(".dif-cat, .dif-falt");
    if (cardEl) guardarCard(cardEl);
    if (e.target.matches(".dif-qtd, .dif-tipo, .dif-para, .dif-outro")) renderDif();
  });
  box.addEventListener("click", (e) => {
    const cardEl = e.target.closest(".dif-cat, .dif-falt");
    if (!cardEl) return;
    if (e.target.closest("[data-dif-add]")) {
      const st = guardarCard(cardEl);
      // A linha nova já vem com o que ainda não foi explicado
      const falt = cardEl.classList.contains("dif-falt");
      const total = falt ? difAtual?.entradas.find((f) => f.key === cardEl.dataset.key)?.qtd
        : difAtual?.cards.find((k) => k.c === cardEl.dataset.cat)?.alvo;
      const usado = st.linhas.reduce((t, l) => t + (Math.floor(numero(l.qtd) || 0)), 0);
      const resto = Math.max(0, (total || 0) - usado);
      st.linhas.push({ qtd: resto || "", tipo: falt ? "ainda" : "" });
      renderDif();
      return;
    }
    const rem = e.target.closest("[data-dif-rem]");
    if (rem) {
      const st = guardarCard(cardEl);
      st.linhas.splice(Number(rem.closest(".dif-mov").dataset.i), 1);
      renderDif();
    }
  });
}

// Na edição: devolve a contagem e as escolhas feitas
function restaurarDif(r) {
  difEstado = {};
  faltEstado = {};
  const desfecho = { retorno: "voltaram", morte: "morto", perda: "perda" };
  (r.movimentos || []).forEach((m) => {
    // Com "desde": desfecho de animais que estavam faltando (o resto continua faltando)
    if (m.desde && desfecho[m.tipo]) {
      (faltEstado[`${m.categoria}|${m.desde}`] ||= { linhas: [] }).linhas
        .push({ qtd: m.qtd, tipo: desfecho[m.tipo], brinco: m.brinco || "", causa: m.causa || "" });
      return;
    }
    (difEstado[m.categoria] ||= { e: undefined, linhas: [] }).linhas.push({ qtd: m.qtd, tipo: m.tipo, para: m.para || "", outro: m.ja ? "*" : m.outro || "", todos: true, brinco: m.brinco || "", causa: m.causa || "" });
  });
  // Faltando que continuaram: completa com "Ainda faltam"
  const ant = anteriorLotacao();
  (ant?.faltando || []).forEach((f) => {
    const st = faltEstado[`${f.categoria}|${f.desde}`];
    if (!st) return;
    const resto = Number(f.qtd) - st.linhas.reduce((s, l) => s + Number(l.qtd), 0);
    if (resto > 0) st.linhas.push({ qtd: resto, tipo: "ainda" });
  });
}

// Faltando e retorno ficam na linha "Faltando"; movimentação é o resto (morte, venda, transferência...)
const movReais = (r) => (r.movimentos || []).filter((m) => m.tipo !== "faltando" && m.tipo !== "retorno");
const txtVoltaram = (r) => (r.movimentos || []).filter((m) => m.tipo === "retorno").map((m) => `voltaram ${fmtNum(m.qtd)} ${m.categoria}`).join(" · ");
const txtMov = (r) => movReais(r).map((m) => m.tipo === "mudanca"
  ? `${fmtNum(m.qtd)} ${m.categoria} → ${m.para}`
  : m.tipo === "transferencia" ? `${fmtNum(m.qtd)} ${m.categoria} foram para ${m.outro || "outro potreiro (já atualizado)"}`
  : m.tipo === "veio" ? `${fmtNum(m.qtd)} ${m.categoria} vieram de ${m.outro || "outro potreiro (já atualizado)"}`
  : `${NOME_MOV[m.tipo] || m.tipo}: ${fmtNum(m.qtd)} ${m.categoria}${m.brinco ? ` (brinco ${m.brinco})` : ""}${m.causa ? ` (${m.causa})` : ""}`).join(" · ");
const txtFaltando = (lot) => (lot?.faltando || []).filter((f) => f.qtd > 0)
  .map((f) => `${fmtNum(f.qtd)} ${f.categoria} (desde ${fmtData(f.desde)}, ${haDias(f.desde)})`).join(" · ");

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
let repostoSel = new Set(); // ids de faltas abertas desmarcadas nesta recorrida (viram "reposto" ao salvar)

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
    const desmarcada = aberta && repostoSel.has(aberta.id);
    const on = aberta ? !desmarcada : faltaSel.has(n);
    const info = !aberta ? ""
      : desmarcada ? `<small>em falta desde ${fmtData(aberta.data)} · ao salvar, fica como reposto nesta data</small>`
      : `<small>em falta desde ${fmtData(aberta.data)} · desmarque se já tem no depósito ou não precisa mais</small>`;
    return `<button type="button" class="falta-item ${aberta && !desmarcada ? "aberta" : ""}" data-falta="${esc(n)}" ${aberta ? `data-aberta="${esc(aberta.id)}"` : ""} aria-pressed="${on}">
      <span class="fi-nome">${esc(n)}${info}</span><span class="interruptor" aria-hidden="true"></span></button>`;
  }).join("") || `<p class="muted-s">Nenhum mineral usado aqui recentemente. Escolha abaixo.</p>`;
}

function alternarFalta(btn) {
  // Falta já aberta: desmarcar = reposto na data da recorrida (gravado ao salvar)
  const id = btn.dataset.aberta;
  if (id) {
    if (repostoSel.has(id)) repostoSel.delete(id); else repostoSel.add(id);
    renderFaltas();
    return;
  }
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

// Faltas abertas desmarcadas na recorrida: reposto na data da recorrida, como o botão do Painel
function gravarRepostosDaRecorrida(rec, ids, agora) {
  if (!ids.size) return;
  faltas.filter((f) => ids.has(f.id) && !f.excluido && !f.reposto_em && mesmoNome(f.potreiro, rec.potreiro))
    .forEach((f) => Object.assign(f, { reposto_em: rec.data, reposto_por: usuario?.email || "demo", atualizado_em: agora, _pendente: true }));
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

// Fotos dos minerais (img/minerais/<nome sem acento, com hífen>.png). Incluir o nome aqui ao adicionar uma foto.
const FOTOS_MINERAIS = new Set([
  "advance", "aveia-azevem", "bovigold-pasto", "energetico-25-m", "engorda", "fosbovinho-ade",
  "pampero", "pasto-crina", "proteico-30-m", "reproducao", "seca",
]);
function fotoMineral(nome) {
  const slug = norm(nome).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return FOTOS_MINERAIS.has(slug) ? `<img class="pf-foto" src="img/minerais/${slug}.png" alt="" loading="lazy">` : "";
}

function renderFaltasPainel() {
  const abertas = faltasAbertas().sort((a, b) => a.mineral.localeCompare(b.mineral, "pt-BR") || a.data.localeCompare(b.data));
  if (!abertas.length) { $("#p-faltas").innerHTML = `<p class="vazio">Nenhum mineral em falta no depósito.</p>`; return; }
  const grupos = {};
  abertas.forEach((f) => (grupos[f.mineral] ||= []).push(f));
  // Pela última lotação conferida: vazio, sem bovinos (só ovinos, por exemplo) ou nunca conferido
  const estado = estadoPotreiros();
  const semBov = (pot) => {
    const lot = estado.get(norm(pot))?.lotacao;
    if (!lot) return ' <span class="pf-aviso">sem informação de bovinos no potreiro</span>';
    if (lot.lotacao === "vazio") return ' <span class="pf-aviso">potreiro vazio</span>';
    return totalBovinos(lot) ? "" : ' <span class="pf-aviso">potreiro sem bovinos</span>';
  };
  $("#p-faltas").innerHTML = Object.entries(grupos).map(([mineral, fs]) => `
    <div class="pf-grupo">
      <div class="pf-min"><span>${esc(mineral)} <span class="muted-s">(${fs.length} potreiro${fs.length > 1 ? "s" : ""})</span></span>${fotoMineral(mineral)}</div>
      ${fs.map((f) => `<div class="pf-linha">
        <span>${esc(f.potreiro)}${semBov(f.potreiro)}<small>desde ${fmtData(f.data)} (${haDias(f.data)}) · ${esc(quem(f.registrado_por))}${f._pendente ? ' · <span class="pend">aguardando envio</span>' : ""}</small></span>
        <button type="button" class="btn-light" data-reposto="${esc(f.id)}">Reposto</button>
      </div>`).join("")}
    </div>`).join("");
}

// =====================================================================
// Medicamentos (bloco 5): todo o lote ou animais específicos
// =====================================================================
// medicacao = { modo: "lote", qtd, itens: [{ dose, medicamento, categorias?, qtd? }] }
//          ou { modo: "animais", animais: [{ brinco, motivo, itens: [{ dose, medicamento }] }] }
// No lote, "categorias" só aparece quando o medicamento foi para parte das categorias (qtd = soma delas).
let medModo = "lote";
// Jeito de informar medicamentos por categoria no lote:
// "A" (em uso) = escolhe as categorias e depois os medicamentos do grupo;
// "B" (testada, guardada) = cada linha de medicamento marca as suas categorias. Para voltar a ela, troque para "B".
// Os dados gravados são os mesmos nas duas, então dá para trocar sem perder registros.
const medOpcao = "A";
let tecladoBrinco = "numeric"; // "numeric" (padrão) ou "text"; vale para os próximos animais
const fmtDose = (n) => String(n ?? "").replace(".", ",");

function linhaMed(m = {}) {
  const d = document.createElement("div");
  d.className = "linha linha-med";
  d.innerHTML = `<input type="text" class="qtd dose" inputmode="decimal" placeholder="Dose" aria-label="Dose" autocomplete="off">
    <span></span><button type="button" class="btn-x" data-remover aria-label="Remover">×</button>`;
  d.querySelector(".dose").value = fmtDose(m.dose);
  d.replaceChild(combo("medicamento", m.medicamento || ""), d.children[1]);
  return d;
}

function cartaoAnimalMed(a = {}) {
  const d = document.createElement("div");
  d.className = "med-animal";
  d.innerHTML = `<div class="med-animal-cab">
      <label class="mini"><span>Brinco</span><span class="brinco-campo">
        <input type="text" class="brinco" placeholder="Opcional" autocomplete="off" autocapitalize="characters" inputmode="${tecladoBrinco}">
        <button type="button" class="btn-teclado" data-teclado aria-label="Trocar teclado">${tecladoBrinco === "numeric" ? "ABC" : "123"}</button></span></label>
      <button type="button" class="btn-x" data-remover-animal aria-label="Remover animal">×</button>
    </div>
    <label class="mini"><span>Motivo</span><input type="text" class="motivo" placeholder="Ex.: bicheira, pneumonia" autocomplete="off"></label>
    <div class="med-cab"><span>Dose</span><span>Medicamento</span></div>
    <div class="linhas linhas-med"></div>
    <div class="linha-acoes"><button type="button" class="btn-mais btn-mais-s" data-add-med aria-label="Adicionar medicamento">+</button>
      <span class="muted-s">Outro medicamento para este animal</span></div>`;
  d.querySelector(".brinco").value = a.brinco || "";
  d.querySelector(".motivo").value = a.motivo || "";
  (a.itens?.length ? a.itens : [{}]).forEach((m) => d.querySelector(".linhas-med").appendChild(linhaMed(m)));
  return d;
}

// Categorias do lote: as conferidas agora no bloco 2 ou, sem elas, as da última lotação
function catsDoLote() {
  if (blocoLigado("animais") && !vazio) {
    const m = new Map();
    $$("#linhas-animais .linha-animal").forEach((l) => {
      const q = numero(l.querySelector(".qtd").value);
      const it = acharItem(catalogo.categorias, l.querySelector(".combo-in").value);
      if (it && q > 0) m.set(it.nome, (m.get(it.nome) || 0) + q);
    });
    if (m.size) return [...m].map(([categoria, qtd]) => ({ categoria, qtd }));
  }
  const lot = potSel ? estadoPotreiros().get(norm(potSel))?.lotacao : null;
  return lot?.lotacao === "conferida" ? (lot.animais || []).map((a) => ({ categoria: a.categoria, qtd: Number(a.qtd) })) : [];
}

// Botões de categoria (sel = null marca todas)
function chipsCat(sel = null) {
  const d = document.createElement("div");
  d.className = "cats-med";
  desenharChips(d, sel);
  return d;
}
function desenharChips(box, sel) {
  const cats = catsDoLote();
  (sel || []).forEach((c) => { if (!cats.some((x) => mesmoNome(x.categoria, c))) cats.push({ categoria: c }); });
  if (!cats.length) { box.innerHTML = `<span class="muted-s">Sem categorias registradas: vale para todo o lote.</span>`; return; }
  const marcado = (c) => !sel || sel.some((x) => mesmoNome(x, c));
  const todas = cats.every((c) => marcado(c.categoria));
  box.innerHTML = (cats.length > 1 ? `<button type="button" class="todas" data-cat-todas aria-pressed="${todas}">Todas</button>` : "")
    + cats.map((c) => `<button type="button" data-cat-med="${esc(c.categoria)}" aria-pressed="${marcado(c.categoria)}">${esc(c.categoria)}${c.qtd ? ` <b>${fmtNum(c.qtd)}</b>` : ""}</button>`).join("");
}
const catsMarcadas = (box) => $$("[data-cat-med]", box).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.catMed);
const todasMarcadas = (box) => $$("[data-cat-med]", box).every((b) => b.getAttribute("aria-pressed") === "true");
function clicarChip(b) {
  const box = b.closest(".cats-med");
  if (b.dataset.catTodas !== undefined) {
    const ligar = !todasMarcadas(box);
    $$("[data-cat-med]", box).forEach((x) => x.setAttribute("aria-pressed", String(ligar)));
  } else b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
  $("[data-cat-todas]", box)?.setAttribute("aria-pressed", String(todasMarcadas(box)));
  box.classList.remove("erro");
}
// Quando os animais do bloco 2 mudam, refaz os botões mantendo o que estava marcado
function atualizarCatsMed() {
  $$("#linhas-med-lote .cats-med").forEach((box) => desenharChips(box, todasMarcadas(box) ? null : catsMarcadas(box)));
}

// Opção A: grupo de categorias com seus medicamentos
function grupoMed(g = {}) {
  const d = document.createElement("div");
  d.className = "med-grupo";
  d.innerHTML = `<div class="med-grupo-cab"><span>Categorias</span>
      <button type="button" class="btn-x" data-remover-grupo aria-label="Remover grupo">×</button></div>
    <div class="med-cab"><span>Dose</span><span>Medicamento</span></div>
    <div class="linhas linhas-med"></div>
    <div class="linha-acoes"><button type="button" class="btn-mais btn-mais-s" data-add-med aria-label="Adicionar medicamento">+</button>
      <span class="muted-s">Outro medicamento para estas categorias</span></div>`;
  d.insertBefore(chipsCat(g.categorias ?? null), d.children[1]);
  (g.itens?.length ? g.itens : [{}]).forEach((m) => d.querySelector(".linhas-med").appendChild(linhaMed(m)));
  return d;
}
// Novo grupo já vem com as categorias que ainda não estão em nenhum grupo
function novoGrupoMed() {
  const usadas = $$("#linhas-med-lote .cats-med").flatMap(catsMarcadas);
  const resto = catsDoLote().map((c) => c.categoria).filter((c) => !usadas.some((u) => mesmoNome(u, c)));
  return grupoMed({ categorias: $$("#linhas-med-lote .med-grupo").length ? resto : null });
}

// Opção B: linha de dose + medicamento com as categorias embaixo
function itemMedCat(m = {}) {
  const d = document.createElement("div");
  d.className = "med-item";
  d.appendChild(linhaMed(m));
  d.appendChild(chipsCat(m.categorias?.length ? m.categorias : null));
  return d;
}
const novoItemLote = () => (medOpcao === "A" ? novoGrupoMed() : itemMedCat());

function mudarOpcaoMed(op) {
  $("#med-cab-lote").hidden = op === "A";
  $("#txt-add-med-lote").textContent = op === "A" ? "Outro grupo de categorias" : "Adicionar medicamento";
}

function mudarModoMed(modo) {
  medModo = modo;
  $$("[data-med-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.medModo === modo)));
  $("#med-lote").hidden = modo !== "lote";
  $("#med-animais").hidden = modo !== "animais";
  prepararMed();
}

// Garante uma linha em branco em cada modo e mostra quantos animais tem o lote
function prepararMed() {
  mudarOpcaoMed(medOpcao);
  if (!$("#linhas-med-lote").children.length) $("#linhas-med-lote").appendChild(novoItemLote());
  atualizarCatsMed();
  if (!$("#lista-med-animais").children.length) $("#lista-med-animais").appendChild(cartaoAnimalMed());
  const lot = potSel ? estadoPotreiros().get(norm(potSel))?.lotacao : null;
  $("#dica-med").textContent = lot?.lotacao === "conferida"
    ? `Lote: ${txtEspecies(lot)} (lotação de ${fmtData(lot.data)}). Se conferir os animais acima, vale a contagem nova.`
    : potSel ? "Sem lotação registrada para este potreiro: confira os animais acima para registrar quantos foram medicados."
    : "Sem potreiro escolhido: confira os animais acima para registrar quantos foram medicados.";
}

function limparMed() {
  tecladoBrinco = "numeric";
  $("#linhas-med-lote").innerHTML = "";
  $("#lista-med-animais").innerHTML = "";
  mudarModoMed("lote");
  $("#linhas-med-lote").innerHTML = "";
  $("#lista-med-animais").innerHTML = "";
  ligarBloco("med", false);
}

function preencherMed(med) {
  $("#linhas-med-lote").innerHTML = "";
  $("#lista-med-animais").innerHTML = "";
  if (!med) { ligarBloco("med", false); return; }
  if (med.modo === "animais") (med.animais || []).forEach((a) => $("#lista-med-animais").appendChild(cartaoAnimalMed(a)));
  else if (medOpcao === "B") (med.itens || []).forEach((m) => $("#linhas-med-lote").appendChild(itemMedCat(m)));
  else {
    // Opção A: junta os medicamentos que foram para as mesmas categorias
    const grupos = new Map();
    (med.itens || []).forEach((m) => {
      const k = (m.categorias || []).map(norm).sort().join("|");
      if (!grupos.has(k)) grupos.set(k, { categorias: m.categorias?.length ? m.categorias : null, itens: [] });
      grupos.get(k).itens.push(m);
    });
    grupos.forEach((g) => $("#linhas-med-lote").appendChild(grupoMed(g)));
  }
  mudarModoMed(med.modo === "animais" ? "animais" : "lote");
  ligarBloco("med", true);
}

// Lê as linhas de dose + medicamento de um contêiner (linhas em branco são ignoradas)
function lerItensMed(box) {
  const itens = [];
  let erro = null;
  $$(".linha-med", box).forEach((l) => {
    const dInp = l.querySelector(".dose");
    const cInp = l.querySelector(".combo-in");
    if (!dInp.value.trim() && !cInp.value.trim()) return;
    const dose = numero(dInp.value);
    const item = cInp.value.trim() && acharItem(listaDoTipo("medicamento"), cInp.value);
    const ok = dInp.value.trim() && dose > 0;
    dInp.classList.toggle("erro", !ok);
    cInp.classList.toggle("erro", !item);
    if (!ok || !item) { erro ||= !item ? cInp : dInp; return; }
    itens.push({ dose, medicamento: item.nome });
  });
  return { itens, erro };
}

// qtdConferida: animais contados nesta recorrida (ou null para usar a última lotação)
function lerMed(qtdConferida) {
  const msgItens = "Confira os medicamentos: dose (número) e medicamento da lista.";
  if (medModo === "lote") {
    const cats = catsDoLote();
    const itens = [];
    // Cada bloco (grupo na opção A, linha na opção B) tem seus botões de categoria
    for (const bloco of $$("#linhas-med-lote > .med-grupo, #linhas-med-lote > .med-item")) {
      const r = lerItensMed(bloco);
      if (r.erro) return { erro: r.erro, msg: msgItens };
      if (!r.itens.length) continue;
      const box = $(".cats-med", bloco);
      let extra = {};
      if (!todasMarcadas(box)) {
        const categorias = catsMarcadas(box);
        if (!categorias.length) { box.classList.add("erro"); box.scrollIntoView({ block: "center", behavior: "smooth" }); return { erro: box, msg: "Marque a(s) categoria(s) que receberam o medicamento." }; }
        const soma = categorias.reduce((s, c) => s + (cats.find((x) => mesmoNome(x.categoria, c))?.qtd || 0), 0);
        extra = { categorias, qtd: soma || "" };
      }
      r.itens.forEach((m) => itens.push({ ...m, ...extra }));
    }
    if (!itens.length) return { erro: $("#linhas-med-lote .dose"), msg: "Informe a dose e o medicamento (ou desligue “Medicamentos”)." };
    const lot = estadoPotreiros().get(norm(potSel))?.lotacao;
    const qtd = qtdConferida ?? (lot?.lotacao === "conferida" ? totalAnimais(lot) : "");
    return { med: { modo: "lote", qtd, itens } };
  }
  const animais = [];
  for (const c of $$("#lista-med-animais .med-animal")) {
    const bInp = c.querySelector(".brinco");
    const brinco = bInp.value.trim().toUpperCase();
    const motivo = c.querySelector(".motivo").value.trim();
    const r = lerItensMed(c);
    if (!brinco && !motivo && !r.itens.length && !r.erro) continue; // cartão em branco
    if (r.erro) return { erro: r.erro, msg: msgItens };
    if (!r.itens.length) return { erro: c.querySelector(".dose"), msg: `Informe a dose e o medicamento${brinco ? ` do brinco ${brinco}` : " do animal"}.` };
    animais.push({ brinco, motivo, itens: r.itens });
  }
  if (!animais.length) return { erro: $("#lista-med-animais .dose"), msg: "Informe a dose e o medicamento (ou desligue “Medicamentos”)." };
  return { med: { modo: "animais", animais } };
}

const txtItensMed = (itens) => (itens || []).map((m) => `${fmtDose(m.dose)} ${unidadeDe(m.medicamento)} ${m.medicamento}`).join(" + ");
function txtMed(med) {
  if (med.modo === "animais") return (med.animais || []).map((a) => `${a.brinco ? `Brinco ${a.brinco}` : "Animal sem brinco"}: ${txtItensMed(a.itens)}${a.motivo ? ` (${a.motivo})` : ""}`).join(" · ");
  const parte = (med.itens || []).filter((m) => m.categorias?.length);
  if (!parte.length) return `Lote${med.qtd ? ` (${fmtNum(med.qtd)} animais)` : ""}: ${txtItensMed(med.itens)}`;
  return (med.itens || []).map((m) => `${txtItensMed([m])} → ${m.categorias?.length ? m.categorias.join(", ") : "todo o lote"}${m.categorias?.length && m.qtd ? ` (${fmtNum(m.qtd)})` : ""}`).join(" · ");
}

// =====================================================================
// Formulário
// =====================================================================
const form = () => $("#form");
const campo = (nome) => form().elements[nome];

// "Tem mineral": o cocho já tinha mineral nesta recorrida (só registro, sem sacos nem consumo)
let temMineral = false;
function marcarTemMineral(v) {
  temMineral = v;
  $("#btn-tem").classList.toggle("on", v);
  $("#btn-tem").setAttribute("aria-pressed", String(v));
}

function limparForm() {
  editId = null;
  marcarTemMineral(false);
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
  limparDif();
  marcarVazio(false);
  $("#linhas-animais").innerHTML = "";
  ligarBloco("animais", false);
  ligarBloco("mineral", false);
  faltaSel = new Set();
  repostoSel = new Set();
  ligarBloco("falta", false);
  limparMed();
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
  if (r.potreiro) escolherPotreiro(r.potreiro, { preencher: false });
  $("#linhas-animais").innerHTML = "";
  $("#linhas-mineral").innerHTML = "";
  // Medicação sem potreiro: os animais conferidos ficaram guardados na medicação
  const animaisMed = !r.potreiro && !r.lotacao ? r.medicacao?.lote || [] : [];
  (animaisMed.length ? animaisMed : r.contados?.length ? r.contados : r.animais || []).forEach((a) => $("#linhas-animais").appendChild(linhaAnimal(a)));
  restaurarDif(r);
  (r.minerais || []).forEach((m) => $("#linhas-mineral").appendChild(linhaMineral(m)));
  marcarVazio(r.lotacao === "vazio");
  marcarTemMineral(!!r.tem_mineral);
  preencherMed(r.medicacao);
  ligarBloco("animais", !!r.lotacao || animaisMed.length > 0);
  ligarBloco("mineral", !!r.minerais?.length);
  atualizarCatsMed();
  renderDif();
  faltaSel = new Set(faltasAtivas().filter((f) => f.recorrida_id === id).map((f) => f.mineral));
  ligarBloco("falta", faltaSel.size > 0);
  if (!r.lotacao && !animaisMed.length) { $("#linhas-animais").innerHTML = ""; }
  $("#form-titulo").textContent = `Editando: ${nomePot(r)} (${fmtData(r.data)})`;
  $("#btn-salvar").textContent = "Salvar alterações";
  $("#btn-cancelar").hidden = false;
  $("#btn-limpar").hidden = true;
  mostrarAba("registro");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =====================================================================
// Transferência entre potreiros: prévia da lotação do outro potreiro e registro automático
// =====================================================================
const outrosPotreiros = () => catalogo.potreiros.filter((p) => p.ativo !== false && !mesmoNome(p.nome, potSel))
  .map((p) => p.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));

// Lista de potreiros do quadro. Em cima, "Já atualizado no outro potreiro" (não mexe no outro).
// Em "Vieram", só os que têm a categoria na lotação (com a quantidade), com a opção de ver todos.
function selectPotreiro(cat, l) {
  const sel = (v) => (mesmoNome(l.outro, v) ? "selected" : "");
  let ops = `<option value="">escolha o potreiro</option><option value="*" ${l.outro === "*" ? "selected" : ""}>Já atualizado no outro potreiro</option>`;
  let todos = l.tipo !== "veio" || l.todos;
  if (!todos) {
    const est = estadoPotreiros();
    const com = outrosPotreiros().map((n) => {
      const lot = est.get(norm(n))?.lotacao;
      return { n, q: lot?.lotacao === "conferida" ? somaCats(lot.animais)[cat] || 0 : 0 };
    }).filter((x) => x.q > 0);
    if (!com.length) todos = true;
    else {
      ops += `<optgroup label="Com ${esc(cat)} na lotação">${com.map((x) => `<option value="${esc(x.n)}" ${sel(x.n)}>${esc(x.n)} (${fmtNum(x.q)})</option>`).join("")}</optgroup>`;
      if (l.outro && l.outro !== "*" && !com.some((x) => mesmoNome(x.n, l.outro))) ops += `<option value="${esc(l.outro)}" selected>${esc(l.outro)}</option>`;
      ops += `<option value="+todos">Mostrar todos os potreiros…</option>`;
    }
  }
  if (todos) ops += outrosPotreiros().map((n) => `<option value="${esc(n)}" ${sel(n)}>${esc(n)}</option>`).join("");
  return `<select class="dif-outro" data-todos="${todos && l.tipo === "veio" ? 1 : 0}">${ops}</select>`;
}

// Lotação em vigor no potreiro na data (sem os registros que esta recorrida já tinha criado)
function lotacaoEm(nome, data, excluir) {
  return ativos().filter((r) => r.lotacao && mesmoNome(r.potreiro, nome) && !excluir.has(r.id) && r.data <= data).sort(ordenar)[0] || null;
}

// Agrupa as transferências por potreiro: [{ pot, sinal: +1 recebe / -1 cede, itens: [{ categoria, qtd }] }]
function transferenciasPorPotreiro(movimentos) {
  const grupos = new Map();
  movimentos.filter((m) => TROCA_POT[m.tipo] && m.outro).forEach((m) => {
    const k = norm(m.outro);
    if (!grupos.has(k)) grupos.set(k, { pot: m.outro, itens: [] });
    grupos.get(k).itens.push({ categoria: m.categoria, qtd: m.qtd, sinal: m.tipo === "transferencia" ? 1 : -1 });
  });
  return [...grupos.values()];
}

// Janela com a prévia de cada potreiro: números editáveis e a escolha de atualizar ou não.
// Resolve com [{ pot, aplicar, animais, base }] ou null (voltou para a recorrida).
function perguntarTransferencias(grupos, data, excluir) {
  const prev = grupos.map((g) => {
    const base = lotacaoEm(g.pot, data, excluir);
    const atual = base?.lotacao === "conferida" ? somaCats(base.animais) : {};
    const delta = {};
    g.itens.forEach((i) => { delta[i.categoria] = (delta[i.categoria] || 0) + i.sinal * i.qtd; });
    const cats = [...new Set([...Object.keys(atual), ...Object.keys(delta)])];
    // O outro potreiro já registrou essa troca com este? Então já vem desmarcado, para não duplicar
    const ja = (base?.movimentos || []).filter((m) => mesmoNome(m.outro, potSel) && g.itens.some((i) => i.categoria === m.categoria
      && m.tipo === (i.sinal > 0 ? "veio" : "transferencia")));
    return { ...g, base, ja, linhas: cats.map((c) => ({ c, antes: atual[c] || 0, mov: delta[c] || 0, depois: Math.max(0, (atual[c] || 0) + (delta[c] || 0)) })) };
  });
  const corpo = prev.map((g, gi) => {
    const recebe = g.itens.some((i) => i.sinal > 0);
    const situacao = !g.base ? "Sem lotação registrada."
      : g.base.lotacao === "vazio" ? `Vazio em ${fmtData(g.base.data)}.`
      : `Lotação de ${fmtData(g.base.data)} (${haDias(g.base.data)}).`;
    return `<div class="tr-pot" data-g="${gi}">
      <h3>${esc(g.pot)}</h3>
      <p class="muted-s">${situacao}</p>
      <table class="tr-tab"><thead><tr><th>Categoria</th><th>Antes</th><th></th><th>Fica</th></tr></thead><tbody>
      ${g.linhas.map((l, li) => `<tr><td>${esc(l.c)}</td><td>${fmtNum(l.antes)}</td>
        <td class="${l.mov > 0 ? "tr-mais" : l.mov < 0 ? "tr-menos" : ""}">${l.mov ? (l.mov > 0 ? "+" : "−") + fmtNum(Math.abs(l.mov)) : ""}</td>
        <td><input type="text" inputmode="numeric" class="tr-qtd" data-l="${li}" value="${l.depois}" aria-label="${esc(l.c)} em ${esc(g.pot)}"></td></tr>`).join("")}
      </tbody></table>
      ${g.linhas.filter((l) => l.mov < 0 && l.antes < -l.mov).map((l) => `<p class="tr-aviso">${esc(g.pot)} tinha ${fmtNum(l.antes)} ${esc(l.c)} na lotação: confira se é este o potreiro.</p>`).join("")}
      ${g.ja.length ? `<p class="tr-aviso">${esc(g.pot)} já registrou em ${fmtData(g.base.data)}: ${g.ja.map((m) => `${fmtNum(m.qtd)} ${esc(m.categoria)}`).join(", ")} ${recebe ? "vindos de" : "enviados para"} ${esc(potSel)}. Desmarcado para não duplicar.</p>` : ""}
      <label class="tr-aplicar"><input type="checkbox" class="tr-ok" ${g.ja.length ? "" : "checked"}> ${recebe ? "Somar" : "Descontar"} esses animais na lotação de ${esc(g.pot)}</label>
    </div>`;
  }).join("");
  $("#tr-corpo").innerHTML = corpo;
  const dlg = $("#dlg-transf");
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((ok) => dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "sim") { ok(null); return; }
    ok(prev.map((g, gi) => {
      const el = $(`.tr-pot[data-g="${gi}"]`);
      const animais = g.linhas.map((l, li) => ({ categoria: l.c, qtd: Math.max(0, Math.floor(numero($(`.tr-qtd[data-l="${li}"]`, el).value) || 0)) }))
        .filter((a) => a.qtd > 0);
      return { pot: g.pot, itens: g.itens, aplicar: $(".tr-ok", el).checked, animais, base: g.base };
    }));
  }, { once: true }));
}

// Recorrida criada no outro potreiro (só lotação), ligada à recorrida que a gerou
function recorridaDaTransferencia(rec, t, id, agora) {
  const recebe = t.itens.some((i) => i.sinal > 0);
  const vazioDepois = !t.animais.length;
  // Animais que estavam faltando lá continuam faltando (se a categoria continua na lotação)
  const faltando = vazioDepois ? [] : (t.base?.lotacao === "conferida" ? t.base.faltando || [] : [])
    .filter((f) => t.animais.some((a) => a.categoria === f.categoria && a.qtd >= f.qtd));
  return {
    id, data: rec.data, potreiro: t.pot,
    lotacao: vazioDepois ? "vazio" : "conferida",
    animais: t.animais, contados: null, faltando,
    movimentos: t.itens.map((i) => ({ tipo: i.sinal > 0 ? "veio" : "transferencia", categoria: i.categoria, qtd: i.qtd, outro: rec.potreiro })),
    minerais: [], tem_mineral: false, medicacao: null,
    obs: `Lotação atualizada pela recorrida de ${rec.potreiro}: animais ${recebe ? "vindos de lá" : "levados para lá"}.`,
    origem: { potreiro: rec.potreiro, recorrida_id: rec.id },
    registrado_por: rec.registrado_por, criado_em: agora, atualizado_em: agora, excluido: false, _pendente: true,
  };
}

async function excluirGerados(ids, agora) {
  for (const id of ids || []) {
    const g = registros.find((x) => x.id === id);
    if (g && !g.excluido) { Object.assign(g, { excluido: true, atualizado_em: agora, _pendente: true }); await db.gravar(g); }
  }
}

async function excluir(id) {
  const r = registros.find((x) => x.id === id);
  const gerados = (r?.gerados || []).map((g) => registros.find((x) => x.id === g && !x.excluido)).filter(Boolean);
  const extra = gerados.length ? `\n\nTambém será desfeita a atualização de lotação feita em ${gerados.map((g) => g.potreiro).join(", ")}.` : "";
  if (!r || !confirm(`Excluir o registro de ${nomePot(r)} (${fmtData(r.data)})?${extra}`)) return;
  Object.assign(r, { excluido: true, atualizado_em: new Date().toISOString(), _pendente: true });
  await db.gravar(r);
  await excluirGerados(r.gerados, r.atualizado_em);
  await gravarFaltasDaRecorrida(r, new Set(), r.atualizado_em);
  if (editId === id) limparForm();
  renderTudo();
  toast("Recorrida excluída.");
  sincronizar();
}

// Pergunta se lança só a medicação quando o potreiro não foi escolhido (resolve true = sim)
function perguntarSemPotreiro(avisos) {
  const dlg = $("#dlg-sem-pot");
  dlg.returnValue = "";
  $("#sp-aviso").textContent = avisos.join(" ");
  $("#sp-aviso").hidden = !avisos.length;
  dlg.showModal();
  return new Promise((ok) => dlg.addEventListener("close", () => ok(dlg.returnValue === "sim"), { once: true }));
}
const nomePot = (r) => r.potreiro || "Sem potreiro";

async function salvar(ev) {
  ev.preventDefault();
  $$(".erro", form()).forEach((e) => e.classList.remove("erro"));
  const falha = (msg, el) => { toast(msg); if (el) { el.classList.add("erro"); el.focus(); } };

  if (!campo("data").value) return falha("Informe a data.", campo("data"));
  if (campo("data").value > hojeISO()) return falha("A data não pode ser no futuro.", campo("data"));
  const irParaPotreiro = () => { window.scrollTo({ top: 0, behavior: "smooth" }); falha("Escolha o potreiro.", $("#pot-q")); };
  // Sem potreiro só dá para lançar medicação (a pergunta vem depois de conferir os medicamentos)
  const semPot = !potSel;
  if (semPot && !blocoLigado("med")) return irParaPotreiro();

  const comAnimais = blocoLigado("animais");
  const comMineral = blocoLigado("mineral") && !semPot;
  const comFalta = blocoLigado("falta") && !semPot;
  const comMed = blocoLigado("med");
  if (!comAnimais && !comMineral && !comFalta && !temMineral && !comMed) return falha("Ligue pelo menos uma opção: animais, mineral no cocho, tem mineral, falta no depósito ou medicamentos.");
  const repostos = new Set([...repostoSel].filter((id) => faltasAbertas().some((f) => f.id === id && mesmoNome(f.potreiro, potSel))));
  if (comFalta && !faltaSel.size && !repostos.size) return falha("Marque o mineral que está faltando no depósito, desmarque o que foi reposto (ou desligue a opção 4).");

  let animais = [];
  if (comAnimais && !vazio) {
    const r = lerLinhas("animais");
    if (r.erro) return falha("Confira as linhas de animais: quantidade inteira e categoria da lista.", r.erro);
    if (!r.itens.length) return falha("Informe os animais ou toque em “Potreiro vazio”.");
    animais = r.itens;
  }
  // Diferença com a lotação anterior: movimentações e lotação de referência
  const contados = animais;
  let movimentos = [], faltandoRec = [];
  let lotacao = comAnimais ? (vazio ? "vazio" : "conferida") : "";
  if (comAnimais && !semPot) {
    renderDif();
    const d = difAtual;
    if (d?.erro) {
      $("#dif-animais .erro")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return falha(d.erro.msg);
    }
    if (d) {
      movimentos = d.movimentos;
      faltandoRec = d.faltando;
      animais = d.ref;
      lotacao = animais.length ? "conferida" : "vazio";
    }
  }
  let minerais = [];
  if (comMineral) {
    const r = lerLinhas("mineral");
    if (r.erro) return falha("Confira as linhas de mineral: número de sacos e mineral da lista.", r.erro);
    if (!r.itens.length) return falha("Informe os sacos de pelo menos um mineral (ou desligue “Coloquei mineral no cocho”).", $("#linhas-mineral .qtd"));
    minerais = r.itens;
  }

  let medicacao = null;
  if (comMed) {
    const r = lerMed(comAnimais && !vazio ? contados.reduce((s, a) => s + Number(a.qtd), 0) : null);
    if (r.erro) return falha(r.msg, r.erro);
    medicacao = r.med;
  }

  if (semPot) {
    const avisos = [];
    if (animais.length) avisos.push("Os animais conferidos ficam só na medicação (a lotação não muda).");
    if (blocoLigado("mineral") || blocoLigado("falta") || temMineral) avisos.push("Mineral no cocho, tem mineral e falta no depósito precisam de potreiro e não serão salvos.");
    if (!await perguntarSemPotreiro(avisos)) return irParaPotreiro();
    // Sem potreiro não há lotação para consultar depois: guarda as categorias na própria medicação
    if (medicacao.modo === "lote" && animais.length) {
      medicacao.lote = animais;
      medicacao.itens = medicacao.itens.map((m) => (m.categorias?.length ? m
        : { ...m, categorias: animais.map((a) => a.categoria), qtd: medicacao.qtd }));
    }
  }

  const agora = new Date().toISOString();
  const antigo = editId ? registros.find((r) => r.id === editId) : null;

  // Transferências: prévia da lotação dos outros potreiros e confirmação
  let transf = [];
  const grupos = semPot ? [] : transferenciasPorPotreiro(movimentos);
  if (grupos.length) {
    transf = await perguntarTransferencias(grupos, campo("data").value, new Set([...(antigo?.gerados || []), editId].filter(Boolean)));
    if (!transf) return; // voltou para a recorrida
  }
  const gerar = transf.filter((t) => t.aplicar).map((t) => ({ t, id: novoId() }));

  const rec = {
    ...(antigo || {}),
    id: editId || novoId(),
    data: campo("data").value,
    potreiro: semPot ? "" : potSel,
    lotacao: semPot ? "" : lotacao,
    animais: semPot ? [] : animais,
    contados: !semPot && lotacao === "conferida" && (movimentos.length || faltandoRec.length) ? contados : null,
    gerados: gerar.map((g) => g.id),
    movimentos: semPot ? [] : movimentos,
    faltando: semPot ? [] : faltandoRec,
    minerais,
    tem_mineral: semPot ? false : temMineral,
    medicacao,
    obs: campo("obs").value.trim(),
    registrado_por: antigo?.registrado_por || usuario?.email || "demo",
    criado_em: antigo?.criado_em || agora,
    atualizado_em: agora,
    excluido: false,
    _pendente: true,
  };
  await db.gravar(rec);
  // Refaz as atualizações de lotação feitas antes por esta recorrida (na edição) e cria as novas
  await excluirGerados(antigo?.gerados, agora);
  for (const g of gerar) await db.gravar(recorridaDaTransferencia(rec, g.t, g.id, agora));
  await gravarFaltasDaRecorrida(rec, comFalta ? faltaSel : new Set(), agora);
  if (comFalta) await gravarRepostosDaRecorrida(rec, repostos, agora);
  registros = await db.todos();
  toast((antigo ? "Alterações salvas." : semPot ? "Medicação registrada (sem potreiro)." : `Recorrida de ${rec.potreiro} registrada.`)
    + (gerar.length ? ` Lotação atualizada em ${gerar.map((g) => g.t.pot).join(", ")}.` : ""), 4500);
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
    r.tem_mineral ? `<span class="badge tem">Tem mineral</span>` : "",
    r.lotacao === "conferida" && r.faltando?.length ? `<span class="badge faltam">Animais faltando</span>` : "",
    movReais(r).length ? `<span class="badge mov">Movimentação</span>` : "",
    r.medicacao ? `<span class="badge med">Medicamento</span>` : "",
  ].join("");
  const fs = faltasAtivas().filter((f) => f.recorrida_id === r.id);
  const tot = totalAnimais(r);
  return `
    <article class="reg">
      <div class="reg-data"><b>${d}/${m}</b><span>${a}</span></div>
      <div>
        <div class="reg-pot">${r.potreiro ? esc(r.potreiro) : `<span class="muted-s">Sem potreiro</span>`} ${badges}${fs.length ? `<span class="badge falta">Falta</span>` : ""}</div>
        ${r.lotacao ? `<div class="reg-linha"><i>Animais</i>${esc(txtAnimais(r))}${r.animais?.length > 1 ? ` <b>(${fmtNum(tot)})</b>` : ""}</div>` : ""}
        ${movReais(r).length ? `<div class="reg-linha"><i>Movimentos</i>${esc(txtMov(r))}</div>` : ""}
        ${(r.lotacao === "conferida" && r.faltando?.length) || txtVoltaram(r) ? `<div class="reg-linha"><i>Faltando</i>${[
          txtVoltaram(r) ? esc(txtVoltaram(r)[0].toUpperCase() + txtVoltaram(r).slice(1)) : "",
          r.lotacao === "conferida" && r.faltando?.length ? `<span class="txt-falta">${txtVoltaram(r) ? "ainda faltam " : ""}${esc(txtFaltando(r))}</span>` : "",
        ].filter(Boolean).join(" · ")}</div>` : ""}
        ${r.minerais?.length ? `<div class="reg-linha"><i>Mineral</i>${esc(txtMinerais(r))}</div>` : ""}
        ${r.medicacao ? `<div class="reg-linha"><i>Medicamentos</i>${esc(txtMed(r.medicacao))}</div>` : ""}
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

// Filtro por tipo nos Registros: botões com as mesmas cores das etiquetas do cartão.
// Pode marcar mais de um: mostra a recorrida que tiver qualquer um deles.
const TIPOS_REG = [
  { id: "lotacao", nome: "Lotação", cls: "", tem: (r) => r.lotacao === "conferida" },
  { id: "vazio", nome: "Vazio", cls: "vazio", tem: (r) => r.lotacao === "vazio" },
  { id: "mineral", nome: "Mineral", cls: "min", tem: (r) => !!r.minerais?.length },
  { id: "tem", nome: "Tem mineral", cls: "tem", tem: (r) => !!r.tem_mineral },
  { id: "falta", nome: "Falta de mineral", cls: "falta", tem: (r) => faltasAtivas().some((f) => f.recorrida_id === r.id) },
  { id: "faltam", nome: "Animais faltando", cls: "faltam", tem: (r) => r.lotacao === "conferida" && !!r.faltando?.length },
  { id: "mov", nome: "Movimentação", cls: "mov", tem: (r) => movReais(r).length > 0 },
  { id: "med", nome: "Medicamento", cls: "med", tem: (r) => !!r.medicacao },
];
const tipoFiltro = new Set();

function filtrados() {
  const q = $("#busca").value;
  const dias = $("#f-periodo").value;
  const desde = dias ? somaDias(hojeISO(), -Number(dias)) : "";
  const tipos = TIPOS_REG.filter((t) => tipoFiltro.has(t.id));
  return ativos().filter((r) => {
    if (desde && r.data < desde) return false;
    if (tipos.length && !tipos.some((t) => t.tem(r))) return false;
    if (norm(q)) {
      const texto = { nome: `${nomePot(r)} ${txtAnimais(r)} ${txtMinerais(r)} ${r.obs || ""}` };
      if (!combina(texto, q)) return false;
    }
    return true;
  }).sort(ordenar);
}

function renderListas() {
  const ult = ativos().sort(ordenar).slice(0, 5);
  $("#ultimos").innerHTML = ult.length ? ult.map(cartao).join("") : `<p class="vazio">Nenhuma recorrida registrada ainda.</p>`;

  $("#f-tipos").innerHTML = TIPOS_REG.map((t) =>
    `<button type="button" class="tipo ${t.cls}" data-tipo="${t.id}" aria-pressed="${tipoFiltro.has(t.id)}">${t.nome}</button>`).join("")
    + (tipoFiltro.size ? `<button type="button" class="limpar" data-tipo-limpar>Limpar filtro</button>` : "");

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
// Filtro por categoria na Lotação (pode marcar mais de uma: mostra quem tem qualquer uma delas)
const catFiltro = new Set();
const topoFiltro = new Set(); // cartões marcados: "esp:Bovinos", "sem" (vazios e sem informação), "faltando"

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
  const totEsp = {};
  ocupados.forEach((l) => Object.entries(porEspecie(l.lot)).forEach(([e, n]) => { totEsp[e] = (totEsp[e] || 0) + n; }));
  if (!totEsp.Bovinos) totEsp.Bovinos = 0;
  const especies = Object.keys(totEsp).filter((e) => e === "Bovinos" || totEsp[e] > 0).sort(ordemEspecie);
  // Cartões de cima (espécies e situação): um ou mais, "OU" entre eles
  [...topoFiltro].forEach((k) => { if (k.startsWith("esp:") && !especies.includes(k.slice(4))) topoFiltro.delete(k); });
  const kpi = (v, r, filtro) => `<button type="button" class="kpi" data-kpi="${esc(filtro)}" aria-pressed="${topoFiltro.has(filtro)}"><b>${v}</b><span>${r}</span></button>`;
  const cartoes = [
    ...especies.map((e) => kpi(fmtNum(totEsp[e]), e, "esp:" + e)),
    // Vazios e sem informação juntos (na prática, os dois estão sem animais)
    kpi(linhas.length - ocupados.length, "Sem animais", "sem"),
  ];
  // "Com falta": potreiros com animais faltando (o cartão só aparece quando há algum)
  const comFalta = linhas.filter((l) => l.grupo === "ocupados" && l.lot.faltando?.length).length;
  if (!comFalta) topoFiltro.delete("faltando");
  else cartoes.push(kpi(comFalta, "Com falta", "faltando").replace('class="kpi"', 'class="kpi kpi-falta"'));
  $("#lot-kpis").innerHTML = cartoes.join("");
  const espSel = [...topoFiltro].filter((k) => k.startsWith("esp:")).map((k) => k.slice(4));
  const passaTopo = (l) => !topoFiltro.size || [...topoFiltro].some((k) => (k.startsWith("esp:")
    ? l.grupo === "ocupados" && (porEspecie(l.lot)[k.slice(4)] || 0) > 0
    : k === "faltando" ? l.grupo === "ocupados" && !!l.lot.faltando?.length
    : l.grupo !== "ocupados"));

  // Botões de categoria: só as dos potreiros que passaram em cima. Com espécie marcada (e sem "Com falta"),
  // só as categorias das espécies marcadas.
  const todasCats = !topoFiltro.size || topoFiltro.has("faltando");
  const porCat = {};
  linhas.filter((l) => l.grupo === "ocupados" && passaTopo(l)).forEach((l) => l.lot.animais.forEach((a) => {
    if (!todasCats && !espSel.includes(especieDe(a.categoria))) return;
    porCat[a.categoria] = (porCat[a.categoria] || 0) + Number(a.qtd);
  }));
  [...catFiltro].forEach((c) => { if (!porCat[c]) catFiltro.delete(c); });
  $("#lot-cats").innerHTML = Object.entries(porCat).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${catFiltro.has(c)}">${esc(c)}: <b>${fmtNum(n)}</b></button>`).join("")
    + (catFiltro.size || topoFiltro.size ? `<button type="button" class="limpar" data-cat-limpar>Limpar filtro</button>` : "");

  // Categorias: um ou mais, "OU" entre elas; "E" com os cartões de cima
  const q = $("#lot-q").value;
  const passaCat = (l) => !catFiltro.size || (l.grupo === "ocupados" && l.lot.animais.some((a) => catFiltro.has(a.categoria)));
  const vis = linhas.filter((l) => passaTopo(l) && passaCat(l) && combina(l.p, q)).sort((a, b) => porNome(a.p, b.p));
  // Tabela compacta: Potreiro | Animais | Última atualização (tocar na linha abre o registro)
  const linha = (l) => {
    const animais = l.grupo === "ocupados"
      ? animaisLinha(l.lot)
      : l.grupo === "vazios" ? `<span class="t-vazio">Vazio</span>` : `<span class="t-sem">Sem informação</span>`;
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
    ? tabela("Com animais", vis.filter((l) => l.grupo === "ocupados")) + tabela("Sem animais", vis.filter((l) => l.grupo !== "ocupados"))
    : `<p class="vazio card">Nenhum potreiro encontrado.</p>`;
}

// Animais da linha da Lotação: uma coluna por espécie (bovinos à esquerda, sempre), com o total
// e as categorias daquela espécie embaixo
function animaisLinha(lot) {
  const t = porEspecie(lot);
  const esps = ["Bovinos", ...Object.keys(t).filter((e) => e !== "Bovinos" && t[e] > 0).sort(ordemEspecie)];
  const cat = (a) => `<small class="${catFiltro.has(a.categoria) ? "cat-sel" : ""}">${fmtQ(a.qtd)} ${esc(a.categoria)}</small>`;
  return `<div class="t-tot">${esps.map((e) => `<div class="t-esp${!t[e] && esps.length > 1 ? " t-zero" : ""}"><b>${fmtNum(t[e] || 0)} ${ABREV_ESPECIE[e] || esc(e.toLowerCase())}</b>`
    + lot.animais.filter((a) => especieDe(a.categoria) === e).map(cat).join("") + "</div>").join("")}</div>`
    + (lot.faltando?.length ? `<small class="t-falta">Faltando: ${esc(txtFaltando(lot))}</small>` : "");
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
    soma += totalBovinos(atual);
    dias++;
  }
  return { soma, dias };
}

function renderFaltandoPainel() {
  const linhas = [];
  estadoPotreiros().forEach((e) => (e.lotacao?.lotacao === "conferida" ? e.lotacao.faltando || [] : [])
    .forEach((f) => { if (f.qtd > 0) linhas.push({ pot: e.lotacao.potreiro, ...f, dias: diasEntre(f.desde, hojeISO()) }); }));
  linhas.sort((a, b) => b.dias - a.dias || a.pot.localeCompare(b.pot, "pt-BR"));
  $("#p-faltando").innerHTML = linhas.length ? `<table><thead><tr><th>Potreiro</th><th>Animais</th><th>Desde</th><th class="num">Dias</th></tr></thead><tbody>`
    + linhas.map((l) => `<tr><td>${esc(l.pot)}</td><td>${fmtNum(l.qtd)} ${esc(l.categoria)}</td><td>${fmtData(l.desde)}</td><td class="num">${l.dias}</td></tr>`).join("")
    + `</tbody></table>` : `<p class="vazio">Nenhum animal faltando.</p>`;
}

function renderPainel() {
  renderFaltasPainel();
  renderFaltandoPainel();
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

  // Animais de hoje somados por espécie (coluna Espécie da aba Categorias)
  const porCat = {}, porEsp = {};
  estado.forEach((e) => {
    if (e.lotacao?.lotacao !== "conferida") return;
    const potsEsp = new Set();
    e.lotacao.animais.forEach((a) => {
      const q = Number(a.qtd) || 0;
      const esp = especieDe(a.categoria);
      porCat[a.categoria] = (porCat[a.categoria] || 0) + q;
      (porEsp[esp] ||= { qtd: 0, pots: 0 }).qtd += q;
      potsEsp.add(esp);
    });
    potsEsp.forEach((esp) => porEsp[esp].pots++);
  });
  const ordemEsp = ["Bovinos", "Ovinos"];
  const esps = Object.keys(porEsp).sort((a, b) => ((ordemEsp.indexOf(a) + 1) || 99) - ((ordemEsp.indexOf(b) + 1) || 99) || a.localeCompare(b));
  if (!esps.length) esps.push("Bovinos", "Ovinos");

  const kpi = (v, r, extra = "") => `<div class="kpi"><b>${v}</b><span>${r}</span>${extra ? `<small>${extra}</small>` : ""}</div>`;
  $("#kpis").innerHTML = [
    ...esps.map((esp) => {
      const e = porEsp[esp] || { qtd: 0, pots: 0 };
      return kpi(fmtNum(e.qtd), `${esp} hoje`, `em ${e.pots} potreiro${e.pots === 1 ? "" : "s"}`);
    }),
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
    // Só bovinos: os ovinos não alcançam os cochos
    if (e.lotacao?.lotacao !== "conferida" || !totalBovinos(e.lotacao)) return;
    semMin.push({ nome: e.lotacao.potreiro, total: totalBovinos(e.lotacao), ult: e.mineral?.data || "", dias: e.mineral ? diasEntre(e.mineral.data, hoje) : Infinity });
  });
  semMin.sort((a, b) => b.dias - a.dias);
  $("#t-dias").innerHTML = semMin.length ? `
    <table>
      <thead><tr><th>Potreiro</th><th class="n">Bovinos</th><th class="n">Último mineral</th><th class="n">Dias</th></tr></thead>
      <tbody>${semMin.map((l) => `<tr><td>${esc(l.nome)}</td><td class="n">${fmtNum(l.total)}</td>
        <td class="n">${l.ult ? fmtData(l.ult) : "nunca"}</td>
        <td class="n ${l.dias > DIAS_SEM_MINERAL ? "alerta" : ""}">${isFinite(l.dias) ? l.dias : "–"}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="vazio">Nenhum potreiro com bovinos registrados.</p>`;
}

// =====================================================================
// Navegação e inicialização
// =====================================================================
const TITULOS = { registro: "Recorrida", lotacao: "Lotação dos potreiros", consulta: "Registros", painel: "Painel" };

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
  $("#form-item").addEventListener("submit", salvarNovoItem);
  $("#ni-nome").addEventListener("input", () => { $("#ni-nome").classList.remove("erro"); conferirNovoItem(); });
  // Cancelar, × ou Esc (se a janela já foi reaberta para outro item, não mexe nela)
  $("#dlg-item").addEventListener("close", () => { if (!$("#dlg-item").open) fecharNovoItem(""); });
  // "+ Nova…" nos selects mostra o campo para digitar
  $$("#dlg-item select").forEach((s) => s.addEventListener("change", () => {
    const novo = $("#" + s.dataset.novoCampo);
    s.classList.remove("erro");
    novo.hidden = s.value !== NOVA_OPCAO;
    if (!novo.hidden) novo.focus();
  }));
  $$("#dlg-item input").forEach((i) => i.addEventListener("input", () => i.classList.remove("erro")));
  $("#np-nome").addEventListener("input", () => { $("#np-nome").classList.remove("erro"); conferirNovoPotreiro(); });

  // Blocos de animais e mineral
  $("#chave-animais").addEventListener("click", () => {
    const ligar = !blocoLigado("animais");
    if (!ligar && vazio) marcarVazio(false);
    ligarBloco("animais", ligar);
  });
  $("#chave-mineral").addEventListener("click", () => ligarBloco("mineral", !blocoLigado("mineral")));
  $("#btn-tem").addEventListener("click", () => marcarTemMineral(!temMineral));
  $("#chave-med").addEventListener("click", () => ligarBloco("med", !blocoLigado("med")));
  $$("[data-med-modo]").forEach((b) => b.addEventListener("click", () => mudarModoMed(b.dataset.medModo)));
  $("#add-med-lote").addEventListener("click", () => { const l = novoItemLote(); $("#linhas-med-lote").appendChild(l); if (medOpcao === "B") l.querySelector(".dose").focus(); });
  $("#linhas-med-lote").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-cat-med], [data-cat-todas]");
    if (chip) { clicarChip(chip); return; }
    const rg = e.target.closest("[data-remover-grupo]");
    if (rg) { rg.closest(".med-grupo").remove(); return; }
    const add = e.target.closest("[data-add-med]");
    if (add) { const l = linhaMed(); add.closest(".med-grupo").querySelector(".linhas-med").appendChild(l); l.querySelector(".dose").focus(); }
  });
  // Animais do bloco 2 mudaram: atualiza as categorias do bloco 5
  $("#linhas-animais").addEventListener("focusout", () => { if (blocoLigado("med")) setTimeout(atualizarCatsMed, 0); });
  $("#linhas-animais").addEventListener("click", () => { if (blocoLigado("med")) setTimeout(atualizarCatsMed, 0); });
  $("#add-med-animal").addEventListener("click", () => { const c = cartaoAnimalMed(); $("#lista-med-animais").appendChild(c); c.querySelector(".brinco").focus(); });
  $("#lista-med-animais").addEventListener("click", (e) => {
    // Troca o teclado do brinco entre números e letras (reabre o teclado já trocado)
    const tec = e.target.closest("[data-teclado]");
    if (tec) {
      e.preventDefault();
      tecladoBrinco = tecladoBrinco === "numeric" ? "text" : "numeric";
      $$("#lista-med-animais .brinco").forEach((i) => i.setAttribute("inputmode", tecladoBrinco));
      $$("#lista-med-animais [data-teclado]").forEach((b) => { b.textContent = tecladoBrinco === "numeric" ? "ABC" : "123"; });
      const inp = tec.parentElement.querySelector(".brinco");
      inp.blur();
      setTimeout(() => inp.focus(), 60);
      return;
    }
    const rem = e.target.closest("[data-remover-animal]");
    if (rem) { rem.closest(".med-animal").remove(); return; }
    const add = e.target.closest("[data-add-med]");
    if (add) { const l = linhaMed(); add.closest(".med-animal").querySelector(".linhas-med").appendChild(l); l.querySelector(".dose").focus(); }
  });
  ligarEventosDif();
  $("#add-animal").addEventListener("click", () => { const l = linhaAnimal(); $("#linhas-animais").appendChild(l); l.querySelector(".qtd").focus(); });
  $("#add-mineral").addEventListener("click", () => { const l = linhaMineral(); $("#linhas-mineral").appendChild(l); l.querySelector(".combo-in").focus(); });
  // "Vazio" ao lado da chave: liga o bloco de animais já marcado como vazio
  $("#btn-vazio").addEventListener("click", () => {
    if (vazio) { marcarVazio(false); return; }
    marcarVazio(true);
    ligarBloco("animais", true);
  });
  $("#chave-falta").addEventListener("click", () => ligarBloco("falta", !blocoLigado("falta")));
  $("#faltas-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-falta]"); if (b) alternarFalta(b); });
  $("#p-faltas").addEventListener("click", (e) => { const b = e.target.closest("[data-reposto]"); if (b) marcarReposto(b.dataset.reposto); });
  form().addEventListener("click", (e) => {
    const rem = e.target.closest("[data-remover]");
    if (rem) { (rem.closest(".med-item") || rem.closest(".linha")).remove(); return; }
    const p = e.target.closest("[data-passo]");
    if (p) passo(p);
  });

  // Caixas de seleção com filtro
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.(".combo-in")) { fecharCombos(e.target.parentElement); abrirCombo(e.target, false); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches?.(".combo-in")) { e.target.classList.remove("erro"); abrirCombo(e.target, true); }
    if (e.target.matches?.(".linha .qtd, .brinco")) e.target.classList.remove("erro");
  });
  document.addEventListener("focusout", (e) => {
    if (!e.target.matches?.(".combo-in")) return;
    const inp = e.target;
    setTimeout(() => {
      if (document.activeElement === inp) return;
      acertarCombo(inp);
      fecharCombos();
      if (inp.closest("#falta-combo")) adicionarFaltaDoCombo(inp);
    if (inp.closest("#linhas-animais")) agendarDif();
    }, 150);
  });
  // Tocar numa opção não tira o foco do campo antes da escolha
  document.addEventListener("pointerdown", (e) => { if (e.target.closest(".combo-lista")) e.preventDefault(); });
  document.addEventListener("click", async (e) => {
    const op = e.target.closest("[data-opcao],[data-novo-item]");
    if (!op) return;
    const inp = op.closest(".combo").querySelector(".combo-in");
    const tipo = op.closest(".combo").dataset.tipo;
    fecharCombos();
    const valor = op.dataset.opcao || await adicionarItem(tipo, op.dataset.novoItem);
    if (!valor) { inp.focus(); return; } // cancelou a janela de cadastro
    inp.value = valor;
    inp.classList.remove("erro");
    inp.blur();
    if (inp.closest("#falta-combo")) adicionarFaltaDoCombo(inp);
    if (inp.closest("#linhas-animais")) agendarDif();
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
  ["#busca", "#f-periodo"].forEach((s) => $(s).addEventListener("input", () => { limiteLista = 60; renderListas(); }));
  $("#f-tipos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tipo], [data-tipo-limpar]");
    if (!b) return;
    if (b.dataset.tipoLimpar !== undefined) tipoFiltro.clear();
    else if (tipoFiltro.has(b.dataset.tipo)) tipoFiltro.delete(b.dataset.tipo);
    else tipoFiltro.add(b.dataset.tipo);
    limiteLista = 60;
    renderListas();
  });
  $("#lot-q").addEventListener("input", renderLotacao);
  $("#lot-cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat], [data-cat-limpar]");
    if (!b) return;
    if (b.dataset.catLimpar !== undefined) { catFiltro.clear(); topoFiltro.clear(); }
    else if (catFiltro.has(b.dataset.cat)) catFiltro.delete(b.dataset.cat);
    else catFiltro.add(b.dataset.cat);
    renderLotacao();
  });
  // Cartões: cada um liga/desliga (pode marcar vários)
  $("#lot-kpis").addEventListener("click", (e) => {
    const k = e.target.closest("[data-kpi]")?.dataset.kpi;
    if (!k) return;
    if (topoFiltro.has(k)) topoFiltro.delete(k); else topoFiltro.add(k);
    renderLotacao();
  });
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
