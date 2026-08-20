/* ==========================================================================
   campo-foto.js — tirar foto na hora ou escolher da galeria
   --------------------------------------------------------------------------
   Dois <input type="file"> separados, e isso é de propósito:

     capture="environment"  → abre a CÂMERA TRASEIRA direto
     sem capture            → abre a GALERIA / arquivos

   Um input só com `capture` não deixa escolher da galeria no Android, e um
   input só sem `capture` obriga o inspetor a passar pelo seletor de app antes
   de fotografar. Em campo, de luva, isso é atrito que faz a foto não ser
   tirada. Dois botões grandes resolvem sem ambiguidade.

   NO COMPUTADOR o navegador IGNORA `capture` e abre o mesmo seletor de arquivo
   do outro botão — a webcam nunca aparece. Como tirar foto na hora é parte do
   trabalho, e não um extra, ali o botão passa por getUserMedia: prévia ao
   vivo, troca de câmera e um quadro copiado para canvas. Mesmo caminho de
   upload da foto escolhida do disco.

   No celular continua sendo o `capture`, e de propósito: a câmera nativa
   entrega foco, flash e a resolução cheia do sensor, coisas que uma prévia
   dentro da página não alcança.

   getUserMedia exige contexto seguro. GitHub Pages (https) e Live Server
   (localhost) atendem; abrir o arquivo direto do disco, em file://, não.
   ========================================================================== */

window.CampoFoto = (function () {
  'use strict';

  /* Estado por campo: { campoId: [ {id, path, legenda, url, enviando} ] } */
  const estados = {};

  function montar(campo, st) {
    const bloco = document.createElement('div');
    bloco.className = 'field';
    bloco.dataset.campoFoto = campo.id;

    const limite = campo.max && campo.max > 0 ? campo.max : 0;

    bloco.innerHTML =
      '<label>' + Util.esc(campo.label) +
        (campo.obrigatorio ? '<span class="req">*</span>' : '') + '</label>' +
      (campo.ajuda ? '<div class="hint" style="margin-bottom:4px">' +
        Util.esc(campo.ajuda) + '</div>' : '') +
      '<div class="foto-acoes">' +
        '<button type="button" class="btn btn-dark" data-acao="camera">' +
          icone('camera') + 'Tirar foto</button>' +
        '<button type="button" class="btn btn-outline" data-acao="galeria">' +
          icone('imagem') + 'Escolher do aparelho</button>' +
        '<input type="file" accept="image/*" capture="environment" data-in="camera"' +
          (campo.multiplas ? ' multiple' : '') + '>' +
        '<input type="file" accept="image/*" data-in="galeria"' +
          (campo.multiplas ? ' multiple' : '') + '>' +
      '</div>' +
      '<div class="foto-grade" id="grade-' + Util.esc(campo.id) + '"></div>' +
      '<div class="msg" id="m' + Util.esc(campo.id) + '"></div>';

    const inCam = bloco.querySelector('[data-in="camera"]');
    const inGal = bloco.querySelector('[data-in="galeria"]');
    const btCam = bloco.querySelector('[data-acao="camera"]');
    const btGal = bloco.querySelector('[data-acao="galeria"]');

    /* `pointer: coarse` = dedo, ou seja, celular ou tablet — exatamente onde o
       `capture` funciona. Fora dali, a captura é nossa. */
    const noCelular = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    btCam.onclick = function () {
      if (noCelular) inCam.click();
      else abrirCamera(campo, st, limite);
    };
    btGal.onclick = function () { inGal.click(); };
    if (!noCelular) btGal.innerHTML = icone('imagem') + 'Escolher do computador';

    function aoEscolher(ev) {
      // Copia as referências ANTES de limpar o value: zerar o input também
      // esvazia o FileList, e sem a cópia os arquivos somem no meio do caminho.
      const arquivos = Array.prototype.slice.call(ev.target.files || []);
      ev.target.value = '';   // permite escolher a MESMA foto de novo
      if (arquivos.length) receber(campo, arquivos, st, limite);
    }
    inCam.onchange = aoEscolher;
    inGal.onchange = aoEscolher;

    estados[campo.id] = (st.fotos && st.fotos[campo.id]) ? st.fotos[campo.id].slice() : [];
    setTimeout(function () { pintar(campo, st); }, 0);

    return bloco;
  }

  function icone(qual) {
    if (qual === 'camera') {
      return '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
    }
    return '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  }

  /* ------------------------------------------------------------------
     Câmera no computador
     ------------------------------------------------------------------ */

  function pedirCamera(idDispositivo) {
    // 1920 é `ideal`, não `exact`: webcam que não alcança devolve o que tem em
    // vez de recusar a chamada. A foto é reduzida para 1600 no upload de
    // qualquer jeito (Storage.reduzirImagem).
    const video = idDispositivo
      ? { deviceId: { exact: idDispositivo }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    return navigator.mediaDevices.getUserMedia({ video: video, audio: false });
  }

  /* Cada motivo de recusa tem uma saída diferente, e o inspetor precisa saber
     qual é a dele: liberar no cadeado, fechar o Teams, ou ligar uma câmera. */
  function mensagemCamera(e) {
    const nome = (e && e.name) || '';
    if (nome === 'NotAllowedError' || nome === 'SecurityError') {
      return 'Permissão de câmera negada. Libere no cadeado da barra de endereço e tente de novo.';
    }
    if (nome === 'NotFoundError' || nome === 'OverconstrainedError' || nome === 'DevicesNotFoundError') {
      return 'Nenhuma câmera encontrada neste computador.';
    }
    if (nome === 'NotReadableError' || nome === 'TrackStartError') {
      return 'A câmera está sendo usada por outro programa. Feche-o e tente de novo.';
    }
    return UI.mensagemErro(e);
  }

  function comoArquivo(blob) {
    const nome = 'foto-' + Date.now() + '.jpg';
    try { return new File([blob], nome, { type: 'image/jpeg' }); }
    catch (e) { return blob; }   // navegador sem construtor File: o Blob serve
  }

  async function abrirCamera(campo, st, limite) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      UI.toast(window.isSecureContext === false
        ? 'A câmera só funciona em https ou localhost. Abra o portal pelo endereço publicado.'
        : 'Este navegador não dá acesso à câmera. Use "Escolher do computador".', 'error');
      return;
    }

    /* A permissão é pedida ANTES de abrir o modal: negada, o inspetor recebe a
       explicação direto, em vez de encarar um retângulo preto sem saber por quê. */
    let stream;
    try {
      stream = await pedirCamera(null);
    } catch (e) {
      UI.toast(mensagemCamera(e), 'error');
      console.warn('[camera]', e);
      return;
    }

    const quadro = document.createElement('canvas');

    const promessa = UI.modal({
      titulo: 'Tirar foto',
      html:
        '<div class="camera">' +
          '<video id="camVideo" autoplay playsinline muted></video>' +
          '<div class="camera-aviso" id="camAviso">abrindo a câmera…</div>' +
        '</div>' +
        '<div class="camera-barra">' +
          '<button type="button" class="btn btn-outline btn-sm hide" id="camTrocar">' +
            'Trocar câmera</button>' +
          '<span class="camera-dica" id="camDica">Enquadre a peça e clique em Capturar.</span>' +
        '</div>',
      textoOk: 'Capturar',
      textoCancelar: 'Fechar',
      classeOk: 'btn-red',
      aoConfirmar: function (wrap) {
        const v = wrap.querySelector('#camVideo');
        // videoWidth só existe depois do primeiro quadro; capturar antes disso
        // gravaria uma imagem preta.
        if (!v || !v.videoWidth) {
          wrap.querySelector('#camDica').textContent = 'A câmera ainda está abrindo. Um instante.';
          return false;
        }
        quadro.width = v.videoWidth;
        quadro.height = v.videoHeight;
        quadro.getContext('2d').drawImage(v, 0, 0, quadro.width, quadro.height);
        return true;
      }
    });

    /* UI.modal insere o modal antes de devolver a promessa, então o <video> já
       está no DOM aqui. O ÚLTIMO `.modal` é o nosso: se houver outro aberto
       por baixo, ele veio antes. */
    const abertos = document.querySelectorAll('.modal');
    const wrap = abertos[abertos.length - 1];
    const video = wrap && wrap.querySelector('#camVideo');
    const aviso = wrap && wrap.querySelector('#camAviso');

    if (video) {
      video.srcObject = stream;
      video.onloadedmetadata = function () { if (aviso) aviso.remove(); };
      video.play().catch(function () { /* autoplay bloqueado: o quadro já está lá */ });
    }

    /* Webcam integrada, câmera de bancada, boroscópio USB: quem tem mais de uma
       precisa escolher. A lista só vem com rótulo DEPOIS da permissão. */
    let camaras = [];
    try {
      const todos = await navigator.mediaDevices.enumerateDevices();
      camaras = todos.filter(function (d) { return d.kind === 'videoinput'; });
    } catch (e) { /* segue com a câmera padrão */ }

    const btTrocar = wrap && wrap.querySelector('#camTrocar');
    if (btTrocar && camaras.length > 1) {
      let atual = 0;
      btTrocar.classList.remove('hide');
      btTrocar.onclick = async function () {
        atual = (atual + 1) % camaras.length;
        try {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stream = await pedirCamera(camaras[atual].deviceId);
          if (video) { video.srcObject = stream; video.play().catch(function () {}); }
        } catch (e) {
          UI.toast(mensagemCamera(e), 'error');
        }
      };
    }

    const capturou = await promessa;

    /* Desligar a câmera é obrigatório em QUALQUER saída — capturou, cancelou ou
       fechou no X. Track viva deixa a luz do equipamento acesa e o aparelho
       preso para os outros programas. */
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    if (!capturou) return;

    const blob = await new Promise(function (ok) {
      quadro.toBlob(ok, 'image/jpeg', 0.95);
    });
    if (!blob) { UI.toast('Não foi possível capturar a imagem.', 'error'); return; }

    receber(campo, [comoArquivo(blob)], st, limite);
  }

  /* ------------------------------------------------------------------
     Recebimento e upload
     ------------------------------------------------------------------ */
  async function receber(campo, arquivos, st, limite) {
    const lista = estados[campo.id];

    if (limite && lista.length + arquivos.length > limite) {
      UI.toast('Este campo aceita no máximo ' + limite + ' fotos.', 'error');
      arquivos = arquivos.slice(0, Math.max(0, limite - lista.length));
      if (!arquivos.length) return;
    }

    /* O rascunho precisa existir ANTES do upload: a foto é gravada em
       relatorio_fotos, que tem chave estrangeira para o relatório. */
    let idRelatorio;
    try {
      idRelatorio = await st.garantirRascunho();
    } catch (e) {
      UI.erro(e);
      return;
    }

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      const provisorio = {
        id: 'tmp-' + Util.uid(),
        campoId: campo.id,
        path: null,
        legenda: '',
        url: URL.createObjectURL(arquivo),
        enviando: true,
        falhou: false
      };
      lista.push(provisorio);
      pintar(campo, st);

      try {
        const path = await Storage.enviarFoto(arquivo, idRelatorio, campo.id);
        const reg = await DB.criarFoto({
          relatorioId: idRelatorio,
          campoId: campo.id,
          path: path,
          ordem: lista.indexOf(provisorio)
        });
        provisorio.id = reg.id;
        provisorio.path = path;
        provisorio.enviando = false;
      } catch (e) {
        provisorio.enviando = false;
        provisorio.falhou = true;
        provisorio.erro = UI.mensagemErro(e);
        UI.toast('Uma foto não foi enviada: ' + provisorio.erro, 'error');
        console.error(e);
      }
      pintar(campo, st);
    }
    if (st.aoMudarFotos) st.aoMudarFotos(campo.id, lista);
  }

  /* ------------------------------------------------------------------
     Desenho da grade
     ------------------------------------------------------------------ */
  function pintar(campo, st) {
    const grade = document.getElementById('grade-' + campo.id);
    if (!grade) return;
    const lista = estados[campo.id] || [];

    if (!lista.length) {
      grade.innerHTML = '<div class="empty-state foto-vazio" style="padding:1.5rem 1rem">' +
        'Nenhuma foto ainda.</div>';
      return;
    }

    grade.innerHTML = '';
    lista.forEach(function (f, i) {
      const item = document.createElement('div');
      item.className = 'foto-item' +
        (f.enviando ? ' enviando' : '') + (f.falhou ? ' falhou' : '');

      const img = document.createElement('img');
      img.alt = f.legenda || ('Foto ' + (i + 1));
      img.src = f.url || '';
      img.loading = 'lazy';
      item.appendChild(img);

      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = f.falhou ? 'FALHOU' : (i + 1);
      item.appendChild(n);

      if (!st.somenteLeitura) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.title = 'Remover foto';
        rm.innerHTML = '&times;';
        rm.onclick = function () { remover(campo, f, st); };
        item.appendChild(rm);
      }

      if (campo.legenda !== false) {
        const leg = document.createElement('input');
        leg.type = 'text';
        leg.className = 'legenda-in';
        leg.placeholder = 'Legenda (opcional)';
        leg.value = f.legenda || '';
        leg.readOnly = !!st.somenteLeitura || !!f.enviando;
        leg.oninput = function () { f.legenda = leg.value; };
        leg.onblur = function () {
          if (!f.path || f.id.indexOf('tmp-') === 0) return;
          DB.atualizarLegenda(f.id, leg.value).catch(function (e) { UI.erro(e); });
        };
        item.appendChild(leg);
      }

      grade.appendChild(item);
    });
  }

  async function remover(campo, foto, st) {
    const ok = await UI.confirmar('Remover foto',
      'A foto sai do relatório e do armazenamento. Não dá para desfazer.', 'Remover');
    if (!ok) return;

    const lista = estados[campo.id];
    const i = lista.indexOf(foto);
    if (i >= 0) lista.splice(i, 1);
    pintar(campo, st);

    try {
      if (foto.id && foto.id.indexOf('tmp-') !== 0) await DB.apagarFoto(foto.id);
      // Só apaga o arquivo se ele não for herdado de uma revisão anterior:
      // nesse caso o objeto ainda pertence ao laudo original.
      if (foto.path && !foto.herdada) await Storage.apagarFotoArquivo(foto.path);
    } catch (e) {
      UI.erro(e);
    }
    if (st.aoMudarFotos) st.aoMudarFotos(campo.id, lista);
  }

  /* Carrega fotos já gravadas e resolve as URLs assinadas em UMA viagem. */
  async function carregar(campo, registros, st) {
    const meus = (registros || []).filter(function (r) { return r.campo_id === campo.id; });
    const mapa = await Storage.urlsFotos(meus.map(function (r) { return r.path; }));

    estados[campo.id] = meus.map(function (r) {
      return {
        id: r.id, campoId: r.campo_id, path: r.path,
        legenda: r.legenda || '', url: mapa[r.path] || '',
        herdada: !!r.herdada, enviando: false, falhou: false
      };
    });
    pintar(campo, st);
  }

  function obter(campoId) { return (estados[campoId] || []).slice(); }
  function limpar() { Object.keys(estados).forEach(function (k) { delete estados[k]; }); }

  return { montar: montar, carregar: carregar, obter: obter, limpar: limpar, pintar: pintar };
})();
