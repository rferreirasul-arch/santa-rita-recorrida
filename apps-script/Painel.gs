/**
 * Santa Rita Recorrida — aba "Painel" da planilha (resumo com tabelas e gráficos)
 *
 * Cole este arquivo como mais um script (+ Arquivo > Script, nome "Painel") no mesmo
 * projeto Apps Script do Code.gs. A aba é refeita por inteiro a cada atualização:
 * ao abrir a planilha, ao trocar o período (célula B4) e pelo menu Recorrida > Atualizar painel.
 * Não digite nada na aba Painel além do período: o resto é apagado na próxima atualização.
 */

const ABA_PAINEL = "Painel";
const PERIODOS_PAINEL = [15, 30, 45, 60, 90];
const CELULA_PERIODO = "B4";
const DIAS_SEM_MINERAL_PAINEL = 30; // dias sem abastecer acima disso ficam em vermelho
// Sanidade por potreiro: quais tipos da aba Medicamentos contam para cada coluna
// (um endectocida, como a ivermectina, conta como vermífugo e como carrapaticida)
const SANIDADE_PAINEL = [
  { titulo: "Carrapaticida", tipos: ["carrapaticida", "endectocida"] },
  { titulo: "Vermífugo", tipos: ["vermifugo", "endectocida"] },
];
const COR_PAINEL = "#3d6b3f";
const COR_TITULO_PAINEL = "#5b3a29";
const COL_GRAFICO_PAINEL = 8; // gráficos a partir da coluna H

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Recorrida").addItem("Atualizar painel", "atualizarPainel").addToUi();
  try { atualizarPainel(); } catch (e) { console.warn("Painel: " + e); }
}

function onEdit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() === ABA_PAINEL && e.range.getA1Notation() === CELULA_PERIODO) atualizarPainel();
}

// ---------------------------------------------------------------------
// Datas no formato "2026-10-30"
// ---------------------------------------------------------------------
const isoParaData_ = (iso) => { const p = String(iso).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
const diaUTC_ = (iso) => { const p = String(iso).split("-"); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
const diasEntre_ = (a, b) => Math.round((diaUTC_(b) - diaUTC_(a)) / 86400000);
const somaDias_ = (iso, n) => new Date(diaUTC_(iso) + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------
// Cálculos (os mesmos da aba Painel do app)
// ---------------------------------------------------------------------
function dadosPainel_(nDias) {
  const ss = SpreadsheetApp.getActive();
  const tz = Session.getScriptTimeZone();
  const hoje = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const ini = somaDias_(hoje, -nDias + 1);

  const shReg = ss.getSheetByName(ABA_REGISTROS);
  const cab = shReg.getRange(1, 1, 1, shReg.getLastColumn()).getValues()[0].map(String);
  const regs = lerRegistros_(shReg, cab).lista.filter((r) => !r.excluido && /^\d{4}-\d{2}-\d{2}$/.test(String(r.data)));
  // Mais recente primeiro
  regs.sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.criado_em).localeCompare(String(a.criado_em)));

  const especie = {};
  lerCategorias_().forEach((c) => {
    const n = norm_(c.especie);
    especie[norm_(c.nome)] = n.indexOf("bov") === 0 ? "Bovinos" : n.indexOf("ov") === 0 ? "Ovinos" : (c.especie || "Sem espécie");
  });
  const especieDe = (cat) => especie[norm_(cat)] || "Sem espécie";
  const bovinos = (r) => (r && r.lotacao === "conferida" ? r.animais.reduce((s, a) => s + (especieDe(a.categoria) === "Bovinos" ? Number(a.qtd) : 0), 0) : 0);
  const kgSaco = {};
  lerMinerais_().forEach((m) => { kgSaco[norm_(m.nome)] = Number(m.kg) || 0; });
  const kgDe = (min) => kgSaco[norm_(min)] || 0;
  const meds = {};
  lerMedicamentos_().forEach((m) => { meds[norm_(m.nome)] = m; });

  // Situação atual de cada potreiro: última lotação e último abastecimento
  const estado = {};
  regs.forEach((r) => {
    const k = norm_(r.potreiro);
    const e = estado[k] || (estado[k] = { nome: r.potreiro, lotacao: null, mineral: null });
    if (r.lotacao && !e.lotacao) e.lotacao = r;
    if (r.minerais.length && !e.mineral) e.mineral = r;
  });
  const estados = Object.keys(estado).map((k) => estado[k]);

  // Animais hoje por categoria e por espécie
  const porCat = {}, porEsp = {};
  estados.forEach((e) => {
    if (!e.lotacao || e.lotacao.lotacao !== "conferida") return;
    const esps = {};
    e.lotacao.animais.forEach((a) => {
      porCat[a.categoria] = (porCat[a.categoria] || 0) + Number(a.qtd);
      const esp = especieDe(a.categoria);
      (porEsp[esp] || (porEsp[esp] = { qtd: 0, pots: 0 })).qtd += Number(a.qtd);
      esps[esp] = true;
    });
    Object.keys(esps).forEach((esp) => porEsp[esp].pots++);
  });

  // Mineral no período
  const base = regs.filter((r) => r.data >= ini && r.data <= hoje);
  const comMin = base.filter((r) => r.minerais.length);
  let sacos = 0, kg = 0;
  const porMin = {}, porPot = {};
  comMin.forEach((r) => r.minerais.forEach((m) => {
    const s = Number(m.sacos), k = kgDe(m.mineral);
    sacos += s;
    kg += s * k;
    porMin[m.mineral] = (porMin[m.mineral] || 0) + s;
    const p = porPot[norm_(r.potreiro)] || (porPot[norm_(r.potreiro)] = { nome: r.potreiro, sacos: 0, kg: 0, semKg: false });
    p.sacos += s;
    p.kg += s * k;
    if (!k) p.semKg = true;
  }));

  // Bovinos × dias de um potreiro entre duas datas, com a lotação em vigor em cada dia
  const cabecasDia = (nome, de, ate) => {
    const lots = regs.filter((r) => r.lotacao && norm_(r.potreiro) === norm_(nome)).slice().reverse();
    let soma = 0, dias = 0, i = 0, atual = null;
    for (let d = de; d <= ate; d = somaDias_(d, 1)) {
      while (i < lots.length && lots[i].data <= d) atual = lots[i++];
      if (!atual) continue;
      soma += bovinos(atual);
      dias++;
    }
    return { soma: soma, dias: dias };
  };
  // Consumo: o mineral de cada abastecimento dura até o seguinte (precisa de 2 abastecimentos no período)
  const consumo = Object.keys(porPot).map((k) => {
    const p = porPot[k];
    const media = cabecasDia(p.nome, ini, hoje);
    const abast = comMin.filter((r) => norm_(r.potreiro) === k).slice().reverse();
    let gcd = "";
    if (abast.length >= 2 && !p.semKg) {
      const kgCons = abast.slice(0, -1).reduce((s, r) => s + r.minerais.reduce((t, m) => t + Number(m.sacos) * kgDe(m.mineral), 0), 0);
      const cd = cabecasDia(p.nome, abast[0].data, somaDias_(abast[abast.length - 1].data, -1));
      if (cd.soma) gcd = (kgCons * 1000) / cd.soma;
    }
    return [p.nome, p.sacos, p.semKg ? "" : p.kg, media.dias ? media.soma / media.dias : "", gcd];
  }).sort((a, b) => (Number(b[2]) || 0) - (Number(a[2]) || 0) || b[1] - a[1]);

  // Dias sem abastecer: potreiros com bovinos (os ovinos não alcançam os cochos)
  const semMin = estados.filter((e) => bovinos(e.lotacao) > 0).map((e) => [
    e.nome, bovinos(e.lotacao), e.mineral ? isoParaData_(e.mineral.data) : "nunca", e.mineral ? diasEntre_(e.mineral.data, hoje) : "",
  ]).sort((a, b) => (b[3] === "" ? 1e9 : b[3]) - (a[3] === "" ? 1e9 : a[3]));

  // Mineral em falta no depósito (faltas abertas)
  const faltas = lerFaltas_(abaFaltas_()).filter((f) => !f.excluido && !String(f.reposto_em).trim())
    .sort((a, b) => String(a.mineral).localeCompare(String(b.mineral)) || String(a.data).localeCompare(String(b.data)))
    .map((f) => [f.mineral, f.potreiro, isoParaData_(f.data), diasEntre_(f.data, hoje)]);

  // Medicamentos no período: cada item vira (qtd de animais, dose)
  const aplic = (r) => {
    const med = r.medicacao;
    if (!med) return [];
    if (med.modo === "animais") {
      const o = [];
      (med.animais || []).forEach((a) => (a.itens || []).forEach((m) => o.push({ m: m, qtd: 1, lote: false })));
      return o;
    }
    return (med.itens || []).map((m) => ({ m: m, qtd: Number(m.categorias && m.categorias.length ? m.qtd : med.qtd) || 0, lote: true, cats: m.categorias || [] }));
  };
  const porMed = {};
  base.forEach((r) => aplic(r).forEach((x) => {
    const k = norm_(x.m.medicamento);
    const info = meds[k] || {};
    const o = porMed[k] || (porMed[k] = { nome: info.nome || x.m.medicamento, tipo: info.tipo || "", unidade: info.unidade || "mL", vezes: 0, animais: 0, total: 0, semQtd: false });
    o.vezes++;
    o.animais += x.qtd;
    if (x.qtd) o.total += x.qtd * Number(x.m.dose); else o.semQtd = true;
  }));
  const medicamentos = Object.keys(porMed).map((k) => porMed[k])
    .sort((a, b) => b.animais - a.animais)
    .map((o) => [o.nome, o.tipo || "(sem tipo)", o.vezes, o.animais || "", o.total ? Math.round(o.total * 100) / 100 : "", o.unidade + (o.semQtd ? " (parcial)" : "")]);

  // Sanidade por potreiro: última aplicação no lote de cada tipo (qualquer data)
  const tiposDe = (nomeMed) => String((meds[norm_(nomeMed)] || {}).tipo || "").split(/[,;\/+]/).map(norm_).filter(String);
  const sanidade = estados.filter((e) => e.lotacao && e.lotacao.lotacao === "conferida" && e.lotacao.animais.length).map((e) => {
    const linha = [e.nome, txtEspeciesPainel_(e.lotacao, especieDe)];
    SANIDADE_PAINEL.forEach((s) => {
      let achou = null;
      regs.some((r) => norm_(r.potreiro) === norm_(e.nome) && aplic(r).some((x) => {
        if (!x.lote || !tiposDe(x.m.medicamento).some((t) => s.tipos.indexOf(t) >= 0)) return false;
        achou = { r: r, x: x };
        return true;
      }));
      if (achou) {
        const cats = achou.x.cats.length ? " (" + achou.x.cats.join(", ") + ")" : "";
        linha.push(isoParaData_(achou.r.data), achou.x.m.medicamento + cats, diasEntre_(achou.r.data, hoje));
      } else linha.push("", "nenhum registro", "");
    });
    return linha;
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "pt-BR"));

  const esps = Object.keys(porEsp).sort((a, b) => ((["Bovinos", "Ovinos"].indexOf(a) + 1) || 99) - ((["Bovinos", "Ovinos"].indexOf(b) + 1) || 99));
  return {
    hoje: hoje, ini: ini,
    kpis: esps.map((esp) => [esp + " hoje", porEsp[esp].qtd, "em " + porEsp[esp].pots + " potreiro" + (porEsp[esp].pots === 1 ? "" : "s")])
      .concat([["Recorridas", base.length, "no período"], ["Sacos de mineral", sacos, "no período"], ["Kg de mineral", kg, "no período"]]),
    categorias: Object.keys(porCat).map((c) => [c, porCat[c]]).sort((a, b) => b[1] - a[1]),
    minerais: Object.keys(porMin).map((m) => [m, porMin[m]]).sort((a, b) => b[1] - a[1]),
    consumo: consumo, semMin: semMin, faltas: faltas, medicamentos: medicamentos, sanidade: sanidade,
  };
}

function txtEspeciesPainel_(lot, especieDe) {
  const t = {};
  lot.animais.forEach((a) => { const e = especieDe(a.categoria); t[e] = (t[e] || 0) + Number(a.qtd); });
  const abrev = { Bovinos: "bov.", Ovinos: "ov." };
  return Object.keys(t).map((e) => t[e] + " " + (abrev[e] || e.toLowerCase())).join(" · ");
}

// ---------------------------------------------------------------------
// Monta a aba
// ---------------------------------------------------------------------
function atualizarPainel() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ABA_PAINEL);
  if (!sh) {
    sh = ss.insertSheet(ABA_PAINEL, 0);
    sh.setHiddenGridlines(true);
  }
  abaMedicamentos_(); // garante a coluna Tipo na aba Medicamentos
  let nDias = Number(sh.getRange(CELULA_PERIODO).getValue());
  if (PERIODOS_PAINEL.indexOf(nDias) < 0) nDias = PERIODOS_PAINEL[0];
  const d = dadosPainel_(nDias);

  sh.getCharts().forEach((c) => sh.removeChart(c));
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clear().clearDataValidations();
  sh.setColumnWidth(1, 190);
  sh.setColumnWidths(2, 7, 110);

  sh.getRange("A1").setValue("Painel da recorrida").setFontSize(18).setFontWeight("bold").setFontColor(COR_TITULO_PAINEL);
  sh.getRange("A2").setValue("Atualizado em " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm")
    + ". Atualiza ao abrir a planilha, ao trocar o período ou pelo menu Recorrida > Atualizar painel.").setFontColor("#777777").setFontStyle("italic");
  sh.getRange("A4").setValue("Período (dias)").setFontWeight("bold");
  sh.getRange(CELULA_PERIODO).setValue(nDias).setBackground("#fff4cc").setFontWeight("bold").setHorizontalAlignment("center")
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PERIODOS_PAINEL.map(String), true).setAllowInvalid(false).build());
  sh.getRange("C4").setValue("de " + Utilities.formatDate(isoParaData_(d.ini), Session.getScriptTimeZone(), "dd/MM/yyyy")
    + " a " + Utilities.formatDate(isoParaData_(d.hoje), Session.getScriptTimeZone(), "dd/MM/yyyy")).setFontColor("#777777");

  // Indicadores: uma linha de números grandes
  d.kpis.forEach((k, i) => {
    sh.getRange(6, 1 + i).setValue(k[1]).setNumberFormat(k[0] === "Sacos de mineral" ? "General" : "#,##0").setFontSize(20).setFontWeight("bold").setHorizontalAlignment("center");
    sh.getRange(7, 1 + i).setValue(k[0]).setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#555555");
    sh.getRange(8, 1 + i).setValue(k[2]).setHorizontalAlignment("center").setFontColor("#888888").setFontSize(9);
  });
  sh.getRange(6, 1, 3, d.kpis.length).setBackground("#f6f1ea").setBorder(true, true, true, true, true, false, "#e2d8c8", SpreadsheetApp.BorderStyle.SOLID);

  let linha = 10;
  const sec = (titulo, cab, linhas, opc) => { linha = secaoPainel_(sh, linha, titulo, cab, linhas, opc || {}); };

  sec("Animais hoje por categoria", ["Categoria", "Animais"], d.categorias,
    { formatos: ["@", "#,##0"], grafico: { colunas: [1, 2], titulo: "Animais por categoria" } });
  sec("Sacos de mineral por tipo (período)", ["Mineral", "Sacos"], d.minerais,
    { formatos: ["@", "General"], grafico: { colunas: [1, 2], titulo: "Sacos colocados no período" } });
  sec("Consumo de mineral por potreiro (período, só bovinos)", ["Potreiro", "Sacos", "Kg", "Cab. média", "g/cab/dia"], d.consumo,
    { formatos: ["@", "General", "#,##0", "#,##0", "#,##0"], grafico: { colunas: [1, 5], titulo: "Consumo (g/cab/dia)" },
      nota: "g/cab/dia precisa de pelo menos 2 abastecimentos no período e do kg por saco na aba Minerais." });
  sec("Dias sem abastecer o cocho (potreiros com bovinos)", ["Potreiro", "Bovinos", "Último mineral", "Dias"], d.semMin,
    { formatos: ["@", "#,##0", "dd/mm/yyyy", "0"], grafico: { colunas: [1, 4], titulo: "Dias desde o último abastecimento" }, alertaCol: 4, alertaAcima: DIAS_SEM_MINERAL_PAINEL });
  sec("Mineral em falta no depósito", ["Mineral", "Potreiro", "Desde", "Dias"], d.faltas,
    { formatos: ["@", "@", "dd/mm/yyyy", "0"], vazio: "Nenhum mineral em falta." });
  sec("Medicamentos no período", ["Medicamento", "Tipo", "Aplicações", "Animais", "Total aplicado", "Unidade"], d.medicamentos,
    { formatos: ["@", "@", "0", "#,##0", "General", "@"], grafico: { colunas: [1, 4], titulo: "Animais medicados no período" },
      nota: "Tipo vem da aba Medicamentos. Total = dose × animais; \"parcial\" quando faltou a quantidade de animais em alguma aplicação." });
  const cabSan = ["Potreiro", "Animais hoje"];
  SANIDADE_PAINEL.forEach((s) => cabSan.push(s.titulo + ": data", s.titulo + ": produto", "Dias após " + s.titulo.toLowerCase()));
  const fmtSan = ["@", "@"];
  SANIDADE_PAINEL.forEach(() => fmtSan.push("dd/mm/yyyy", "@", "0"));
  sec("Sanidade por potreiro (última aplicação no lote)", cabSan, d.sanidade,
    { formatos: fmtSan, larga: true, grafico: { colunas: [1].concat(SANIDADE_PAINEL.map((s, i) => 5 + i * 3)), titulo: "Dias após a última aplicação", legenda: true, abaixo: true },
      nota: "Conta só medicamentos aplicados no lote do potreiro. Se os animais trocaram de potreiro depois, a aplicação fica no potreiro onde foi feita. Endectocida conta como vermífugo e carrapaticida." });
}

// Escreve uma seção (título, tabela e gráfico à direita) e devolve a próxima linha livre
function secaoPainel_(sh, linha, titulo, cab, linhas, opc) {
  const nCol = cab.length;
  sh.getRange(linha, 1).setValue(titulo).setFontSize(13).setFontWeight("bold").setFontColor(COR_TITULO_PAINEL);
  let l = linha + 1;
  if (opc.nota) { sh.getRange(l, 1).setValue(opc.nota).setFontColor("#888888").setFontSize(9).setFontStyle("italic"); l++; }
  const ini = l;
  sh.getRange(l, 1, 1, nCol).setValues([cab]).setFontWeight("bold").setBackground(COR_PAINEL).setFontColor("#ffffff").setWrap(true);
  l++;
  if (!linhas.length) {
    sh.getRange(l, 1).setValue(opc.vazio || "Sem registros.").setFontColor("#888888");
    return l + 2;
  }
  sh.getRange(l, 1, linhas.length, nCol).setValues(linhas);
  (opc.formatos || []).forEach((f, i) => sh.getRange(l, i + 1, linhas.length, 1).setNumberFormat(f));
  sh.getRange(l, 1, linhas.length, nCol).setBorder(null, null, true, null, null, true, "#e2d8c8", SpreadsheetApp.BorderStyle.SOLID);
  for (let i = 1; i < linhas.length; i += 2) sh.getRange(l + i, 1, 1, nCol).setBackground("#faf7f2");
  if (opc.alertaCol) {
    const faixa = sh.getRange(l, opc.alertaCol, linhas.length, 1);
    const regras = sh.getConditionalFormatRules();
    regras.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(opc.alertaAcima)
      .setFontColor("#b3261e").setBold(true).setRanges([faixa]).build());
    sh.setConditionalFormatRules(regras);
  }
  let fim = l + linhas.length;
  if (opc.grafico) {
    const g = opc.grafico;
    const altura = Math.max(240, Math.min(1400, 24 * linhas.length + 90));
    const b = sh.newChart().setChartType(Charts.ChartType.BAR).setNumHeaders(1)
      .setOption("title", g.titulo).setOption("height", altura).setOption("width", g.abaixo ? 760 : 560)
      .setOption("legend", { position: g.legenda ? "top" : "none" })
      .setOption("colors", g.legenda ? ["#b5651d", COR_PAINEL] : [COR_PAINEL])
      .setOption("hAxis", { minValue: 0 }).setOption("chartArea", { left: 170, width: "65%" });
    g.colunas.forEach((c) => { b.addRange(sh.getRange(ini, c, linhas.length + 1, 1)); });
    if (g.abaixo) {
      b.setPosition(fim + 1, 1, 0, 0);
      fim += Math.ceil(altura / 21) + 2;
    } else {
      b.setPosition(linha, COL_GRAFICO_PAINEL, 0, 0);
      fim = Math.max(fim, linha + Math.ceil(altura / 21) + 1);
    }
    sh.insertChart(b.build());
  }
  return fim + 2;
}
