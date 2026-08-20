/* ==========================================================================
   auth.js — sessão e perfil
   --------------------------------------------------------------------------
   O PAPEL DO USUÁRIO VEM DA TABELA public.perfis, nunca do JWT.
   O user_metadata do token é editável pelo próprio usuário (updateUser), e
   confiar nele para decidir quem é admin entregaria o papel de graça.
   Mesmo assim, o que vale de verdade é a RLS: isto aqui é só conforto de tela.
   ========================================================================== */

window.Auth = (function () {
  'use strict';

  let perfil = null;

  async function entrar(email, senha) {
    const sb = SB.exigirCliente();
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: String(senha || '')
    });
    if (error) throw error;
    await carregarPerfil();
    if (!perfil) {
      // Usuário existe no Auth e não tem linha em perfis. É o problema de
      // instalação mais comum — ver o bloco DIAGNÓSTICO no schema.sql.
      await sb.auth.signOut();
      throw new Error('Seu acesso existe, mas o perfil não foi criado. Procure o administrador.');
    }
    if (!perfil.ativo) {
      await sb.auth.signOut();
      throw new Error('Seu acesso está desativado. Procure o administrador.');
    }
    return data;
  }

  async function sair() {
    try { await SB.exigirCliente().auth.signOut(); } catch (e) { /* segue e limpa */ }
    perfil = null;
    limparCache();
    location.href = 'index.html';
  }

  /* Aparelho compartilhado não pode guardar dado de um inspetor para o
     próximo usuário. Regra 6 da camada de dados do kit. */
  function limparCache() {
    const p = (window.CONFIG && CONFIG.PREFIXO_CACHE) || 'perpec.riv.';
    const remover = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(p) === 0) remover.push(k);
    }
    remover.forEach(function (k) { localStorage.removeItem(k); });
  }

  async function sessao() {
    if (!SB.configurado) return null;
    const { data } = await SB.cliente.auth.getSession();
    return (data && data.session) || null;
  }

  async function carregarPerfil() {
    const s = await sessao();
    if (!s) { perfil = null; return null; }
    const { data, error } = await SB.cliente
      .from('perfis')
      .select('id,nome,papel,ativo,matricula,telefone,assinatura_path,' +
              'assinatura_atualizada_em,consentimento_em,consentimento_versao')
      .eq('id', s.user.id)
      .maybeSingle();
    if (error) throw error;
    perfil = data || null;
    if (perfil) perfil.email = s.user.email;
    return perfil;
  }

  async function garantirPerfil() {
    if (perfil) return perfil;
    return await carregarPerfil();
  }

  function precisaConsentir() {
    if (!perfil) return false;
    return !perfil.consentimento_em ||
           perfil.consentimento_versao !== CONFIG.TERMO_VERSAO;
  }

  async function registrarConsentimento() {
    const p = await garantirPerfil();
    if (!p) throw new Error('Sessão necessária.');
    const { error } = await SB.cliente.from('perfis').update({
      consentimento_em: new Date().toISOString(),
      consentimento_versao: CONFIG.TERMO_VERSAO
    }).eq('id', p.id);
    if (error) throw error;
    await carregarPerfil();
  }

  async function trocarSenha(novaSenha) {
    const { error } = await SB.exigirCliente().auth.updateUser({ password: novaSenha });
    if (error) throw error;
  }

  return {
    entrar: entrar, sair: sair, sessao: sessao,
    carregarPerfil: carregarPerfil, garantirPerfil: garantirPerfil,
    precisaConsentir: precisaConsentir, registrarConsentimento: registrarConsentimento,
    trocarSenha: trocarSenha, limparCache: limparCache,
    get perfil() { return perfil; },
    get admin() { return !!perfil && perfil.papel === 'admin' && perfil.ativo; }
  };
})();
