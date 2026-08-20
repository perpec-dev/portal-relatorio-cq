/* ==========================================================================
   util.js — utilitários sem dependência de nada
   ========================================================================== */

window.Util = (function () {
  'use strict';

  /* XSS: tudo que vem do usuário passa por aqui antes de virar innerHTML.
     Sem exceção — inclusive nome de inspetor e legenda de foto, que parecem
     inofensivos e são exatamente por onde se entra. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  /* Comparação tolerante a acento, caixa e espaço. */
  function chave(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const p2 = function (n) { return String(n).padStart(2, '0'); };

  function hojeISO() {
    const d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  /* Data pura (AAAA-MM-DD) formatada sem passar por new Date():
     new Date('2026-08-19') é interpretado como UTC e, a oeste de Greenwich,
     volta um dia. O relatório mostraria 18/08 para uma inspeção do dia 19. */
  function fmtData(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '—';
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function fmtDT(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function param(nome) {
    return new URLSearchParams(location.search).get(nome);
  }

  function baixarBlob(nomeArquivo, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Sem o revoke, cada download deixa o arquivo inteiro preso na memória.
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* Nome de arquivo seguro em Windows e SharePoint: barra, dois-pontos e
     asterisco quebram o upload, e o inspetor descobre só na hora de arquivar. */
  function nomeArquivoSeguro(s) {
    return String(s || 'documento').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  }

  return {
    esc: esc, uid: uid, chave: chave, p2: p2,
    hojeISO: hojeISO, fmtData: fmtData, fmtDT: fmtDT,
    debounce: debounce, param: param,
    baixarBlob: baixarBlob, nomeArquivoSeguro: nomeArquivoSeguro
  };
})();
