/* ==========================================================================
   documento.js — normaliza o relatório para impressão
   --------------------------------------------------------------------------
   PDF e DOCX consomem ESTA estrutura, não o relatório cru. Assim os dois
   documentos não podem divergir: se um mostra a resposta e o outro não, é
   porque alguém montou o conteúdo duas vezes. Aqui é uma vez só.
   ========================================================================== */

window.Documento = (function () {
  'use strict';

  const ROTULO_LAUDO = { aprovado: 'APROVADO', nao_conforme: 'NÃO CONFORME' };

  /* Rótulo curto para a caixinha do checklist. Escrito por extenso,
     'NÃO SE APLICA' quebra a linha na coluna das opções e desalinha as três
     caixas de todas as perguntas da seção. */
  const ROTULO_CURTO = { 'NÃO SE APLICA': 'N/A' };

  /* Monta tudo, inclusive baixando as imagens do bucket privado.
     `aoProgresso(feito, total)` deixa a tela avisar em relatório com 30 fotos,
     que demora o suficiente para o usuário achar que travou. */
  async function montar(relatorio, schema, aoProgresso) {
    const enc = schema.encerramento || {};

    /* O número mora em COLUNA PRÓPRIA, não dentro de `dados` — a tela o retira
       de propósito antes de gravar, para não haver duas verdades. Quem monta o
       documento tem que devolvê-lo ao lugar, senão a linha "Relatório nº" sai
       com um travessão num laudo que tem número. */
    const valores = Object.assign({}, relatorio.dados);
    RenderForm.todosCampos(schema).forEach(function (campo) {
      if (campo.sistema === 'numero' && relatorio.numero) valores[campo.id] = relatorio.numero;
    });

    const doc = {
      titulo: schema.nome || 'Relatório de Inspeção',
      sigla: schema.sigla || '',
      docRef: schema.docRef || '',
      docRevisao: schema.docRevisao || '',
      schemaVersao: relatorio.schemaVersao || schema.versao || '',
      numero: relatorio.numero || '(rascunho)',
      status: relatorio.status,
      revisao: relatorio.revisao || 0,
      motivoRevisao: relatorio.motivoRevisao || '',
      laudo: relatorio.laudo || null,
      laudoRotulo: ROTULO_LAUDO[relatorio.laudo] || '—',
      tituloLaudo: enc.titulo || 'Laudo',
      inspetorNome: relatorio.inspetorNome || (Auth.perfil ? Auth.perfil.nome : ''),
      emitidoEm: relatorio.concluidoEm,
      dataInspecao: enc.campoData ? (valores[enc.campoData.id] || '') : '',
      rotuloData: enc.campoData ? enc.campoData.label : 'Data da inspeção',
      observacoes: enc.campoObs ? (valores[enc.campoObs.id] || '') : '',
      rotuloObs: enc.campoObs ? enc.campoObs.label : 'OBS',
      secoes: [],
      fotos: [],
      assinatura: null
    };

    /* ---- Seções ---- */
    RenderForm.secoesAtivas(schema).forEach(function (secao) {
      const bloco = { titulo: secao.titulo, linhas: [], perguntas: [], temFoto: false };

      secao.campos.forEach(function (campo) {
        if (campo.tipo === 'foto') { bloco.temFoto = true; return; }

        // Campo oculto por condição não sai no documento: ele não faz parte
        // do que foi inspecionado.
        if (!RenderForm.visivel(campo, valores)) return;

        if (RenderForm.ehPergunta(campo)) {
          const resp = valores[campo.id] || '';
          /* O documento imprime o CHECKLIST INTEIRO, não só a resposta: quem
             confere a via impressa vê quais eram as alternativas e qual foi
             marcada — é o mesmo que o formulário controlado em papel mostra. */
          const opcoes = campo.opcoes || RenderForm.OPCOES_FIXAS[campo.tipo] || [];
          bloco.perguntas.push({
            label: campo.label,
            resposta: resp || '—',
            opcoes: opcoes.map(function (op) {
              return {
                rotulo: ROTULO_CURTO[op] || op,
                marcada: resp === op,
                alerta: !!(campo.alertaSe && op === campo.alertaSe)
              };
            }),
            observacao: valores[RenderForm.idObs(campo.id)] || '',
            alerta: !!(campo.alertaSe && resp === campo.alertaSe)
          });
        } else {
          bloco.linhas.push([campo.label, formatar(campo, valores[campo.id])]);
        }
      });

      if (bloco.linhas.length || bloco.perguntas.length) doc.secoes.push(bloco);
    });

    /* ---- Fotos ---- */
    const registros = await DB.listarFotos(relatorio.id);
    if (registros.length) {
      const mapa = await Storage.urlsFotos(registros.map(function (r) { return r.path; }));
      let feito = 0;

      for (let i = 0; i < registros.length; i++) {
        const r = registros[i];
        const url = mapa[r.path];
        if (!url) { feito++; continue; }
        try {
          const dataUrl = await Storage.comoDataURL(url);
          const dim = await Storage.dimensoes(dataUrl);
          doc.fotos.push({
            dataUrl: dataUrl,
            largura: dim.largura, altura: dim.altura,
            legenda: r.legenda || '',
            campoId: r.campo_id
          });
        } catch (e) {
          // Uma foto ilegível não pode impedir a emissão do laudo inteiro.
          console.warn('[documento] foto ignorada:', r.path, e);
        }
        feito++;
        if (aoProgresso) aoProgresso(feito, registros.length);
      }
    }

    /* ---- Assinatura ---- */
    // Do SNAPSHOT quando o laudo já foi emitido: é a assinatura que valia na
    // hora da emissão. Do perfil só na pré-visualização de rascunho.
    const caminho = relatorio.assinaturaPath ||
      (relatorio.status !== 'concluido' && Auth.perfil ? Auth.perfil.assinatura_path : null);

    if (caminho) {
      try {
        if (relatorio.status === 'concluido') {
          await DB.registrarAcessoAssinatura(relatorio.id);
        }
        const url = await Storage.urlAssinatura(caminho);
        const dataUrl = await Storage.comoDataURL(url);
        const dim = await Storage.dimensoes(dataUrl);
        doc.assinatura = { dataUrl: dataUrl, largura: dim.largura, altura: dim.altura };
      } catch (e) {
        console.warn('[documento] assinatura indisponível:', e);
      }
    }

    return doc;
  }

  function formatar(campo, valor) {
    if (valor == null || valor === '') return '—';
    if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '—';
    if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
    if (campo.tipo === 'data') return Util.fmtData(valor);
    if (campo.tipo === 'numero' && campo.unidade) return valor + ' ' + campo.unidade;
    return String(valor);
  }

  /* O número emitido JÁ COMEÇA pela sigla ('RIV-001-26'), porque o prefixo do
     tipo é a própria sigla do formulário. Prefixar de novo dava "RIV RIV-001-26"
     no arquivo baixado. A sigla só entra quando o número ainda não a traz —
     no rascunho, que não tem número, e num tipo cujo prefixo seja outro. */
  function nomeArquivo(doc, extensao) {
    const numero = (doc.numero && doc.numero !== '(rascunho)') ? String(doc.numero).trim() : '';
    const sigla = String(doc.sigla || '').trim();
    let base;

    if (!numero) {
      base = (sigla ? sigla + ' ' : '') + 'RASCUNHO';
    } else if (sigla && Util.chave(numero).indexOf(Util.chave(sigla)) !== 0) {
      base = sigla + ' ' + numero;
    } else {
      base = numero;
    }
    return Util.nomeArquivoSeguro(base) + '.' + extensao;
  }

  return { montar: montar, nomeArquivo: nomeArquivo, ROTULO_LAUDO: ROTULO_LAUDO };
})();
