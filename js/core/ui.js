/* ==========================================================================
   ui.js — toast, modal, marcação de erro, tradução de erro de rede/auth
   ========================================================================== */

window.UI = (function () {
  'use strict';

  function toast(msg, tipo) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast' + (tipo ? ' ' + tipo : '');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 4800);
  }

  /* Prefixos de id do kit: w = wrapper, m = mensagem.
     Permite marcar erro sem o chamador saber a estrutura do DOM. */
  function marcarErro(campo, msg) {
    const w = document.getElementById('w' + campo);
    if (!w) return;
    w.classList.toggle('err', !!msg);
    const m = document.getElementById('m' + campo);
    if (m) m.textContent = msg || '';
  }

  function limparErros(raiz) {
    (raiz || document).querySelectorAll('.err').forEach(function (el) {
      el.classList.remove('err');
    });
    (raiz || document).querySelectorAll('.msg').forEach(function (el) {
      el.textContent = '';
    });
  }

  function focarCampo(campo) {
    const w = document.getElementById('w' + campo);
    if (!w) return;
    const el = w.querySelector('input,select,textarea,button');
    if (el) {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
    w.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function ocupado(botao, ocupadoAgora, textoOcupado) {
    if (!botao) return;
    if (ocupadoAgora) {
      botao._txt = botao.innerHTML;
      botao.disabled = true;
      botao.innerHTML = '<span class="spin" style="border-top-color:currentColor"></span> ' +
        Util.esc(textoOcupado || 'Aguarde…');
    } else {
      botao.disabled = false;
      if (botao._txt) botao.innerHTML = botao._txt;
    }
  }

  function carregando(el, texto) {
    if (!el) return;
    el.innerHTML = '<div class="carregando"><span class="spin"></span>' +
      Util.esc(texto || 'Carregando…') + '</div>';
  }

  function vazio(el, texto) {
    if (!el) return;
    el.innerHTML = '<div class="empty-state">' + Util.esc(texto) + '</div>';
  }

  /* --------------------------------------------------------------------
     Tradução de erro para linguagem de gente.

     Duas regras que valem mais que a lista:
     1. Credencial errada recebe mensagem GENÉRICA — dizer "este e-mail não
        existe" entrega ao atacante quais e-mails são válidos.
     2. Erro de INSTALAÇÃO recebe mensagem ESPECÍFICA. Esconder que faltou
        rodar o SQL ou preencher o config.js só faz perder horas.
     -------------------------------------------------------------------- */
  function mensagemErro(e) {
    if (!e) return 'Não foi possível concluir. Tente de novo.';
    const msg = String(e.message || e.error_description || e || '');
    const cod = String(e.code || '');

    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
    }
    if (/Invalid login credentials/i.test(msg)) {
      return 'E-mail ou senha incorretos.';
    }
    if (/Email not confirmed/i.test(msg)) {
      return 'Este acesso ainda não foi confirmado. Peça ao administrador para liberar.';
    }
    if (/JWT|token|session/i.test(msg) && /expired|invalid/i.test(msg)) {
      return 'Sua sessão expirou. Entre de novo.';
    }
    if (cod === '23505' || /duplicate key|unique constraint/i.test(msg)) {
      return 'Este valor já está em uso. Escolha outro.';
    }
    if (cod === '42501' || /row-level security|permission denied/i.test(msg)) {
      return 'Você não tem permissão para esta ação.';
    }
    // Erros que a gente mesmo levantou no banco chegam com texto pronto.
    if (/^[A-ZÀ-Ú].*[.!?]$/.test(msg) && msg.length < 220) return msg;

    if (/relation .* does not exist|schema cache/i.test(msg)) {
      return 'Instalação incompleta: o esquema do banco não foi criado. ' +
        'Rode supabase/schema.sql no SQL Editor.';
    }
    return msg || 'Não foi possível concluir. Tente de novo.';
  }

  function erro(e) {
    const m = mensagemErro(e);
    toast(m, 'error');
    if (e) console.error('[erro]', e);
    return m;
  }

  /* --------------------------------------------------------------------
     Modal genérico. Devolve Promise<boolean>.
     -------------------------------------------------------------------- */
  function modal(opcoes) {
    return new Promise(function (resolve) {
      const o = opcoes || {};
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML =
        '<div class="modal-card">' +
          '<div class="modal-head"><h3>' + Util.esc(o.titulo || '') + '</h3>' +
            '<button class="x" type="button" aria-label="Fechar">&times;</button></div>' +
          '<div class="modal-body">' + (o.html || '') + '</div>' +
          '<div class="modal-foot">' +
            (o.semCancelar ? '' :
              '<button class="btn btn-outline" data-acao="nao">' +
              Util.esc(o.textoCancelar || 'Cancelar') + '</button>') +
            '<button class="btn ' + (o.classeOk || 'btn-red') + '" data-acao="sim">' +
              Util.esc(o.textoOk || 'Confirmar') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);

      function fechar(valor) {
        wrap.remove();
        document.removeEventListener('keydown', aoTeclar);
        resolve(valor);
      }
      function aoTeclar(ev) { if (ev.key === 'Escape') fechar(false); }

      wrap.querySelector('.x').onclick = function () { fechar(false); };
      const nao = wrap.querySelector('[data-acao="nao"]');
      if (nao) nao.onclick = function () { fechar(false); };
      wrap.querySelector('[data-acao="sim"]').onclick = function () {
        if (o.aoConfirmar && o.aoConfirmar(wrap) === false) return;
        fechar(true);
      };
      wrap.onclick = function (ev) { if (ev.target === wrap) fechar(false); };
      document.addEventListener('keydown', aoTeclar);

      const primeiro = wrap.querySelector('.modal-body input,.modal-body select,.modal-body textarea');
      if (primeiro) primeiro.focus();
    });
  }

  function confirmar(titulo, texto, textoOk, classeOk) {
    return modal({
      titulo: titulo,
      html: '<p style="font-size:14.5px;line-height:1.6">' + Util.esc(texto) + '</p>',
      textoOk: textoOk || 'Confirmar',
      classeOk: classeOk || 'btn-red'
    });
  }

  return {
    toast: toast, erro: erro, mensagemErro: mensagemErro,
    marcarErro: marcarErro, limparErros: limparErros, focarCampo: focarCampo,
    ocupado: ocupado, carregando: carregando, vazio: vazio,
    modal: modal, confirmar: confirmar
  };
})();
