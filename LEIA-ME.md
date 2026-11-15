# Santa Rita Recorrida

App para registrar, em cada potreiro, a **lotação** (animais por categoria) e o **mineral**
colocado no cocho. Funciona **sem sinal** e envia os registros para uma **planilha Google**
quando a internet volta. Segue o mesmo modelo do Santa Rita Nascimentos (veja `../GUIA-NOVOS-APPS.md`).

```
Celular (app instalado)  ──►  Google Apps Script  ──►  Planilha "Santa Rita Recorrida"
  guarda tudo offline          confere o acesso e         abas: Recorridas, Potreiros,
  (IndexedDB)                  grava/devolve os dados      Minerais, Categorias, Usuarios, Aparelhos
```

## Abas do app

| Aba | O que faz |
|---|---|
| **Registro** | Escolhe o potreiro (próximos pelo GPS ou busca por parte do nome, sem acento/maiúscula), marca a localização dos cochos, informa animais e/ou mineral |
| **Lotação** | Animais em cada potreiro pela última recorrida com contagem. Tocar num potreiro abre o registro dele |
| **Registros** | Recorridas lançadas, com filtros, edição, exclusão e CSV |
| **Painel** | Animais hoje, sacos e kg no período, mineral por produto, consumo estimado (g/cab/dia) e dias sem abastecer |

## Planilha

**Recorridas**: uma linha por recorrida. Colunas fixas (Data, Potreiro, Lotação, Total animais, Animais, Sacos, Kg,
Mineral, Observações…) e **uma coluna por categoria** (`Animais: Vacas`) e **por mineral** (`Sacos: Proteico 30 M`),
criadas sozinhas conforme aparecem. Isso facilita tabela dinâmica. Lotação: `Conferida`, `Vazio` ou `Não conferida`
(quando só foi colocado mineral).

**Potreiros**: nome, nomes alternativos (a busca também procura neles), Ativo, dois cochos e o contorno.
- Cocho: texto `lat, lon` (pode colar no Google Maps). O app grava sozinho quando alguém marca o cocho.
- Contorno: formato do KML do Google Earth, `lon,lat lon,lat …` (vários polígonos separados por `|`).
  Com contorno, o app sabe em qual potreiro a pessoa está; sem contorno, usa a distância até os cochos.
- `Ativo = NÃO` tira o potreiro da lista sem apagar o histórico.

**Minerais**: nome, nomes alternativos, **kg por saco** (usado no kg total e no consumo), Ativo.
**Categorias**: nome, nomes alternativos, Ativo.

**Medicamentos**: nome, nomes alternativos, unidade da dose, Ativo e **Tipo** (Vermífugo, Carrapaticida, Endectocida…;
dá para digitar outro ou mais de um separado por vírgula). O Tipo alimenta a sanidade do Painel.
**Medicações**: montada pelo servidor a partir das recorridas (não editar). Uma linha por medicamento, com as
categorias que receberam, a quantidade de animais, a dose por animal e o **total aplicado** (dose × animais).
**Movimentações**: montada pelo servidor (não editar). Ao conferir os animais, o app compara a contagem com a
lotação anterior e, quando há diferença, pergunta o motivo por categoria: faltando, morte (brinco e causa
opcionais), venda/saída, mudança de categoria, nascimento, entrada, animais de outro potreiro ou contagem
anterior errada (diferença sem motivo também conta assim). A lotação de referência (colunas "Animais: ...")
é a contagem + os faltando − os de outro potreiro. Os faltando aparecem na recorrida seguinte do potreiro
(voltaram, ainda faltam, encontrado morto ou não vão voltar), na aba Lotação (cartão "Com falta") e na
seção "Animais faltando" do Painel.
**Transferência entre potreiros**: no quadro de diferença, "Transferência" (saíram) ou "Vieram (transferência)"
pede o outro potreiro ("Já atualizado no outro potreiro" registra só aqui; em "Vieram" a lista mostra os
potreiros que têm a categoria). Ao salvar, o app mostra como fica a lotação dele (números editáveis) e, se confirmado,
cria uma recorrida só de lotação lá, com a observação "Lotação atualizada pela recorrida de ...". Editar a
recorrida refaz essa atualização; se o outro potreiro já registrou a mesma troca, a opção vem desmarcada; excluir também a desfaz. "Vazio" também abre o quadro, para dizer para onde
foram os animais.
**Medicação sem potreiro**: com Medicamentos ligado e sem potreiro escolhido, ao salvar o app pergunta se lança
só a medicação. Se sim, grava um registro com o potreiro em branco (aparece como "Sem potreiro"): os animais
conferidos ficam só na medicação e não mudam a lotação; mineral, tem mineral e falta no depósito não são salvos.

**Painel**: resumo com tabelas e gráficos (animais por categoria, sacos e consumo de mineral, dias sem abastecer,
mineral em falta, medicamentos e dias após carrapaticida/vermífugo por potreiro). Vem do script `Painel.gs`
(colar como mais um arquivo no projeto Apps Script). Atualiza ao abrir a planilha, ao trocar o período na célula B4
e pelo menu **Recorrida > Atualizar painel**. A aba é refeita a cada atualização: não digite nada nela.

Potreiros, categorias e minerais novos podem ser incluídos pelo app. Entram na planilha com uma nota
dizendo quem incluiu e quando.
Ao incluir **medicamento**, **categoria** ou **mineral** novos, o app abre uma janela para completar o cadastro:
medicamento pede nomes alternativos, unidade da dose e tipo; categoria pede nomes alternativos e espécie;
mineral pede nomes alternativos e kg por saco.
Unidade, tipo e espécie mostram os já usados na planilha, com a opção de digitar um novo.

## Configuração

Siga o passo a passo do `GUIA-NOVOS-APPS.md` (item 6), com estes nomes:

| Item | Valor |
|---|---|
| Planilha e projeto Apps Script | **Santa Rita Recorrida** |
| Repositório GitHub | **santa-rita-recorrida** |
| Endereço | `https://rferreirasul-arch.github.io/santa-rita-recorrida/` |

A função `configurar` cria todas as abas e já preenche Potreiros, Minerais e Categorias com a aba
"Lista" da planilha antiga *Controle sal mineral*. Depois de publicar, cole a URL `/exec` em `config.js`
(`API_URL`). Com `API_URL` vazio o app roda em **modo demonstração** (salva só no aparelho).

## Publicar no GitHub

Enviar tudo desta pasta. A pasta `apps-script/` e este arquivo podem ir junto (não têm segredo).
Ao incluir ou remover arquivos, aumentar `VERSAO` no `sw.js`.

## Cópia diária no Dropbox

Todo dia, perto das **5h**, o Apps Script grava `Recorrida - consulta.xlsx` em
`Dropbox/Fazenda Santa Rita -2023/Apps Santa Rita`, substituindo a versão anterior. A cópia é **só para consulta**:
tem todas as abas, menos Usuarios e Aparelhos, e uma aba **Leia-me** com o link da planilha Google para quem
precisar editar. A pessoa precisa ter acesso de edição à planilha Google.
O código fica em `apps-script/Dropbox.gs` e usa a sua conta do Dropbox, que tem acesso de edição à pasta da fazenda.

Configuração (uma vez só):

1. **Apps Script** da planilha → **+** ao lado de Arquivos → **Script** → nome `Dropbox` → colar `Dropbox.gs` → salvar.
   Não é preciso fazer nova implantação: o app continua igual.
2. **Dropbox** → <https://www.dropbox.com/developers/apps> → **Create app** → *Scoped access* → *Full Dropbox* →
   nome único (ex.: `Santa Rita Recorrida Exportacao`).
   - Aba **Permissions**: marcar `files.content.write` → **Submit** (antes do passo 4).
   - Aba **Settings**: anotar **App key** e **App secret**.
3. Apps Script → **Configurações do projeto** (engrenagem) → **Propriedades do script**:
   `DROPBOX_APP_KEY` e `DROPBOX_APP_SECRET`.
4. Executar **`dropboxConectar`**. O registro de execução mostra um link: abrir → **Permitir** → copiar o código →
   criar a propriedade `DROPBOX_CODIGO` com ele → executar `dropboxConectar` de novo ("Dropbox conectado").
5. Executar **`exportarParaDropbox`**. O arquivo deve aparecer na pasta do Dropbox.
6. Executar **`agendarExportacao`**. A partir daí roda sozinho todo dia.

Na primeira execução o Google pede novas autorizações (Drive e agendamento). Se a exportação falhar,
o Google manda e-mail para o dono do script. Para mudar a hora, troque `HORA_EXPORTACAO` e rode
`agendarExportacao` de novo.
