/**
 * Santa Rita Recorrida — servidor da planilha (Google Apps Script)
 *
 * Cole este arquivo em Extensões > Apps Script da planilha "Santa Rita Recorrida",
 * rode a função "configurar" uma vez e publique como App da Web (veja o LEIA-ME.md).
 */

const CLIENT_ID = "997988874349-65tdu4nmrtj1p4sgg291ftg4b1dfna7i.apps.googleusercontent.com";

const ABA_REGISTROS = "Recorridas";
const ABA_POTREIROS = "Potreiros";
const ABA_MINERAIS = "Minerais";
const ABA_CATEGORIAS = "Categorias";
const ABA_USUARIOS = "Usuarios";
const ABA_APARELHOS = "Aparelhos";
const ABA_FALTAS = "Faltas";

// Aba Faltas: uma linha por mineral em falta no depósito de um potreiro
const COLUNAS_FALTAS = ["id", "data", "potreiro", "mineral", "registrado_por", "criado_em", "reposto_em", "reposto_por", "atualizado_em", "excluido", "recorrida_id"];
const CABECALHO_FALTAS = ["ID", "Data", "Potreiro", "Mineral", "Registrado por", "Registrado em", "Reposto em", "Reposto por", "Atualizado em (não editar)", "Excluído", "ID da recorrida"];

const CABECALHO_APARELHOS = ["Código", "E-mail", "Nome", "Aparelho", "Liberado em", "Último uso", "Ativo (SIM/NÃO)", "Resumo da chave (não editar)"];

// Aba Recorridas: colunas fixas + uma coluna por categoria ("Animais: Vacas")
// e uma por mineral ("Sacos: Proteico 30 M"), criadas conforme aparecem.
const COLUNAS = [
  "id", "data", "potreiro", "lotacao", "total_animais", "animais_txt", "total_sacos", "total_kg", "minerais_txt", "obs",
  "registrado_por", "alterado_por", "criado_em", "atualizado_em", "sincronizado_em", "excluido",
];
const CABECALHO = [
  "ID", "Data", "Potreiro", "Lotação", "Total animais", "Animais", "Sacos (total)", "Kg mineral (total)", "Mineral", "Observações",
  "Registrado por", "Alterado por", "Criado em", "Atualizado em", "Sincronizado em", "Excluído",
];
const PREFIXO_ANIMAIS = "Animais: ";
const PREFIXO_SACOS = "Sacos: ";
const LOTACAO_TXT = { conferida: "Conferida", vazio: "Vazio", "": "Não conferida" };

const CABECALHO_POTREIROS = [
  "Potreiro", "Nomes alternativos", "Ativo (SIM/NÃO)",
  "Cocho 1 (lat, lon)", "Cocho 1 precisão (m)", "Cocho 1 marcado por", "Cocho 1 marcado em",
  "Cocho 2 (lat, lon)", "Cocho 2 precisão (m)", "Cocho 2 marcado por", "Cocho 2 marcado em",
  "Contorno (KML: lon,lat lon,lat …)",
];
const CABECALHO_MINERAIS = ["Mineral", "Nomes alternativos", "Kg por saco", "Ativo (SIM/NÃO)"];
// Aba Categorias: a coluna "Espécie" (Bov, Ovino...) separa os totais do Painel
const CABECALHO_CATEGORIAS = ["Espécie", "Categoria", "Nomes alternativos", "Ativo (SIM/NÃO)"];

// Listas iniciais (vindas da aba "Lista" da planilha antiga "Controle sal mineral")
const POTREIROS_INICIAIS = [
  ["Açudezinho", ""], ["Alto Grande", ""], ["Andreu arroio", ""], ["Aruana Banheiro", ""], ["Aruana Sinuelo", ""],
  ["Banhado", ""], ["Banhado Sudão", ""], ["Banhado trevinho", ""], ["Banheiro", ""], ["Brachiaria Banheiro", ""],
  ["Brachiaria Capororoca", ""], ["Brachiaria Sinuelo", ""], ["Campo Novo", ""], ["Capororoca", ""], ["Chico", ""],
  ["Chico arroio (sarandy)", "chico arroio; sarandi"], ["Chico miroca (silencio)", "chico miroca; silêncio"],
  ["Chico sinuelo (sementeira)", "chico sementeira; chico sinuelo"], ["Elbio", ""], ["Felomena", "filomena"],
  ["Felomena Banhado", "filomena banhado"], ["Felomena Meio", "filomena meio"], ["Festuca", ""], ["Fundo", ""],
  ["Frente", ""], ["Gelia Banhado", ""], ["Gelia Frente", ""], ["Gelia Fundo", ""], ["Gelia Umbu", ""], ["Gomos", ""],
  ["JC", ""], ["Lucia Helena", ""], ["Miroca", ""], ["Miroca cerro", ""], ["Miroca açude", ""], ["Miroca fundo", ""],
  ["Nina", ""], ["Nina frente", ""], ["Pastagem Banhado", ""], ["Pastagem Felomena", "pastagem filomena"],
  ["Pastagem Sinuelo", ""], ["Potreirinho", "potrerinho"], ["Ratão Alto", ""], ["Ratão Frente", ""], ["Ratão Fundo", ""],
  ["Ratinho", ""], ["Rodizio Sinuelo", ""], ["Rodizio", ""], ["Rodizio Potreirinho", "rodízios potreirinho"],
  ["Rodizio frente", ""], ["Sementeira", "sementera"], ["Sinuelo", ""], ["Umbu", ""], ["Zuri", ""],
];
const MINERAIS_INICIAIS = [
  ["Advance", "avanço", ""], ["Aveia Azevém", "AA", 30], ["Bovigold Pasto", "", 30], ["Energético 25 M", "PE25", 30],
  ["Engorda", "", 30], ["Fosbovinho ADE", "fós bovinho; fosbovin", 25], ["Pampero", "pampeiro", 30],
  ["Proteico 30 M", "proteico; P30", 30], ["Reprodução", "", 30], ["Seca", "", 30], ["Pasto Crina", "pasto e crina", 25],
  ["Ração", "rasão", ""],
];
const CATEGORIAS_INICIAIS = [
  ["Bov", "Vacas", "vaca; vc"], ["Bov", "Vacas com cria", "vaca com cria; vacas c cria; vc com cria"], ["Bov", "Novilhas", "vaq; vaquilhona; vq"],
  ["Bov", "Novilhos", "boi; bois"], ["Bov", "Terneiros", "ternero; terneira"], ["Bov", "Touros", "boluti; toro; touro"],
  ["Ovino", "Ovelhas", ""], ["Ovino", "Cordeiros", ""], ["Ovino", "Borregas", ""], ["Ovino", "Carneiros", ""],
];

// ---------------------------------------------------------------------
// Rode UMA vez pelo editor (botão Executar) para criar as abas
// ---------------------------------------------------------------------
function configurar() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetLocale("pt_BR");
  ss.setSpreadsheetTimeZone("America/Sao_Paulo");
  const cabecalho = (sh, cab) => sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight("bold");

  const reg = ss.getSheetByName(ABA_REGISTROS) || ss.insertSheet(ABA_REGISTROS);
  if (reg.getLastRow() === 0) {
    cabecalho(reg, CABECALHO).setBackground("#5a3018").setFontColor("#ffffff");
    reg.setFrozenRows(1);
    reg.getRange(2, 1, reg.getMaxRows() - 1, 1).setNumberFormat("@");
    reg.getRange(2, 2, reg.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy");
    reg.hideColumns(1);
  }

  const pot = ss.getSheetByName(ABA_POTREIROS) || ss.insertSheet(ABA_POTREIROS);
  if (pot.getLastRow() === 0) {
    cabecalho(pot, CABECALHO_POTREIROS);
    pot.getRange(2, 1, POTREIROS_INICIAIS.length, 3).setValues(POTREIROS_INICIAIS.map((p) => [p[0], p[1], "SIM"]));
    pot.getRange("D:D").setNumberFormat("@");
    pot.getRange("H:H").setNumberFormat("@");
    pot.setFrozenRows(1);
  }

  const min = ss.getSheetByName(ABA_MINERAIS) || ss.insertSheet(ABA_MINERAIS);
  if (min.getLastRow() === 0) {
    cabecalho(min, CABECALHO_MINERAIS);
    min.getRange(2, 1, MINERAIS_INICIAIS.length, 4).setValues(MINERAIS_INICIAIS.map((m) => [m[0], m[1], m[2], "SIM"]));
    min.setFrozenRows(1);
  }

  const cat = ss.getSheetByName(ABA_CATEGORIAS) || ss.insertSheet(ABA_CATEGORIAS);
  if (cat.getLastRow() === 0) {
    cabecalho(cat, CABECALHO_CATEGORIAS);
    cat.getRange(2, 1, CATEGORIAS_INICIAIS.length, 4).setValues(CATEGORIAS_INICIAIS.map((c) => [c[0], c[1], c[2], "SIM"]));
    cat.setFrozenRows(1);
  }

  const usu = ss.getSheetByName(ABA_USUARIOS) || ss.insertSheet(ABA_USUARIOS);
  if (usu.getLastRow() === 0) {
    usu.getRange(1, 1, 1, 3).setValues([["E-mail", "Nome", "Ativo (SIM/NÃO)"]]).setFontWeight("bold");
    usu.appendRow([Session.getEffectiveUser().getEmail(), "Administrador", "SIM"]);
    usu.setFrozenRows(1);
  }
  abaAparelhos_();
  abaFaltas_();

  const vazia = ss.getSheetByName("Página1") || ss.getSheetByName("Sheet1");
  if (vazia && vazia.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(vazia);
}

// ---------------------------------------------------------------------
// Entrada do App da Web
// ---------------------------------------------------------------------
function doPost(e) {
  let saida;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === "registrar") {
      const u = verificarUsuario_(req.token);
      saida = { ok: true, usuario: u, chave: registrarAparelho_(u, req.aparelho) };
    } else {
      const usuario = req.chave ? verificarAparelho_(req.chave) : verificarUsuario_(req.token);
      if (req.action === "ping") saida = { ok: true, usuario: usuario };
      else if (req.action === "sync") saida = sincronizar_(req.registros || [], req.alteracoes || [], usuario, req.faltas || []);
      else if (req.action === "sair") { desativarAparelho_(req.chave); saida = { ok: true }; }
      else throw erro_("Ação desconhecida.", "ACAO");
    }
  } catch (err) {
    saida = { ok: false, erro: String(err.message || err), codigo: err.codigo || "ERRO" };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput("Santa Rita Recorrida: servidor ativo.");
}

// ---------------------------------------------------------------------
// Login: confere o token do Google e a lista de usuários autorizados
// ---------------------------------------------------------------------
function verificarUsuario_(token) {
  if (!token) throw erro_("Faça login com sua conta Google.", "AUTH");

  const cache = CacheService.getScriptCache();
  const chave = "tk_" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  let email = cache.get(chave);

  if (!email) {
    const r = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token),
      { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw erro_("Sessão expirada. Entre novamente.", "AUTH");
    const info = JSON.parse(r.getContentText());
    if (info.aud !== CLIENT_ID) throw erro_("Login emitido para outro aplicativo.", "AUTH");
    if (String(info.email_verified) !== "true") throw erro_("E-mail Google não verificado.", "AUTH");
    email = String(info.email).toLowerCase();
    const restante = Math.max(60, Math.min(21600, Number(info.exp) - Math.floor(Date.now() / 1000) - 30));
    cache.put(chave, email, restante);
  }

  const aut = usuariosAutorizados_()[email];
  if (!aut) throw erro_("O e-mail " + email + " não está autorizado. Peça ao administrador para incluí-lo na aba Usuarios.", "NEGADO");
  return { email: email, nome: aut.nome || email };
}

// ---------------------------------------------------------------------
// Aparelhos liberados (chave permanente por celular)
// ---------------------------------------------------------------------
function abaAparelhos_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ABA_APARELHOS);
  if (!sh) {
    sh = ss.insertSheet(ABA_APARELHOS);
    sh.getRange(1, 1, 1, CABECALHO_APARELHOS.length).setValues([CABECALHO_APARELHOS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.hideColumns(CABECALHO_APARELHOS.length);
  }
  return sh;
}

// Começa com "k" para a planilha nunca confundir o texto com fórmula ou número
function resumo_(chave) {
  return "k" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(chave))).replace(/=+$/, "");
}

function registrarAparelho_(usuario, aparelho) {
  const chave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  const r = resumo_(chave);
  const agora = new Date();
  abaAparelhos_().appendRow([r.slice(1, 7).toUpperCase(), usuario.email, usuario.nome,
    String(aparelho || "").slice(0, 60), agora, agora, "SIM", r]);
  return chave;
}

function linhaAparelho_(sh, chave) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return null;
  const r = resumo_(chave);
  const col = sh.getRange(2, CABECALHO_APARELHOS.length, n, 1).getValues();
  for (let i = 0; i < n; i++) if (col[i][0] === r) return i + 2;
  return null;
}

function verificarAparelho_(chave) {
  const sh = abaAparelhos_();
  const linha = linhaAparelho_(sh, chave);
  if (!linha) throw erro_("Este aparelho não está liberado. Entre com o Google para liberá-lo.", "APARELHO");
  const l = sh.getRange(linha, 1, 1, CABECALHO_APARELHOS.length).getValues()[0];
  const ativo = String(l[6]).trim().toUpperCase();
  if (ativo === "NÃO" || ativo === "NAO") throw erro_("Este aparelho foi bloqueado. Entre com o Google para liberá-lo de novo.", "APARELHO");
  const email = String(l[1]).trim().toLowerCase();
  const aut = usuariosAutorizados_()[email];
  if (!aut) throw erro_("O e-mail " + email + " não está autorizado. Peça ao administrador para incluí-lo na aba Usuarios.", "NEGADO");
  sh.getRange(linha, 6).setValue(new Date());
  return { email: email, nome: aut.nome || email };
}

function desativarAparelho_(chave) {
  const sh = abaAparelhos_();
  const linha = linhaAparelho_(sh, chave);
  if (linha) sh.getRange(linha, 7).setValue("NÃO");
}

function usuariosAutorizados_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_USUARIOS);
  const mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach((l) => {
    const email = String(l[0]).trim().toLowerCase();
    if (email && !ehNao_(l[2])) mapa[email] = { nome: String(l[1]).trim() };
  });
  return mapa;
}

// ---------------------------------------------------------------------
// Sincronização: aplica as alterações de cadastro (potreiros novos, cochos,
// categorias e minerais novos), grava as recorridas e devolve tudo
// ---------------------------------------------------------------------
function sincronizar_(recebidos, alteracoes, usuario, faltasRecebidas) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    alteracoes.forEach((a) => aplicarAlteracao_(a, usuario));

    const sh = SpreadsheetApp.getActive().getSheetByName(ABA_REGISTROS);
    const kgSaco = {};
    lerMinerais_().forEach((m) => { kgSaco[m.nome] = m.kg; });
    const cab = garantirCabecalho_(sh, recebidos);
    const base = lerRegistros_(sh, cab);
    const agora = new Date().toISOString();
    const novos = [];

    recebidos.forEach((r) => {
      if (!r || !r.id) return;
      const pos = base.indice[r.id];
      if (pos !== undefined) {
        const atual = base.lista[pos];
        if (String(atual.atualizado_em) >= String(r.atualizado_em)) return; // a planilha já tem versão igual ou mais nova
        r.registrado_por = atual.registrado_por;
        r.criado_em = atual.criado_em;
        r.alterado_por = usuario.nome;
        r.sincronizado_em = agora;
        sh.getRange(pos + 2, 1, 1, cab.length).setValues([paraLinha_(r, cab, kgSaco)]);
        base.lista[pos] = r;
      } else {
        r.registrado_por = usuario.nome; // quem enviou, conferido pelo login (nome da aba Usuarios)
        r.alterado_por = "";
        r.sincronizado_em = agora;
        base.indice[r.id] = base.lista.length;
        base.lista.push(r);
        novos.push(paraLinha_(r, cab, kgSaco));
      }
    });

    if (novos.length) sh.getRange(sh.getLastRow() + 1, 1, novos.length, cab.length).setValues(novos);
    return {
      ok: true,
      usuario: usuario,
      registros: base.lista,
      faltas: sincronizarFaltas_(faltasRecebidas || [], usuario),
      catalogo: { potreiros: lerPotreiros_(), minerais: lerMinerais_(), categorias: lerCategorias_() },
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------
// Cadastros
// ---------------------------------------------------------------------
const norm_ = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ehNao_ = (v) => { const a = String(v).trim().toUpperCase(); return a === "NÃO" || a === "NAO"; };

function linhaPorNome_(sh, nome, coluna) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return null;
  const alvo = norm_(nome);
  const col = sh.getRange(2, coluna || 1, n, 1).getValues();
  for (let i = 0; i < n; i++) if (norm_(col[i][0]) === alvo) return i + 2;
  return null;
}

function aplicarAlteracao_(a, usuario) {
  if (!a || !a.tipo) return;
  const ss = SpreadsheetApp.getActive();
  const nome = String(a.nome || a.potreiro || "").trim().slice(0, 80);
  if (!nome) return;

  if (a.tipo === "potreiro" || a.tipo === "mineral" || a.tipo === "categoria") {
    const aba = { potreiro: ABA_POTREIROS, mineral: ABA_MINERAIS, categoria: ABA_CATEGORIAS }[a.tipo];
    const sh = ss.getSheetByName(aba);
    const cc = a.tipo === "categoria" ? colunasCategorias_(sh) : null;
    if (linhaPorNome_(sh, nome, cc ? cc.nome + 1 : 1)) return; // já existe
    let linha = a.tipo === "mineral" ? [nome, "", "", "SIM"] : [nome, "", "SIM"];
    if (cc) {
      // Monta a linha pelo cabeçalho; a espécie fica em branco para preencher na planilha
      linha = new Array(Math.max(sh.getLastColumn(), 3)).fill("");
      linha[cc.nome] = nome;
      if (cc.ativo >= 0) linha[cc.ativo] = "SIM";
    }
    sh.appendRow(linha);
    const obs = "Incluído pelo app por " + usuario.nome + " em " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    sh.getRange(sh.getLastRow(), cc ? cc.nome + 1 : 1).setNote(obs);
    return;
  }

  if (a.tipo === "cocho") {
    const sh = ss.getSheetByName(ABA_POTREIROS);
    let linha = linhaPorNome_(sh, nome);
    if (!linha) { sh.appendRow([nome, "", "SIM"]); linha = sh.getLastRow(); }
    const n = Number(a.n) === 2 ? 2 : 1;
    const col = n === 1 ? 4 : 8;
    const atual = sh.getRange(linha, col + 3).getValue();
    const em = new Date(a.em || Date.now());
    if (atual instanceof Date && atual > em) return; // já tem marcação mais nova
    const lat = Number(a.lat), lon = Number(a.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    sh.getRange(linha, col, 1, 4).setValues([[
      lat.toFixed(6) + ", " + lon.toFixed(6), Math.round(Number(a.precisao) || 0), usuario.nome, em,
    ]]);
  }
}

function lerPotreiros_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_POTREIROS);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const cocho = (pos, prec, por, em) => {
    const m = String(pos || "").match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    return {
      lat: Number(m[1]), lon: Number(m[2]), precisao: Number(prec) || "",
      por: String(por || ""), em: em instanceof Date ? Utilities.formatDate(em, tz, "yyyy-MM-dd'T'HH:mm:ss") : String(em || ""),
    };
  };
  return sh.getRange(2, 1, sh.getLastRow() - 1, CABECALHO_POTREIROS.length).getValues()
    .filter((l) => String(l[0]).trim() !== "")
    .map((l) => ({
      nome: String(l[0]).trim(),
      alternativos: String(l[1] || "").trim(),
      ativo: !ehNao_(l[2]),
      cochos: [cocho(l[3], l[4], l[5], l[6]), cocho(l[7], l[8], l[9], l[10])],
      contorno: String(l[11] || "").trim(),
    }));
}

function lerMinerais_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_MINERAIS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter((l) => String(l[0]).trim() !== "")
    .map((l) => ({ nome: String(l[0]).trim(), alternativos: String(l[1] || "").trim(), kg: Number(l[2]) || "", ativo: !ehNao_(l[3]) }));
}

// Posição (base 0) de cada coluna da aba Categorias, pelo cabeçalho.
// Sem a coluna "Espécie", vale o formato antigo: Categoria | Nomes alternativos | Ativo.
function colunasCategorias_(sh) {
  const cab = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(norm_);
  const achar = (ini) => cab.findIndex((c) => c.indexOf(ini) === 0);
  const especie = achar("especie");
  const nome = achar("categoria");
  if (nome < 0) return { especie: -1, nome: 0, alternativos: 1, ativo: 2 };
  return { especie, nome, alternativos: achar("nomes alternativos"), ativo: achar("ativo") };
}

function lerCategorias_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_CATEGORIAS);
  if (!sh || sh.getLastRow() < 2) return [];
  const c = colunasCategorias_(sh);
  const v = (l, i) => (i >= 0 ? String(l[i] == null ? "" : l[i]).trim() : "");
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 3)).getValues()
    .filter((l) => v(l, c.nome) !== "")
    .map((l) => ({ nome: v(l, c.nome), alternativos: v(l, c.alternativos), ativo: !ehNao_(v(l, c.ativo)), especie: v(l, c.especie) }));
}

// ---------------------------------------------------------------------
// Aba Recorridas
// ---------------------------------------------------------------------
// Garante as colunas fixas e cria as colunas de categoria/mineral que faltam
function garantirCabecalho_(sh, recebidos) {
  let cab = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  if (cab.slice(0, CABECALHO.length).join("|") !== CABECALHO.join("|")) {
    sh.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
    cab = CABECALHO.concat(cab.slice(CABECALHO.length));
  }
  const faltam = [];
  recebidos.forEach((r) => {
    (r.animais || []).forEach((a) => { const t = PREFIXO_ANIMAIS + a.categoria; if (cab.indexOf(t) < 0 && faltam.indexOf(t) < 0) faltam.push(t); });
    (r.minerais || []).forEach((m) => { const t = PREFIXO_SACOS + m.mineral; if (cab.indexOf(t) < 0 && faltam.indexOf(t) < 0) faltam.push(t); });
  });
  if (faltam.length) {
    const falta = cab.length + faltam.length - sh.getMaxColumns();
    if (falta > 0) sh.insertColumnsAfter(sh.getMaxColumns(), falta);
    sh.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight("bold");
    cab = cab.concat(faltam);
  }
  return cab;
}

function lerRegistros_(sh, cab) {
  const lista = [];
  const indice = {};
  const n = sh.getLastRow() - 1;
  if (n < 1) return { lista: lista, indice: indice };
  const tz = Session.getScriptTimeZone();
  const lotacao = { conferida: "conferida", vazio: "vazio" };
  sh.getRange(2, 1, n, cab.length).getValues().forEach((l) => {
    const r = { animais: [], minerais: [] };
    COLUNAS.forEach((c, i) => {
      let v = l[i];
      if (v instanceof Date) v = c === "data" ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v.toISOString();
      r[c] = v;
    });
    if (!r.id) return;
    r.excluido = r.excluido === true || String(r.excluido).toUpperCase() === "TRUE";
    r.lotacao = lotacao[norm_(r.lotacao)] || "";
    for (let i = CABECALHO.length; i < cab.length; i++) {
      const q = Number(l[i]);
      if (!q) continue;
      if (cab[i].indexOf(PREFIXO_ANIMAIS) === 0) r.animais.push({ categoria: cab[i].slice(PREFIXO_ANIMAIS.length), qtd: q });
      if (cab[i].indexOf(PREFIXO_SACOS) === 0) r.minerais.push({ mineral: cab[i].slice(PREFIXO_SACOS.length), sacos: q });
    }
    ["total_animais", "animais_txt", "total_sacos", "total_kg", "minerais_txt", "sincronizado_em"].forEach((c) => delete r[c]);
    indice[r.id] = lista.length;
    lista.push(r);
  });
  return { lista: lista, indice: indice };
}

function paraLinha_(r, cab, kgSaco) {
  const animais = r.lotacao === "conferida" ? (r.animais || []) : [];
  const minerais = r.minerais || [];
  const totalAnimais = animais.reduce((s, a) => s + Number(a.qtd || 0), 0);
  const totalSacos = minerais.reduce((s, m) => s + Number(m.sacos || 0), 0);
  const semKg = minerais.some((m) => !kgSaco[m.mineral]);
  const totalKg = minerais.reduce((s, m) => s + Number(m.sacos || 0) * (Number(kgSaco[m.mineral]) || 0), 0);
  const calc = {
    lotacao: LOTACAO_TXT[r.lotacao || ""],
    total_animais: r.lotacao === "" ? "" : totalAnimais,
    animais_txt: r.lotacao === "vazio" ? "Vazio" : animais.map((a) => a.qtd + " " + a.categoria).join("; "),
    total_sacos: minerais.length ? totalSacos : "",
    total_kg: minerais.length && !semKg ? totalKg : "",
    minerais_txt: minerais.map((m) => m.sacos + " sc " + m.mineral).join("; "),
  };
  const linha = cab.map((c, i) => {
    if (i < COLUNAS.length) {
      const k = COLUNAS[i];
      if (k in calc) return calc[k];
      const v = r[k];
      if (k === "data" && v) {
        const p = String(v).split("-");
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      }
      if (k === "excluido") return v === true;
      return v === undefined || v === null ? "" : v;
    }
    if (c.indexOf(PREFIXO_ANIMAIS) === 0) {
      const a = animais.find((x) => x.categoria === c.slice(PREFIXO_ANIMAIS.length));
      return a ? Number(a.qtd) : "";
    }
    if (c.indexOf(PREFIXO_SACOS) === 0) {
      const m = minerais.find((x) => x.mineral === c.slice(PREFIXO_SACOS.length));
      return m ? Number(m.sacos) : "";
    }
    return "";
  });
  return linha;
}

// ---------------------------------------------------------------------
// Aba Faltas (mineral em falta no depósito)
// ---------------------------------------------------------------------
function abaFaltas_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ABA_FALTAS);
  if (!sh) {
    sh = ss.insertSheet(ABA_FALTAS);
    sh.getRange(1, 1, 1, CABECALHO_FALTAS.length).setValues([CABECALHO_FALTAS]).setFontWeight("bold").setBackground("#b3362f").setFontColor("#ffffff");
    sh.setFrozenRows(1);
    const n = sh.getMaxRows() - 1;
    sh.getRange(2, 1, n, 1).setNumberFormat("@");
    sh.getRange(2, 2, n, 1).setNumberFormat("dd/mm/yyyy");
    sh.getRange(2, 6, n, 2).setNumberFormat("dd/mm/yyyy hh:mm");
    sh.getRange(2, 9, n, 1).setNumberFormat("@");
    sh.getRange(2, 11, n, 1).setNumberFormat("@");
    sh.hideColumns(9, 1);
    sh.hideColumns(11, 1);
    sh.hideColumns(1, 1);
  }
  return sh;
}

function lerFaltas_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, n, COLUNAS_FALTAS.length).getValues().map((l) => {
    const f = {};
    COLUNAS_FALTAS.forEach((c, i) => {
      let v = l[i];
      if (v instanceof Date) v = c === "data" ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v.toISOString();
      f[c] = v === null || v === undefined ? "" : v;
    });
    f.excluido = f.excluido === true || String(f.excluido).toUpperCase() === "TRUE";
    f.atualizado_em = String(f.atualizado_em);
    return f;
  }).filter((f) => f.id);
}

function linhaFalta_(f) {
  const data = (v) => {
    if (!v) return "";
    const d = String(v).length === 10 ? new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))) : new Date(v);
    return isNaN(d) ? "" : d;
  };
  return COLUNAS_FALTAS.map((c) => {
    const v = f[c];
    if (c === "data" || c === "criado_em" || c === "reposto_em") return data(v);
    if (c === "excluido") return v === true;
    return v === undefined || v === null ? "" : v;
  });
}

// Grava o que veio do celular (versão mais nova vence) e devolve todas as faltas
function sincronizarFaltas_(recebidas, usuario) {
  const sh = abaFaltas_();
  const lista = lerFaltas_(sh);
  const indice = {};
  lista.forEach((f, i) => { indice[f.id] = i; });
  const novas = [];
  recebidas.forEach((f) => {
    if (!f || !f.id) return;
    const pos = indice[f.id];
    if (pos !== undefined) {
      const atual = lista[pos];
      if (String(atual.atualizado_em) >= String(f.atualizado_em)) return;
      f.registrado_por = atual.registrado_por;
      f.criado_em = atual.criado_em;
      if (f.reposto_em && !atual.reposto_em) f.reposto_por = usuario.nome;
      sh.getRange(pos + 2, 1, 1, COLUNAS_FALTAS.length).setValues([linhaFalta_(f)]);
      lista[pos] = f;
    } else {
      f.registrado_por = usuario.nome;
      if (f.reposto_em) f.reposto_por = usuario.nome;
      indice[f.id] = lista.length;
      lista.push(f);
      novas.push(linhaFalta_(f));
    }
  });
  if (novas.length) sh.getRange(sh.getLastRow() + 1, 1, novas.length, COLUNAS_FALTAS.length).setValues(novas);
  return lista;
}

function erro_(msg, codigo) {
  const e = new Error(msg);
  e.codigo = codigo;
  return e;
}
