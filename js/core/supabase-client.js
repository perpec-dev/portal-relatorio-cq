/* ==========================================================================
   supabase-client.js — cliente único do Supabase
   --------------------------------------------------------------------------
   Nenhuma página fala com o Supabase direto. Tudo passa por db.js, auth.js ou
   storage.js. Assim fica visível no código o que sai da máquina.
   ========================================================================== */

window.SB = (function () {
  'use strict';

  const CFG = window.SUPABASE_CONFIG || {};

  /* A biblioteca acrescenta /rest/v1 sozinha. Se a URL vier com esse sufixo
     colado do painel, todas as chamadas dão 404 — e o erro não diz por quê. */
  function urlBase(u) {
    return String(u || '').trim()
      .replace(/\/+$/, '')
      .replace(/\/(rest|auth|storage|realtime)\/v1$/i, '')
      .replace(/\/+$/, '');
  }

  const url = urlBase(CFG.URL);
  const chave = String(CFG.ANON_KEY || '').trim();

  const configurado =
    !!url && !!chave &&
    !/SEU-PROJETO/i.test(url) &&
    !/COLE-AQUI/i.test(chave);

  let cliente = null;

  if (configurado) {
    if (!window.supabase || !window.supabase.createClient) {
      console.error('[SB] A biblioteca supabase-js não carregou. Confira a ordem dos <script>.');
    } else {
      cliente = window.supabase.createClient(url, chave, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    }
  }

  /* Erro de instalação é mostrado, não escondido: sem isso, o usuário vê uma
     tela de login que simplesmente não responde e ninguém sabe o motivo. */
  function exigirCliente() {
    if (!cliente) {
      throw new Error(
        'Instalação incompleta: preencha a URL e a chave anon em js/config.js.'
      );
    }
    return cliente;
  }

  return {
    get cliente() { return cliente; },
    get configurado() { return configurado; },
    exigirCliente: exigirCliente
  };
})();
