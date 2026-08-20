/* ==========================================================================
   guards.js — proteção de rota e montagem do cabeçalho
   --------------------------------------------------------------------------
   ISTO É CONFORTO DE INTERFACE, NÃO SEGURANÇA.
   Esconder a tela do admin não impede ninguém de chamar a API: o que impede
   é a RLS no banco. Um guard aqui existe para o usuário não se perder numa
   tela que não vai funcionar — e nada além disso.
   ========================================================================== */

window.Guards = (function () {
  'use strict';

  /* Exige sessão ativa. Sem ela, volta ao portal, que é onde mora o login.
     Devolve o perfil, ou null se já mandou embora. */
  async function exigirSessao() {
    if (!SB.configurado) {
      document.body.innerHTML =
        '<div class="wrap"><div class="warn-box e" style="margin-top:3rem">' +
        '<strong>Instalação incompleta.</strong><br>Preencha a URL e a chave anon ' +
        'em <code>js/config.js</code> e recarregue.</div></div>';
      return null;
    }
    const s = await Auth.sessao();
    if (!s) { irParaLogin(); return null; }

    const p = await Auth.carregarPerfil();
    if (!p || !p.ativo) {
      await Auth.sair();
      return null;
    }
    return p;
  }

  async function exigirAdmin() {
    const p = await exigirSessao();
    if (!p) return null;
    if (p.papel !== 'admin') {
      UI.toast('Esta área é do administrador.', 'error');
      setTimeout(function () { location.href = 'index.html'; }, 1200);
      return null;
    }
    return p;
  }

  function irParaLogin() {
    const destino = location.pathname.split('/').pop() + location.search;
    const q = destino && destino.indexOf('index.html') !== 0
      ? '?voltar=' + encodeURIComponent(destino) : '';
    location.href = 'index.html' + q;
  }

  /* Monta cabeçalho + faixa do documento + faixa de estado.
     Um lugar só: se mudar, muda em todas as telas de uma vez.

     INSERE no começo do #topo, nunca reescreve o innerHTML dele. Telas com
     abas (Relatórios, Administração) deixam a barra de abas dentro do #topo
     para ela grudar no topo junto com o cabeçalho; sobrescrever o innerHTML
     apagava essas abas — e, com elas, o único caminho até os rascunhos. */
  function montarCabecalho(opcoes) {
    const o = opcoes || {};
    const alvo = document.getElementById('topo');
    if (!alvo) return;
    const p = Auth.perfil;

    const anterior = alvo.querySelector('.topo-cab');
    if (anterior) anterior.remove();      // remontagem não empilha cabeçalho

    const html =
      '<header class="site-header"><div class="header-inner">' +
        '<a class="header-logo" href="index.html" aria-label="Início">' +
          '<img src="' + (window.LOGO_B64 || '') + '" alt="Perpec Oilfield Supply"></a>' +
        '<div class="header-right">' +
          '<div class="title">' + Util.esc(o.titulo || CONFIG.SISTEMA) + '</div>' +
          '<div class="sub">' + Util.esc(o.subtitulo || CONFIG.EMPRESA) + '</div>' +
        '</div>' +
      '</div></header>' +

      '<div class="doc-strip"><div class="doc-strip-inner">' +
        '<div><span class="doc-code-label">Documento</span>' +
        '<span class="doc-code-val">' + Util.esc(o.docRef || '—') + '</span></div>' +
        '<div class="doc-meta" id="relogio"></div>' +
      '</div></div>' +

      '<div class="user-strip"><div class="user-strip-inner">' +
        (p
          ? '<span>Conectado como <strong>' + Util.esc(p.nome) + '</strong></span>' +
            '<span class="sep">•</span>' +
            '<span class="bdg ' + (p.papel === 'admin' ? 'b-late' : 'b-in') + '">' +
              (p.papel === 'admin' ? 'Administrador' : 'Inspetor') + '</span>'
          : '<span>Não identificado</span>') +
        '<span class="right">' +
          '<a href="meus-relatorios.html">Relatórios</a>' +
          '<a href="perfil.html">Meu perfil</a>' +
          (Auth.admin ? '<a href="admin.html">Inspetores</a>' : '') +
          '<a href="#" id="btSair">Sair</a>' +
        '</span>' +
      '</div></div>';

    alvo.insertAdjacentHTML('afterbegin', '<div class="topo-cab">' + html + '</div>');

    const btSair = document.getElementById('btSair');
    if (btSair) {
      btSair.onclick = function (ev) { ev.preventDefault(); Auth.sair(); };
    }
    tocarRelogio();
  }

  function tocarRelogio() {
    const el = document.getElementById('relogio');
    if (!el) return;
    function pintar() {
      const d = new Date();
      el.textContent = Util.p2(d.getDate()) + '/' + Util.p2(d.getMonth() + 1) + '/' +
        d.getFullYear() + '  ' + Util.p2(d.getHours()) + ':' + Util.p2(d.getMinutes());
    }
    pintar();
    clearInterval(el._t);
    el._t = setInterval(pintar, 20000);
  }

  return {
    exigirSessao: exigirSessao,
    exigirAdmin: exigirAdmin,
    irParaLogin: irParaLogin,
    montarCabecalho: montarCabecalho
  };
})();
