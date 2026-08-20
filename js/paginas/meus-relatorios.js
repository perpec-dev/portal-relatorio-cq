/* ==========================================================================
   meus-relatorios.js — consulta e download de PDF/DOCX
   ========================================================================== */

(function () {
  'use strict';

  const el = {
    abas: document.getElementById('abas'),
    lista: document.getElementById('lista'),
    busca: document.getElementById('fBusca'),
    tipo: document.getElementById('fTipo'),
    laudo: document.getElementById('fLaudo'),
    exportar: document.getElementById('btExportar')
  };

  const ABAS = [
    { id: 'meus',      rotulo: 'Meus relatórios' },
    { id: 'rascunhos', rotulo: 'Meus rascunhos' },
    { id: 'equipe',    rotulo: 'Da equipe' }
  ];

  let abaAtual = 'meus';
  let tipos = [];
  let cache = [];

  /* Situação e cor num só lugar. Cartão, aba e badge consomem esta função —
     nunca se decide cor no meio do render. */
  function situacao(r) {
    if (r.status !== 'concluido') return 'in';
    return r.laudo === 'aprovado' ? 'out' : 'late';
  }
  const ROTULO_SIT = {
    in: 'Rascunho', out: 'Aprovado', late: 'Não conforme'
  };

  /* O contador só aparece na aba aberta: é a única cuja consulta foi feita.
     Um "0" fixo nas outras dizia ao inspetor que ele não tem rascunho — e
     ele tem. Contar as três exigiria três consultas a cada troca de aba. */
  function montarAbas() {
    el.abas.innerHTML = '';
    ABAS.forEach(function (a) {
      const b = document.createElement('button');
      const atual = a.id === abaAtual;
      b.className = 'tab' + (atual ? ' sel' : '');
      b.innerHTML = Util.esc(a.rotulo) +
        (atual ? ' <span class="n zero" id="n-' + a.id + '">…</span>' : '');
      b.onclick = function () { abaAtual = a.id; montarAbas(); carregar(); };
      el.abas.appendChild(b);
    });
  }

  function filtroDaAba() {
    const f = {
      tipo: el.tipo.value || null,
      laudo: el.laudo.value || null,
      busca: el.busca.value.trim()
    };
    if (abaAtual === 'meus') { f.meus = true; f.status = 'concluido'; }
    if (abaAtual === 'rascunhos') { f.meus = true; f.status = 'rascunho'; f.laudo = null; }
    if (abaAtual === 'equipe') { f.status = 'concluido'; }
    return f;
  }

  async function carregar() {
    UI.carregando(el.lista, 'Carregando relatórios…');
    try {
      cache = await DB.listarRelatorios(filtroDaAba());

      /* A aba "Da equipe" mostra o acervo dos colegas. Os meus já estão na
         primeira aba — repetir aqui só faria a lista inchar. */
      if (abaAtual === 'equipe') {
        const meu = (Auth.perfil || {}).id;
        cache = cache.filter(function (r) { return r.inspetorId !== meu; });
      }

      const contador = document.getElementById('n-' + abaAtual);
      if (contador) {
        contador.textContent = cache.length;
        contador.className = 'n' + (cache.length ? '' : ' zero');
      }
      pintar();
    } catch (e) {
      UI.vazio(el.lista, UI.mensagemErro(e));
    }
  }

  function pintar() {
    if (!cache.length) {
      UI.vazio(el.lista, abaAtual === 'rascunhos'
        ? 'Nenhum rascunho em aberto.'
        : 'Nenhum relatório encontrado com esses filtros.');
      return;
    }
    el.lista.innerHTML = '';
    cache.forEach(function (r) { el.lista.appendChild(cartao(r)); });
  }

  function cartao(r) {
    const sit = situacao(r);
    const tipoNome = (tipos.filter(function (t) { return t.codigo === r.tipo; })[0] || {}).nome || r.tipo;
    const meu = r.inspetorId === (Auth.perfil || {}).id;

    const div = document.createElement('div');
    div.className = 'rec s-' + sit;

    const descricao = r.dados && (r.dados.descricao || r.dados.Descricao) || '';

    div.innerHTML =
      '<div class="rec-status"><span class="dot"></span>' + Util.esc(ROTULO_SIT[sit]) +
        (r.revisao > 0 ? ' — Rev. ' + r.revisao : '') +
        '<span class="num">' + Util.esc(r.numero || '—') + '</span></div>' +
      '<div class="rec-in">' +
        '<div class="rec-grid">' +
          '<div><div class="k">Formulário</div><div class="v">' + Util.esc(tipoNome) + '</div></div>' +
          '<div><div class="k">Descrição</div><div class="v">' +
            Util.esc(descricao || '—') + '</div></div>' +
          '<div><div class="k">Inspetor</div><div class="v">' +
            Util.esc(r.inspetorNome || (meu ? (Auth.perfil || {}).nome : '—')) + '</div></div>' +
          '<div><div class="k">' + (r.status === 'concluido' ? 'Emitido em' : 'Alterado em') +
            '</div><div class="v">' +
            Util.esc(Util.fmtDT(r.status === 'concluido' ? r.concluidoEm : r.atualizadoEm)) +
            '</div></div>' +
        '</div>' +
        '<div class="rec-acts"></div>' +
      '</div>';

    const acoes = div.querySelector('.rec-acts');
    const btn = function (texto, classe, aoClicar) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm ' + classe;
      b.textContent = texto;
      b.onclick = aoClicar;
      acoes.appendChild(b);
    };

    btn(r.status === 'concluido' ? 'Abrir' : 'Continuar preenchendo',
      r.status === 'concluido' ? 'btn-outline' : 'btn-red', function () {
        location.href = 'relatorio.html?id=' + encodeURIComponent(r.id);
      });

    if (r.status === 'concluido') {
      btn('PDF', 'btn-dark', function (ev) { baixar(r, 'pdf', ev.target); });
      btn('DOCX', 'btn-outline', function (ev) { baixar(r, 'docx', ev.target); });
    }
    return div;
  }

  async function baixar(r, formato, bt) {
    UI.ocupado(bt, true, 'Gerando…');
    try {
      const schema = await RenderForm.carregarSchema(r.tipo);
      /* Relê do banco em vez de usar a linha em cache: o documento tem que
         sair do registro, não de uma cópia que já pode estar velha. */
      const atual = await DB.obterRelatorio(r.id);
      if (formato === 'pdf') await GerarPDF.gerar(atual, schema);
      else await GerarDOCX.gerar(atual, schema);
      UI.toast('Documento gerado.', 'success');
    } catch (e) {
      UI.erro(e);
    } finally {
      UI.ocupado(bt, false);
    }
  }

  /* Backup do acervo. NÃO usa o `cache` da aba aberta de propósito: a aba é um
     recorte de leitura (só os meus, só rascunho, só da equipe) e um backup
     recortado dá a impressão de estar completo quando não está. Refaz a
     consulta abrangendo tudo o que o inspetor pode ver. */
  async function exportar(bt) {
    UI.ocupado(bt, true, 'Montando planilha…');
    try {
      const n = await Exportar.acervo({
        tipos: tipos,
        tipo: el.tipo.value || null,
        busca: el.busca.value.trim()
      });
      UI.toast(n + (n === 1 ? ' relatório exportado.' : ' relatórios exportados.'), 'success');
    } catch (e) {
      UI.erro(e);
    } finally {
      UI.ocupado(bt, false);
    }
  }

  /* ------------------------------------------------------------------ */
  (async function iniciar() {
    const perfil = await Guards.exigirSessao();
    if (!perfil) return;

    Guards.montarCabecalho({
      titulo: 'Relatórios',
      subtitulo: 'Consulta e emissão de documentos',
      docRef: 'FP-CQP — INSPEÇÃO'
    });

    try {
      tipos = await DB.listarTipos();
      tipos.forEach(function (t) {
        const o = document.createElement('option');
        o.value = t.codigo;
        o.textContent = t.nome;
        el.tipo.appendChild(o);
      });
    } catch (e) { UI.erro(e); }

    montarAbas();
    await carregar();

    const refiltrar = Util.debounce(carregar, 350);
    el.busca.oninput = refiltrar;
    el.tipo.onchange = carregar;
    el.laudo.onchange = carregar;
    if (el.exportar) {
      el.exportar.onclick = function (ev) { exportar(ev.currentTarget); };
    }
  })();
})();
