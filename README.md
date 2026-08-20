# Portal de Relatórios de Inspeção — Perpec Oilfield Supply

Aplicação web para preenchimento, emissão e arquivamento de relatórios de inspeção
técnica. HTML/CSS/JS puros, sem compilação, publicados no GitHub Pages. Dados,
autenticação e arquivos no Supabase.

**Implementado:** Relatório de Inspeção Visual (RIV — FP-CQP-0011 Rev. 01).
**No portal, aguardando schema:** RIR, RID, RLP, RPM.

---

## Sumário

- [Atualizando uma instalação que já roda](#atualizando-uma-instalação-que-já-roda)
- [Instalação](#instalação)
- [Uso diário](#uso-diário)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Segurança](#segurança)
- [Mexer nas perguntas](#mexer-nas-perguntas)
- [Ligar um relatório novo](#ligar-um-relatório-novo)
- [Problemas comuns](#problemas-comuns)

---

## Atualizando uma instalação que já roda

O `schema.sql` é idempotente: rodá-lo inteiro de novo no SQL Editor não apaga
dado nenhum e traz as funções novas. Se preferir aplicar só o que mudou:

```sql
-- Conferência de número duplicado antes de gravar. Sem isto, a tela não
-- consegue avisar sobre número preso a rascunho de outro inspetor.
create or replace function public.numero_em_uso(p_numero text, p_ignorar uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sou_ativo() then
    raise exception 'Usuário sem permissão.';
  end if;
  if p_numero is null or btrim(p_numero) = '' then
    return false;
  end if;
  return exists (
    select 1 from public.relatorios
     where upper(numero) = upper(btrim(p_numero))
       and (p_ignorar is null or id <> p_ignorar)
  );
end $$;

grant execute on function public.numero_em_uso(text, uuid) to authenticated;
```

---

## Instalação

### 1. Projeto Supabase

1. Criar projeto na região **South America (São Paulo)** — LGPD, art. 33.
2. `SQL Editor` → colar `supabase/schema.sql` inteiro → **Run**.
3. `Authentication` → `Providers` → `Email`:
   - **Confirm email**: DESLIGADO (quem cria o acesso é o admin, não há e-mail a confirmar)
   - **Allow new users to sign up**: **DESLIGADO** — o cadastro é feito pela Edge Function.

### 2. Primeiro administrador

Sem ele ninguém entra, e a tela não diz por quê.

1. `Authentication` → `Users` → `Add user`, com **Auto Confirm User** marcado.
2. `SQL Editor`, com o seu e-mail:

```sql
insert into public.perfis (id, nome, papel, ativo, matricula, consentimento_em, consentimento_versao)
select id, 'SEU NOME COMPLETO', 'admin', true, '0001', now(), 'v1'
  from auth.users where email = 'seu.email@dominio.com'
on conflict (id) do update set papel = 'admin', ativo = true;
```

> Rodado **antes** de o usuário existir, este `INSERT` não insere nada e **não avisa**.
> Confira sempre com o bloco `DIAGNÓSTICO` no fim do `schema.sql`.

### 3. Edge Function de cadastro

É ela que permite ao admin criar inspetores pela tela. A `service_role` fica no
servidor do Supabase e **nunca** chega ao navegador.

```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU-REF
supabase functions deploy admin-criar-inspetor
supabase secrets set ORIGENS_PERMITIDAS="https://SEU-USUARIO.github.io"
```

Sem publicar a função, tudo o mais funciona — só o cadastro pela tela fica indisponível,
e o admin passa a criar usuários pelo painel do Supabase.

### 4. `js/config.js`

Preencha `URL` e `ANON_KEY` (`Settings` → `API`). A URL vai **sem** `/rest/v1`.
Preencha também `FN_CRIAR_INSPETOR` com a URL da função publicada.

> A chave `anon` é pública por natureza — ela aparece no código-fonte do site e isso é
> esperado. Quem protege os dados é a RLS, no banco. **Jamais** coloque aqui a
> `service_role`.

### 5. Logo

`js/logo.js` já está gerado a partir de `PERPEC - LOGO PRINCIPAL.png`. Se a logo mudar:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("PERPEC - LOGO PRINCIPAL.png")
$b64   = [System.Convert]::ToBase64String($bytes)
$txt   = 'window.LOGO_B64 = "data:image/png;base64,' + $b64 + '";'
[System.IO.File]::WriteAllText("js\logo.js", $txt, (New-Object System.Text.UTF8Encoding($false)))
```

### 6. Fonte do PDF

`js/pdf/fontes.js` já está gerado. Ele carrega **Proxima Nova Alt Condensed Light**
(corpo) e **Extra Condensed Bold** (rótulos e laudo) dentro do PDF, e é buscado só na
hora de gerar o primeiro documento — quem apenas navega pelo portal não baixa os 76 KB.
Se o arquivo faltar, o PDF sai em Helvetica em vez de falhar.

O jsPDF só embarca **TrueType**, e as fontes licenciadas da Perpec são OTF. Para
regerar depois de trocar a família (as `.otf` ficam em
`%LOCALAPPDATA%\Microsoft\Windows\Fonts`):

```bash
pip install fonttools
python ferramentas/gerar-fontes.py
```

> A fonte vai embutida no `.js` publicado, ou seja, fica baixável por quem abrir o site.
> Confira se a licença da Perpec cobre esse uso (*web embedding*) antes de publicar.
> Para trocar por uma família livre, edite `ferramentas/gerar-fontes.py` e rode de novo.
>
> No **DOCX** não há embutir: o Word usa a fonte instalada na máquina de quem abre.
> Quem não tiver a Proxima vê a substituta padrão — o conteúdo não muda. É mais um
> motivo para o **PDF** ser a via de arquivamento.

### 7. Publicar

`Settings` → `Pages` → branch `main`, pasta `/ (root)`.

**Testar local:** use o *Live Server* do VS Code (`Ctrl+Shift+P` → `Live Server: Open
with Live Server`). Abrir o `index.html` com dois cliques **não funciona** — o navegador
bloqueia a leitura dos `.json` de formulário em `file://`.

---

## Uso diário

### Inspetor

1. Entra com e-mail e senha. No primeiro acesso, aceita o termo de tratamento de dados.
2. **Meu perfil** → cadastra a assinatura (desenha na tela ou envia a imagem do carimbo).
   Sem assinatura não é possível emitir laudo.
3. Portal → escolhe o formulário → preenche.
   - O rascunho é salvo sozinho. Pode fechar e voltar depois.
   - Fotos: **Tirar foto** abre a câmera — a nativa no celular, a webcam (com
     prévia e troca de câmera) no computador. **Escolher do aparelho** abre a
     galeria ou o disco. Quantas precisar.
   - Resposta que indica problema fica vermelha e pede a descrição do achado.
   - O número é conferido contra o acervo **enquanto se digita**. Código já
     usado por qualquer relatório — inclusive rascunho de colega — aparece em
     vermelho no campo, com o próximo livre sugerido.
4. **CONCLUIR E EMITIR LAUDO** → APROVADO ou NÃO CONFORME.
5. **Relatórios** → baixa em PDF (assinado) ou DOCX (editável, para o SharePoint).
6. **Relatórios → Exportar Excel** → backup do acervo em `.xlsx`: uma linha por
   relatório, uma aba por formulário. As colunas saem do próprio schema, então
   incluir uma pergunta no JSON já a coloca na planilha. Além dos campos, cada
   linha traz a contagem de itens verificados, conformes e não conformes, e os
   achados descritos.

### Administrador

- **Inspetores**: cadastra, desativa, vê assinaturas, executa pedidos de exclusão.
- **Auditoria**: registro das operações de tratamento de dados.

---

## Onde ficam os dados

| O quê | Onde |
|---|---|
| Respostas do formulário | `relatorios.dados` (jsonb) |
| Número, laudo, status, snapshots | colunas próprias de `relatorios` |
| Fotos | bucket privado `relatorios`, caminho `<inspetor>/<relatório>/<campo>/<uuid>.jpg` |
| Assinaturas | bucket privado `assinaturas`, caminho `<usuário>/<uuid>.png` |
| Rascunho em andamento | servidor, com espelho em `localStorage` |

O servidor é a fonte da verdade. O `localStorage` é só rede de segurança contra queda
de conexão, e é apagado ao sair — aparelho compartilhado não guarda dado de terceiro.

### Numeração

Manual, no formato `PREFIXO-NNN-AA` (`RIV-001-26`). O sistema **sugere** o próximo livre
e o inspetor pode trocar. O banco confere o formato e recusa número repetido.

### Revisão

Laudo emitido é imutável. Corrigir abre uma **revisão**: nasce um relatório novo,
numerado `RIV-001-26 Rev.1`, ligado ao original, com motivo obrigatório. Os dois
permanecem no acervo.

---

## Segurança

A página é pública e todo o JavaScript é visível, inclusive a chave `anon`.
**A proteção está no banco, nunca na tela.** O que a interface esconde é conforto.

- **RLS ligada em todas as tabelas.** Nenhuma política atende `anon`.
- **Permissão por coluna.** O cliente só tem `GRANT UPDATE` em `dados` e `numero`.
  `status`, `laudo` e os snapshots são escritos apenas por `concluir_relatorio()`.
- **Buckets privados.** Nada é lido por URL pública; só por signed URL de 10 minutos.
- **Assinatura nunca é sobrescrita.** Trocar grava arquivo novo, senão os PDFs já
  emitidos passariam a exibir a assinatura nova.
- **Auditoria append-only.** Sem `GRANT` de update/delete.

### Quem vê o quê

| | Inspetor | Admin |
|---|---|---|
| Relatórios **emitidos** (todos) | ✔ | ✔ |
| Rascunhos de terceiros | ✕ | ✔ |
| Editar / concluir / revisar | só os próprios | ✕ (não assina por ninguém) |
| Assinatura corrente de um colega | ✕ | ✔ |
| Assinatura de colega dentro de laudo emitido | ✔, e fica registrado | ✔ |
| Cadastro de usuários | ✕ | ✔ |

### LGPD

- Consentimento explícito no primeiro acesso, com versão registrada.
- Acesso, retificação, portabilidade (exportar JSON) e pedido de exclusão, em **Meu perfil**.
- **Limite declarado ao titular:** a exclusão remove o cadastro e a assinatura corrente,
  mas os laudos já emitidos permanecem, com o nome e a assinatura congelados na emissão
  — documento técnico com prazo legal de guarda (art. 16, I). O termo diz isso com todas
  as letras, porque prometer exclusão integral e não cumprir seria pior do que não prometer.

---

## Mexer nas perguntas

As perguntas **não estão no código**. Ficam em `js/forms/<codigo>.json`.
Ver **[js/forms/LEIA-ME.md](js/forms/LEIA-ME.md)** — explica como ocultar, incluir e
reordenar pergunta sem tocar em JavaScript.

Ao mexer, suba o número em `"versao"`: ele é gravado em cada laudo emitido
(`schema_versao`) e é o que responde, dois anos depois, com qual versão do formulário
aquele documento foi feito.

---

## Ligar um relatório novo

1. Criar `js/forms/<codigo>.json` seguindo o LEIA-ME.
2. No SQL Editor: `update public.tipos_relatorio set ativo = true where codigo = '<codigo>';`

Não é preciso mexer em HTML, CSS nem JavaScript. O portal, o renderizador, o PDF e o
DOCX são genéricos.

---

## Problemas comuns

| Sintoma | Causa quase sempre |
|---|---|
| Login não responde, sem erro | `js/config.js` sem preencher |
| "Seu acesso existe, mas o perfil não foi criado" | falta a linha em `public.perfis` — rode o bloco DIAGNÓSTICO |
| Formulário aparece vazio na máquina local | abriu com dois cliques; use o Live Server |
| Fotos não aparecem no PDF | signed URL expirada — recarregue a página |
| Cadastro de inspetor recusado | Edge Function não publicada ou `ORIGENS_PERMITIDAS` sem o domínio do Pages |
| "O número já foi usado" | numeração manual; a mensagem já sugere o próximo livre |
| "Tirar foto" não abre a câmera no PC | falta permissão (libere no cadeado da barra de endereço), a câmera está presa em outro programa, ou a página foi aberta em `file://` — getUserMedia exige https/localhost |
| PDF saiu em Arial/Helvetica | `js/pdf/fontes.js` não carregou ou está corrompido — abra `ferramentas/teste.html` |
| Alteração publicada não aparece | cache do GitHub Pages — `Ctrl+F5` |

---

## Ferramentas de desenvolvimento

Abra com o Live Server. Nenhuma das duas fala com o Supabase.

| Arquivo | Para quê |
|---|---|
| `ferramentas/previa-pdf.html` | Gera o PDF com um relatório de mentira. Confere tipografia, checklist e quebra de página sem precisar de sessão. |
| `ferramentas/teste.html` | Autoteste dos geradores (PDF, DOCX, XLSX) e do `documento.js`. Rode depois de mexer em qualquer um deles. |
| `ferramentas/gerar-fontes.py` | Regera `js/pdf/fontes.js` a partir das OTF instaladas. |

---

*Perpec Oilfield Supply — Engenharia / SGQ*
