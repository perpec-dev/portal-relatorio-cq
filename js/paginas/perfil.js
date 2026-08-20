/* ==========================================================================
   perfil.js — dados do inspetor, assinatura e direitos de LGPD
   ========================================================================== */

(function () {
  'use strict';

  let perfil = null;
  let temTraco = false;

  /* ------------------------------------------------------------------
     Dados
     ------------------------------------------------------------------ */
  function preencher() {
    document.getElementById('fNome').value = perfil.nome || '';
    document.getElementById('fMatricula').value = perfil.matricula || '';
    document.getElementById('fTelefone').value = perfil.telefone || '';
    document.getElementById('fEmailRO').value = perfil.email || '';

    const aviso = document.getElementById('avisoExclusao');
    aviso.innerHTML = perfil.exclusao_solicitada_em
      ? '<div class="warn-box w">Você solicitou a exclusão em ' +
        Util.esc(Util.fmtDT(perfil.exclusao_solicitada_em)) +
        '. O administrador foi notificado pelo registro de auditoria.</div>'
      : '';
  }

  document.getElementById('btSalvarDados').onclick = async function (ev) {
    const nome = document.getElementById('fNome').value.trim();
    UI.limparErros(document);

    if (nome.length < 5) {
      UI.marcarErro('Nome', 'Escreva o nome completo.');
      document.getElementById('wNome').classList.add('err');
      UI.focarCampo('Nome');
      UI.toast('Falta preencher. Veja em vermelho.', 'error');
      return;
    }

    UI.ocupado(ev.target, true, 'Salvando…');
    try {
      await DB.atualizarPerfil(perfil.id, {
        nome: nome,
        matricula: document.getElementById('fMatricula').value.trim() || null,
        telefone: document.getElementById('fTelefone').value.trim() || null
      });
      perfil = await Auth.carregarPerfil();
      preencher();
      UI.toast('Dados salvos.', 'success');
    } catch (e) {
      UI.erro(e);
    } finally {
      UI.ocupado(ev.target, false);
    }
  };

  document.getElementById('btTrocarSenha').onclick = async function () {
    let nova = '', repete = '';
    const ok = await UI.modal({
      titulo: 'Trocar minha senha',
      html:
        '<div class="field" id="wNova"><label for="fNova">Nova senha</label>' +
        '<input type="password" id="fNova" autocomplete="new-password"/>' +
        '<div class="hint">Pelo menos 10 caracteres.</div>' +
        '<div class="msg" id="mNova"></div></div>' +
        '<div class="field" id="wRepete" style="margin-top:12px">' +
        '<label for="fRepete">Repita a nova senha</label>' +
        '<input type="password" id="fRepete" autocomplete="new-password"/>' +
        '<div class="msg" id="mRepete"></div></div>',
      textoOk: 'Trocar senha',
      aoConfirmar: function (wrap) {
        nova = wrap.querySelector('#fNova').value;
        repete = wrap.querySelector('#fRepete').value;
        wrap.querySelectorAll('.field').forEach(function (f) { f.classList.remove('err'); });
        if (nova.length < 10) {
          wrap.querySelector('#wNova').classList.add('err');
          wrap.querySelector('#mNova').textContent = 'Use pelo menos 10 caracteres.';
          return false;
        }
        if (nova !== repete) {
          wrap.querySelector('#wRepete').classList.add('err');
          wrap.querySelector('#mRepete').textContent = 'As senhas não são iguais.';
          return false;
        }
        return true;
      }
    });
    if (!ok) return;
    try {
      await Auth.trocarSenha(nova);
      UI.toast('Senha trocada.', 'success');
    } catch (e) { UI.erro(e); }
  };

  /* ------------------------------------------------------------------
     Assinatura
     ------------------------------------------------------------------ */
  async function pintarAssinaturaAtual() {
    const alvo = document.getElementById('assinAtual');
    if (!perfil.assinatura_path) {
      alvo.innerHTML = '<div class="warn-box w">Você ainda não cadastrou assinatura. ' +
        'Sem ela não é possível emitir laudo.</div>';
      return;
    }
    alvo.innerHTML = '<div class="carregando"><span class="spin"></span>Carregando assinatura…</div>';
    try {
      const url = await Storage.urlAssinatura(perfil.assinatura_path);
      alvo.innerHTML =
        '<div class="assin-atual">' +
          '<img src="' + Util.esc(url) + '" alt="Sua assinatura"/>' +
          '<div class="meta"><strong>Assinatura cadastrada</strong><br>' +
          'Atualizada em ' + Util.esc(Util.fmtDT(perfil.assinatura_atualizada_em)) + '<br>' +
          'Trocar aqui não altera os laudos já emitidos.</div>' +
        '</div>';
    } catch (e) {
      alvo.innerHTML = '<div class="warn-box e">' + Util.esc(UI.mensagemErro(e)) + '</div>';
    }
  }

  /* ---- alternância entre desenhar e enviar imagem ---- */
  document.querySelectorAll('.assin-abas .opt').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.assin-abas .opt').forEach(function (o) {
        o.classList.remove('sel');
      });
      b.classList.add('sel');
      const desenhar = b.dataset.modo === 'desenhar';
      document.getElementById('modoDesenhar').classList.toggle('hide', !desenhar);
      document.getElementById('modoImagem').classList.toggle('hide', desenhar);
    };
  });

  /* ---- canvas ----
     O canvas é dimensionado em pixels REAIS (CSS × devicePixelRatio). Sem
     isso o traço sai serrilhado no celular e a assinatura fica ilegível
     no PDF, que é justamente onde ela precisa valer. */
  const cv = document.getElementById('assinCanvas');
  const cx = cv.getContext('2d');
  const caixa = document.getElementById('assinBox');

  function dimensionar() {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    // Preserva o desenho existente ao redimensionar.
    const antes = temTraco ? cv.toDataURL('image/png') : null;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.lineWidth = 2.4;
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    cx.strokeStyle = '#18171A';
    if (antes) {
      const img = new Image();
      img.onload = function () { cx.drawImage(img, 0, 0, r.width, r.height); };
      img.src = antes;
    }
  }

  let desenhando = false;

  function ponto(ev) {
    const r = cv.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function comecar(ev) {
    ev.preventDefault();
    desenhando = true;
    const p = ponto(ev);
    cx.beginPath();
    cx.moveTo(p.x, p.y);
  }
  function mover(ev) {
    if (!desenhando) return;
    ev.preventDefault();
    const p = ponto(ev);
    cx.lineTo(p.x, p.y);
    cx.stroke();
    if (!temTraco) { temTraco = true; caixa.classList.add('tem'); }
  }
  function parar() { desenhando = false; }

  cv.addEventListener('mousedown', comecar);
  cv.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', parar);
  cv.addEventListener('touchstart', comecar, { passive: false });
  cv.addEventListener('touchmove', mover, { passive: false });
  cv.addEventListener('touchend', parar);

  document.getElementById('btLimparAssin').onclick = function () {
    cx.clearRect(0, 0, cv.width, cv.height);
    temTraco = false;
    caixa.classList.remove('tem');
  };

  document.getElementById('btSalvarAssin').onclick = async function (ev) {
    if (!temTraco) {
      UI.toast('Desenhe a assinatura antes de salvar.', 'error');
      return;
    }
    UI.ocupado(ev.target, true, 'Enviando…');
    try {
      const blob = await recortar(cv);
      await Storage.enviarAssinatura(blob);
      perfil = Auth.perfil;
      await pintarAssinaturaAtual();
      document.getElementById('btLimparAssin').click();
      UI.toast('Assinatura salva.', 'success');
    } catch (e) {
      UI.erro(e);
    } finally {
      UI.ocupado(ev.target, false);
    }
  };

  /* Recorta o retângulo do traço e devolve PNG com fundo transparente.
     Sem o recorte, a assinatura viria com metade da caixa em branco em volta
     e apareceria minúscula no meio do documento. */
  function recortar(canvas) {
    return new Promise(function (resolve, reject) {
      const img = cx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0, achou = false;

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (d[(y * canvas.width + x) * 4 + 3] > 12) {
            achou = true;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (!achou) { reject(new Error('Nada foi desenhado.')); return; }

      const margem = 8;
      x0 = Math.max(0, x0 - margem); y0 = Math.max(0, y0 - margem);
      x1 = Math.min(canvas.width - 1, x1 + margem);
      y1 = Math.min(canvas.height - 1, y1 + margem);

      const saida = document.createElement('canvas');
      saida.width = x1 - x0 + 1;
      saida.height = y1 - y0 + 1;
      saida.getContext('2d').drawImage(canvas, x0, y0, saida.width, saida.height,
        0, 0, saida.width, saida.height);

      saida.toBlob(function (blob) {
        if (!blob) { reject(new Error('Não foi possível gerar a imagem.')); return; }
        resolve(blob);
      }, 'image/png');
    });
  }

  /* ---- envio de imagem pronta ---- */
  document.getElementById('fArquivoAssin').onchange = async function (ev) {
    const arquivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!arquivo) return;

    if (arquivo.size > 2 * 1024 * 1024) {
      UI.toast('A imagem passa de 2 MB. Use uma menor.', 'error');
      return;
    }
    UI.toast('Enviando assinatura…');
    try {
      // PNG puro: preserva a transparência do carimbo, que o JPEG destruiria.
      await Storage.enviarAssinatura(arquivo);
      perfil = Auth.perfil;
      await pintarAssinaturaAtual();
      UI.toast('Assinatura salva.', 'success');
    } catch (e) { UI.erro(e); }
  };

  /* ------------------------------------------------------------------
     LGPD
     ------------------------------------------------------------------ */
  document.getElementById('btExportar').onclick = async function (ev) {
    UI.ocupado(ev.target, true, 'Preparando…');
    try {
      const dados = await DB.exportarMeusDados();
      const blob = new Blob([JSON.stringify(dados, null, 2)],
        { type: 'application/json;charset=utf-8' });
      Util.baixarBlob('meus-dados-' + Util.hojeISO() + '.json', blob);
      UI.toast('Arquivo gerado.', 'success');
    } catch (e) {
      UI.erro(e);
    } finally {
      UI.ocupado(ev.target, false);
    }
  };

  document.getElementById('btExcluir').onclick = async function () {
    const ok = await UI.confirmar('Solicitar exclusão dos meus dados',
      'Seu cadastro e sua assinatura atual serão removidos pelo administrador. ' +
      'Os laudos que você já emitiu permanecem, com o nome e a assinatura ' +
      'registrados no momento da emissão — são documento técnico com prazo legal ' +
      'de guarda. Confirma o pedido?',
      'Solicitar exclusão');
    if (!ok) return;
    try {
      await DB.solicitarExclusao();
      perfil = await Auth.carregarPerfil();
      preencher();
      UI.toast('Pedido registrado.', 'success');
    } catch (e) { UI.erro(e); }
  };

  /* ------------------------------------------------------------------ */
  (async function iniciar() {
    perfil = await Guards.exigirSessao();
    if (!perfil) return;

    Guards.montarCabecalho({
      titulo: 'Meu perfil',
      subtitulo: 'Dados, assinatura e privacidade',
      docRef: 'PERFIL'
    });

    preencher();
    dimensionar();
    window.addEventListener('resize', Util.debounce(dimensionar, 250));
    await pintarAssinaturaAtual();
  })();
})();
