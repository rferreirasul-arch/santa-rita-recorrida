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

Potreiros, categorias e minerais novos podem ser incluídos pelo app. Entram na planilha com uma nota
dizendo quem incluiu e quando.

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
