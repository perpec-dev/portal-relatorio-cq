# Como mexer nas perguntas dos relatórios

As perguntas **não estão no código**. Cada relatório tem um arquivo `.json` nesta pasta,
e o nome do arquivo é o código do relatório no banco:

```
js/forms/inspecao-visual.json        → Relatório de Inspeção Visual  (FP-CQP-0011)
js/forms/inspecao-recebimento.json   → Inspeção de Recebimento       (FP-CQP-0020)
js/forms/inspecao-dimensional.json   → Inspeção Dimensional          (FP-CQP-0004)
js/forms/liquido-penetrante.json     → Líquido Penetrante            (FP-CQP-0001)
js/forms/particula-magnetica.json    → Partícula Magnética           (FP-CQP-0003)
```

Editar o `.json`, salvar e publicar já muda o formulário. Não há compilação.

> **Para testar na sua máquina**, abra a pasta no VS Code e use o *Live Server*
> (`Ctrl+Shift+P` → `Live Server: Open with Live Server`). Abrir o `index.html`
> com dois cliques **não funciona**: o navegador bloqueia a leitura de arquivos
> `.json` em `file://`, e o formulário aparece vazio. Publicado no GitHub Pages,
> funciona normalmente.

---

## As três coisas que você mais vai querer fazer

### Ocultar uma pergunta sem perdê-la

Troque `"ativo": true` por `"ativo": false`. A pergunta some da tela e do PDF, mas o
texto continua no arquivo para quando você quiser de volta.

```json
{ "id": "dureza", "label": "Dureza", "tipo": "sim_na", "ativo": false }
```

**Não apague a pergunta** se já existe relatório emitido com ela. O laudo antigo guarda
a resposta, e o PDF precisa do rótulo para conseguir imprimi-la.

### Incluir uma pergunta

Copie um bloco parecido, troque o `id` e o `label`. O `id` precisa ser único no arquivo,
sem acento e sem espaço — ele vira a chave da resposta no banco.

### Mudar a ordem

É a ordem em que aparecem no arquivo. Recortar e colar resolve.

---

## Vocabulário

### Seção

```json
{ "id": "ensaios", "titulo": "Ensaios complementares", "ajuda": "...", "ativo": true, "campos": [] }
```

Cada seção vira um cartão numerado na tela.

### Campo — chaves comuns a todos os tipos

| chave | para que serve |
|---|---|
| `id` | chave da resposta. Único, sem acento nem espaço. **Não mude depois de emitir laudo** — mudar perde a resposta dos relatórios antigos. |
| `label` | o que o inspetor lê |
| `tipo` | ver tabela abaixo |
| `obrigatorio` | `true` bloqueia a conclusão se estiver vazio |
| `ativo` | `false` oculta sem apagar |
| `largura` | `"inteira"`, `"meia"` ou `"terco"` |
| `ajuda` | linha cinza abaixo do campo |
| `exibirSe` | mostra só quando outro campo tem certo valor |

### Tipos

| `tipo` | vira | chaves próprias |
|---|---|---|
| `texto` | uma linha | `codigo: true` deixa monoespaçado e centralizado (placa, nº de série) |
| `texto_longo` | caixa de várias linhas | |
| `numero` | teclado numérico | `unidade`, `min`, `max`, `casas` |
| `data` | seletor de data | `naoFuturo: true` |
| `hora` | seletor de hora | |
| `selecao` | lista suspensa | `opcoes: ["A","B"]` |
| `opcao_unica` | botões grandes, escolhe um | `opcoes` |
| `opcao_multipla` | caixas, escolhe vários | `opcoes` |
| `sim_na` | par SIM / N/A, alvo grande | |
| `sim_nao` | par SIM / NÃO | |
| `sim_nao_na` | trio SIM / NÃO / NÃO SE APLICA | `alertaSe`, `observacaoSeAlerta` |
| `caixa` | uma caixa de marcar | |
| `foto` | tirar na hora ou escolher da galeria | `multiplas`, `max` (`0` = sem limite), `camera`, `legenda` |

Use `selecao` a partir de umas 6 opções. Abaixo disso, `opcao_unica` — botão grande é
melhor de acertar com luva, em pé, no sol.

### Marcar qual resposta é problema

As perguntas do formulário têm polaridade trocada entre si: em *"Usinagem conforme
desenho?"* quem preocupa é o **NÃO**; em *"Peças apresentam oxidações?"* quem preocupa
é o **SIM**. `alertaSe` diz qual das duas é a ruim:

```json
{ "id": "pecas_oxidacoes", "label": "Peças apresentam oxidações?",
  "tipo": "sim_nao_na", "alertaSe": "SIM", "observacaoSeAlerta": true }
```

Ao marcar a resposta de alerta, o campo fica vermelho e abre uma caixa de observação —
obrigatória, se `observacaoSeAlerta` for `true`. É o que preenche a coluna em branco à
direita de cada pergunta no formulário impresso, e o que impede achado sem descrição.

`alertaSe` não decide o laudo. Quem decide APROVADO ou NÃO CONFORME continua sendo o
inspetor, no fim do formulário; o alerta só destaca o que ele vai ter que justificar.

### Mostrar um campo só às vezes

```json
{
  "id": "dureza_relatorio",
  "label": "Relatório nº",
  "tipo": "texto",
  "exibirSe": { "campo": "dureza", "igual": "SIM" }
}
```

Campo oculto por `exibirSe` **não é cobrado** mesmo com `"obrigatorio": true`.

### Campos do sistema

`"sistema": "numero"` diz que a resposta vai para a coluna `numero` da tabela, e não
para o pacote de respostas. Só existe um hoje: o número do relatório.
`"sugerir": true` faz o campo já vir preenchido com o próximo número livre — e o
inspetor pode trocar.

### Encerramento

O bloco final (laudo, observações, assinatura e data) é igual em todos os relatórios e
fica na chave `encerramento`. A assinatura vem do perfil do inspetor, não é pergunta.

`"obrigatorioSeNaoConforme": true` nas observações cobra a descrição quando o laudo é
**NÃO CONFORME**. Não conformidade sem descrição não serve para tratativa nenhuma.

---

## Depois de mexer

Suba o número em `"versao"`. Ele é gravado em cada relatório emitido (`schema_versao`),
e é o que responde, dois anos depois, *"com qual versão do formulário este laudo foi
feito?"*. Sem isso, a rastreabilidade do documento não se sustenta numa auditoria.

Use `1.0.0` → `1.1.0` ao incluir ou ocultar pergunta; `1.0.0` → `2.0.0` ao mexer em `id`
de campo já usado.
