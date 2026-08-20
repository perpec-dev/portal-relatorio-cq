/* ==========================================================================
   render-form.js — monta o formulário a partir do schema JSON
   --------------------------------------------------------------------------
   Este arquivo NÃO conhece nenhum campo do Relatório de Inspeção Visual.
   Ele só sabe interpretar o vocabulário descrito em js/forms/LEIA-ME.md.
   Incluir um campo é editar o JSON; não se mexe aqui.
   ========================================================================== */

window.RenderForm = (function () {
  'use strict';

  const OPCOES_FIXAS = {
    sim_na:     ['SIM', 'N/A'],
    sim_nao:    ['SIM', 'NÃO'],
    sim_nao_na: ['SIM', 'NÃO', 'NÃO SE APLICA']
  };

  /* Carrega o schema. `fetch` de arquivo local é bloqueado em file:// —
     por isso o LEIA-ME manda usar Live Server para testar na máquina. */
  async function carregarSchema(codigo) {
    const resp = await fetch(CONFIG.PASTA_FORMS + codigo + '.json', { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error('Formulário "' + codigo + '" não encontrado em ' + CONFIG.PASTA_FORMS + '.');
    }
    try {
      return await resp.json();
    } catch (e) {
      throw new Error('O arquivo ' + codigo + '.json tem erro de sintaxe. ' +
        'Confira vírgulas e aspas.');
    }
  }

  /* Só campos e seções com ativo !== false. É o que faz `"ativo": false`
     ocultar a pergunta sem apagá-la do arquivo. */
  function secoesAtivas(schema) {
    return (schema.secoes || [])
      .filter(function (s) { return s.ativo !== false; })
      .map(function (s) {
        const copia = Object.assign({}, s);
        copia.campos = (s.campos || []).filter(function (c) { return c.ativo !== false; });
        return copia;
      })
      .filter(function (s) { return s.campos.length > 0; });
  }

  function todosCampos(schema) {
    const lista = [];
    secoesAtivas(schema).forEach(function (s) {
      s.campos.forEach(function (c) { lista.push(c); });
    });
    return lista;
  }

  const ehPergunta = function (c) { return !!OPCOES_FIXAS[c.tipo]; };

  /* ------------------------------------------------------------------
     Montagem
     ------------------------------------------------------------------ */

  function montar(alvo, schema, estado) {
    const st = estado || {};
    const somenteLeitura = !!st.somenteLeitura;
    alvo.innerHTML = '';
    alvo.classList.toggle('form-lido', somenteLeitura);

    let passo = 0;
    secoesAtivas(schema).forEach(function (secao) {
      passo++;
      alvo.appendChild(montarSecao(secao, passo, st));
    });
  }

  function montarSecao(secao, passo, st) {
    const card = document.createElement('section');
    card.className = 'card';
    card.id = 'sec-' + secao.id;

    const cabeca = document.createElement('div');
    cabeca.className = 'card-head';
    cabeca.innerHTML = '<span class="step">' + passo + '</span><h2>' +
      Util.esc(String(secao.titulo || '').toUpperCase()) + '</h2>';
    card.appendChild(cabeca);

    const corpo = document.createElement('div');
    corpo.className = 'card-body';
    if (secao.ajuda) {
      corpo.innerHTML = '<p class="card-ajuda">' + Util.esc(secao.ajuda) + '</p>';
    }

    const perguntas = secao.campos.filter(ehPergunta);
    const comuns = secao.campos.filter(function (c) { return !ehPergunta(c); });

    /* Perguntas de resposta fixa formam uma lista vertical; os demais campos
       entram numa grade. Misturar os dois numa grade só deixa a leitura das
       12 perguntas do formulário impossível no celular. */
    if (comuns.length) {
      const grade = document.createElement('div');
      grade.className = 'form-grid';
      comuns.forEach(function (c) { grade.appendChild(montarCampo(c, st)); });
      corpo.appendChild(grade);
    }
    if (perguntas.length) {
      const lista = document.createElement('div');
      lista.className = 'perguntas';
      if (comuns.length) lista.style.marginTop = '16px';
      perguntas.forEach(function (c) { lista.appendChild(montarPergunta(c, st)); });
      corpo.appendChild(lista);
    }

    card.appendChild(corpo);
    return card;
  }

  /* ---------------- Pergunta de resposta fixa ---------------- */

  function montarPergunta(campo, st) {
    const opcoes = campo.opcoes || OPCOES_FIXAS[campo.tipo];
    const valor = st.valores ? st.valores[campo.id] : null;

    const bloco = document.createElement('div');
    bloco.className = 'pergunta';
    bloco.id = 'w' + campo.id;
    bloco.dataset.campo = campo.id;

    const topo = document.createElement('div');
    topo.className = 'pergunta-topo';

    const texto = document.createElement('div');
    texto.className = 'pergunta-txt';
    texto.innerHTML = Util.esc(campo.label) +
      (campo.obrigatorio ? '<span class="req">*</span>' : '');
    topo.appendChild(texto);

    const caixa = document.createElement('div');
    caixa.className = 'opcoes';
    opcoes.forEach(function (op) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + classeOpcao(campo, op) + (valor === op ? ' sel' : '');
      b.textContent = op;
      b.dataset.valor = op;
      b.onclick = function () {
        if (st.somenteLeitura) return;
        caixa.querySelectorAll('.opt').forEach(function (o) { o.classList.remove('sel'); });
        b.classList.add('sel');
        bloco.classList.remove('err');
        aplicarObs(bloco, campo, op, st);
        if (st.aoMudar) st.aoMudar(campo.id, op);
      };
      caixa.appendChild(b);
    });
    topo.appendChild(caixa);
    bloco.appendChild(topo);

    /* Montado por appendChild, e não por innerHTML +=: reatribuir innerHTML
       recria todos os nós filhos e apaga os onclick recém-ligados acima. */
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.id = 'm' + campo.id;
    bloco.appendChild(msg);

    aplicarObs(bloco, campo, valor, st);
    return bloco;
  }

  /* A cor da opção escolhida sai do `alertaSe` do JSON:
     vermelha quando a resposta é a problemática, verde quando não,
     azul quando é "não se aplica" — que não é bom nem ruim. */
  function classeOpcao(campo, opcao) {
    if (opcao === 'N/A' || opcao === 'NÃO SE APLICA') return ' neutro';
    if (campo.alertaSe && opcao === campo.alertaSe) return ' alerta';
    return '';
  }

  function idObs(campoId) { return campoId + '__obs'; }

  /* Observação obrigatória quando a resposta é a de alerta. É o que preenche
     a coluna em branco à direita de cada pergunta no formulário impresso —
     e o que impede achado registrado sem descrição. */
  function aplicarObs(bloco, campo, valor, st) {
    const existente = bloco.querySelector('.pergunta-obs');
    const precisa = campo.observacaoSeAlerta && campo.alertaSe && valor === campo.alertaSe;

    if (!precisa) {
      if (existente) existente.remove();
      return;
    }
    if (existente) return;

    const id = idObs(campo.id);
    const atual = st.valores ? (st.valores[id] || '') : '';
    const div = document.createElement('div');
    div.className = 'pergunta-obs field';
    div.id = 'w' + id;
    div.innerHTML =
      '<label for="f' + id + '">O que foi encontrado?<span class="req">*</span></label>' +
      '<textarea id="f' + id + '" data-campo="' + Util.esc(id) + '" ' +
      'placeholder="Descreva o achado com o detalhe que o laudo precisa."></textarea>' +
      '<div class="msg" id="m' + id + '"></div>';
    bloco.insertBefore(div, bloco.querySelector('.msg'));

    const ta = div.querySelector('textarea');
    ta.value = atual;
    ta.readOnly = !!st.somenteLeitura;
    ta.oninput = function () { if (st.aoMudar) st.aoMudar(id, ta.value); };
  }

  /* ---------------- Campos comuns ---------------- */

  function montarCampo(campo, st) {
    const wrap = document.createElement('div');
    wrap.className = 'field col-' + (campo.largura || 'inteira');
    wrap.id = 'w' + campo.id;
    wrap.dataset.campo = campo.id;

    if (campo.tipo === 'foto') {
      wrap.classList.remove('field');
      wrap.className = 'col-' + (campo.largura || 'inteira');
      wrap.appendChild(CampoFoto.montar(campo, st));
      return wrap;
    }

    const valor = st.valores ? st.valores[campo.id] : '';
    const idc = 'f' + campo.id;
    let controle = '';

    switch (campo.tipo) {
      case 'texto_longo':
        controle = '<textarea id="' + idc + '" data-campo="' + Util.esc(campo.id) + '"></textarea>';
        break;
      case 'numero':
        controle = '<input type="number" inputmode="decimal" id="' + idc + '" ' +
          'data-campo="' + Util.esc(campo.id) + '"' +
          (campo.min != null ? ' min="' + campo.min + '"' : '') +
          (campo.max != null ? ' max="' + campo.max + '"' : '') +
          (campo.casas === 0 ? ' step="1"' : '') + '>';
        break;
      case 'data':
        controle = '<input type="date" id="' + idc + '" data-campo="' + Util.esc(campo.id) + '"' +
          (campo.naoFuturo ? ' max="' + Util.hojeISO() + '"' : '') + '>';
        break;
      case 'hora':
        controle = '<input type="time" id="' + idc + '" data-campo="' + Util.esc(campo.id) + '">';
        break;
      case 'selecao':
        controle = '<select id="' + idc + '" data-campo="' + Util.esc(campo.id) + '">' +
          '<option value="">Selecione…</option>' +
          (campo.opcoes || []).map(function (o) {
            return '<option value="' + Util.esc(o) + '">' + Util.esc(o) + '</option>';
          }).join('') + '</select>';
        break;
      case 'opcao_unica':
      case 'opcao_multipla':
        controle = '<div class="opcoes" data-campo="' + Util.esc(campo.id) + '" ' +
          'data-multi="' + (campo.tipo === 'opcao_multipla' ? '1' : '0') + '">' +
          (campo.opcoes || []).map(function (o) {
            return '<button type="button" class="opt" data-valor="' + Util.esc(o) + '">' +
              Util.esc(o) + '</button>';
          }).join('') + '</div>';
        break;
      case 'caixa':
        controle = '<label class="confirmar" style="margin-top:0">' +
          '<input type="checkbox" id="' + idc + '" data-campo="' + Util.esc(campo.id) + '">' +
          '<span class="mark"></span><span class="txt">' + Util.esc(campo.label) + '</span></label>';
        break;
      default:
        controle = '<input type="text" id="' + idc + '" data-campo="' + Util.esc(campo.id) + '"' +
          (campo.codigo ? ' class="cod" autocapitalize="characters" spellcheck="false"' : '') +
          (campo.placeholder ? ' placeholder="' + Util.esc(campo.placeholder) + '"' : '') + '>';
    }

    const mostraLabel = campo.tipo !== 'caixa';
    wrap.innerHTML =
      (mostraLabel
        ? '<label for="' + idc + '">' + Util.esc(campo.label) +
          (campo.obrigatorio ? '<span class="req">*</span>' : '') + '</label>'
        : '') +
      controle +
      (campo.ajuda ? '<div class="hint">' + Util.esc(campo.ajuda) + '</div>' : '') +
      '<div class="msg" id="m' + campo.id + '"></div>';

    ligarCampo(wrap, campo, valor, st);
    return wrap;
  }

  function ligarCampo(wrap, campo, valor, st) {
    const st_ = st || {};
    const grupo = wrap.querySelector('.opcoes');

    if (grupo) {
      const multi = grupo.dataset.multi === '1';
      const atuais = multi
        ? (Array.isArray(valor) ? valor.slice() : [])
        : (valor ? [valor] : []);

      grupo.querySelectorAll('.opt').forEach(function (b) {
        if (atuais.indexOf(b.dataset.valor) >= 0) b.classList.add('sel');
        b.onclick = function () {
          if (st_.somenteLeitura) return;
          if (multi) {
            b.classList.toggle('sel');
          } else {
            grupo.querySelectorAll('.opt').forEach(function (o) { o.classList.remove('sel'); });
            b.classList.add('sel');
          }
          wrap.classList.remove('err');
          const sel = Array.prototype.map.call(
            grupo.querySelectorAll('.opt.sel'), function (o) { return o.dataset.valor; });
          if (st_.aoMudar) st_.aoMudar(campo.id, multi ? sel : (sel[0] || ''));
        };
      });
      return;
    }

    const el = wrap.querySelector('input,textarea,select');
    if (!el) return;

    if (el.type === 'checkbox') {
      // A .confirmar é filha do wrap, não ancestral — querySelector, não closest.
      const alvo = wrap.querySelector('.confirmar');
      el.checked = !!valor;
      el.disabled = !!st_.somenteLeitura;
      el.onchange = function () {
        if (alvo) alvo.classList.toggle('ok', el.checked);
        if (st_.aoMudar) st_.aoMudar(campo.id, el.checked);
      };
      if (el.checked && alvo) alvo.classList.add('ok');
      return;
    }

    el.value = valor == null ? '' : valor;
    if (st_.somenteLeitura) el.readOnly = true;

    el.oninput = function () {
      wrap.classList.remove('err');
      if (st_.aoMudar) st_.aoMudar(campo.id, el.value);
    };
    if (el.tagName === 'SELECT') {
      el.onchange = function () {
        wrap.classList.remove('err');
        if (st_.aoMudar) st_.aoMudar(campo.id, el.value);
      };
    }
  }

  /* ------------------------------------------------------------------
     Visibilidade condicional (exibirSe).
     Rodar depois de qualquer mudança: um campo escondido não pode ser
     cobrado na validação nem sair no PDF.
     ------------------------------------------------------------------ */
  function visivel(campo, valores) {
    const c = campo.exibirSe;
    if (!c) return true;
    const v = valores[c.campo];
    if (Object.prototype.hasOwnProperty.call(c, 'igual')) return v === c.igual;
    if (Object.prototype.hasOwnProperty.call(c, 'diferente')) return v !== c.diferente;
    if (Object.prototype.hasOwnProperty.call(c, 'preenchido')) {
      return c.preenchido ? !!(v && String(v).trim()) : !(v && String(v).trim());
    }
    return true;
  }

  function aplicarCondicionais(schema, valores) {
    todosCampos(schema).forEach(function (c) {
      const w = document.getElementById('w' + c.id);
      if (!w) return;
      w.classList.toggle('hide', !visivel(c, valores));
    });
  }

  return {
    carregarSchema: carregarSchema,
    montar: montar,
    /* Exposto para o bloco de encerramento (laudo/data/observações), que mora
       fora das seções mas precisa ser idêntico ao resto do formulário. */
    montarCampo: montarCampo,
    secoesAtivas: secoesAtivas,
    todosCampos: todosCampos,
    ehPergunta: ehPergunta,
    visivel: visivel,
    aplicarCondicionais: aplicarCondicionais,
    idObs: idObs,
    OPCOES_FIXAS: OPCOES_FIXAS
  };
})();
