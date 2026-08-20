/* ==========================================================================
   validate.js — validação a partir do schema
   --------------------------------------------------------------------------
   Regra 6 de UX do kit: valide TUDO de uma vez, marque todos os campos com
   erro, foque o primeiro e mostre um toast só. Nunca uma cascata de alert().

   Isto é validação de INTERFACE. As invariantes que não podem ser burladas
   (laudo assinado, imutabilidade, número duplicado) estão no banco.
   ========================================================================== */

window.Validate = (function () {
  'use strict';

  function vazio(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'boolean') return v === false;
    return String(v).trim() === '';
  }

  /* Devolve { ok, erros: [{campo, msg}], primeiro } */
  function validar(schema, valores, contexto) {
    const ctx = contexto || {};
    const erros = [];
    const falha = function (campo, msg) { erros.push({ campo: campo, msg: msg }); };

    RenderForm.todosCampos(schema).forEach(function (campo) {
      // Campo escondido por exibirSe não é cobrado: cobrar o que não está
      // na tela deixa o inspetor preso num erro que ele não consegue ver.
      if (!RenderForm.visivel(campo, valores)) return;

      const v = valores[campo.id];

      if (campo.tipo === 'foto') {
        const qtd = (CampoFoto.obter(campo.id) || []).length;
        if (campo.obrigatorio && qtd === 0) {
          falha(campo.id, 'Anexe pelo menos uma foto.');
        }
        return;
      }

      if (campo.obrigatorio && vazio(v)) {
        falha(campo.id, mensagemFalta(campo));
        return;
      }
      if (vazio(v)) return;

      if (campo.tipo === 'numero') {
        const n = Number(String(v).replace(',', '.'));
        if (isNaN(n)) {
          falha(campo.id, 'Escreva um número.');
        } else {
          if (campo.min != null && n < campo.min) falha(campo.id, 'Mínimo: ' + campo.min + '.');
          if (campo.max != null && n > campo.max) falha(campo.id, 'Máximo: ' + campo.max + '.');
        }
      }

      if (campo.tipo === 'data' && campo.naoFuturo && String(v) > Util.hojeISO()) {
        falha(campo.id, 'A data não pode ser no futuro.');
      }

      // Observação obrigatória quando a resposta é a de alerta.
      if (campo.observacaoSeAlerta && campo.alertaSe && v === campo.alertaSe) {
        const idObs = RenderForm.idObs(campo.id);
        if (vazio(valores[idObs])) {
          falha(idObs, 'Descreva o que foi encontrado.');
        }
      }

      if (campo.sistema === 'numero' && ctx.mascara) {
        if (!new RegExp(ctx.mascara).test(String(v).trim().toUpperCase())) {
          falha(campo.id, 'Use o formato ' + (ctx.exemploNumero || 'RIV-000-26') + '.');
        }
      }
    });

    /* ---- Encerramento ---- */
    const enc = schema.encerramento || {};

    if (ctx.exigirLaudo) {
      if (!ctx.laudo) falha('__laudo', 'Escolha APROVADO ou NÃO CONFORME.');

      if (enc.campoData && enc.campoData.obrigatorio && vazio(valores[enc.campoData.id])) {
        falha(enc.campoData.id, 'Informe a data da inspeção.');
      }
      if (enc.campoData && enc.campoData.naoFuturo &&
          valores[enc.campoData.id] && String(valores[enc.campoData.id]) > Util.hojeISO()) {
        falha(enc.campoData.id, 'A data não pode ser no futuro.');
      }
      if (enc.campoObs) {
        const obrig = enc.campoObs.obrigatorio ||
          (enc.campoObs.obrigatorioSeNaoConforme && ctx.laudo === 'nao_conforme');
        if (obrig && vazio(valores[enc.campoObs.id])) {
          falha(enc.campoObs.id, 'Descreva a não conformidade.');
        }
      }
    }

    return {
      ok: erros.length === 0,
      erros: erros,
      primeiro: erros.length ? erros[0].campo : null
    };
  }

  function mensagemFalta(campo) {
    if (RenderForm.ehPergunta(campo)) return 'Responda esta pergunta.';
    switch (campo.tipo) {
      case 'data': return 'Informe a data.';
      case 'numero': return 'Informe a quantidade.';
      case 'selecao':
      case 'opcao_unica':
      case 'opcao_multipla': return 'Escolha uma opção.';
      default: return 'Preencha este campo.';
    }
  }

  /* Marca na tela, foca o primeiro e avisa uma vez só. */
  function aplicar(resultado) {
    UI.limparErros(document.getElementById('formulario') || document);

    resultado.erros.forEach(function (e) {
      UI.marcarErro(e.campo, e.msg);
      const w = document.getElementById('w' + e.campo);
      if (w) w.classList.add('err');
    });

    if (!resultado.ok) {
      UI.focarCampo(resultado.primeiro);
      const n = resultado.erros.length;
      UI.toast(n === 1
        ? 'Falta preencher 1 campo. Veja em vermelho.'
        : 'Faltam ' + n + ' campos. Veja em vermelho.', 'error');
    }
    return resultado.ok;
  }

  return { validar: validar, aplicar: aplicar, vazio: vazio };
})();
