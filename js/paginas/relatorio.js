/* ==========================================================================
   relatorio.js — preenchimento, rascunho automático e emissão do laudo
   ========================================================================== */

(function () {
  'use strict';

  const el = {
    form: document.getElementById('formulario'),
    aviso: document.getElementById('aviso'),
    cardLaudo: document.getElementById('cardLaudo'),
    laudoOpcoes: document.getElementById('laudoOpcoes'),
    laudoCampos: document.getElementById('laudoCampos'),
    passoLaudo: document.getElementById('passoLaudo'),
    tituloLaudo: document.getElementById('tituloLaudo'),
    barra: document.getElementById('barraAcoes'),
    acoes: document.getElementById('acoes'),
    estado: document.getElementById('estadoRascunho'),
    ftDoc: document.getElementById('ftDoc')
  };

  let schema = null;
  let tipo = null;
  let relatorio = null;
  let valores = {};
  let laudo = null;
  let somenteLeitura = false;
  let criandoRascunho = null;   // promessa em voo, para não criar dois

  /* ------------------------------------------------------------------
     Rascunho: criação preguiçosa
     ------------------------------------------------------------------
     O rascunho só nasce quando o inspetor mexe em alguma coisa. Criar na
     abertura encheria o banco de relatórios vazios de quem só espiou o
     formulário — e consumiria número na série.
     ------------------------------------------------------------------ */
  async function garantirRascunho() {
    if (relatorio && relatorio.id) return relatorio.id;
    if (criandoRascunho) return await criandoRascunho;

    criandoRascunho = (async function () {
      const novo = await DB.criarRascunho(tipo.codigo, schema.versao || '1.0.0');
      relatorio = novo;
      // Deixa o id na URL: um F5 volta para o MESMO rascunho em vez de abrir
      // outro em branco e abandonar o anterior no banco.
      history.replaceState(null, '', 'relatorio.html?id=' + encodeURIComponent(novo.id));
      montarAcoes();
      return novo.id;
    })();

    try { return await criandoRascunho; }
    finally { criandoRascunho = null; }
  }

  /* ------------------------------------------------------------------
     Gravação do rascunho
     ------------------------------------------------------------------ */
  function pintarEstado(classe, texto) {
    el.estado.className = 'rascunho-estado ' + (classe || '');
    el.estado.querySelector('.txt').textContent = texto;
  }

  let salvandoAgora = false;
  let pedidoPendente = false;
  let numeroPendura = false;   // respostas gravadas, número recusado
  let falhouSalvar = false;    // nem as respostas foram gravadas

  async function salvar() {
    if (somenteLeitura) return;
    if (salvandoAgora) { pedidoPendente = true; return; }

    salvandoAgora = true;
    pintarEstado('salvando', 'Salvando…');
    try {
      const id = await garantirRascunho();
      const numero = campoNumero() ? String(valores[campoNumero().id] || '').trim().toUpperCase() : undefined;
      await DB.salvarRascunho(id, semSistema(valores), numero);
      espelharLocal();
      numeroPendura = false;
      falhouSalvar = false;
      pintarEstado('salvo', 'Rascunho salvo');
    } catch (e) {
      /* Número recusado NÃO é rascunho perdido: as respostas já foram
         gravadas antes (ver DB.salvarRascunho). Dizer "erro ao salvar" aqui
         assustaria à toa; o que falta é trocar o número, e é isso que a
         mensagem tem que dizer, no campo, onde ele está sendo digitado. */
      if (e && e.numeroRecusado) {
        numeroPendura = true;
        falhouSalvar = false;
        espelharLocal();
        const cn = campoNumero();
        if (cn) UI.marcarErro(cn.id, UI.mensagemErro(e));
        pintarEstado('erro', 'Respostas salvas — falta acertar o número');
      } else {
        falhouSalvar = true;
        pintarEstado('erro', UI.mensagemErro(e));
        UI.toast(UI.mensagemErro(e), 'error');
      }
    } finally {
      salvandoAgora = false;
      if (pedidoPendente) { pedidoPendente = false; salvar(); }
    }
  }

  /* ------------------------------------------------------------------
     Número: conferência imediata contra o acervo
     ------------------------------------------------------------------
     O `unique` do banco já impede a duplicata, mas só na hora de gravar. O
     inspetor precisa saber ANTES — enquanto ainda está com o desenho na mão —
     que aquele código já foi usado. A pergunta vai ao servidor porque a RLS
     esconde da tela o rascunho do colega, e é contra ele que a colisão
     costuma acontecer.
     ------------------------------------------------------------------ */
  let numeroConferido = '';

  async function conferirNumero() {
    const cn = campoNumero();
    if (!cn || somenteLeitura) return;

    const valor = String(valores[cn.id] || '').trim().toUpperCase();
    numeroConferido = valor;

    if (!valor) { UI.marcarErro(cn.id, ''); return; }
    if (!new RegExp(mascaraNumero()).test(valor)) {
      UI.marcarErro(cn.id, 'Use o formato ' + exemploNumero() + '.');
      return;
    }

    try {
      const usado = await DB.numeroEmUso(valor, relatorio ? relatorio.id : null);
      // Outra tecla já foi digitada enquanto a resposta vinha: a resposta é
      // de um número que não está mais na tela. Descarta.
      if (numeroConferido !== valor) return;

      if (usado) {
        let livre = '';
        try { livre = await DB.sugerirNumero(tipo.codigo); } catch (e) { /* sugestão é bônus */ }
        UI.marcarErro(cn.id, 'Código já existente.' + (livre ? ' O próximo livre é ' + livre + '.' : ''));
      } else {
        UI.marcarErro(cn.id, '');
      }
    } catch (e) {
      // Sem rede, a conferência não acontece — e não pode travar a digitação.
      console.warn('[numero] conferência indisponível:', e);
    }
  }

  const conferirNumeroDepois = Util.debounce(conferirNumero, 450);

  const salvarDepois = Util.debounce(salvar, CONFIG.AUTOSAVE_MS);

  /* O número mora em coluna própria, não dentro de `dados`. Mandá-lo nos dois
     lugares criaria duas verdades e uma delas ficaria desatualizada. */
  function campoNumero() {
    return RenderForm.todosCampos(schema).filter(function (c) {
      return c.sistema === 'numero';
    })[0] || null;
  }

  function semSistema(v) {
    const copia = Object.assign({}, v);
    const cn = campoNumero();
    if (cn) delete copia[cn.id];
    return copia;
  }

  /* Espelho local: se a conexão cair no meio da inspeção, o que foi digitado
     não some com um F5. O servidor continua sendo a fonte da verdade — isto
     é só rede de segurança. */
  function chaveLocal() {
    return CONFIG.PREFIXO_CACHE + 'rascunho.' + (relatorio ? relatorio.id : tipo.codigo);
  }
  function espelharLocal() {
    try {
      localStorage.setItem(chaveLocal(), JSON.stringify({
        valores: valores, laudo: laudo, em: Date.now()
      }));
    } catch (e) { /* cota cheia: o servidor já tem o dado */ }
  }
  function limparLocal() {
    try { localStorage.removeItem(chaveLocal()); } catch (e) { /* nada a fazer */ }
  }

  /* ------------------------------------------------------------------
     Mudança de valor
     ------------------------------------------------------------------ */
  function aoMudar(campoId, valor) {
    valores[campoId] = valor;
    RenderForm.aplicarCondicionais(schema, valores);
    pintarEstado('salvando', 'Alterado…');

    const cn = campoNumero();
    if (cn && campoId === cn.id) {
      // Some com o aviso do número anterior na hora: deixá-lo na tela
      // enquanto se digita o número novo acusa um erro que já não existe.
      UI.marcarErro(cn.id, '');
      conferirNumeroDepois();
    }

    salvarDepois();
  }

  /* ------------------------------------------------------------------
     Encerramento (laudo, data, observações)
     ------------------------------------------------------------------ */
  function montarEncerramento() {
    const enc = schema.encerramento || {};
    el.tituloLaudo.textContent = String(enc.titulo || 'Laudo').toUpperCase();
    el.passoLaudo.textContent = RenderForm.secoesAtivas(schema).length + 1;

    el.laudoOpcoes.innerHTML = '';
    (enc.opcoesLaudo || []).forEach(function (op) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'laudo-op ' + (op.cor || '') + (laudo === op.valor ? ' sel' : '');
      b.innerHTML = '<span class="mark"></span>' + Util.esc(op.rotulo);
      b.onclick = function () {
        if (somenteLeitura) return;
        laudo = op.valor;
        el.laudoOpcoes.querySelectorAll('.laudo-op').forEach(function (o) {
          o.classList.remove('sel');
        });
        b.classList.add('sel');
        UI.marcarErro('__laudo', '');
        // Observação vira obrigatória ao marcar NÃO CONFORME: o rótulo tem
        // que dizer isso na hora, não só quando o envio falhar.
        pintarObrigatoriedadeObs();
        espelharLocal();
      };
      el.laudoOpcoes.appendChild(b);
    });

    el.laudoCampos.innerHTML = '';
    const st = { valores: valores, aoMudar: aoMudar, somenteLeitura: somenteLeitura };

    /* Mesma função que monta o resto do formulário: o encerramento não pode
       divergir visualmente das demais seções. */
    if (enc.campoData) {
      const c = Object.assign({ largura: 'meia' }, enc.campoData);
      if (!valores[c.id] && !somenteLeitura) valores[c.id] = Util.hojeISO();
      el.laudoCampos.appendChild(RenderForm.montarCampo(c, st));
    }
    if (enc.campoObs) {
      const c = Object.assign({ largura: 'inteira' }, enc.campoObs);
      el.laudoCampos.appendChild(RenderForm.montarCampo(c, st));
    }
    pintarObrigatoriedadeObs();
    el.cardLaudo.classList.remove('hide');
  }

  function pintarObrigatoriedadeObs() {
    const enc = schema.encerramento || {};
    if (!enc.campoObs) return;
    const w = document.getElementById('w' + enc.campoObs.id);
    if (!w) return;
    const rotulo = w.querySelector('label');
    if (!rotulo) return;
    const precisa = enc.campoObs.obrigatorio ||
      (enc.campoObs.obrigatorioSeNaoConforme && laudo === 'nao_conforme');
    rotulo.innerHTML = Util.esc(enc.campoObs.label) + (precisa ? '<span class="req">*</span>' : '');
  }

  /* ------------------------------------------------------------------
     Ações
     ------------------------------------------------------------------ */
  function montarAcoes() {
    el.acoes.innerHTML = '';
    el.barra.classList.remove('hide');

    const btn = function (texto, classe, aoClicar) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + classe;
      b.textContent = texto;
      b.onclick = aoClicar;
      el.acoes.appendChild(b);
      return b;
    };

    if (somenteLeitura) {
      btn('Baixar PDF', 'btn-dark', function (ev) { baixar('pdf', ev.target); });
      btn('Baixar DOCX', 'btn-outline', function (ev) { baixar('docx', ev.target); });
      if (relatorio && relatorio.inspetorId === (Auth.perfil || {}).id) {
        btn('Abrir revisão', 'btn-outline', abrirRevisao);
      }
      btn('Voltar', 'btn-outline', function () { location.href = 'meus-relatorios.html'; });
      return;
    }

    btn('Pré-visualizar PDF', 'btn-outline', function (ev) { baixar('pdf', ev.target); });
    if (relatorio && relatorio.id) {
      btn('Descartar rascunho', 'btn-outline', descartar);
    }
    // Uma ação primária por tela: vermelha, caixa alta, 58px.
    const b = btn('CONCLUIR E EMITIR LAUDO', 'btn-red btn-xl', concluir);
    b.style.maxWidth = '340px';
  }

  async function concluir(ev) {
    const bt = ev.target;
    const cn = campoNumero();

    const contexto = {
      exigirLaudo: true,
      laudo: laudo,
      mascara: cn ? mascaraNumero() : null,
      exemploNumero: exemploNumero()
    };

    const r = Validate.validar(schema, valores, contexto);
    if (!Validate.aplicar(r)) return;

    /* Última barreira antes da emissão. A conferência que roda enquanto se
       digita pode estar desatualizada — o colega pode ter fechado o número
       nesse meio-tempo. Pergunta de novo, agora. */
    if (cn) {
      const numero = String(valores[cn.id] || '').trim().toUpperCase();
      UI.ocupado(bt, true, 'Conferindo número…');
      try {
        if (await DB.numeroEmUso(numero, relatorio ? relatorio.id : null)) {
          let livre = '';
          try { livre = await DB.sugerirNumero(tipo.codigo); } catch (e) { /* bônus */ }
          UI.marcarErro(cn.id, 'Código já existente.' + (livre ? ' O próximo livre é ' + livre + '.' : ''));
          UI.focarCampo(cn.id);
          UI.toast('O número ' + numero + ' já está em uso. Troque antes de emitir.', 'error');
          return;
        }
      } catch (e) {
        // Sem resposta do servidor, deixa seguir: o `unique` da tabela ainda
        // barra a duplicata na hora de concluir. Aqui é conforto, não guarda.
        console.warn('[numero] conferência antes da emissão indisponível:', e);
      } finally {
        UI.ocupado(bt, false);
      }
    }

    if (!(Auth.perfil || {}).assinatura_path) {
      const ir = await UI.confirmar('Assinatura não cadastrada',
        'O laudo é assinado com a sua assinatura ou carimbo, e você ainda não ' +
        'cadastrou a sua. Quer fazer isso agora? O rascunho fica salvo.',
        'Cadastrar assinatura', 'btn-red');
      if (ir) location.href = 'perfil.html';
      return;
    }

    const rotulo = (schema.encerramento.opcoesLaudo || [])
      .filter(function (o) { return o.valor === laudo; })
      .map(function (o) { return o.rotulo; })[0] || laudo;

    const ok = await UI.confirmar('Emitir laudo ' + rotulo,
      'Depois de emitido, o relatório não pode mais ser editado. Uma correção ' +
      'passa a exigir a abertura de uma revisão. Confirma?',
      'Emitir laudo', laudo === 'aprovado' ? 'btn-green' : 'btn-red');
    if (!ok) return;

    UI.ocupado(bt, true, 'Emitindo…');
    try {
      await salvar();                                   // garante o último toque
      const emitido = await DB.concluir(relatorio.id, laudo);
      relatorio = emitido;
      limparLocal();
      UI.toast('Laudo ' + rotulo + ' emitido. Nº ' + emitido.numero, 'success');
      setTimeout(function () {
        location.href = 'relatorio.html?id=' + encodeURIComponent(emitido.id);
      }, 900);
    } catch (e) {
      UI.erro(e);
      UI.ocupado(bt, false);
    }
  }

  async function descartar() {
    const ok = await UI.confirmar('Descartar rascunho',
      'Tudo que foi preenchido, inclusive as fotos, será apagado. Não dá para desfazer.',
      'Descartar');
    if (!ok) return;
    try {
      await DB.apagarRascunho(relatorio.id);
      limparLocal();
      UI.toast('Rascunho descartado.');
      setTimeout(function () { location.href = 'index.html'; }, 700);
    } catch (e) { UI.erro(e); }
  }

  async function abrirRevisao() {
    let motivo = '';
    const ok = await UI.modal({
      titulo: 'Abrir revisão de ' + (relatorio.numero || ''),
      html:
        '<p style="font-size:14px;line-height:1.6;margin-bottom:12px">O laudo atual ' +
        'permanece no acervo, intacto. Nasce um rascunho novo com os mesmos dados e ' +
        'as mesmas fotos, numerado como <strong>' +
        Util.esc((relatorio.numeroBase || relatorio.numero) + ' Rev.' + ((relatorio.revisao || 0) + 1)) +
        '</strong>.</p>' +
        '<div class="field" id="wMotivo"><label for="fMotivo">Motivo da revisão' +
        '<span class="req">*</span></label>' +
        '<textarea id="fMotivo" placeholder="Por que este laudo precisa ser revisado?"></textarea>' +
        '<div class="msg" id="mMotivo"></div></div>',
      textoOk: 'Abrir revisão',
      aoConfirmar: function (wrap) {
        motivo = wrap.querySelector('#fMotivo').value.trim();
        if (motivo.length < 5) {
          wrap.querySelector('#wMotivo').classList.add('err');
          wrap.querySelector('#mMotivo').textContent = 'Descreva o motivo.';
          return false;
        }
        return true;
      }
    });
    if (!ok) return;

    try {
      const nova = await DB.criarRevisao(relatorio.id, motivo);
      location.href = 'relatorio.html?id=' + encodeURIComponent(nova.id);
    } catch (e) { UI.erro(e); }
  }

  async function baixar(formato, bt) {
    UI.ocupado(bt, true, 'Gerando…');
    try {
      if (!relatorio || !relatorio.id) {
        UI.toast('Preencha alguma coisa antes de gerar o documento.', 'error');
        return;
      }
      await salvar();

      /* O documento é montado a partir do que está NO BANCO. Se a gravação
         acabou de falhar, ele sairia sem o que o inspetor acabou de preencher
         — e sem avisar. Foi assim que a prévia do rascunho saiu em branco. */
      if (falhouSalvar) {
        UI.toast('O rascunho não foi salvo, então o documento sairia sem o que você ' +
          'preencheu agora. Resolva o erro acima e tente de novo.', 'error');
        return;
      }
      if (numeroPendura) {
        UI.toast('Atenção: o número ainda não foi aceito. O documento sai com o número anterior.', 'error');
      }

      const atual = await DB.obterRelatorio(relatorio.id);
      if (formato === 'pdf') await GerarPDF.gerar(atual, schema);
      else await GerarDOCX.gerar(atual, schema);
      UI.toast('Documento gerado.', 'success');
    } catch (e) {
      UI.erro(e);
    } finally {
      UI.ocupado(bt, false);
    }
  }

  /* ------------------------------------------------------------------
     Numeração
     ------------------------------------------------------------------ */
  function mascaraNumero() {
    return '^' + tipo.prefixo + '-[0-9]{3}-[0-9]{2}$';
  }
  function exemploNumero() {
    const aa = String(new Date().getFullYear()).slice(-2);
    return tipo.prefixo + '-001-' + aa;
  }

  async function sugerirNumeroSeVazio() {
    const cn = campoNumero();
    if (!cn || !cn.sugerir || somenteLeitura) return;
    if (valores[cn.id]) return;
    try {
      const n = await DB.sugerirNumero(tipo.codigo);
      valores[cn.id] = n;
      const campo = document.getElementById('f' + cn.id);
      if (campo) campo.value = n;
    } catch (e) {
      // Falhar a sugestão não impede nada: o inspetor digita o número.
      console.warn('[numero] sugestão indisponível:', e);
    }
  }

  /* ------------------------------------------------------------------
     Avisos de contexto no topo
     ------------------------------------------------------------------ */
  function montarAviso() {
    let html = '';
    if (somenteLeitura) {
      const cor = relatorio.laudo === 'aprovado' ? 'g' : 'e';
      html = '<div class="warn-box ' + cor + '"><strong>Laudo emitido: ' +
        Util.esc(Documento.ROTULO_LAUDO[relatorio.laudo] || '—') + '</strong> — Nº ' +
        Util.esc(relatorio.numero) + ', por ' + Util.esc(relatorio.inspetorNome || '—') +
        ' em ' + Util.esc(Util.fmtDT(relatorio.concluidoEm)) +
        '. Este registro é imutável.</div>';
    } else if (relatorio && relatorio.revisao > 0) {
      html = '<div class="warn-box w"><strong>Revisão ' + relatorio.revisao + '</strong> de ' +
        Util.esc(relatorio.numeroBase || '') + ' — motivo: ' +
        Util.esc(relatorio.motivoRevisao || '—') + '</div>';
    }
    el.aviso.innerHTML = html;
  }

  /* ------------------------------------------------------------------
     Início
     ------------------------------------------------------------------ */
  (async function iniciar() {
    const perfil = await Guards.exigirSessao();
    if (!perfil) return;

    const id = Util.param('id');
    const codigoTipo = Util.param('tipo');

    try {
      if (id) {
        relatorio = await DB.obterRelatorio(id);
        if (!relatorio) throw new Error('Relatório não encontrado ou sem permissão de acesso.');
        tipo = await DB.tipo(relatorio.tipo);
        valores = Object.assign({}, relatorio.dados);
        laudo = relatorio.laudo;
        somenteLeitura = relatorio.status === 'concluido' ||
                         relatorio.inspetorId !== perfil.id;
      } else if (codigoTipo) {
        tipo = await DB.tipo(codigoTipo);
        if (!tipo) throw new Error('Formulário não encontrado.');
        if (!tipo.ativo) throw new Error('Este formulário ainda não está disponível.');
      } else {
        location.href = 'index.html';
        return;
      }

      schema = await RenderForm.carregarSchema(tipo.codigo);

      Guards.montarCabecalho({
        titulo: schema.nome,
        subtitulo: somenteLeitura ? 'Somente leitura' : 'Preenchimento',
        docRef: tipo.doc_ref + (schema.docRevisao ? ' Rev.' + schema.docRevisao : '')
      });
      el.ftDoc.textContent = tipo.doc_ref +
        (schema.versao ? ' • formulário ' + schema.versao : '');

      // Número vem da coluna, não de `dados`.
      const cn = campoNumero();
      if (cn && relatorio && relatorio.numero) valores[cn.id] = relatorio.numero;

      montarAviso();

      RenderForm.montar(el.form, schema, {
        valores: valores,
        aoMudar: aoMudar,
        somenteLeitura: somenteLeitura,
        garantirRascunho: garantirRascunho,
        aoMudarFotos: function () { espelharLocal(); }
      });
      RenderForm.aplicarCondicionais(schema, valores);

      // Fotos já gravadas
      if (relatorio && relatorio.id) {
        const registros = await DB.listarFotos(relatorio.id);
        RenderForm.todosCampos(schema)
          .filter(function (c) { return c.tipo === 'foto'; })
          .forEach(function (c) {
            CampoFoto.carregar(c, registros, {
              somenteLeitura: somenteLeitura,
              garantirRascunho: garantirRascunho,
              aoMudarFotos: function () { espelharLocal(); }
            });
          });
      }

      montarEncerramento();
      montarAcoes();

      if (somenteLeitura) {
        el.barra.querySelector('.rascunho-estado').classList.add('hide');
        el.cardLaudo.classList.add('form-lido');
      } else {
        pintarEstado(relatorio ? 'salvo' : '', relatorio ? 'Rascunho salvo' : 'Rascunho novo');
        await sugerirNumeroSeVazio();
        // Rascunho retomado pode ter ficado com um número que outro inspetor
        // fechou nesse meio-tempo. Melhor descobrir na abertura.
        conferirNumero();

        // beforeunload: avisa se há alteração ainda não gravada.
        window.addEventListener('beforeunload', function (ev) {
          if (salvandoAgora || pedidoPendente) {
            ev.preventDefault();
            ev.returnValue = '';
          }
        });
      }
    } catch (e) {
      el.form.innerHTML = '<div class="warn-box e">' + Util.esc(UI.mensagemErro(e)) + '</div>' +
        '<a class="btn btn-outline" href="index.html">Voltar ao portal</a>';
      console.error(e);
    }
  })();
})();
