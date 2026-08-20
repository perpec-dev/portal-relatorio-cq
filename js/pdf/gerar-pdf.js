/* ==========================================================================
   gerar-pdf.js — jsPDF, desenho manual
   --------------------------------------------------------------------------
   Documento formal de inspeção. Duas decisões explicam o resto do arquivo:

   1) SEM autoTable. O plugin quebra linha onde a página acaba, e o resultado
      é pergunta cortada ao meio entre a folha 1 e a 2. Aqui cada bloco é
      MEDIDO antes de ser pintado: se não couber inteiro no que sobrou da
      página, ele começa na próxima. Faixa de seção nunca fica órfã no pé da
      folha, e tabela que continua na página seguinte repete o título com
      "(continuação)".

   2) O checklist sai com as CAIXINHAS, não com a palavra. Quem confere a via
      impressa vê quais eram as alternativas e qual foi marcada — é o que o
      formulário controlado em papel mostra.

   3) TUDO EM TINTA CHEIA. Nada de texto cinza: o documento é conferido
      impresso, às vezes numa cópia de cópia, e cinza claro simplesmente some.
      A hierarquia vem de tamanho, peso e caixa alta. Vermelho só onde tem que
      puxar o olho (achado, laudo não conforme, carimbo de rascunho) e verde no
      APROVADO. Nada de tarja decorativa.
   ========================================================================== */

window.GerarPDF = (function () {
  'use strict';

  /* ---------------- Geometria (mm) ---------------- */
  const W = 210, H = 297;
  const ML = 15, MR = 15, CW = W - ML - MR;   // 180 de área útil
  const TOPO = 28;                            // 1ª linha abaixo do cabeçalho
  const BASE = 281;                           // última linha acima do rodapé

  const ALT_FAIXA = 7.2;                      // altura da faixa de seção
  const LINHA = 4.3;                          // entrelinha do corpo
  const PAD = 4;                              // respiro vertical da célula

  /* Colunas da tabela de identificação e da tabela de checklist. */
  const C_ROTULO = 52;
  const C_PERGUNTA = 84, C_OPCOES = 44;

  /* ---------------- Paleta ----------------
     TEXTO CINZA NÃO EXISTE NESTE DOCUMENTO. Cinza claro é confortável na tela
     e some na impressão a laser — e este relatório é conferido no papel, em
     galpão, muitas vezes numa cópia de cópia. Toda letra sai em tinta cheia; a
     hierarquia vem de tamanho, peso e caixa alta, nunca de desbotar.

     Sobra em cinza só o que NÃO é texto: o fio da grade e a zebra das linhas. */
  const TINTA   = [24, 22, 21];
  const GRADE   = [112, 107, 102];   // fio da tabela: escuro o bastante para imprimir
  const ZEBRA   = [242, 240, 237];
  const PAPEL   = [255, 255, 255];
  const VERMELHO= [193, 39, 45];
  const VERDE   = [30, 106, 58];

  /* ------------------------------------------------------------------
     Fonte
     ------------------------------------------------------------------
     Proxima Nova Alt Condensed Light no corpo, Extra Condensed Bold nos
     rótulos. Vem de js/pdf/fontes.js, carregado SOB DEMANDA: quem só navega
     pelo portal não baixa 76 KB de fonte à toa.

     Se o arquivo não carregar, o PDF sai em Helvetica. Fonte é acabamento;
     laudo é obrigação. Uma nunca pode impedir a outra.
     ------------------------------------------------------------------ */
  let promessaFontes = null;

  function arquivoFontes() {
    if (window.FONTES_PDF) return Promise.resolve(window.FONTES_PDF);
    if (promessaFontes) return promessaFontes;

    promessaFontes = new Promise(function (resolver) {
      const s = document.createElement('script');
      s.src = (CONFIG.PASTA_PDF || 'js/pdf/') + 'fontes.js';
      s.onload = function () { resolver(window.FONTES_PDF || null); };
      s.onerror = function () {
        console.warn('[pdf] fontes.js não carregou; o documento sai em Helvetica.');
        resolver(null);
      };
      document.head.appendChild(s);
    });
    return promessaFontes;
  }

  function registrar(pdf, fontes) {
    if (!fontes || !fontes.faces) return 'helvetica';
    try {
      fontes.faces.forEach(function (f) {
        pdf.addFileToVFS(f.arquivo, f.b64);
        pdf.addFont(f.arquivo, fontes.familia, f.estilo);
        /* Sonda: mede um texto acentuado agora, ainda dentro do try. Uma face
           corrompida estoura AQUI, e não no meio do desenho — quando já seria
           tarde para trocar por Helvetica e o inspetor ficaria sem o PDF. */
        pdf.setFont(fontes.familia, f.estilo);
        pdf.getTextWidth('Inspeção');
      });
      return fontes.familia;
    } catch (e) {
      console.warn('[pdf] fonte recusada pelo jsPDF; segue em Helvetica:', e);
      return 'helvetica';
    }
  }

  /* ------------------------------------------------------------------ */
  async function gerar(relatorio, schema) {
    const doc = await Documento.montar(relatorio, schema, function (feito, total) {
      UI.toast('Preparando imagens… ' + feito + '/' + total);
    });
    const fontes = await arquivoFontes();
    const blob = desenhar(doc, fontes);
    Util.baixarBlob(Documento.nomeArquivo(doc, 'pdf'), blob);
    return doc;
  }

  /* ================================================================== */
  function desenhar(d, fontes) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const FAM = registrar(pdf, fontes);

    const setC = function (c) { pdf.setTextColor(c[0], c[1], c[2]); };
    const setD = function (c) { pdf.setDrawColor(c[0], c[1], c[2]); };
    const setF = function (c) { pdf.setFillColor(c[0], c[1], c[2]); };
    const fonte = function (estilo, tamanho) {
      pdf.setFont(FAM, estilo);
      pdf.setFontSize(tamanho);
    };

    const rascunho = d.status !== 'concluido';
    let y = TOPO;

    /* ---------------- Cabeçalho ---------------- */
    function cabecalho() {
      const logo = window.LOGO_B64 || '';
      if (logo) {
        // try/catch porque logo corrompida derruba o addImage e, com ele, o
        // documento inteiro. Melhor um PDF sem logo do que nenhum PDF.
        try { pdf.addImage(logo, 'PNG', ML, 6.4, 36, 9.7); } catch (e) { /* segue sem logo */ }
      }

      fonte('bold', 12.5); setC(TINTA);
      pdf.text(String(d.titulo).toUpperCase(), W - MR, 11.6, { align: 'right' });

      fonte('normal', 8.4); setC(TINTA);
      pdf.text([
        d.numero,
        d.docRef ? 'Código ' + d.docRef : '',
        d.docRevisao ? 'Rev. ' + d.docRevisao : ''
      ].filter(Boolean).join('   •   '), W - MR, 16.4, { align: 'right' });

      // Filete preto de ponta a ponta com o naco vermelho por cima, à
      // esquerda. É o único enfeite fixo do documento.
      setD(TINTA); pdf.setLineWidth(0.4);
      pdf.line(ML, 20.4, W - MR, 20.4);
      setF(VERMELHO); pdf.rect(ML, 19.7, 26, 1.4, 'F');

      if (rascunho) carimboRascunho();
    }

    /* Carimbo em TODA página: folha solta de rascunho não pode ser confundida
       com laudo emitido em cima de uma mesa de inspeção. */
    function carimboRascunho() {
      const texto = 'RASCUNHO — SEM VALOR DE LAUDO';
      fonte('bold', 8);
      const largura = pdf.getTextWidth(texto) + 6.4;
      const x = W - MR - largura;
      setD(VERMELHO); pdf.setLineWidth(0.4);
      pdf.rect(x, 22.1, largura, 5.3);
      setC(VERMELHO);
      pdf.text(texto, x + 3.2, 25.7);
    }

    function rodape(pagina, total) {
      setD(GRADE); pdf.setLineWidth(0.2);
      pdf.line(ML, 284.4, W - MR, 284.4);

      fonte('normal', 7.4); setC(TINTA);
      pdf.text(CONFIG.EMPRESA + '  •  ' + d.docRef +
        (d.schemaVersao ? '  •  formulário ' + d.schemaVersao : ''), ML, 288.6);
      pdf.text(d.numero, W / 2, 288.6, { align: 'center' });
      pdf.text('Página ' + pagina + ' de ' + total, W - MR, 288.6, { align: 'right' });
    }

    function novaPagina() {
      pdf.addPage();
      cabecalho();
      y = TOPO;
    }

    /* Reserva vertical: o bloco só começa aqui se couber inteiro. */
    function garantir(altura) {
      if (y + altura > BASE) novaPagina();
    }

    /* ---------------- Faixa de seção ---------------- */
    function faixa(titulo, continuacao) {
      setF(TINTA); pdf.rect(ML, y, CW, ALT_FAIXA, 'F');
      setF(VERMELHO); pdf.rect(ML, y, 1.8, ALT_FAIXA, 'F');

      fonte('bold', 8.4); setC([250, 248, 247]);
      pdf.text(String(titulo).toUpperCase() + (continuacao ? '  (continuação)' : ''),
        ML + 4.4, y + 4.9, { charSpace: 0.22 });
      y += ALT_FAIXA;
    }

    /* ---------------- Motor de tabela ----------------
       `linhas` é uma lista de { altura, pintar(y) } já medida. Aqui só se
       decide ONDE cada uma cai. A faixa só é desenhada quando a primeira
       linha do trecho couber junto — é isso que impede título órfão. */
    function imprimirTabela(titulo, linhas) {
      if (!linhas.length) return;
      let aberta = false, continuacao = false;

      linhas.forEach(function (l) {
        const necessario = (aberta ? 0 : ALT_FAIXA) + l.altura;
        if (y + necessario > BASE) {
          novaPagina();
          aberta = false;
          continuacao = true;
        }
        if (!aberta) { faixa(titulo, continuacao); aberta = true; }
        l.pintar(y);
        y += l.altura;
      });
      y += 5;
    }

    /* ---------------- Linha rótulo/valor ---------------- */
    function linhaValor(rotulo, valor) {
      fonte('bold', 8.2);
      const chave = pdf.splitTextToSize(String(rotulo).toUpperCase(), C_ROTULO - 6.4);
      fonte('normal', 10);
      const texto = pdf.splitTextToSize(String(valor == null || valor === '' ? '—' : valor),
        CW - C_ROTULO - 7);
      // O rótulo também entra na conta: rótulo longo quebrava em duas linhas e
      // vazava para fora da célula, que fora medida só pelo valor.
      const altura = Math.max(8.6, Math.max(chave.length, texto.length) * LINHA + PAD);

      return {
        altura: altura,
        pintar: function (yy) {
          setD(GRADE); pdf.setLineWidth(0.2);
          pdf.rect(ML, yy, CW, altura);
          pdf.line(ML + C_ROTULO, yy, ML + C_ROTULO, yy + altura);

          // Rótulo em caixa alta e negrito, valor em corpo maior: a diferença
          // entre os dois é de peso e tamanho, não de cor.
          fonte('bold', 8.2); setC(TINTA);
          pdf.text(chave, ML + 3.2, yy + 5.7, { charSpace: 0.15 });

          fonte('normal', 10); setC(TINTA);
          pdf.text(texto, ML + C_ROTULO + 3.4, yy + 5.7);
        }
      };
    }

    /* ---------------- Caixinha do checklist ---------------- */
    const LADO = 3.3;

    function caixinha(x, yy, marcada, alerta) {
      const cor = alerta ? VERMELHO : TINTA;
      if (marcada) {
        setF(cor); setD(cor); pdf.setLineWidth(0.3);
        pdf.rect(x, yy, LADO, LADO, 'FD');

        setD(PAPEL); pdf.setLineWidth(0.48);
        pdf.setLineCap('round'); pdf.setLineJoin('round');
        pdf.lines([[0.8, 0.9], [1.5, -1.7]], x + 0.7, yy + 1.65, [1, 1], 'S', false);
        pdf.setLineCap('butt'); pdf.setLineJoin('miter');
      } else {
        // Caixa vazia também em tinta cheia: contorno claro sumia na cópia e a
        // pergunta parecia não ter alternativa nenhuma.
        setD(TINTA); pdf.setLineWidth(0.25);
        pdf.rect(x, yy, LADO, LADO);
      }
    }

    /* Todas as alternativas da pergunta, centralizadas na coluna. A marcada se
       distingue pela caixa cheia e pelo negrito — as outras saem em tinta
       cheia também, só que em peso normal. */
    function grupoOpcoes(opcoes, x, largura, base) {
      const GAP = 1.3, ENTRE = 3.2;

      // Mede cada rótulo com o peso em que ele vai ser desenhado: negrito é
      // mais largo, e medir tudo em negrito jogaria o grupo fora do centro.
      const itens = opcoes.map(function (op) {
        fonte(op.marcada ? 'bold' : 'normal', 8.6);
        return { op: op, w: pdf.getTextWidth(op.rotulo) };
      });
      const total = itens.reduce(function (s, it) { return s + LADO + GAP + it.w; }, 0) +
        ENTRE * Math.max(0, itens.length - 1);

      let cx = x + Math.max(2.5, (largura - total) / 2);
      itens.forEach(function (it) {
        const destaque = it.op.marcada && it.op.alerta;
        caixinha(cx, base - 2.6, it.op.marcada, destaque);
        cx += LADO + GAP;

        fonte(it.op.marcada ? 'bold' : 'normal', 8.6);
        setC(destaque ? VERMELHO : TINTA);
        pdf.text(it.op.rotulo, cx, base);
        cx += it.w + ENTRE;
      });
    }

    /* ---------------- Linha de pergunta ---------------- */
    function linhaPergunta(p, indice) {
      const C3 = CW - C_PERGUNTA - C_OPCOES;

      fonte('normal', 9.8);
      const rotulo = pdf.splitTextToSize(p.label, C_PERGUNTA - 6.4);
      fonte('normal', 9);
      const obs = p.observacao ? pdf.splitTextToSize(p.observacao, C3 - 6.4) : [];

      const altura = Math.max(9.4, Math.max(rotulo.length, obs.length, 1) * LINHA + PAD);
      const opcoes = p.opcoes && p.opcoes.length
        ? p.opcoes
        : [{ rotulo: p.resposta, marcada: true, alerta: p.alerta }];

      return {
        altura: altura,
        pintar: function (yy) {
          if (indice % 2 === 1) { setF(ZEBRA); pdf.rect(ML, yy, CW, altura, 'F'); }

          setD(GRADE); pdf.setLineWidth(0.2);
          pdf.rect(ML, yy, CW, altura);
          pdf.line(ML + C_PERGUNTA, yy, ML + C_PERGUNTA, yy + altura);
          pdf.line(ML + C_PERGUNTA + C_OPCOES, yy, ML + C_PERGUNTA + C_OPCOES, yy + altura);

          fonte('normal', 9.8); setC(TINTA);
          pdf.text(rotulo, ML + 3.2, yy + 5.9);

          grupoOpcoes(opcoes, ML + C_PERGUNTA, C_OPCOES, yy + 5.9);

          if (obs.length) {
            // A observação é a descrição da não conformidade. Sai em tinta
            // cheia, como todo o resto.
            fonte('normal', 9); setC(TINTA);
            pdf.text(obs, ML + C_PERGUNTA + C_OPCOES + 3.2, yy + 5.9);
          }
        }
      };
    }

    /* ================================================================
       Corpo
       ================================================================ */
    cabecalho();

    d.secoes.forEach(function (secao) {
      /* Uma faixa por seção, mesmo quando a seção tem campos comuns E
         checklist. Antes saíam duas tabelas com o mesmo título repetido. */
      const linhas = [];

      secao.linhas.forEach(function (par) {
        linhas.push(linhaValor(par[0], par[1]));
      });
      secao.perguntas.forEach(function (p, i) {
        linhas.push(linhaPergunta(p, i));
      });

      imprimirTabela(secao.titulo, linhas);
    });

    /* ---------------- Anexos ----------------
       Duas por linha, altura pela proporção real de cada imagem — nada de
       esticar foto. A dupla inteira, com legenda, cabe na página ou desce
       para a próxima. */
    if (d.fotos.length) {
      const col = (CW - 7) / 2;
      const alturaMax = 66;

      const alturaDe = function (f) {
        const prop = (f.altura && f.largura) ? (f.altura / f.largura) : 0.75;
        return Math.min(col * prop, alturaMax);
      };

      const linhas = [];
      for (let i = 0; i < d.fotos.length; i += 2) {
        const par = d.fotos.slice(i, i + 2);
        const alturas = par.map(alturaDe);
        const altura = Math.max.apply(null, alturas) + 12.5;
        const inicio = i;

        linhas.push({
          altura: altura,
          pintar: function (yy) {
            par.forEach(function (f, k) {
              const x = ML + k * (col + 7);
              const h = alturas[k];
              const prop = (f.altura && f.largura) ? (f.altura / f.largura) : 0.75;
              const largura = Math.min(col, h / prop);
              const xc = x + (col - largura) / 2;

              try {
                pdf.addImage(f.dataUrl, 'JPEG', xc, yy + 3, largura, h, undefined, 'FAST');
              } catch (e) {
                fonte('normal', 8.4); setC(TINTA);
                pdf.text('[imagem indisponível]', x + 2, yy + 9);
              }
              setD(GRADE); pdf.setLineWidth(0.25);
              pdf.rect(xc, yy + 3, largura, h);

              fonte('bold', 8); setC(TINTA);
              const etiqueta = 'FOTO ' + Util.p2(inicio + k + 1);
              pdf.text(etiqueta, x, yy + h + 7.4);

              if (f.legenda) {
                const desloc = pdf.getTextWidth(etiqueta) + 2.2;
                fonte('normal', 8); setC(TINTA);
                pdf.text(pdf.splitTextToSize('— ' + f.legenda, col - desloc)[0],
                  x + desloc, yy + h + 7.4);
              }
            });
          }
        });
      }
      imprimirTabela('Anexos — ' + d.fotos.length + ' foto(s)', linhas);
    }

    /* ---------------- Laudo ----------------
       Faixa, veredito e observação são um bloco só: laudo partido entre duas
       folhas é exatamente o que não pode acontecer num documento assinado. */
    const corLaudo = d.laudo === 'aprovado' ? VERDE : (d.laudo ? VERMELHO : TINTA);

    fonte('normal', 10);
    const obsLaudo = pdf.splitTextToSize(d.observacoes || '—', CW - C_ROTULO - 7);
    const altObs = Math.max(10, obsLaudo.length * LINHA + PAD);
    const altVeredito = 15;

    // 46 mm é o que o bloco de assinatura ocupa abaixo da observação. Laudo,
    // veredito e assinatura vão para a mesma folha ou descem juntos.
    garantir(ALT_FAIXA + altVeredito + altObs + 46);

    faixa(d.tituloLaudo || 'Laudo', false);

    setD(GRADE); pdf.setLineWidth(0.2);
    pdf.rect(ML, y, CW, altVeredito);
    setF(corLaudo); pdf.rect(ML, y, 2.4, altVeredito, 'F');

    fonte('bold', 18); setC(corLaudo);
    pdf.text(d.laudoRotulo, ML + CW / 2, y + 10.2, { align: 'center' });
    y += altVeredito;

    pdf.rect(ML, y, CW, altObs);
    pdf.line(ML + C_ROTULO, y, ML + C_ROTULO, y + altObs);
    fonte('bold', 8.2); setC(TINTA);
    pdf.text(String(d.rotuloObs).toUpperCase(), ML + 3.2, y + 5.7, { charSpace: 0.15 });
    fonte('normal', 10); setC(TINTA);
    pdf.text(obsLaudo, ML + C_ROTULO + 3.4, y + 5.7);
    y += altObs + 12;

    /* ---------------- Assinatura ---------------- */
    const meia = CW / 2;

    if (d.assinatura) {
      const prop = (d.assinatura.altura && d.assinatura.largura)
        ? (d.assinatura.altura / d.assinatura.largura) : 0.35;
      const alt = Math.min(17, (meia - 26) * prop);
      const larg = alt / prop;
      try {
        pdf.addImage(d.assinatura.dataUrl, 'PNG', ML + (meia - larg) / 2, y - 1, larg, alt);
      } catch (e) { /* sem a imagem, a linha e o nome continuam valendo */ }
    }

    const yLinha = y + 17;
    setD(TINTA); pdf.setLineWidth(0.3);
    pdf.line(ML + 8, yLinha, ML + meia - 8, yLinha);
    pdf.line(ML + meia + 8, yLinha, W - MR - 8, yLinha);

    fonte('bold', 10.5); setC(TINTA);
    pdf.text(d.inspetorNome || '—', ML + meia / 2, yLinha + 5.4, { align: 'center' });
    pdf.text(Util.fmtData(d.dataInspecao), ML + meia + meia / 2, yLinha + 5.4, { align: 'center' });

    fonte('normal', 8); setC(TINTA);
    pdf.text('Assinatura do inspetor', ML + meia / 2, yLinha + 9.8, { align: 'center' });
    pdf.text(String(d.rotuloData), ML + meia + meia / 2, yLinha + 9.8, { align: 'center' });

    y = yLinha + 16;

    if (d.revisao > 0) {
      // O motivo da revisão é o que justifica o documento existir. Ele quebra
      // em quantas linhas precisar; a tarja cresce junto em vez de cortá-lo.
      fonte('normal', 8.8);
      const motivo = pdf.splitTextToSize('Motivo: ' + (d.motivoRevisao || '—'), CW - 34);
      const altRev = Math.max(9.4, motivo.length * 3.9 + 3.8);

      garantir(altRev + 1);
      setD(GRADE); pdf.setLineWidth(0.2);
      pdf.rect(ML, y, CW, altRev);
      fonte('bold', 8); setC(TINTA);
      pdf.text('REVISÃO ' + d.revisao, ML + 3.2, y + 5.9, { charSpace: 0.15 });
      fonte('normal', 8.8); setC(TINTA);
      pdf.text(motivo, ML + 30, y + 5.9);
    }

    /* Rodapé em todas as páginas: o total só é conhecido agora. */
    const total = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i);
      rodape(i, total);
    }

    return pdf.output('blob');
  }

  return { gerar: gerar };
})();
