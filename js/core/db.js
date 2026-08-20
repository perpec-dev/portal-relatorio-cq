/* ==========================================================================
   db.js — acesso às tabelas
   --------------------------------------------------------------------------
   Regra do kit: as páginas NUNCA chamam o Supabase direto. Toda leitura e toda
   gravação passa por uma função nomeada daqui, para ficar visível no código o
   que sai da máquina.

   Nomes: tela usa camelCase, banco usa snake_case. A tradução acontece só
   aqui, em paraBanco() / doBanco().
   ========================================================================== */

window.DB = (function () {
  'use strict';

  const COLUNAS_REL =
    'id,tipo_codigo,schema_versao,numero,numero_base,revisao,origem_id,motivo_revisao,' +
    'status,laudo,dados,inspetor_id,inspetor_nome_snapshot,assinatura_path_snapshot,' +
    'concluido_em,criado_em,criado_por,atualizado_em,atualizado_por';

  function sb() { return SB.exigirCliente(); }

  function doBanco(r) {
    if (!r) return null;
    return {
      id: r.id,
      tipo: r.tipo_codigo,
      schemaVersao: r.schema_versao,
      numero: r.numero,
      numeroBase: r.numero_base,
      revisao: r.revisao,
      origemId: r.origem_id,
      motivoRevisao: r.motivo_revisao,
      status: r.status,
      laudo: r.laudo,
      dados: r.dados || {},
      inspetorId: r.inspetor_id,
      inspetorNome: r.inspetor_nome_snapshot,
      assinaturaPath: r.assinatura_path_snapshot,
      concluidoEm: r.concluido_em,
      criadoEm: r.criado_em,
      atualizadoEm: r.atualizado_em
    };
  }

  /* ---------------- Tipos de relatório (catálogo do portal) ------------- */

  async function listarTipos() {
    const { data, error } = await sb()
      .from('tipos_relatorio')
      .select('codigo,nome,prefixo,doc_ref,ativo,ordem')
      .order('ordem');
    if (error) throw error;
    return data || [];
  }

  async function tipo(codigo) {
    const { data, error } = await sb()
      .from('tipos_relatorio')
      .select('codigo,nome,prefixo,doc_ref,ativo,ordem')
      .eq('codigo', codigo)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /* ---------------- Relatórios ----------------------------------------- */

  async function criarRascunho(tipoCodigo, schemaVersao) {
    const p = await Auth.garantirPerfil();
    if (!p) throw new Error('Sessão necessária.');
    const { data, error } = await sb().from('relatorios').insert({
      id: Util.uid(),
      tipo_codigo: tipoCodigo,
      schema_versao: schemaVersao,
      inspetor_id: p.id,
      dados: {}
    }).select(COLUNAS_REL).single();
    if (error) throw error;
    return doBanco(data);
  }

  async function obterRelatorio(id) {
    const { data, error } = await sb()
      .from('relatorios').select(COLUNAS_REL).eq('id', id).maybeSingle();
    if (error) throw error;
    return doBanco(data);
  }

  /* Salva as respostas do rascunho. `numero` é campo do sistema (coluna
     própria), e não uma resposta dentro de `dados`.

     DUAS GRAVAÇÕES, de propósito. `numero` tem unique na tabela; num único
     UPDATE, um número repetido faz o Postgres recusar a linha INTEIRA — e as
     respostas do inspetor iam embora junto, calado. Era isso que esvaziava o
     rascunho e fazia o PDF sair em branco. Grava-se primeiro o que não pode se
     perder; o número vai depois e, se for recusado, o erro sobe marcado para a
     tela poder dizer exatamente o que aconteceu. */
  async function salvarRascunho(id, dados, numero) {
    const { error } = await sb().from('relatorios')
      .update({ dados: dados || {} }).eq('id', id);
    if (error) throw error;

    if (numero === undefined) return;

    const r = await sb().from('relatorios')
      .update({ numero: numero || null }).eq('id', id);
    if (r.error) {
      const e = new Error(mensagemNumero(r.error, numero));
      e.numeroRecusado = true;
      e.original = r.error;
      throw e;
    }
  }

  /* A mensagem crua do Postgres ("duplicate key value violates unique
     constraint relatorios_numero_key") não diz nada a quem está de luva no
     galpão. Traduz aqui, uma vez, para todas as telas. */
  function mensagemNumero(erro, numero) {
    const texto = (erro && (erro.message || erro.details || '')) + '';
    if (erro && (erro.code === '23505' || /duplicate key|unique/i.test(texto))) {
      return 'O número ' + numero + ' já está em uso por outro relatório.';
    }
    return texto || 'Não foi possível gravar o número.';
  }

  /* Pergunta ao banco se o número já está preso a algum relatório — inclusive
     rascunho de colega, que a RLS não deixa a tela enxergar. */
  async function numeroEmUso(numero, ignorarId) {
    const { data, error } = await sb().rpc('numero_em_uso', {
      p_numero: numero, p_ignorar: ignorarId || null
    });
    if (error) throw error;
    return data === true;
  }

  async function apagarRascunho(id) {
    const { error } = await sb().from('relatorios').delete().eq('id', id);
    if (error) throw error;
  }

  /* Conclusão: RPC, nunca update direto. O cliente não tem permissão de
     escrever status, laudo nem os snapshots — só esta função escreve. */
  async function concluir(id, laudo) {
    const { data, error } = await sb().rpc('concluir_relatorio', {
      p_id: id, p_laudo: laudo
    });
    if (error) throw error;
    return doBanco(Array.isArray(data) ? data[0] : data);
  }

  /* A série inteira de um laudo compartilha `numero_base` — é ele, e não a
     cadeia de origem_id, que junta Rev.0, Rev.1 e Rev.2 numa consulta só.
     Devolve em ordem de revisão, do original ao mais recente. */
  async function listarRevisoes(numeroBase) {
    if (!numeroBase) return [];
    const { data, error } = await sb()
      .from('relatorios')
      .select('id,numero,revisao,motivo_revisao,status,concluido_em,inspetor_nome_snapshot')
      .eq('numero_base', numeroBase)
      .order('revisao');
    if (error) throw error;
    return data || [];
  }

  async function criarRevisao(id, motivo) {
    const { data, error } = await sb().rpc('criar_revisao', {
      p_id: id, p_motivo: motivo
    });
    if (error) throw error;
    return doBanco(Array.isArray(data) ? data[0] : data);
  }

  async function sugerirNumero(tipoCodigo) {
    const { data, error } = await sb().rpc('sugerir_numero', { p_tipo: tipoCodigo });
    if (error) throw error;
    return data;
  }

  /* Registra a saída da assinatura de outro inspetor do bucket privado.
     Falha aqui NÃO pode derrubar a geração do documento: a auditoria é
     importante, mas o inspetor não pode ficar sem o PDF por causa dela. */
  async function registrarAcessoAssinatura(idRelatorio) {
    try {
      await sb().rpc('registrar_acesso_assinatura', { p_relatorio: idRelatorio });
    } catch (e) {
      console.warn('[auditoria] não foi possível registrar o acesso:', e);
    }
  }

  /* filtro: { meus, tipo, status, laudo, busca } */
  async function listarRelatorios(filtro) {
    const f = filtro || {};
    let q = sb().from('relatorios').select(COLUNAS_REL);

    if (f.meus) {
      const p = await Auth.garantirPerfil();
      if (p) q = q.eq('inspetor_id', p.id);
    }
    if (f.tipo) q = q.eq('tipo_codigo', f.tipo);
    if (f.status) q = q.eq('status', f.status);
    if (f.laudo) q = q.eq('laudo', f.laudo);

    q = q.order('atualizado_em', { ascending: false }).limit(f.limite || 300);

    const { data, error } = await q;
    if (error) throw error;
    let lista = (data || []).map(doBanco);

    /* Busca por texto é feita aqui e não no banco de propósito: as respostas
       moram num jsonb, e um filtro server-side sobre jsonb exigiria índice
       específico por campo. Com o limite acima, a lista cabe na memória. */
    if (f.busca) {
      const alvo = Util.chave(f.busca);
      lista = lista.filter(function (r) {
        const texto = [r.numero, r.inspetorNome, JSON.stringify(r.dados)].join(' ');
        return Util.chave(texto).indexOf(alvo) >= 0;
      });
    }
    return lista;
  }

  /* ---------------- Fotos ---------------------------------------------- */

  async function listarFotos(idRelatorio) {
    const { data, error } = await sb()
      .from('relatorio_fotos')
      .select('id,relatorio_id,campo_id,path,legenda,ordem,herdada,criado_em')
      .eq('relatorio_id', idRelatorio)
      .order('campo_id').order('ordem');
    if (error) throw error;
    return data || [];
  }

  async function criarFoto(reg) {
    const { data, error } = await sb().from('relatorio_fotos').insert({
      id: reg.id || Util.uid(),
      relatorio_id: reg.relatorioId,
      campo_id: reg.campoId,
      path: reg.path,
      legenda: reg.legenda || null,
      ordem: reg.ordem || 0
    }).select('id,relatorio_id,campo_id,path,legenda,ordem,herdada').single();
    if (error) throw error;
    return data;
  }

  async function atualizarLegenda(idFoto, legenda) {
    const { error } = await sb().from('relatorio_fotos')
      .update({ legenda: legenda || null }).eq('id', idFoto);
    if (error) throw error;
  }

  async function apagarFoto(idFoto) {
    const { error } = await sb().from('relatorio_fotos').delete().eq('id', idFoto);
    if (error) throw error;
  }

  /* ---------------- Perfis --------------------------------------------- */

  async function listarInspetores() {
    const { data, error } = await sb()
      .from('perfis')
      .select('id,nome,papel,ativo,matricula,telefone,assinatura_path,' +
              'assinatura_atualizada_em,consentimento_em,exclusao_solicitada_em,criado_em')
      .order('nome');
    if (error) throw error;
    return data || [];
  }

  async function atualizarPerfil(id, patch) {
    const { error } = await sb().from('perfis').update(patch).eq('id', id);
    if (error) throw error;
  }

  async function anonimizarPerfil(id) {
    const { error } = await sb().rpc('anonimizar_perfil', { p_perfil: id });
    if (error) throw error;
  }

  async function exportarMeusDados() {
    const { data, error } = await sb().rpc('exportar_meus_dados');
    if (error) throw error;
    return data;
  }

  async function solicitarExclusao() {
    const { error } = await sb().rpc('solicitar_exclusao');
    if (error) throw error;
  }

  /* ---------------- Auditoria ------------------------------------------ */

  async function listarAuditoria(limite) {
    const { data, error } = await sb()
      .from('auditoria')
      .select('id,relatorio_id,alvo_perfil,ts,evento,detalhe,autor')
      .order('ts', { ascending: false })
      .limit(limite || 120);
    if (error) throw error;
    return data || [];
  }

  /* ---------------- Cadastro de inspetor (Edge Function) --------------- */
  /* Criar usuário exige a service_role, que não pode existir no frontend.
     A chamada vai para a Edge Function, que guarda a chave no servidor e
     confere no banco se quem chamou é mesmo admin. */
  async function criarInspetor(dados) {
    const url = (window.SUPABASE_CONFIG || {}).FN_CRIAR_INSPETOR;
    if (!url || /SEU-PROJETO/i.test(url)) {
      throw new Error('Cadastro pela tela não está configurado. ' +
        'Publique a Edge Function e preencha FN_CRIAR_INSPETOR em js/config.js.');
    }
    const s = await Auth.sessao();
    if (!s) throw new Error('Sessão necessária.');

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + s.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dados)
    });
    let corpo = null;
    try { corpo = await resp.json(); } catch (e) { /* resposta sem json */ }
    if (!resp.ok) throw new Error((corpo && corpo.erro) || 'Não foi possível cadastrar o inspetor.');
    return corpo;
  }

  return {
    listarTipos: listarTipos, tipo: tipo,
    criarRascunho: criarRascunho, obterRelatorio: obterRelatorio,
    salvarRascunho: salvarRascunho, apagarRascunho: apagarRascunho,
    concluir: concluir, criarRevisao: criarRevisao, listarRevisoes: listarRevisoes,
    sugerirNumero: sugerirNumero, numeroEmUso: numeroEmUso,
    registrarAcessoAssinatura: registrarAcessoAssinatura,
    listarRelatorios: listarRelatorios,
    listarFotos: listarFotos, criarFoto: criarFoto,
    atualizarLegenda: atualizarLegenda, apagarFoto: apagarFoto,
    listarInspetores: listarInspetores, atualizarPerfil: atualizarPerfil,
    anonimizarPerfil: anonimizarPerfil, exportarMeusDados: exportarMeusDados,
    solicitarExclusao: solicitarExclusao, listarAuditoria: listarAuditoria,
    criarInspetor: criarInspetor
  };
})();
