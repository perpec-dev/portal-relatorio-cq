/* ==========================================================================
   gerar-docx.js — biblioteca "docx" (UMD, via CDN)
   --------------------------------------------------------------------------
   jsPDF NÃO gera .docx. São dois geradores distintos consumindo a MESMA
   estrutura (js/core/documento.js), para que o conteúdo não possa divergir.

   O .docx sai editável de propósito: é o formato que vai para o SharePoint,
   onde alguém pode precisar acrescentar um parecer. A versão inalterável do
   laudo é o registro no banco, não o arquivo.

   Tipografia e checklist acompanham o PDF: Proxima Nova Alt Condensed Light e
   as caixinhas ☒/☐. O Word não embarca fonte — quem abrir o arquivo sem a
   Proxima instalada vê a substituta padrão. É por isso que o PDF, e não o
   .docx, é a via de arquivamento.
   ========================================================================== */

window.GerarDOCX = (function () {
  'use strict';

  const COR_DARK = '181615', COR_RED = 'C1272D', COR_GRAY = '8A857F';
  const COR_GRAFITE = '585450';
  const COR_GREEN = '1E6A3A', COR_BORDA = 'D6D1CB', COR_CAB = '181615';
  const COR_ZEBRA = 'F8F7F5';

  /* Mesma família do PDF. Quem receber o arquivo sem a fonte instalada vê a
     substituta do Word — o conteúdo não muda, só o acabamento. */
  const FONTE = 'Proxima Nova Alt Condensed Light';
  // A Proxima não tem ☒/☐. Sem uma fonte que tenha, o Word imprime tofu.
  const FONTE_SIMBOLO = 'Segoe UI Symbol';

  // Twips: 1 polegada = 1440. A4 útil com margens de 2 cm ≈ 9360.
  const LARGURA_TOTAL = 9360;

  /* Colunas: pergunta / caixinhas / observação. As linhas de rótulo-e-valor
     usam a mesma grade, com a coluna do valor ocupando as duas últimas —
     é o que permite uma faixa de título só por seção. */
  const C_ROTULO = 2900, C_OPCOES = 2100;

  function lib() {
    if (!window.docx) {
      throw new Error('A biblioteca docx não carregou. Confira a conexão e recarregue.');
    }
    return window.docx;
  }

  async function gerar(relatorio, schema) {
    const d = await Documento.montar(relatorio, schema, function (feito, total) {
      UI.toast('Preparando imagens… ' + feito + '/' + total);
    });
    const blob = await construir(d);
    Util.baixarBlob(Documento.nomeArquivo(d, 'docx'), blob);
    return d;
  }

  /* dataURL → base64 puro. A lib aceita base64 em string; o prefixo
     "data:image/jpeg;base64," faria o arquivo abrir com imagem quebrada. */
  function base64De(dataUrl) {
    const i = String(dataUrl || '').indexOf(',');
    return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  }

  function bordas(D) {
    const b = { style: D.BorderStyle.SINGLE, size: 4, color: COR_BORDA };
    return { top: b, bottom: b, left: b, right: b };
  }

  function trecho(D, conteudo, opcoes) {
    const o = opcoes || {};
    return new D.TextRun({
      text: String(conteudo == null ? '' : conteudo),
      bold: !!o.negrito, italics: !!o.italico,
      size: o.tamanho || 19,              // meio-pontos: 19 ≈ 9,5pt
      color: o.cor || COR_DARK,
      font: o.fonte || FONTE
    });
  }

  function paragrafo(D, filhos, opcoes) {
    const o = opcoes || {};
    return new D.Paragraph({
      alignment: o.alinhar || D.AlignmentType.LEFT,
      spacing: { before: o.antes || 0, after: o.depois == null ? 40 : o.depois },
      children: filhos
    });
  }

  function texto(D, conteudo, opcoes) {
    return paragrafo(D, [trecho(D, conteudo, opcoes)], opcoes);
  }

  function celula(D, filhos, opcoes) {
    const o = opcoes || {};
    return new D.TableCell({
      width: { size: o.largura || 0, type: D.WidthType.DXA },
      columnSpan: o.span || 1,
      shading: o.fundo ? { fill: o.fundo, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      verticalAlign: D.VerticalAlign.TOP,
      children: Array.isArray(filhos) ? filhos : [filhos]
    });
  }

  function tabela(D, linhas) {
    return new D.Table({
      width: { size: LARGURA_TOTAL, type: D.WidthType.DXA },
      borders: bordas(D), rows: linhas
    });
  }

  /* cantSplit: o Word não parte a linha no meio ao virar a página. Pergunta
     cortada entre duas folhas é a reclamação clássica de quem confere o
     documento impresso — e a linha inteira desce para a folha seguinte. */
  function linha(D, celulas) {
    return new D.TableRow({ children: celulas, cantSplit: true });
  }

  function faixaTitulo(D, titulo, colunas) {
    return new D.TableRow({
      children: [celula(D,
        texto(D, String(titulo).toUpperCase(), { negrito: true, cor: 'FAF8F7', tamanho: 17, depois: 0 }),
        { largura: LARGURA_TOTAL, span: colunas || 3, fundo: COR_CAB })]
    });
  }

  /* Checklist com as caixinhas, igual ao PDF: o documento mostra QUAIS eram
     as alternativas e qual foi marcada, não só a palavra da resposta. */
  function celulaOpcoes(D, p, fundo) {
    const opcoes = (p.opcoes && p.opcoes.length)
      ? p.opcoes
      : [{ rotulo: p.resposta, marcada: true, alerta: p.alerta }];

    const runs = [];
    opcoes.forEach(function (op, i) {
      const destaque = op.marcada && op.alerta;
      const cor = op.marcada ? (destaque ? COR_RED : COR_DARK) : COR_GRAY;
      if (i) runs.push(trecho(D, '  ', { tamanho: 17 }));
      runs.push(trecho(D, op.marcada ? '☒' : '☐',
        { cor: cor, tamanho: 19, fonte: FONTE_SIMBOLO }));
      runs.push(trecho(D, ' ' + op.rotulo, { cor: cor, tamanho: 17, negrito: true }));
    });

    return celula(D, paragrafo(D, runs, { alinhar: D.AlignmentType.CENTER, depois: 0 }),
      { largura: C_OPCOES, fundo: fundo });
  }

  /* Rodapé com numeração de página de VERDADE (campo do Word, não texto
     fixo): folha solta precisa dizer de qual documento saiu e quantas são.
     Se esta build da lib não expuser PageNumber, o rodapé sai sem o "Página
     X de Y" em vez de derrubar a geração inteira. */
  function rodape(D, d) {
    const runs = [trecho(D, CONFIG.EMPRESA + '  •  ' + d.docRef +
      (d.schemaVersao ? '  •  formulário ' + d.schemaVersao : '') +
      '  •  ' + d.numero, { cor: COR_GRAY, tamanho: 14 })];

    if (D.PageNumber && D.PageNumber.CURRENT) {
      runs.push(trecho(D, '  •  Página ', { cor: COR_GRAY, tamanho: 14 }));
      runs.push(new D.TextRun({
        children: [D.PageNumber.CURRENT], size: 14, color: COR_GRAY, font: FONTE
      }));
      runs.push(trecho(D, ' de ', { cor: COR_GRAY, tamanho: 14 }));
      runs.push(new D.TextRun({
        children: [D.PageNumber.TOTAL_PAGES], size: 14, color: COR_GRAY, font: FONTE
      }));
    }
    return paragrafo(D, runs, { alinhar: D.AlignmentType.CENTER, depois: 0 });
  }

  async function construir(d) {
    const D = lib();
    const filhos = [];

    /* ---------------- Cabeçalho ---------------- */
    if (window.LOGO_B64) {
      try {
        filhos.push(new D.Paragraph({
          spacing: { after: 60 },
          children: [new D.ImageRun({
            data: base64De(window.LOGO_B64),
            transformation: { width: 150, height: 40 }
          })]
        }));
      } catch (e) { /* documento segue sem logo */ }
    }

    filhos.push(texto(D, d.titulo.toUpperCase(), { negrito: true, tamanho: 26, depois: 20 }));
    filhos.push(texto(D, [
      d.numero,
      d.docRef ? 'Código ' + d.docRef : '',
      d.docRevisao ? 'Rev. ' + d.docRevisao : ''
    ].filter(Boolean).join('   •   '), { cor: COR_GRAY, tamanho: 16, depois: 40 }));

    // Filete vermelho fechando o cabeçalho — o mesmo detalhe do PDF.
    filhos.push(new D.Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 10, color: COR_RED, space: 1 } },
      children: []
    }));

    if (d.status !== 'concluido') {
      filhos.push(texto(D, 'RASCUNHO — SEM VALOR DE LAUDO',
        { negrito: true, cor: COR_RED, tamanho: 18, depois: 160 }));
    }

    /* ---------------- Seções ----------------
       UMA faixa por seção. Antes, uma seção com campos comuns e checklist
       gerava duas tabelas com o título repetido — e o leitor achava que era
       outra seção. Rótulo/valor ocupa as duas últimas colunas da mesma grade. */
    d.secoes.forEach(function (secao) {
      if (!secao.linhas.length && !secao.perguntas.length) return;
      const linhas = [faixaTitulo(D, secao.titulo, 3)];

      secao.linhas.forEach(function (par) {
        linhas.push(linha(D, [
          celula(D, texto(D, String(par[0]).toUpperCase(),
            { negrito: true, cor: COR_GRAY, tamanho: 16, depois: 0 }), { largura: C_ROTULO }),
          celula(D, texto(D, par[1], { depois: 0 }),
            { largura: LARGURA_TOTAL - C_ROTULO, span: 2 })
        ]));
      });

      secao.perguntas.forEach(function (p, i) {
        const fundo = i % 2 ? COR_ZEBRA : undefined;
        linhas.push(linha(D, [
          celula(D, texto(D, p.label, { depois: 0 }),
            { largura: C_ROTULO + 2000, fundo: fundo }),
          celulaOpcoes(D, p, fundo),
          // A observação de um achado é a descrição da não conformidade:
          // sai em tinta cheia, não em cinza de nota de rodapé.
          celula(D, texto(D, p.observacao || '',
            { cor: p.alerta ? COR_DARK : COR_GRAFITE, tamanho: 17, depois: 0 }),
            { largura: LARGURA_TOTAL - C_ROTULO - 2000 - C_OPCOES, fundo: fundo })
        ]));
      });

      filhos.push(tabela(D, linhas));
      filhos.push(texto(D, '', { depois: 120 }));
    });

    /* ---------------- Anexos ----------------
       Duas por linha numa tabela, proporção real preservada. Cresce sozinho
       conforme o número de fotos; o Word quebra a página. */
    if (d.fotos.length) {
      const LARGURA_FOTO = 210;   // pontos
      const linhas = [faixaTitulo(D, 'Anexos — ' + d.fotos.length + ' foto(s)', 2)];

      for (let i = 0; i < d.fotos.length; i += 2) {
        const par = d.fotos.slice(i, i + 2);
        const celulas = par.map(function (f, k) {
          const prop = (f.altura && f.largura) ? (f.altura / f.largura) : 0.75;
          const conteudo = [];
          try {
            conteudo.push(new D.Paragraph({
              alignment: D.AlignmentType.CENTER,
              spacing: { after: 40 },
              children: [new D.ImageRun({
                data: base64De(f.dataUrl),
                transformation: {
                  width: LARGURA_FOTO,
                  height: Math.round(LARGURA_FOTO * prop)
                }
              })]
            }));
          } catch (e) {
            conteudo.push(texto(D, '[imagem indisponível]', { cor: COR_GRAY, italico: true }));
          }
          conteudo.push(paragrafo(D, [
            trecho(D, 'FOTO ' + Util.p2(i + k + 1), { negrito: true, tamanho: 15 }),
            trecho(D, f.legenda ? '  ' + f.legenda : '', { cor: COR_GRAY, tamanho: 15 })
          ], { alinhar: D.AlignmentType.CENTER, depois: 0 }));
          return celula(D, conteudo, { largura: LARGURA_TOTAL / 2 });
        });

        // Linha ímpar: célula vazia para a tabela não desalinhar.
        if (celulas.length === 1) {
          celulas.push(celula(D, texto(D, '', { depois: 0 }), { largura: LARGURA_TOTAL / 2 }));
        }
        linhas.push(linha(D, celulas));
      }

      filhos.push(tabela(D, linhas));
      filhos.push(texto(D, '', { depois: 140 }));
    }

    /* ---------------- Laudo ---------------- */
    const corLaudo = d.laudo === 'aprovado' ? COR_GREEN : (d.laudo ? COR_RED : COR_GRAY);
    filhos.push(tabela(D, [
      faixaTitulo(D, d.tituloLaudo || 'Laudo', 2),
      linha(D, [celula(D, texto(D, d.laudoRotulo, {
        negrito: true, tamanho: 30, cor: corLaudo,
        alinhar: D.AlignmentType.CENTER, depois: 0
      }), { largura: LARGURA_TOTAL, span: 2 })]),
      linha(D, [
        celula(D, texto(D, String(d.rotuloObs).toUpperCase(),
          { negrito: true, cor: COR_GRAY, tamanho: 16, depois: 0 }), { largura: 1400 }),
        celula(D, texto(D, d.observacoes || '—', { depois: 0 }),
          { largura: LARGURA_TOTAL - 1400 })
      ])
    ]));
    filhos.push(texto(D, '', { depois: 220 }));

    /* ---------------- Assinatura ---------------- */
    const celulaAssinatura = [];
    if (d.assinatura) {
      const prop = (d.assinatura.altura && d.assinatura.largura)
        ? (d.assinatura.altura / d.assinatura.largura) : 0.35;
      const largura = 150;
      try {
        celulaAssinatura.push(new D.Paragraph({
          alignment: D.AlignmentType.CENTER,
          spacing: { after: 0 },
          children: [new D.ImageRun({
            data: base64De(d.assinatura.dataUrl),
            transformation: { width: largura, height: Math.round(largura * prop) }
          })]
        }));
      } catch (e) { /* linha e nome continuam */ }
    }
    celulaAssinatura.push(texto(D, '__________________________________',
      { alinhar: D.AlignmentType.CENTER, cor: COR_DARK, depois: 20 }));
    celulaAssinatura.push(texto(D, d.inspetorNome || '—',
      { negrito: true, alinhar: D.AlignmentType.CENTER, depois: 10 }));
    celulaAssinatura.push(texto(D, 'Assinatura do inspetor',
      { cor: COR_GRAY, tamanho: 15, alinhar: D.AlignmentType.CENTER, depois: 0 }));

    filhos.push(new D.Table({
      width: { size: LARGURA_TOTAL, type: D.WidthType.DXA },
      borders: {
        top: { style: D.BorderStyle.NONE }, bottom: { style: D.BorderStyle.NONE },
        left: { style: D.BorderStyle.NONE }, right: { style: D.BorderStyle.NONE },
        insideHorizontal: { style: D.BorderStyle.NONE },
        insideVertical: { style: D.BorderStyle.NONE }
      },
      rows: [linha(D, [
          celula(D, celulaAssinatura, { largura: LARGURA_TOTAL / 2 }),
          celula(D, [
            texto(D, '__________________________________',
              { alinhar: D.AlignmentType.CENTER, depois: 20 }),
            texto(D, Util.fmtData(d.dataInspecao),
              { negrito: true, alinhar: D.AlignmentType.CENTER, depois: 10 }),
            texto(D, d.rotuloData,
              { cor: COR_GRAY, tamanho: 15, alinhar: D.AlignmentType.CENTER, depois: 0 })
          ], { largura: LARGURA_TOTAL / 2 })
      ])]
    }));

    if (d.revisao > 0) {
      filhos.push(texto(D, 'Revisão ' + d.revisao + ' — motivo: ' + (d.motivoRevisao || '—'),
        { italico: true, cor: COR_GRAY, tamanho: 16, antes: 200 }));
    }

    /* ---------------- Documento ---------------- */
    const doc = new D.Document({
      creator: CONFIG.EMPRESA,
      title: d.titulo + ' ' + d.numero,
      description: 'Emitido por ' + (d.inspetorNome || '—'),
      sections: [{
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: { default: new D.Footer({ children: [rodape(D, d)] }) },
        children: filhos
      }]
    });

    return await D.Packer.toBlob(doc);
  }

  return { gerar: gerar };
})();
