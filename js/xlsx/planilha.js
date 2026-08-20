/* ==========================================================================
   planilha.js — escreve .xlsx de verdade, sem biblioteca
   --------------------------------------------------------------------------
   Um .xlsx é um ZIP com alguns XML dentro. São ~200 linhas para escrever os
   dois, contra ~900 KB de uma biblioteca de planilha no CDN — que o inspetor
   baixaria em campo, no 4G, para exportar uma vez por mês. Não compensa.

   O ZIP sai SEM COMPRESSÃO (método "stored"): é o que permite dispensar a
   biblioteca de deflate. O arquivo fica maior em bytes e idêntico em conteúdo;
   para algumas centenas de linhas de texto, a diferença não aparece.

   CSV foi descartado de propósito: perde tipo de dado (data vira texto, código
   com zero à esquerda vira número) e não guarda filtro nem largura de coluna.
   O que o SGQ arquiva tem que abrir pronto para uso.

   Este arquivo não sabe NADA de relatório de inspeção. Ver js/xlsx/exportar.js.
   ========================================================================== */

window.Planilha = (function () {
  'use strict';

  const utf8 = function (s) { return new TextEncoder().encode(s); };

  /* ------------------------------------------------------------------
     ZIP
     ------------------------------------------------------------------ */
  let tabelaCRC = null;

  function tabela() {
    if (tabelaCRC) return tabelaCRC;
    tabelaCRC = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      tabelaCRC[i] = c >>> 0;
    }
    return tabelaCRC;
  }

  function crc32(bytes) {
    const t = tabela();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(arquivos) {
    const corpo = [], central = [];
    let deslocamento = 0;

    const agora = new Date();
    const hora = ((agora.getHours() << 11) | (agora.getMinutes() << 5) |
                  (agora.getSeconds() >> 1)) & 0xFFFF;
    const data = (((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) |
                  agora.getDate()) & 0xFFFF;

    arquivos.forEach(function (a) {
      const nome = utf8(a.nome);
      const dados = utf8(a.texto);
      const soma = crc32(dados);

      const local = new Uint8Array(30 + nome.length);
      const l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true);
      l.setUint16(4, 20, true);        // versão necessária
      l.setUint16(6, 0x0800, true);    // nome do arquivo em UTF-8
      l.setUint16(8, 0, true);         // método 0 = armazenado
      l.setUint16(10, hora, true);
      l.setUint16(12, data, true);
      l.setUint32(14, soma, true);
      l.setUint32(18, dados.length, true);
      l.setUint32(22, dados.length, true);
      l.setUint16(26, nome.length, true);
      l.setUint16(28, 0, true);
      local.set(nome, 30);

      corpo.push(local, dados);

      const cd = new Uint8Array(46 + nome.length);
      const c = new DataView(cd.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, hora, true);
      c.setUint16(14, data, true);
      c.setUint32(16, soma, true);
      c.setUint32(20, dados.length, true);
      c.setUint32(24, dados.length, true);
      c.setUint16(28, nome.length, true);
      c.setUint32(42, deslocamento, true);
      cd.set(nome, 46);
      central.push(cd);

      deslocamento += local.length + dados.length;
    });

    let tamCentral = 0;
    central.forEach(function (c) { tamCentral += c.length; });

    const fim = new Uint8Array(22);
    const f = new DataView(fim.buffer);
    f.setUint32(0, 0x06054b50, true);
    f.setUint16(8, central.length, true);
    f.setUint16(10, central.length, true);
    f.setUint32(12, tamCentral, true);
    f.setUint32(16, deslocamento, true);

    return new Blob(corpo.concat(central, [fim]),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ------------------------------------------------------------------
     XML
     ------------------------------------------------------------------ */
  function esc(s) {
    // Caractere de controle dentro do XML faz o Excel recusar o arquivo
    // inteiro com "conteúdo ilegível" — e nenhum deles significa nada numa
    // resposta de inspeção. Some com eles antes de escapar o resto.
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function letra(n) {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = (n - r - 1) / 26;
    }
    return s;
  }

  /* Serial do Excel: dias desde 1899-12-30. 1970-01-01 é o dia 25569. */
  function serialData(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
  }

  function serialDataHora(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return null;
    // O Excel não guarda fuso. Grava a hora LOCAL, que é a que o inspetor viu
    // na tela — converter para UTC mudaria a data de um laudo do fim do dia.
    return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;
  }

  const ESTILO = { normal: 0, cabecalho: 1, data: 2, dataHora: 3 };

  function celula(ref, valor, tipo) {
    if (tipo === 'data' || tipo === 'datahora') {
      const s = tipo === 'data' ? serialData(valor) : serialDataHora(valor);
      if (s === null) return '<c r="' + ref + '"/>';
      return '<c r="' + ref + '" s="' + ESTILO[tipo === 'data' ? 'data' : 'dataHora'] +
        '"><v>' + s + '</v></c>';
    }
    if (tipo === 'numero') {
      const n = Number(String(valor == null ? '' : valor).replace(',', '.'));
      if (valor === '' || valor == null || isNaN(n)) return '<c r="' + ref + '"/>';
      return '<c r="' + ref + '"><v>' + n + '</v></c>';
    }
    const texto = String(valor == null ? '' : valor);
    if (!texto) return '<c r="' + ref + '"/>';
    // inlineStr dispensa a tabela de strings compartilhadas — uma parte a
    // menos no pacote, e o arquivo continua legítimo.
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
      esc(texto) + '</t></is></c>';
  }

  /* aba: { nome, colunas: [{titulo, tipo, largura}], linhas: [[...]] } */
  function folha(aba) {
    const cols = aba.colunas;
    const ultima = letra(cols.length);
    const total = aba.linhas.length + 1;
    const faixa = 'A1:' + ultima + total;

    const largura = cols.map(function (c, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) +
        '" width="' + (c.largura || 18) + '" customWidth="1"/>';
    }).join('');

    const cabecalho = '<row r="1" ht="18" customHeight="1">' +
      cols.map(function (c, i) {
        return '<c r="' + letra(i + 1) + '1" s="' + ESTILO.cabecalho +
          '" t="inlineStr"><is><t>' + esc(c.titulo) + '</t></is></c>';
      }).join('') + '</row>';

    const corpo = aba.linhas.map(function (linha, n) {
      const r = n + 2;
      return '<row r="' + r + '">' + cols.map(function (c, i) {
        return celula(letra(i + 1) + r, linha[i], c.tipo);
      }).join('') + '</row>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="' + faixa + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' +
        // Linha de título congelada: numa planilha de 30 colunas, rolar sem
        // isso é perder de vista o que cada coluna significa.
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="14.5"/>' +
      '<cols>' + largura + '</cols>' +
      '<sheetData>' + cabecalho + corpo + '</sheetData>' +
      '<autoFilter ref="' + faixa + '"/>' +
      '</worksheet>';
  }

  const ESTILOS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2">' +
      '<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>' +
      '<numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/>' +
    '</numFmts>' +
    '<fonts count="2">' +
      '<font><sz val="10"/><color rgb="FF181615"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF181615"/>' +
        '<bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" ' +
        'applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* Nome de aba: o Excel recusa > 31 caracteres e os sinais : \ / ? * [ ] */
  function nomeAba(s, indice) {
    const limpo = String(s || 'Planilha').replace(/[:\\/?*[\]]/g, '-').slice(0, 31).trim();
    return limpo || ('Planilha' + indice);
  }

  /* abas: [{ nome, colunas, linhas }] → Blob .xlsx */
  function montar(abas) {
    const lista = (abas || []).filter(function (a) { return a && a.colunas && a.colunas.length; });
    if (!lista.length) throw new Error('Não há nada para exportar.');

    const nomes = [];
    lista.forEach(function (a, i) {
      let n = nomeAba(a.nome, i + 1), base = n, k = 2;
      while (nomes.indexOf(n) >= 0) { n = base.slice(0, 28) + ' ' + (k++); }
      nomes.push(n);
    });

    const arquivos = [
      { nome: '[Content_Types].xml', texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        lista.map(function (a, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },

      { nome: '_rels/.rels', texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },

      { nome: 'xl/workbook.xml', texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + lista.map(function (a, i) {
          return '<sheet name="' + esc(nomes[i]) + '" sheetId="' + (i + 1) +
            '" r:id="rId' + (i + 1) + '"/>';
        }).join('') + '</sheets></workbook>' },

      { nome: 'xl/_rels/workbook.xml.rels', texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        lista.map(function (a, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },

      { nome: 'xl/styles.xml', texto: ESTILOS }
    ];

    lista.forEach(function (a, i) {
      arquivos.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: folha(a) });
    });

    return zip(arquivos);
  }

  function baixar(nomeArquivo, abas) {
    Util.baixarBlob(Util.nomeArquivoSeguro(nomeArquivo) + '.xlsx', montar(abas));
  }

  return { montar: montar, baixar: baixar };
})();
