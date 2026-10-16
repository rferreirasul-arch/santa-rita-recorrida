/**
 * Santa Rita Recorrida — cópia diária da planilha para o Dropbox (só para consulta)
 *
 * Cole este arquivo como um segundo script (+ Arquivo > Script, nome "Dropbox") no mesmo
 * projeto Apps Script do Code.gs. Configuração: veja "Cópia diária no Dropbox" no LEIA-ME.md.
 *
 * Todo dia, perto das 5h, exporta a planilha em .xlsx (sem as abas Usuarios e Aparelhos)
 * com uma aba "Leia-me" que leva à planilha Google para editar, e substitui o arquivo no Dropbox.
 */

const DROPBOX_PASTA = "/Fazenda Santa Rita -2023/Apps Santa Rita";
const DROPBOX_ARQUIVO = "Recorrida - consulta.xlsx";
const HORA_EXPORTACAO = 5;
// E-mails dos usuários e chaves dos aparelhos não vão para o Dropbox
const ABAS_FORA_DA_COPIA = [ABA_USUARIOS, ABA_APARELHOS];

// ---------------------------------------------------------------------
// Rode pelo editor: 1º sem código (mostra o link), 2º com DROPBOX_CODIGO preenchido
// ---------------------------------------------------------------------
function dropboxConectar() {
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty("DROPBOX_APP_KEY");
  const segredo = props.getProperty("DROPBOX_APP_SECRET");
  if (!chave || !segredo) throw new Error("Preencha DROPBOX_APP_KEY e DROPBOX_APP_SECRET nas Propriedades do script.");

  const codigo = props.getProperty("DROPBOX_CODIGO");
  if (!codigo) {
    Logger.log("Abra este link, clique em Permitir e copie o código para a propriedade DROPBOX_CODIGO:\n" +
      "https://www.dropbox.com/oauth2/authorize?client_id=" + encodeURIComponent(chave) +
      "&response_type=code&token_access_type=offline");
    return;
  }

  const r = UrlFetchApp.fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "post",
    payload: { grant_type: "authorization_code", code: codigo.trim(), client_id: chave, client_secret: segredo },
    muteHttpExceptions: true,
  });
  props.deleteProperty("DROPBOX_CODIGO");   // o código só vale uma vez
  if (r.getResponseCode() !== 200) throw new Error("Dropbox recusou o código (gere outro): " + r.getContentText());
  props.setProperty("DROPBOX_REFRESH_TOKEN", JSON.parse(r.getContentText()).refresh_token);
  Logger.log("Dropbox conectado. Agora rode exportarParaDropbox e depois agendarExportacao.");
}

// Rode UMA vez: cria (ou recria) o agendamento diário
function agendarExportacao() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "exportarParaDropbox")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("exportarParaDropbox").timeBased()
    .everyDays(1).atHour(HORA_EXPORTACAO).nearMinute(0).inTimezone("America/Sao_Paulo").create();
  Logger.log("Exportação agendada para todo dia às " + HORA_EXPORTACAO + "h.");
}

// ---------------------------------------------------------------------
// Exportação (agendada; também pode ser rodada à mão)
// ---------------------------------------------------------------------
function exportarParaDropbox() {
  const ss = SpreadsheetApp.getActive();
  const copia = ss.copy("Recorrida - exportação temporária (pode apagar)");
  try {
    ABAS_FORA_DA_COPIA.forEach((nome) => {
      const sh = copia.getSheetByName(nome);
      if (sh) copia.deleteSheet(sh);
    });
    abaLeiaMe_(copia, ss.getUrl());
    SpreadsheetApp.flush();

    const xlsx = UrlFetchApp.fetch(
      "https://docs.google.com/spreadsheets/d/" + copia.getId() + "/export?format=xlsx",
      { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } }).getBlob();
    enviarDropbox_(xlsx, DROPBOX_PASTA + "/" + DROPBOX_ARQUIVO);
    Logger.log("Enviado para o Dropbox: " + DROPBOX_PASTA + "/" + DROPBOX_ARQUIVO);
  } finally {
    DriveApp.getFileById(copia.getId()).setTrashed(true);
  }
}

function abaLeiaMe_(copia, urlOriginal) {
  const sh = copia.insertSheet("Leia-me", 0);
  const agora = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy 'às' HH:mm");
  sh.getRange("A1:A9").setValues([
    ["Santa Rita Recorrida — cópia para consulta"],
    [""],
    ["Esta planilha é atualizada automaticamente todo dia às " + HORA_EXPORTACAO + "h a partir da planilha Google do app Recorrida."],
    ["Alterações feitas aqui NÃO são aproveitadas: o arquivo é substituído na próxima atualização."],
    [""],
    ["Para editar (nomes de potreiros, minerais, categorias, registros), use a planilha Google:"],
    [""],
    [""],
    ["Última atualização: " + agora],
  ]);
  sh.getRange("A1").setFontSize(14).setFontWeight("bold");
  sh.getRange("A4").setFontWeight("bold").setFontColor("#b00020");
  // Link como texto com hiperlink (fórmula HYPERLINK dá erro com a planilha em pt_BR)
  sh.getRange("A7").setRichTextValue(SpreadsheetApp.newRichTextValue()
    .setText("➜ Abrir a planilha Google para editar").setLinkUrl(urlOriginal).build())
    .setFontSize(12).setFontWeight("bold");
  sh.setColumnWidth(1, 760);
  copia.setActiveSheet(sh);
}

function enviarDropbox_(blob, caminho) {
  const r = UrlFetchApp.fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "post",
    contentType: "application/octet-stream",
    headers: {
      Authorization: "Bearer " + tokenDropbox_(),
      "Dropbox-API-Arg": jsonAscii_({ path: caminho, mode: "overwrite", mute: true }),
    },
    payload: blob.getBytes(),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error("Falha ao enviar ao Dropbox: " + r.getContentText());
}

function tokenDropbox_() {
  const props = PropertiesService.getScriptProperties();
  const refresh = props.getProperty("DROPBOX_REFRESH_TOKEN");
  if (!refresh) throw new Error("Dropbox não conectado: rode dropboxConectar (veja o LEIA-ME.md).");
  const r = UrlFetchApp.fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "post",
    payload: {
      grant_type: "refresh_token", refresh_token: refresh,
      client_id: props.getProperty("DROPBOX_APP_KEY"), client_secret: props.getProperty("DROPBOX_APP_SECRET"),
    },
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error("Dropbox recusou a conexão (rode dropboxConectar de novo): " + r.getContentText());
  return JSON.parse(r.getContentText()).access_token;
}

// O cabeçalho Dropbox-API-Arg só aceita ASCII: acentos viram \uXXXX
function jsonAscii_(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g,
    (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
}
