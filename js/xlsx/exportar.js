/* ==========================================================================
   exportar.js — backup do acervo em .xlsx
   --------------------------------------------------------------------------
   As colunas SAEM DO SCHEMA, não de uma lista escrita aqui. Cada campo do
   formulário vira uma coluna, na ordem em que aparece na tela. É o que faz o
   backup continuar certo quando alguém incluir uma pergunta no JSON — e o que
   fará os outros relatórios (RIR, RID, RLP, RPM) funcionarem sem tocar neste
   arquivo: cada tipo ganha a sua aba, com as colunas dele.

   Uma linha por relatório, do rascunho ao laudo emitido. O recorte é o da
   RLS: os emitidos de todo mundo e os rascunhos do próprio inspetor.
   ========================================================================== */

window.Exportar = (function () {
  'use strict';

  const LIMITE = 5000;

  function situacao(r) {
    if (r.status !== 'concluido') return 'Rascunho';
    return r.laudo === 'aprovado' ? 'Aprovado'
         : (r.laudo === 'nao_conforme' ? 'Não conforme' : 'Concluído');
  }

  /* Texto vira texto, data vira data, número vira número: é o tipo que
     permite ordenar, somar e filtrar por período dentro do Excel. */
  function tipoColuna(campo) {
    if (campo.tipo === 'numero') return 'numero';
    if (campo.tipo === 'data') return 'data';
    return 'texto';
  }

  function valorDe(campo, valores) {
    // Campo escondido por condição fica em branco, e não com a resposta
    // velha: ele não fazia parte do que foi inspecionado.
    if (!RenderForm.visivel(campo, valores)) return '';
    const v = valores[campo.id];
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    return v;
  }

  function aba(tipo, relatorios, schema) {
    /* O número tem coluna própria logo no começo; repeti-lo no meio da grade
       só faria a planilha ter duas colunas iguais. */
    const campos = schema
      ? RenderForm.todosCampos(schema).filter(function (c) {
          return c.tipo !== 'foto' && c.sistema !== 'numero';
        })
      : [];
    const perguntas = campos.filter(RenderForm.ehPergunta);
    const enc = (schema && schema.encerramento) || {};

    const colunas = [
      { titulo: 'Formulário',          tipo: 'texto',    largura: 28 },
      { titulo: 'Nº do relatório',     tipo: 'texto',    largura: 17 },
      { titulo: 'Revisão',             tipo: 'numero',   largura: 9 },
      { titulo: 'Situação',            tipo: 'texto',    largura: 15 },
      { titulo: 'Inspetor',            tipo: 'texto',    largura: 26 },
      { titulo: 'Data da inspeção',    tipo: 'data',     largura: 16 },
      { titulo: 'Emitido em',          tipo: 'datahora', largura: 17 },
      { titulo: 'Última alteração',    tipo: 'datahora', largura: 17 }
    ];

    campos.forEach(function (c) {
      colunas.push({
        titulo: c.label,
        tipo: tipoColuna(c),
        largura: RenderForm.ehPergunta(c) ? 15 : 24
      });
    });

    colunas.push(
      { titulo: 'Itens verificados',   tipo: 'numero', largura: 14 },
      { titulo: 'Itens conformes',     tipo: 'numero', largura: 14 },
      { titulo: 'Itens não conformes', tipo: 'numero', largura: 16 },
      { titulo: 'Achados',             tipo: 'texto',  largura: 60 },
      { titulo: 'Observações do laudo', tipo: 'texto', largura: 48 }
    );

    const linhas = relatorios.map(function (r) {
      const valores = Object.assign({}, r.dados);

      const linha = [
        tipo.nome,
        r.numero || '',
        r.revisao || 0,
        situacao(r),
        r.inspetorNome || '',
        enc.campoData ? (valores[enc.campoData.id] || '') : '',
        r.concluidoEm || '',
        r.atualizadoEm || ''
      ];
      campos.forEach(function (c) { linha.push(valorDe(c, valores)); });

      /* Estatística do checklist. "Conformes" é o que foi respondido menos o
         que caiu na resposta de alerta — a mesma regra que pinta a resposta de
         vermelho no PDF, para o número da planilha bater com o documento. */
      let respondidas = 0, alertas = 0;
      const achados = [];
      perguntas.forEach(function (c) {
        if (!RenderForm.visivel(c, valores)) return;
        const v = valores[c.id];
        if (!v) return;
        respondidas++;
        if (c.alertaSe && v === c.alertaSe) {
          alertas++;
          const obs = valores[RenderForm.idObs(c.id)] || '';
          achados.push(c.label + (obs ? ' — ' + obs : ''));
        }
      });

      linha.push(
        respondidas,
        respondidas - alertas,
        alertas,
        achados.join('  |  '),
        enc.campoObs ? (valores[enc.campoObs.id] || '') : ''
      );
      return linha;
    });

    return { nome: tipo.prefixo || tipo.nome, colunas: colunas, linhas: linhas };
  }

  /* opcoes: { tipos: [catálogo], tipo, busca }
     Devolve o número de relatórios exportados. */
  async function acervo(opcoes) {
    const o = opcoes || {};
    const catalogo = o.tipos || [];

    const relatorios = await DB.listarRelatorios({
      tipo: o.tipo || null,
      busca: o.busca || '',
      limite: LIMITE
    });
    if (relatorios.length >= LIMITE) {
      UI.toast('O backup traz os ' + LIMITE + ' relatórios mais recentes.', 'error');
    }

    const abas = [];
    for (let i = 0; i < catalogo.length; i++) {
      const t = catalogo[i];
      const doTipo = relatorios.filter(function (r) { return r.tipo === t.codigo; });
      if (!doTipo.length) continue;

      // Na planilha a ordem útil é a da série, não a da última alteração.
      doTipo.sort(function (a, b) {
        return String(a.numero || '').localeCompare(String(b.numero || ''),
          'pt-BR', { numeric: true });
      });

      let schema = null;
      try {
        schema = await RenderForm.carregarSchema(t.codigo);
      } catch (e) {
        // Tipo ainda sem JSON de formulário sai com as colunas do sistema.
        // Melhor uma aba enxuta do que um backup faltando relatório.
        console.warn('[exportar] sem schema para ' + t.codigo + ':', e);
      }
      abas.push(aba(t, doTipo, schema));
    }

    if (!abas.length) throw new Error('Nenhum relatório encontrado com esses filtros.');

    Planilha.baixar('Acervo de inspeção ' + Util.hojeISO(), abas);
    return relatorios.length;
  }

  return { acervo: acervo, aba: aba };
})();
