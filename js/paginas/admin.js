/* ==========================================================================
   admin.js — gestão de inspetores e leitura da auditoria
   ========================================================================== */

(function () {
  'use strict';

  let inspetores = [];

  /* ---- abas ---- */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (o) { o.classList.remove('sel'); });
      document.querySelectorAll('.pane').forEach(function (o) { o.classList.remove('on'); });
      t.classList.add('sel');
      document.getElementById('pane-' + t.dataset.pane).classList.add('on');
      if (t.dataset.pane === 'auditoria') carregarAuditoria();
    };
  });

  /* ------------------------------------------------------------------
     Inspetores
     ------------------------------------------------------------------ */
  async function carregar() {
    const alvo = document.getElementById('listaInspetores');
    UI.carregando(alvo, 'Carregando inspetores…');
    try {
      inspetores = await DB.listarInspetores();
      pintarPainel();
      pintarLista();
    } catch (e) {
      UI.vazio(alvo, UI.mensagemErro(e));
    }
  }

  function pintarPainel() {
    const conta = function (fn) { return inspetores.filter(fn).length; };
    document.getElementById('numTotal').textContent = inspetores.length;
    document.getElementById('numAtivos').textContent = conta(function (p) { return p.ativo; });
    document.getElementById('numSemAssin').textContent =
      conta(function (p) { return p.ativo && !p.assinatura_path; });
    document.getElementById('numExclusao').textContent =
      conta(function (p) { return !!p.exclusao_solicitada_em; });
    const n = document.getElementById('nInspetores');
    n.textContent = inspetores.length;
    n.className = 'n' + (inspetores.length ? '' : ' zero');
  }

  function pintarLista() {
    const alvo = document.getElementById('listaInspetores');
    if (!inspetores.length) {
      UI.vazio(alvo, 'Nenhum inspetor cadastrado ainda.');
      return;
    }

    alvo.innerHTML =
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Nome</th><th>Papel</th><th>Matrícula</th><th>Assinatura</th>' +
        '<th>Consentimento</th><th>Situação</th><th></th>' +
      '</tr></thead><tbody></tbody></table></div>';

    const corpo = alvo.querySelector('tbody');

    inspetores.forEach(function (p) {
      const tr = document.createElement('tr');
      if (!p.ativo) tr.className = 'inativo';

      tr.innerHTML =
        '<td><strong>' + Util.esc(p.nome) + '</strong>' +
          (p.exclusao_solicitada_em
            ? '<br><span class="bdg b-late" style="margin-top:4px">Pediu exclusão</span>' : '') +
        '</td>' +
        '<td>' + (p.papel === 'admin'
          ? '<span class="bdg b-late">Admin</span>'
          : '<span class="bdg b-in">Inspetor</span>') + '</td>' +
        '<td class="mono">' + Util.esc(p.matricula || '—') + '</td>' +
        '<td>' + (p.assinatura_path
          ? '<span class="bdg b-out">Cadastrada</span>'
          : '<span class="bdg b-warn">Falta</span>') + '</td>' +
        '<td>' + (p.consentimento_em
          ? Util.esc(Util.fmtData(p.consentimento_em))
          : '<span class="bdg b-warn">Pendente</span>') + '</td>' +
        '<td>' + (p.ativo
          ? '<span class="bdg b-out">Ativo</span>'
          : '<span class="bdg b-late">Inativo</span>') + '</td>' +
        '<td></td>';

      const acoes = tr.lastElementChild;
      const btn = function (texto, classe, aoClicar) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm ' + classe;
        b.textContent = texto;
        b.style.marginRight = '6px';
        b.onclick = aoClicar;
        acoes.appendChild(b);
      };

      if (p.assinatura_path) btn('Ver assinatura', 'btn-outline', function () { verAssinatura(p); });
      btn(p.ativo ? 'Desativar' : 'Reativar', 'btn-outline', function () { alternarAtivo(p); });
      // Anonimizar só aparece depois de o titular pedir: é execução de um
      // direito dele, não uma ferramenta de limpeza de cadastro.
      if (p.exclusao_solicitada_em) {
        btn('Anonimizar', 'btn-red', function () { anonimizar(p); });
      }

      corpo.appendChild(tr);
    });
  }

  async function verAssinatura(p) {
    try {
      const url = await Storage.urlAssinatura(p.assinatura_path);
      await UI.modal({
        titulo: 'Assinatura de ' + p.nome,
        html: '<div style="text-align:center;padding:12px;background:#fff;' +
          'border:1px solid var(--border);border-radius:8px">' +
          '<img src="' + Util.esc(url) + '" alt="Assinatura" ' +
          'style="max-width:100%;max-height:220px"></div>' +
          '<p style="font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.55">' +
          'Dado pessoal. O link acima expira em poucos minutos.</p>',
        textoOk: 'Fechar', semCancelar: true, classeOk: 'btn-outline'
      });
    } catch (e) { UI.erro(e); }
  }

  async function alternarAtivo(p) {
    const desativando = p.ativo;
    const ok = await UI.confirmar(
      desativando ? 'Desativar acesso' : 'Reativar acesso',
      desativando
        ? p.nome + ' deixa de conseguir entrar e de enxergar qualquer relatório. ' +
          'Os laudos já emitidos por ' + p.nome + ' permanecem no acervo.'
        : p.nome + ' volta a ter acesso ao sistema.',
      desativando ? 'Desativar' : 'Reativar',
      desativando ? 'btn-red' : 'btn-green');
    if (!ok) return;
    try {
      await DB.atualizarPerfil(p.id, { ativo: !p.ativo });
      await carregar();
      UI.toast(desativando ? 'Acesso desativado.' : 'Acesso reativado.', 'success');
    } catch (e) { UI.erro(e); }
  }

  async function anonimizar(p) {
    const ok = await UI.confirmar('Anonimizar ' + p.nome,
      'O cadastro é apagado e o acesso desativado, em definitivo. Os laudos já ' +
      'emitidos permanecem, com o nome e a assinatura congelados no momento da ' +
      'emissão — obrigação legal de guarda. Não dá para desfazer.',
      'Anonimizar');
    if (!ok) return;
    try {
      const caminhoAssinatura = p.assinatura_path;
      await DB.anonimizarPerfil(p.id);

      /* O SQL não alcança o Storage: o arquivo da assinatura corrente tem que
         ser apagado daqui, ou a eliminação fica pela metade. */
      if (caminhoAssinatura) {
        try {
          await Storage.apagarAssinaturaArquivo(caminhoAssinatura);
        } catch (e) {
          UI.toast('Perfil anonimizado, mas o arquivo da assinatura não foi apagado. ' +
            'Remova pelo painel do Supabase.', 'error');
        }
      }
      await carregar();
      UI.toast('Perfil anonimizado.', 'success');
    } catch (e) { UI.erro(e); }
  }

  /* ------------------------------------------------------------------
     Cadastro — via Edge Function
     ------------------------------------------------------------------ */
  document.getElementById('btNovo').onclick = async function () {
    let dados = null;

    const ok = await UI.modal({
      titulo: 'Cadastrar inspetor',
      html:
        '<div class="form-grid">' +
          '<div class="field col-inteira" id="wcNome"><label for="fcNome">Nome completo' +
            '<span class="req">*</span></label><input type="text" id="fcNome"/>' +
            '<div class="msg" id="mcNome"></div></div>' +
          '<div class="field col-inteira" id="wcEmail"><label for="fcEmail">E-mail de acesso' +
            '<span class="req">*</span></label><input type="email" id="fcEmail" ' +
            'inputmode="email" spellcheck="false"/><div class="msg" id="mcEmail"></div></div>' +
          '<div class="field col-inteira" id="wcSenha"><label for="fcSenha">Senha inicial' +
            '<span class="req">*</span></label><input type="text" id="fcSenha"/>' +
            '<div class="hint">Mínimo 10 caracteres. Entregue ao inspetor por canal ' +
            'interno e peça que troque no primeiro acesso.</div>' +
            '<div class="msg" id="mcSenha"></div></div>' +
          '<div class="field col-meia" id="wcMatricula"><label for="fcMatricula">Matrícula' +
            '</label><input type="text" id="fcMatricula" class="cod"/></div>' +
          '<div class="field col-meia" id="wcTelefone"><label for="fcTelefone">Telefone' +
            '</label><input type="tel" id="fcTelefone"/></div>' +
          '<div class="field col-inteira"><label for="fcPapel">Papel</label>' +
            '<select id="fcPapel"><option value="inspetor">Inspetor</option>' +
            '<option value="admin">Administrador</option></select></div>' +
        '</div>' +
        '<div class="warn-box i" style="margin-top:14px;margin-bottom:0">' +
        'O consentimento de tratamento de dados <strong>não</strong> é registrado aqui: ' +
        'o próprio inspetor aceita o termo no primeiro acesso. Consentimento dado por ' +
        'terceiro não vale.</div>',
      textoOk: 'Cadastrar',
      aoConfirmar: function (wrap) {
        const v = function (id) { return wrap.querySelector('#fc' + id).value.trim(); };
        wrap.querySelectorAll('.field').forEach(function (f) { f.classList.remove('err'); });

        const nome = v('Nome'), email = v('Email').toLowerCase(), senha =
          wrap.querySelector('#fcSenha').value;

        let falhou = false;
        const falha = function (campo, msg) {
          wrap.querySelector('#wc' + campo).classList.add('err');
          wrap.querySelector('#mc' + campo).textContent = msg;
          falhou = true;
        };
        if (nome.length < 5) falha('Nome', 'Escreva o nome completo.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) falha('Email', 'E-mail inválido.');
        if (senha.length < 10) falha('Senha', 'Use pelo menos 10 caracteres.');
        if (falhou) return false;

        dados = {
          nome: nome, email: email, senha: senha,
          matricula: v('Matricula') || null,
          telefone: v('Telefone') || null,
          papel: wrap.querySelector('#fcPapel').value
        };
        return true;
      }
    });
    if (!ok || !dados) return;

    UI.toast('Cadastrando…');
    try {
      await DB.criarInspetor(dados);
      await carregar();
      UI.toast('Inspetor cadastrado.', 'success');
    } catch (e) { UI.erro(e); }
  };

  /* ------------------------------------------------------------------
     Auditoria
     ------------------------------------------------------------------ */
  async function carregarAuditoria() {
    const alvo = document.getElementById('listaAuditoria');
    UI.carregando(alvo, 'Carregando registros…');
    try {
      const linhas = await DB.listarAuditoria(200);
      if (!linhas.length) { UI.vazio(alvo, 'Nenhum registro ainda.'); return; }

      alvo.innerHTML =
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>Quando</th><th>Evento</th><th>Detalhe</th><th>Autor</th>' +
        '</tr></thead><tbody>' +
        linhas.map(function (l) {
          const critico = /EXCLUSAO|ANONIMIZACAO|ASSINATURA|DESCARTE/.test(l.evento);
          return '<tr>' +
            '<td class="mono" style="white-space:nowrap">' + Util.esc(Util.fmtDT(l.ts)) + '</td>' +
            '<td><span class="bdg ' + (critico ? 'b-late' : 'b-in') + '">' +
              Util.esc(l.evento) + '</span></td>' +
            '<td>' + Util.esc(l.detalhe || '—') + '</td>' +
            '<td>' + Util.esc(l.autor || '—') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';
    } catch (e) {
      UI.vazio(alvo, UI.mensagemErro(e));
    }
  }

  /* ------------------------------------------------------------------ */
  (async function iniciar() {
    const perfil = await Guards.exigirAdmin();
    if (!perfil) return;

    Guards.montarCabecalho({
      titulo: 'Administração',
      subtitulo: 'Inspetores e auditoria',
      docRef: 'ADMIN'
    });

    await carregar();
  })();
})();
