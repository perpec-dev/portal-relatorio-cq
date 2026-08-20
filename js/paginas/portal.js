/* ==========================================================================
   portal.js — login e escolha do relatório
   ========================================================================== */

(function () {
  'use strict';

  const gate = document.getElementById('gate');
  const grade = document.getElementById('grade');

  document.getElementById('gateLogo').src = window.LOGO_B64 || '';

  /* ------------------------------------------------------------------
     Entrada
     ------------------------------------------------------------------ */
  document.getElementById('formEntrar').onsubmit = async function (ev) {
    ev.preventDefault();
    const bt = document.getElementById('btEntrar');
    const erroBox = document.getElementById('gateErro');
    const email = document.getElementById('fEmail').value;
    const senha = document.getElementById('fSenha').value;

    UI.limparErros(gate);
    erroBox.classList.add('hide');

    let falhou = false;
    if (!email.trim()) { UI.marcarErro('Email', 'Informe o e-mail.'); falhou = true; }
    if (!senha) { UI.marcarErro('Senha', 'Informe a senha.'); falhou = true; }
    if (falhou) {
      document.querySelectorAll('#gate .msg').forEach(function (m) {
        if (m.textContent) m.parentElement.classList.add('err');
      });
      return;
    }

    UI.ocupado(bt, true, 'Entrando…');
    try {
      await Auth.entrar(email, senha);
      document.getElementById('fSenha').value = '';
      await abrirPortal();
    } catch (e) {
      erroBox.textContent = UI.mensagemErro(e);
      erroBox.classList.remove('hide');
    } finally {
      UI.ocupado(bt, false);
    }
  };

  /* ------------------------------------------------------------------
     Portal
     ------------------------------------------------------------------ */
  async function abrirPortal() {
    // Só some o gate DEPOIS da sessão confirmada e do perfil carregado.
    gate.hidden = true;
    Guards.montarCabecalho({
      titulo: 'Portal de Relatórios',
      subtitulo: CONFIG.EMPRESA,
      docRef: 'FP-CQP — INSPEÇÃO'
    });

    // Consentimento LGPD é a primeira porta: sem ele, nada de formulário.
    if (Auth.precisaConsentir()) {
      const aceitou = await pedirConsentimento();
      if (!aceitou) { await Auth.sair(); return; }
    }

    const destino = Util.param('voltar');
    if (destino) { location.href = destino; return; }

    await carregarTipos();
  }

  async function carregarTipos() {
    UI.carregando(grade, 'Carregando formulários…');
    try {
      const tipos = await DB.listarTipos();
      if (!tipos.length) {
        UI.vazio(grade, 'Nenhum formulário cadastrado. Rode supabase/schema.sql.');
        return;
      }
      grade.innerHTML = '';
      tipos.forEach(function (t) { grade.appendChild(cartao(t)); });
    } catch (e) {
      UI.vazio(grade, UI.mensagemErro(e));
    }
  }

  function cartao(tipo) {
    const el = document.createElement(tipo.ativo ? 'button' : 'div');
    el.className = 'card-rel ' + (tipo.ativo ? 'ativo' : 'breve');
    if (tipo.ativo) el.type = 'button';

    el.innerHTML =
      '<div class="card-rel-topo">' +
        '<span class="card-rel-sigla">' + Util.esc(tipo.prefixo) + '</span>' +
        '<span class="card-rel-nome">' + Util.esc(tipo.nome) + '</span>' +
      '</div>' +
      '<div class="card-rel-pe">' +
        '<span class="card-rel-doc">' + Util.esc(tipo.doc_ref) + '</span>' +
        (tipo.ativo
          ? '<span class="card-rel-seta">&rarr;</span>'
          : '<span class="bdg b-warn">Em breve</span>') +
      '</div>';

    if (tipo.ativo) {
      el.onclick = function () {
        location.href = 'relatorio.html?tipo=' + encodeURIComponent(tipo.codigo);
      };
    }
    return el;
  }

  /* ------------------------------------------------------------------
     Termo de consentimento (LGPD art. 8º)
     ------------------------------------------------------------------
     Consentimento tem que ser informado e específico. Por isso o termo diz o
     que é coletado, para quê, quem vê, e — principalmente — declara o LIMITE
     do direito de exclusão. Prometer apagar tudo e não apagar seria pior do
     que não prometer.
     ------------------------------------------------------------------ */
  function pedirConsentimento() {
    const html =
      '<div class="termo">' +
        '<h4>O que é tratado</h4>' +
        '<p>Seu nome, e-mail, matrícula, telefone e a imagem da sua assinatura ' +
        'ou carimbo. As fotos e respostas que você registrar nos relatórios.</p>' +

        '<h4>Para quê</h4>' +
        '<p>Emitir e arquivar relatórios de inspeção técnica, com a rastreabilidade ' +
        'documental exigida pelo sistema de gestão da qualidade.</p>' +

        '<h4>Quem vê</h4>' +
        '<ul>' +
          '<li>Os relatórios <strong>emitidos</strong> ficam visíveis a todos os ' +
          'inspetores: são acervo técnico da equipe.</li>' +
          '<li>Seus <strong>rascunhos</strong> só você e o administrador enxergam.</li>' +
          '<li>Sua <strong>assinatura</strong> fica em armazenamento privado. Ela só ' +
          'é exibida a terceiros dentro de um laudo que você já emitiu, e todo acesso ' +
          'desse tipo fica registrado.</li>' +
        '</ul>' +

        '<h4>Seus direitos</h4>' +
        '<p>Você pode, a qualquer momento pela tela <em>Meu perfil</em>: consultar e ' +
        'corrigir seus dados, exportar tudo o que é seu, e solicitar a exclusão.</p>' +

        '<h4>Limite da exclusão — leia com atenção</h4>' +
        '<p>Ao pedir exclusão, seus dados de cadastro e sua assinatura atual são ' +
        'removidos. <strong>Os laudos que você já emitiu permanecem</strong>, com o ' +
        'seu nome e a assinatura registrados no momento da emissão. Eles são documento ' +
        'técnico com prazo legal de guarda, e apagá-los descaracterizaria a inspeção. ' +
        'Este é o único ponto em que o direito de exclusão não é integral, e ele está ' +
        'escrito aqui para você decidir sabendo.</p>' +
      '</div>' +
      '<label class="confirmar" id="lbAceite">' +
        '<input type="checkbox" id="fAceite"><span class="mark"></span>' +
        '<span class="txt">Li e concordo com o tratamento dos meus dados</span>' +
      '</label>';

    return UI.modal({
      titulo: 'Termo de tratamento de dados',
      html: html,
      textoOk: 'Concordar e entrar',
      textoCancelar: 'Não concordo',
      classeOk: 'btn-green',
      aoConfirmar: function (wrap) {
        const cx = wrap.querySelector('#fAceite');
        if (!cx.checked) {
          UI.toast('Marque a confirmação para continuar.', 'error');
          return false;
        }
        return true;
      }
    }).then(async function (ok) {
      if (!ok) return false;
      try {
        await Auth.registrarConsentimento();
        return true;
      } catch (e) {
        UI.erro(e);
        return false;
      }
    });
  }

  // O toque na caixa precisa pintar de verde na hora — o modal é criado
  // depois do load, então o listener vai por delegação no documento.
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'fAceite') {
      const l = document.getElementById('lbAceite');
      if (l) l.classList.toggle('ok', ev.target.checked);
    }
  });

  /* ------------------------------------------------------------------
     Início
     ------------------------------------------------------------------ */
  (async function iniciar() {
    if (!SB.configurado) {
      document.getElementById('gateErro').textContent =
        'Instalação incompleta: preencha a URL e a chave anon em js/config.js.';
      document.getElementById('gateErro').classList.remove('hide');
      document.getElementById('btEntrar').disabled = true;
      return;
    }
    try {
      const s = await Auth.sessao();
      if (!s) return;                 // fica no gate
      const p = await Auth.carregarPerfil();
      if (!p || !p.ativo) { await Auth.sair(); return; }
      await abrirPortal();
    } catch (e) {
      console.error(e);
      // Sessão quebrada não pode deixar a tela travada no gate sem explicação.
      document.getElementById('gateErro').textContent = UI.mensagemErro(e);
      document.getElementById('gateErro').classList.remove('hide');
    }
  })();
})();
