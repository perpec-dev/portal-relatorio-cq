-- ============================================================================
-- PORTAL DE RELATÓRIOS DE INSPEÇÃO — Perpec Oilfield Supply
-- Esquema, RLS, Storage e rotinas de LGPD.
--
-- PRINCÍPIO (do kit): a página é pública e todo o JavaScript é visível,
-- inclusive a chave `anon`. A PROTEÇÃO ESTÁ NESTE ARQUIVO, nunca na tela.
-- O que a interface esconde é conforto; o que este arquivo nega é segurança.
--
-- Ordem de execução: rode o arquivo inteiro de uma vez no SQL Editor.
-- Região do projeto: South America (São Paulo) — LGPD, art. 33.
-- ============================================================================

create extension if not exists pgcrypto;


-- ============================================================================
-- 1. PERFIS
-- ----------------------------------------------------------------------------
-- Espelha auth.users. O papel do usuário vive AQUI, nunca no JWT editável
-- pelo cliente, e nunca em user_metadata (que o próprio usuário pode alterar
-- via updateUser — seria escalação de privilégio para 'admin').
-- ============================================================================
create table if not exists public.perfis (
  id                  uuid primary key references auth.users(id) on delete cascade,

  nome                text not null check (char_length(btrim(nome)) >= 5),
  papel               text not null default 'inspetor'
                        check (papel in ('admin','inspetor')),
  ativo               boolean not null default true,

  -- Identificação profissional. DADO PESSOAL: minimização (LGPD art. 6º, III)
  -- — só o necessário para a rastreabilidade do laudo técnico.
  -- O laudo é assinado por NOME + IMAGEM DA ASSINATURA. Não há registro de
  -- conselho envolvido, então não há campo para ele: dado que não existe no
  -- processo não entra no banco.
  matricula           text unique,
  telefone            text,

  -- Assinatura/carimbo: CAMINHO no bucket privado, nunca a imagem em si.
  -- A imagem só sai por signed URL de curta duração (ver seção 8).
  assinatura_path     text,
  assinatura_atualizada_em timestamptz,

  -- LGPD: consentimento explícito, com prova de quando e sobre qual texto.
  consentimento_em    timestamptz,
  consentimento_versao text,

  -- LGPD art. 18, VI: titular pede exclusão; admin executa depois do prazo
  -- legal de guarda do laudo. A marca fica registrada aqui.
  exclusao_solicitada_em timestamptz,

  criado_em           timestamptz not null default now(),
  criado_por          uuid,
  atualizado_em       timestamptz not null default now(),
  atualizado_por      uuid
);

comment on column public.perfis.assinatura_path is
  'Caminho no bucket privado "assinaturas". Dado pessoal — acesso só por signed URL.';


-- ============================================================================
-- 2. FUNÇÕES DE APOIO
-- ----------------------------------------------------------------------------
-- security definer para lerem public.perfis SEM cair na própria RLS
-- (senão a política de perfis chamaria a si mesma: recursão infinita).
-- search_path SEMPRE fixado: sem isso, um schema malicioso no caminho de
-- busca poderia sequestrar a resolução dos nomes.
-- ============================================================================
create or replace function public.sou_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.sou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' and ativo from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.meu_nome()
returns text language sql stable security definer set search_path = public as $$
  select nome from public.perfis where id = auth.uid()
$$;


-- ============================================================================
-- 3. CATÁLOGO DE TIPOS DE RELATÓRIO
-- ----------------------------------------------------------------------------
-- O portal é montado a partir desta tabela. Ligar um relatório novo =
-- publicar o schema de campos em js/forms/ e virar `ativo` para true aqui.
-- Nenhum deploy de banco é necessário para isso.
-- ============================================================================
create table if not exists public.tipos_relatorio (
  codigo      text primary key,        -- casa com o arquivo em js/forms/<codigo>.js
  nome        text not null,
  prefixo     text not null,           -- prefixo da numeração: RIV-2026-0001
  doc_ref     text not null,           -- referência do formulário controlado (SGQ)
  ativo       boolean not null default false,
  ordem       integer not null default 0
);

-- `do update` e não `do nothing`: rodar o arquivo de novo precisa CORRIGIR o
-- catálogo, não ignorá-lo em silêncio.
insert into public.tipos_relatorio (codigo, nome, prefixo, doc_ref, ativo, ordem) values
  ('inspecao-visual',      'Relatório de Inspeção Visual',        'RIV', 'FP-CQP-0011', true,  1),
  ('inspecao-recebimento', 'Relatório de Inspeção de Recebimento','RIR', 'FP-CQP-0020', false, 2),
  ('inspecao-dimensional', 'Relatório de Inspeção Dimensional',   'RID', 'FP-CQP-0004', false, 3),
  ('liquido-penetrante',   'Relatório de Líquido Penetrante',     'RLP', 'FP-CQP-0001', false, 4),
  ('particula-magnetica',  'Relatório de Partícula Magnética',    'RPM', 'FP-CQP-0003', false, 5)
on conflict (codigo) do update
  set nome = excluded.nome, prefixo = excluded.prefixo,
      doc_ref = excluded.doc_ref, ordem = excluded.ordem;

-- Inspeção de Dureza saiu do escopo. O delete só passa se ninguém tiver
-- emitido laudo desse tipo — a FK segura. Se travar aqui, é porque existe
-- acervo: nesse caso troque por `update ... set ativo = false`.
delete from public.tipos_relatorio where codigo = 'inspecao-dureza';


-- ============================================================================
-- 4. RELATÓRIOS
-- ----------------------------------------------------------------------------
-- Os campos preenchidos vivem em `dados jsonb`, porque o formulário é
-- construído a partir de um schema em arquivo (js/forms/*.js) e mudar campo
-- não pode exigir migração de banco.
--
-- CONTRAPARTIDA, e é uma contrapartida real: o banco NÃO valida os campos do
-- domínio — só o frontend valida. Por isso `schema_versao` é obrigatório:
-- sem ele não se sabe, dois anos depois, com qual versão do formulário aquele
-- laudo foi emitido. Em auditoria de QHSE isso é o que sustenta o documento.
-- ============================================================================
create table if not exists public.relatorios (
  id              uuid primary key default gen_random_uuid(),

  tipo_codigo     text not null references public.tipos_relatorio(codigo),
  schema_versao   text not null,

  -- Numeração MANUAL, no formato PREFIXO-NNN-AA (ex.: RIR-001-26).
  -- Quem digita é o inspetor; o sistema apenas SUGERE o próximo livre.
  --
  -- Isto contraria a regra 4 do kit ("numeração vem do servidor, nunca do
  -- aparelho") por decisão sua, e o custo é conhecido: dois inspetores podem
  -- escolher o mesmo número. O `unique` abaixo é o que impede — o segundo a
  -- concluir leva erro em vez de duplicar a série. Sem ele, a numeração
  -- manual silenciosamente geraria dois laudos com o mesmo número.
  numero          text unique,          -- 'RIV-001-26' ou 'RIV-001-26 Rev.1'
  numero_base     text,                 -- 'RIV-001-26' — compartilhado pela série

  -- ---- REVISÃO ------------------------------------------------------------
  -- Laudo emitido é imutável. Corrigir gera um relatório NOVO que aponta para
  -- o anterior; os dois permanecem no acervo. É a cadeia de revisão que
  -- prova o histórico da correção, não o registro sobrescrito.
  revisao         integer not null default 0,
  origem_id       uuid references public.relatorios(id) on delete restrict,
  motivo_revisao  text,

  status          text not null default 'rascunho'
                    check (status in ('rascunho','concluido')),

  -- Vocabulário do formulário controlado: APROVADO / NÃO CONFORME.
  -- Não é sinônimo de "reprovado" — não conformidade abre tratativa, e é esse
  -- o termo que o SGQ usa no registro. O banco guarda a chave; a tela e o PDF
  -- exibem o rótulo.
  laudo           text check (laudo in ('aprovado','nao_conforme')),

  dados           jsonb not null default '{}'::jsonb,

  inspetor_id     uuid not null references public.perfis(id) on delete restrict,

  -- ---- SNAPSHOTS DE CONCLUSÃO -------------------------------------------
  -- Congelados no momento em que o laudo é emitido. Sem isso, trocar a
  -- assinatura ou corrigir o nome no perfil mudaria RETROATIVAMENTE todos os
  -- PDFs já emitidos — o documento deixaria de ser rastreável.
  inspetor_nome_snapshot  text,
  assinatura_path_snapshot text,
  concluido_em    timestamptz,

  criado_em       timestamptz not null default now(),
  criado_por      uuid not null default auth.uid(),
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid not null default auth.uid(),

  -- Conclusão é atômica: ou tem laudo, número, snapshot e data, ou não é
  -- concluído. Impede um relatório "meio emitido".
  constraint relatorio_concluido_completo check (
    status = 'rascunho'
    or (laudo is not null and numero is not null and concluido_em is not null)
  ),
  -- Revisão sempre tem origem, e origem sempre gera revisão > 0.
  constraint relatorio_revisao_coerente check (
    (revisao = 0 and origem_id is null) or (revisao > 0 and origem_id is not null)
  )
);

create index if not exists relatorios_inspetor_idx   on public.relatorios (inspetor_id, atualizado_em desc);
create index if not exists relatorios_atualizado_idx on public.relatorios (atualizado_em desc);
create index if not exists relatorios_tipo_idx       on public.relatorios (tipo_codigo, status);
create index if not exists relatorios_origem_idx     on public.relatorios (origem_id);
-- Idem: a policy do bucket 'assinaturas' procura o snapshot pelo caminho.
create index if not exists relatorios_assin_snap_idx on public.relatorios (assinatura_path_snapshot);


-- ============================================================================
-- 5. FOTOS DOS RELATÓRIOS
-- ----------------------------------------------------------------------------
-- Tabela separada (e não um array dentro de `dados`) por três motivos:
-- política de acesso própria, contagem/ordem confiável, e limpeza do Storage
-- possível ao excluir o relatório.
-- ============================================================================
create table if not exists public.relatorio_fotos (
  id            uuid primary key default gen_random_uuid(),
  relatorio_id  uuid not null references public.relatorios(id) on delete cascade,

  campo_id      text not null,      -- id do campo no schema (ex.: 'foto_corpo')
  path          text not null,      -- caminho no bucket privado "relatorios"
  legenda       text,
  ordem         integer not null default 0,

  -- Foto trazida de um relatório anterior por criar_revisao(): a linha é
  -- nova, mas o ARQUIVO no Storage é o mesmo objeto. Remover esta linha nunca
  -- pode apagar o arquivo — ele ainda pertence ao laudo original.
  herdada       boolean not null default false,

  criado_em     timestamptz not null default now(),
  criado_por    uuid not null default auth.uid()
);

create index if not exists fotos_relatorio_idx on public.relatorio_fotos (relatorio_id, campo_id, ordem);

-- Índices de POLICY, não de consulta: as políticas do Storage procuram o
-- objeto pelo caminho a cada arquivo lido. Sem eles, abrir um relatório com
-- 20 fotos faz 20 varreduras completas de tabela.
create index if not exists fotos_path_idx on public.relatorio_fotos (path);


-- ============================================================================
-- 6. AUDITORIA (append-only)
-- ----------------------------------------------------------------------------
-- Rastreabilidade documental e prova de acesso a dado pessoal (LGPD art. 37:
-- o controlador deve manter registro das operações de tratamento).
-- Não há GRANT de update/delete: pela API, ninguém reescreve a auditoria.
-- ============================================================================
create table if not exists public.auditoria (
  id           bigint generated always as identity primary key,
  relatorio_id uuid references public.relatorios(id) on delete set null,
  alvo_perfil  uuid references public.perfis(id) on delete set null,
  ts           timestamptz not null default now(),
  evento       text not null,
  detalhe      text,
  autor        text,
  autor_id     uuid not null default auth.uid()
);

create index if not exists auditoria_ts_idx        on public.auditoria (ts desc);
create index if not exists auditoria_relatorio_idx on public.auditoria (relatorio_id, ts desc);


-- ============================================================================
-- 7. NUMERAÇÃO (MANUAL) E CONCLUSÃO
-- ----------------------------------------------------------------------------
-- Formato: PREFIXO-NNN-AA   →   RIR-001-26, RLP-024-26
-- Não há mais tabela de contadores: com numeração manual, um contador do
-- servidor mentiria — ele não sabe o que o inspetor digitou.
-- ============================================================================

-- Máscara esperada para um tipo. Um lugar só monta a expressão, para tela,
-- validação e sugestão nunca discordarem entre si.
create or replace function public.mascara_numero(p_tipo text)
returns text language sql stable security definer set search_path = public as $$
  select '^' || prefixo || '-[0-9]{3}-[0-9]{2}$' from public.tipos_relatorio where codigo = p_tipo
$$;

-- SUGESTÃO, não imposição: devolve o próximo número livre do tipo no ano
-- corrente. A tela preenche o campo com isto e o inspetor sobrescreve à
-- vontade — é ele quem manda, conforme combinado.
create or replace function public.sugerir_numero(p_tipo text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_prefixo text;
  v_aa      text := to_char(now() at time zone 'America/Sao_Paulo', 'YY');
  v_ultimo  integer;
begin
  if not public.sou_ativo() then
    raise exception 'Usuário sem permissão.';
  end if;

  select prefixo into v_prefixo from public.tipos_relatorio where codigo = p_tipo;
  if v_prefixo is null then
    raise exception 'Tipo de relatório inválido: %', p_tipo;
  end if;

  -- Varre TODOS os relatórios do tipo no ano, de qualquer inspetor, inclusive
  -- rascunhos: um número já digitado em rascunho está reservado, e sugerir
  -- ele de novo garantiria a colisão que se quer evitar.
  select max((substring(numero from '^[A-Z]+-([0-9]{3})-[0-9]{2}$'))::integer)
    into v_ultimo
    from public.relatorios
   where tipo_codigo = p_tipo
     and numero ~ ('^' || v_prefixo || '-[0-9]{3}-' || v_aa || '$');

  return v_prefixo || '-' || lpad((coalesce(v_ultimo, 0) + 1)::text, 3, '0') || '-' || v_aa;
end $$;

-- O número já está preso a algum relatório?
--
-- Precisa ser SECURITY DEFINER: a RLS esconde do inspetor os rascunhos dos
-- colegas, e é justamente contra eles que a colisão acontece — o `unique` da
-- coluna vale para a tabela inteira, rascunho incluído. Sem esta função a tela
-- só enxergaria os números dos laudos emitidos e o inspetor descobriria o
-- choque tarde, quando o banco recusasse a gravação.
--
-- Devolve apenas "sim/não" sobre um número que o próprio usuário digitou.
-- Não expõe de quem é o relatório, nem qualquer outro dado dele.
create or replace function public.numero_em_uso(p_numero text, p_ignorar uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sou_ativo() then
    raise exception 'Usuário sem permissão.';
  end if;
  if p_numero is null or btrim(p_numero) = '' then
    return false;
  end if;
  return exists (
    select 1 from public.relatorios
     where upper(numero) = upper(btrim(p_numero))
       and (p_ignorar is null or id <> p_ignorar)
  );
end $$;

-- O formato é conferido no BANCO, não só na tela. A tela é conforto; um
-- número fora do padrão entrando por qualquer outro caminho quebraria a
-- ordenação da série e a busca do SGQ.
create or replace function public.tg_valida_numero()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mascara text;
begin
  -- Revisão não digita número: ela herda o do original e ganha o sufixo.
  if new.numero is null or new.revisao > 0 then
    return new;
  end if;
  v_mascara := public.mascara_numero(new.tipo_codigo);
  if new.numero !~ v_mascara then
    raise exception 'Número fora do padrão. Use o formato %-000-%, por exemplo %.',
      (select prefixo from public.tipos_relatorio where codigo = new.tipo_codigo),
      to_char(now() at time zone 'America/Sao_Paulo', 'YY'),
      public.sugerir_numero(new.tipo_codigo);
  end if;
  return new;
end $$;

drop trigger if exists relatorios_valida_numero on public.relatorios;
create trigger relatorios_valida_numero before insert or update of numero on public.relatorios
  for each row execute function public.tg_valida_numero();


-- Conclusão do relatório: emissão do laudo.
-- Faz tudo numa transação só — número, laudo, snapshots, auditoria — porque
-- o cliente NÃO tem GRANT para escrever nenhuma dessas colunas. É a única
-- porta de entrada para o estado 'concluido'.
create or replace function public.concluir_relatorio(p_id uuid, p_laudo text)
returns public.relatorios language plpgsql security definer set search_path = public as $$
declare
  v_rel   public.relatorios;
  v_perf  public.perfis;
  v_num   text;
begin
  if p_laudo not in ('aprovado','nao_conforme') then
    raise exception 'Laudo deve ser "aprovado" ou "nao_conforme".';
  end if;

  select * into v_rel from public.relatorios where id = p_id for update;
  if v_rel.id is null then
    raise exception 'Relatório não encontrado.';
  end if;

  -- Só o dono conclui. Admin NÃO assina laudo por inspetor: a assinatura
  -- técnica é pessoal e intransferível.
  if v_rel.inspetor_id <> auth.uid() then
    raise exception 'Somente o inspetor autor pode concluir este relatório.';
  end if;
  if not public.sou_ativo() then
    raise exception 'Usuário inativo.';
  end if;
  if v_rel.status = 'concluido' then
    raise exception 'Relatório já concluído. Emita uma revisão.';
  end if;

  select * into v_perf from public.perfis where id = auth.uid();
  if v_perf.assinatura_path is null then
    raise exception 'Cadastre sua assinatura/carimbo no perfil antes de emitir o laudo.';
  end if;

  -- Revisão NÃO ganha número novo: mantém o do original e acrescenta o
  -- sufixo. Quem procura 'RIV-001-26' acha a série inteira.
  if v_rel.revisao > 0 then
    v_num := v_rel.numero_base || ' Rev.' || v_rel.revisao;
  else
    -- Numeração manual: o número já está na linha, digitado pelo inspetor.
    if v_rel.numero is null then
      raise exception 'Informe o número do relatório antes de emitir o laudo.';
    end if;
    if v_rel.numero !~ public.mascara_numero(v_rel.tipo_codigo) then
      raise exception 'Número fora do padrão: %', v_rel.numero;
    end if;
    v_num := v_rel.numero;
  end if;

  begin
    update public.relatorios set
      status                   = 'concluido',
      laudo                    = p_laudo,
      numero                   = v_num,
      numero_base              = coalesce(numero_base, v_num),
      concluido_em             = now(),
      inspetor_nome_snapshot   = v_perf.nome,
      assinatura_path_snapshot = v_perf.assinatura_path
    where id = p_id
    returning * into v_rel;
  exception when unique_violation then
    -- Corrida entre dois inspetores que escolheram o mesmo número. Mensagem
    -- útil em vez do erro cru do Postgres: quem chegou depois precisa saber
    -- o que fazer, e o número livre já vai na resposta.
    raise exception 'O número % já foi usado em outro relatório. Sugestão livre: %.',
      v_num, public.sugerir_numero(v_rel.tipo_codigo);
  end;

  insert into public.auditoria (relatorio_id, evento, detalhe, autor)
  values (p_id, 'RELATORIO CONCLUIDO',
          'Laudo: ' || (case p_laudo when 'aprovado' then 'APROVADO' else 'NÃO CONFORME' end) ||
          ' • Nº ' || v_num, v_perf.nome);

  return v_rel;
end $$;


-- Abre uma revisão de um laudo já emitido.
-- O original permanece intocado; nasce um rascunho novo, com os mesmos dados
-- e as mesmas fotos, ligado ao anterior por origem_id. O motivo é obrigatório
-- — em auditoria de SGQ, revisão sem justificativa registrada não se sustenta.
create or replace function public.criar_revisao(p_id uuid, p_motivo text)
returns public.relatorios language plpgsql security definer set search_path = public as $$
declare
  v_orig public.relatorios;
  v_nova public.relatorios;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Descreva o motivo da revisão.';
  end if;

  select * into v_orig from public.relatorios where id = p_id;
  if v_orig.id is null then raise exception 'Relatório não encontrado.'; end if;
  if v_orig.status <> 'concluido' then
    raise exception 'Só um relatório concluído pode ser revisado.';
  end if;
  -- Quem revisa é quem assina. O admin não emite laudo em nome de terceiro.
  if v_orig.inspetor_id <> auth.uid() then
    raise exception 'Somente o inspetor autor pode revisar este relatório.';
  end if;
  if not public.sou_ativo() then raise exception 'Usuário inativo.'; end if;

  if exists (select 1 from public.relatorios where origem_id = p_id) then
    raise exception 'Este relatório já tem uma revisão aberta ou emitida.';
  end if;

  insert into public.relatorios
    (tipo_codigo, schema_versao, dados, inspetor_id,
     numero_base, revisao, origem_id, motivo_revisao)
  values
    (v_orig.tipo_codigo, v_orig.schema_versao, v_orig.dados, v_orig.inspetor_id,
     coalesce(v_orig.numero_base, v_orig.numero), v_orig.revisao + 1, v_orig.id, btrim(p_motivo))
  returning * into v_nova;

  -- Fotos vêm por referência: o arquivo no Storage não é copiado.
  insert into public.relatorio_fotos (relatorio_id, campo_id, path, legenda, ordem, herdada, criado_por)
  select v_nova.id, campo_id, path, legenda, ordem, true, v_orig.inspetor_id
    from public.relatorio_fotos where relatorio_id = p_id;

  insert into public.auditoria (relatorio_id, evento, detalhe, autor)
  values (v_nova.id, 'REVISAO ABERTA',
          'Revisão ' || v_nova.revisao || ' de ' || v_orig.numero || ' • Motivo: ' || btrim(p_motivo),
          public.meu_nome());

  return v_nova;
end $$;


-- ----------------------------------------------------------------------------
-- ACESSO À ASSINATURA DE TERCEIRO, SEMPRE AUDITADO
-- ----------------------------------------------------------------------------
-- A leitura de relatório é compartilhada por decisão do negócio, então
-- registrar toda consulta seria ruído sem valor. O que continua sendo dado
-- pessoal é a ASSINATURA: ela sai do bucket privado toda vez que alguém gera
-- o PDF de um laudo de outro inspetor. É esse evento que a LGPD (art. 37)
-- pede que fique registrado — e é ele que se quer poder provar depois.
--
-- LIMITE HONESTO: isto registra o acesso feito PELA TELA. Não impede alguém
-- de pedir a signed URL direto na API com o próprio token e não deixar rastro.
-- Fechar essa brecha exigiria emitir toda signed URL por RPC. Dá para fazer
-- depois sem refazer o modelo; é decisão sua se vale o atrito.
create or replace function public.registrar_acesso_assinatura(p_relatorio uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_rel public.relatorios;
begin
  select * into v_rel from public.relatorios where id = p_relatorio;
  if v_rel.id is null then return; end if;
  if v_rel.inspetor_id = auth.uid() then return; end if;   -- a própria assinatura não é evento

  insert into public.auditoria (relatorio_id, alvo_perfil, evento, detalhe, autor)
  values (p_relatorio, v_rel.inspetor_id, 'ASSINATURA ACESSADA',
          'Assinatura de ' || coalesce(v_rel.inspetor_nome_snapshot, '?') ||
          ' exibida na emissão do documento Nº ' || coalesce(v_rel.numero, '(rascunho)'),
          public.meu_nome());
end $$;


-- ============================================================================
-- 8. GATILHOS DE INVARIANTE
-- ============================================================================

-- Carimbo de auditoria. criado_em/criado_por são IMUTÁVEIS: o cliente pode
-- mandar o que quiser no payload, o gatilho restaura o valor original.
create or replace function public.tg_carimbo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();
  if tg_op = 'UPDATE' then
    new.criado_em  := old.criado_em;
    new.criado_por := old.criado_por;
  end if;
  return new;
end $$;

drop trigger if exists relatorios_carimbo on public.relatorios;
create trigger relatorios_carimbo before insert or update on public.relatorios
  for each row execute function public.tg_carimbo();


-- IMUTABILIDADE DO LAUDO EMITIDO.
-- Um relatório concluído é documento formal: não se edita. Correção vira
-- revisão (novo relatório). Isto é o coração da rastreabilidade — sem ele o
-- PDF baixado hoje pode não corresponder ao registro de amanhã.
create or replace function public.tg_relatorio_imutavel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'concluido' then
    raise exception 'Relatório % já concluído: registro imutável.', coalesce(old.numero, old.id::text);
  end if;
  return new;
end $$;

drop trigger if exists relatorios_imutavel on public.relatorios;
create trigger relatorios_imutavel before update on public.relatorios
  for each row
  -- A função concluir_relatorio() é security definer e roda com o dono da
  -- função; o guard abaixo deixa passar exatamente a transição de conclusão.
  when (old.status = 'concluido')
  execute function public.tg_relatorio_imutavel();

drop trigger if exists relatorios_sem_delete on public.relatorios;
create or replace function public.tg_relatorio_sem_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'concluido' and not public.sou_admin() then
    raise exception 'Relatório concluído não pode ser excluído.';
  end if;
  return old;
end $$;
create trigger relatorios_sem_delete before delete on public.relatorios
  for each row execute function public.tg_relatorio_sem_delete();


-- Foto só entra ou sai enquanto o relatório é rascunho.
create or replace function public.tg_foto_so_em_rascunho()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.relatorios
   where id = coalesce(new.relatorio_id, old.relatorio_id);
  if v_status = 'concluido' then
    raise exception 'Relatório concluído: as fotos não podem mais ser alteradas.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists fotos_so_em_rascunho on public.relatorio_fotos;
create trigger fotos_so_em_rascunho before insert or update or delete on public.relatorio_fotos
  for each row execute function public.tg_foto_so_em_rascunho();


-- Perfil: papel e ativo só mudam por admin; ninguém se promove.
create or replace function public.tg_perfil_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();

  if tg_op = 'INSERT' then
    -- ESCALAÇÃO DE PRIVILÉGIO, fechada aqui.
    -- A policy perfil_criar aceita `id = auth.uid()`, ou seja, o usuário pode
    -- inserir a PRÓPRIA linha. Sem esta trava ele a inseriria com
    -- papel='admin' e viraria administrador sozinho.
    --
    -- `auth.uid() is not null` distingue a origem: toda chamada vinda do
    -- navegador tem uid (a policy é `to authenticated`; sem sessão, o insert
    -- nem chega aqui). uid nulo só acontece no SQL Editor e na Edge Function
    -- com service_role — os dois caminhos confiáveis, e é por eles que o
    -- PRIMEIRO admin é criado, quando ainda não existe admin nenhum.
    if new.papel is distinct from 'inspetor'
       and auth.uid() is not null
       and not public.sou_admin() then
      raise exception 'Somente o administrador define o papel de um usuário.';
    end if;

  elsif tg_op = 'UPDATE' then
    new.id         := old.id;
    new.criado_em  := old.criado_em;
    new.criado_por := old.criado_por;
    if (new.papel is distinct from old.papel or new.ativo is distinct from old.ativo)
       and not public.sou_admin() then
      raise exception 'Somente o administrador altera papel ou situação de acesso.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists perfis_guarda on public.perfis;
create trigger perfis_guarda before insert or update on public.perfis
  for each row execute function public.tg_perfil_guarda();


-- ============================================================================
-- 9. PERMISSÃO POR COLUNA
-- ----------------------------------------------------------------------------
-- O Supabase concede tudo por padrão. Derrubamos e devolvemos coluna a coluna.
-- É ISTO — e não a RLS — que impede o cliente de escrever `status`,
-- `numero`, `laudo` ou os snapshots. Essas colunas só mudam pela função
-- concluir_relatorio(). RLS decide QUAIS LINHAS; grant decide QUAIS COLUNAS.
-- ============================================================================
revoke all on public.perfis, public.relatorios, public.relatorio_fotos,
              public.auditoria, public.tipos_relatorio
  from anon, authenticated;

-- PERFIS
grant select (id, nome, papel, ativo, matricula, telefone,
              assinatura_path, assinatura_atualizada_em,
              consentimento_em, consentimento_versao, exclusao_solicitada_em,
              criado_em, atualizado_em)                    on public.perfis to authenticated;
grant insert (id, nome, papel, matricula, telefone,
              consentimento_em, consentimento_versao)      on public.perfis to authenticated;
grant update (nome, matricula, telefone,
              assinatura_path, assinatura_atualizada_em,
              consentimento_em, consentimento_versao,
              exclusao_solicitada_em, papel, ativo)        on public.perfis to authenticated;
-- sem delete: apagar inspetor é apagar autoria de laudo. Ver seção 11 (LGPD).

-- RELATÓRIOS
grant select (id, tipo_codigo, schema_versao, numero, numero_base,
              revisao, origem_id, motivo_revisao, status, laudo, dados,
              inspetor_id, inspetor_nome_snapshot,
              assinatura_path_snapshot, concluido_em,
              criado_em, criado_por, atualizado_em, atualizado_por)
                                                           on public.relatorios to authenticated;
grant insert (id, tipo_codigo, schema_versao, dados, inspetor_id, numero)
                                                           on public.relatorios to authenticated;
grant update (dados, numero)                               on public.relatorios to authenticated;
grant delete                                               on public.relatorios to authenticated;
-- `numero` é gravável pelo cliente porque a numeração é manual. O que o
-- protege depois de emitido não é o grant, é o gatilho de imutabilidade
-- (seção 8) somado à política rel_alterar, que só aceita rascunho.
--
-- Note o que NÃO está aqui: status, laudo, revisao, origem_id, numero_base,
-- motivo_revisao e os snapshots. Nada disso o cliente escreve — só
-- concluir_relatorio() e criar_revisao().

-- FOTOS
grant select (id, relatorio_id, campo_id, path, legenda, ordem, herdada, criado_em, criado_por)
                                                           on public.relatorio_fotos to authenticated;
grant insert (id, relatorio_id, campo_id, path, legenda, ordem)
                                                           on public.relatorio_fotos to authenticated;
grant update (legenda, ordem)                              on public.relatorio_fotos to authenticated;
grant delete                                               on public.relatorio_fotos to authenticated;

-- AUDITORIA: lê e acrescenta. Nunca altera nem apaga.
grant select (id, relatorio_id, alvo_perfil, ts, evento, detalhe, autor, autor_id)
                                                           on public.auditoria to authenticated;
grant insert (relatorio_id, alvo_perfil, evento, detalhe, autor)
                                                           on public.auditoria to authenticated;

-- CATÁLOGO: leitura para todos; escrita só por admin (via RLS abaixo).
grant select (codigo, nome, prefixo, doc_ref, ativo, ordem) on public.tipos_relatorio to authenticated;
grant update (ativo, nome, doc_ref, ordem)                  on public.tipos_relatorio to authenticated;

grant execute on function public.sugerir_numero(text)                  to authenticated;
grant execute on function public.mascara_numero(text)                  to authenticated;
grant execute on function public.numero_em_uso(text, uuid)             to authenticated;
grant execute on function public.concluir_relatorio(uuid, text)        to authenticated;
grant execute on function public.criar_revisao(uuid, text)             to authenticated;
grant execute on function public.registrar_acesso_assinatura(uuid)     to authenticated;


-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Nenhuma política atende `anon`. Sem sessão, o banco não devolve uma linha.
-- ============================================================================
alter table public.perfis           enable row level security;
alter table public.relatorios       enable row level security;
alter table public.relatorio_fotos  enable row level security;
alter table public.auditoria        enable row level security;
alter table public.tipos_relatorio  enable row level security;
-- Se você já rodou a versão anterior deste arquivo, a tabela de contadores
-- ficou órfã. Pode remover:  drop table if exists public.contadores;

-- ---- PERFIS ----
-- Inspetor enxerga só a si mesmo: a lista de colegas não é dado necessário
-- para o trabalho dele (minimização, LGPD art. 6º, III).
drop policy if exists perfil_ler on public.perfis;
create policy perfil_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.sou_admin());

drop policy if exists perfil_criar on public.perfis;
create policy perfil_criar on public.perfis for insert to authenticated
  with check (id = auth.uid() or public.sou_admin());

drop policy if exists perfil_alterar on public.perfis;
create policy perfil_alterar on public.perfis for update to authenticated
  using (id = auth.uid() or public.sou_admin())
  with check (id = auth.uid() or public.sou_admin());

-- ---- RELATÓRIOS ----
-- LEITURA COMPARTILHADA, por decisão do negócio: todo inspetor ativo enxerga
-- os laudos EMITIDOS por qualquer colega — é acervo técnico da equipe.
--
-- O rascunho, não: documento em elaboração não é documento. Enquanto está em
-- rascunho só o autor vê. O admin vê tudo, inclusive rascunho.
--
-- Isto abre a LEITURA e só ela. Escrita, conclusão e revisão continuam
-- presas ao autor nas políticas abaixo.
drop policy if exists rel_ler on public.relatorios;
create policy rel_ler on public.relatorios for select to authenticated
  using (public.sou_ativo()
         and (status = 'concluido' or inspetor_id = auth.uid() or public.sou_admin()));

-- Só cria relatório em nome próprio. `inspetor_id = auth.uid()` no with check
-- é o que impede forjar autoria de laudo técnico.
drop policy if exists rel_criar on public.relatorios;
create policy rel_criar on public.relatorios for insert to authenticated
  with check (public.sou_ativo() and inspetor_id = auth.uid());

-- Admin NÃO edita relatório de inspetor: o conteúdo técnico é do autor.
drop policy if exists rel_alterar on public.relatorios;
create policy rel_alterar on public.relatorios for update to authenticated
  using (public.sou_ativo() and inspetor_id = auth.uid() and status = 'rascunho')
  with check (public.sou_ativo() and inspetor_id = auth.uid());

-- Apagar: só rascunho, só o dono (gatilho da seção 8 barra o concluído).
drop policy if exists rel_apagar on public.relatorios;
create policy rel_apagar on public.relatorios for delete to authenticated
  using (public.sou_ativo() and inspetor_id = auth.uid() and status = 'rascunho');

-- ---- FOTOS ---- (herdam o acesso do relatório pai)
drop policy if exists foto_ler on public.relatorio_fotos;
create policy foto_ler on public.relatorio_fotos for select to authenticated
  using (public.sou_ativo() and exists (
           select 1 from public.relatorios r
            where r.id = relatorio_id
              and (r.status = 'concluido' or r.inspetor_id = auth.uid() or public.sou_admin())));

drop policy if exists foto_criar on public.relatorio_fotos;
create policy foto_criar on public.relatorio_fotos for insert to authenticated
  with check (exists (select 1 from public.relatorios r
                       where r.id = relatorio_id and r.inspetor_id = auth.uid()
                         and r.status = 'rascunho'));

drop policy if exists foto_alterar on public.relatorio_fotos;
create policy foto_alterar on public.relatorio_fotos for update to authenticated
  using (exists (select 1 from public.relatorios r
                  where r.id = relatorio_id and r.inspetor_id = auth.uid() and r.status = 'rascunho'))
  with check (exists (select 1 from public.relatorios r
                       where r.id = relatorio_id and r.inspetor_id = auth.uid() and r.status = 'rascunho'));

drop policy if exists foto_apagar on public.relatorio_fotos;
create policy foto_apagar on public.relatorio_fotos for delete to authenticated
  using (exists (select 1 from public.relatorios r
                  where r.id = relatorio_id and r.inspetor_id = auth.uid() and r.status = 'rascunho'));

-- ---- AUDITORIA ----
drop policy if exists aud_ler on public.auditoria;
create policy aud_ler on public.auditoria for select to authenticated
  using (public.sou_admin() or autor_id = auth.uid());

drop policy if exists aud_criar on public.auditoria;
create policy aud_criar on public.auditoria for insert to authenticated
  with check (public.sou_ativo() and autor_id = auth.uid());

-- ---- CATÁLOGO ----
drop policy if exists tipos_ler on public.tipos_relatorio;
create policy tipos_ler on public.tipos_relatorio for select to authenticated
  using (public.sou_ativo());

drop policy if exists tipos_alterar on public.tipos_relatorio;
create policy tipos_alterar on public.tipos_relatorio for update to authenticated
  using (public.sou_admin()) with check (public.sou_admin());


-- ============================================================================
-- 11. STORAGE — BUCKETS PRIVADOS
-- ----------------------------------------------------------------------------
-- public = false nos dois. Bucket público não tem RLS: a URL vaza e o arquivo
-- fica aberto na internet para sempre. Assinatura é dado pessoal; foto de
-- inspeção é informação de cliente sob contrato. Nenhum dos dois é público.
--
-- Convenção de caminho — a PRIMEIRA pasta é sempre o uuid do dono, porque é
-- ela que as políticas comparam com auth.uid():
--   assinaturas/<user_id>/assinatura.png
--   relatorios/<inspetor_id>/<relatorio_id>/<campo_id>/<uuid>.jpg
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assinaturas', 'assinaturas', false, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorios', 'relatorios', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---- ASSINATURAS ----
-- Leitura em três casos, e só nesses:
--   1. é a sua própria assinatura;
--   2. você é o admin;
--   3. a imagem está CONGELADA em um laudo já emitido (snapshot) — é ela que
--      o PDF precisa desenhar quando um colega baixa o documento.
-- Repare que o caso 3 aponta para `assinatura_path_snapshot`, nunca para
-- `perfis.assinatura_path`: a assinatura corrente de um colega continua
-- inacessível. Só o que já virou documento fica visível.
drop policy if exists assin_ler on storage.objects;
create policy assin_ler on storage.objects for select to authenticated
  using (bucket_id = 'assinaturas' and public.sou_ativo() and (
           (storage.foldername(name))[1] = auth.uid()::text
           or public.sou_admin()
           or exists (select 1 from public.relatorios r
                       where r.assinatura_path_snapshot = storage.objects.name
                         and r.status = 'concluido')));

drop policy if exists assin_enviar on storage.objects;
create policy assin_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'assinaturas'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.sou_ativo());

-- Sem policy de UPDATE em 'assinaturas': sobrescrever é justamente o que não
-- pode acontecer. Troca de assinatura = arquivo novo + novo assinatura_path.

-- APAGAR ASSINATURA: só o admin, e só como execução do direito de exclusão
-- (LGPD art. 18, VI). O inspetor NÃO apaga a própria — trocar a assinatura
-- grava um arquivo NOVO (<uid>/<uuid>.png), nunca sobrescreve o anterior.
-- Se sobrescrevesse, todo PDF já emitido passaria a exibir a assinatura nova:
-- o laudo mudaria sozinho depois de assinado.
drop policy if exists assin_apagar on storage.objects;
create policy assin_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'assinaturas' and public.sou_admin());

-- ---- FOTOS DE RELATÓRIO ----
-- Mesma lógica: foto de rascunho alheio, não. Foto que já compõe um laudo
-- emitido, sim — é parte do acervo técnico que a equipe consulta.
drop policy if exists foto_obj_ler on storage.objects;
create policy foto_obj_ler on storage.objects for select to authenticated
  using (bucket_id = 'relatorios' and public.sou_ativo() and (
           (storage.foldername(name))[1] = auth.uid()::text
           or public.sou_admin()
           or exists (select 1 from public.relatorio_fotos f
                        join public.relatorios r on r.id = f.relatorio_id
                       where f.path = storage.objects.name and r.status = 'concluido')));

drop policy if exists foto_obj_enviar on storage.objects;
create policy foto_obj_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'relatorios'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.sou_ativo());

-- Apagar foto: só a sua, e só enquanto nenhum laudo emitido depende dela.
-- Sem a segunda condição, o autor poderia esvaziar as fotos de um relatório
-- já concluído — o registro continuaria íntegro e o documento, furado.
drop policy if exists foto_obj_apagar on storage.objects;
create policy foto_obj_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'relatorios'
         and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from public.relatorio_fotos f
                           join public.relatorios r on r.id = f.relatorio_id
                          where f.path = storage.objects.name and r.status = 'concluido'));


-- ============================================================================
-- 12. LGPD — DIREITOS DO TITULAR
-- ----------------------------------------------------------------------------
-- Art. 18: acesso, retificação, portabilidade e eliminação.
-- Retificação (nome, matrícula, telefone, assinatura) já é a tela de perfil.
-- ============================================================================

-- Art. 18, II e V — acesso e portabilidade. O titular baixa tudo que é dele.
create or replace function public.exportar_meus_dados()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão necessária.'; end if;

  select jsonb_build_object(
    'gerado_em',  now(),
    'perfil',     (select to_jsonb(p) from public.perfis p where p.id = auth.uid()),
    'relatorios', coalesce((select jsonb_agg(to_jsonb(r) order by r.criado_em)
                              from public.relatorios r where r.inspetor_id = auth.uid()), '[]'::jsonb),
    'fotos',      coalesce((select jsonb_agg(to_jsonb(f) order by f.criado_em)
                              from public.relatorio_fotos f
                              join public.relatorios r on r.id = f.relatorio_id
                             where r.inspetor_id = auth.uid()), '[]'::jsonb)
  ) into v_out;

  insert into public.auditoria (alvo_perfil, evento, detalhe, autor)
  values (auth.uid(), 'EXPORTACAO LGPD', 'Titular exportou os próprios dados.', public.meu_nome());

  return v_out;
end $$;

-- Art. 18, VI — o titular PEDE a eliminação. O sistema registra o pedido;
-- não apaga na hora. O laudo técnico assinado tem prazo legal e contratual
-- de guarda, e a base legal do tratamento não é só o consentimento.
create or replace function public.solicitar_exclusao()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão necessária.'; end if;
  update public.perfis set exclusao_solicitada_em = now() where id = auth.uid();
  insert into public.auditoria (alvo_perfil, evento, detalhe, autor)
  values (auth.uid(), 'EXCLUSAO SOLICITADA',
          'Titular solicitou eliminação dos dados pessoais.', public.meu_nome());
end $$;

-- Execução da eliminação, pelo admin. Anonimiza o perfil e desliga a
-- assinatura, PRESERVANDO os laudos já emitidos (obrigação legal, LGPD
-- art. 16, I) com o nome congelado no snapshot — o documento continua
-- rastreável, o dado vivo some.
create or replace function public.anonimizar_perfil(p_perfil uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if not public.sou_admin() then raise exception 'Somente o administrador.'; end if;
  select nome into v_nome from public.perfis where id = p_perfil;

  update public.perfis set
    nome        = 'Titular removido',
    matricula   = null, telefone = null,
    assinatura_path = null, assinatura_atualizada_em = null,
    ativo       = false
  where id = p_perfil;

  insert into public.auditoria (alvo_perfil, evento, detalhe, autor)
  values (p_perfil, 'ANONIMIZACAO LGPD',
          'Perfil anonimizado. Laudos emitidos preservados por obrigação legal.', public.meu_nome());

  -- LIMITE A DECLARAR AO TITULAR, e não a esconder dele:
  -- a assinatura CORRENTE some (arquivo apagado pela tela do admin logo em
  -- seguida — SQL não alcança o Storage). As assinaturas já CONGELADAS em
  -- laudos emitidos permanecem: são parte de documento técnico com prazo
  -- legal de guarda (LGPD art. 16, I). O aviso de consentimento precisa
  -- dizer isso com todas as letras, senão o direito prometido não existe.
end $$;

-- Descarte por retenção: rascunhos abandonados não viram acervo.
create or replace function public.descartar_rascunhos_antigos(p_meses integer default 6)
returns integer language plpgsql security definer set search_path = public as $$
declare v_qtd integer;
begin
  if not public.sou_admin() then raise exception 'Somente o administrador.'; end if;
  delete from public.relatorios
   where status = 'rascunho' and atualizado_em < now() - (p_meses || ' months')::interval;
  get diagnostics v_qtd = row_count;
  insert into public.auditoria (evento, detalhe, autor)
  values ('DESCARTE LGPD', v_qtd || ' rascunho(s) descartado(s).', public.meu_nome());
  return v_qtd;
end $$;

grant execute on function public.exportar_meus_dados()               to authenticated;
grant execute on function public.solicitar_exclusao()                to authenticated;
grant execute on function public.anonimizar_perfil(uuid)             to authenticated;
grant execute on function public.descartar_rascunhos_antigos(integer) to authenticated;


-- ============================================================================
-- 13. PRIMEIRO ADMIN
-- ----------------------------------------------------------------------------
-- 1) Authentication → Users → Add user, COM "Auto Confirm User" marcado.
-- 2) Copie o UUID gerado e rode o INSERT abaixo.
--
-- Rodado ANTES de o usuário existir, o INSERT não insere nada e NÃO AVISA
-- (o select interno volta vazio). Confira sempre com o bloco DIAGNÓSTICO.
-- ============================================================================
insert into public.perfis (id, nome, papel, ativo, matricula, consentimento_em, consentimento_versao)
select '4462db0d-351a-4553-ba31-9ed225d0f1c1', 'João Victor Amaral', 'admin', true, '0001', now(), 'v1'
    from auth.users where email = 'joao@perpec.com.br'
    on conflict (id) do update set papel = 'admin', ativo = true;


-- ============================================================================
-- 14. DIAGNÓSTICO
-- ----------------------------------------------------------------------------
-- Quando o login "não funciona", rode isto ANTES de mexer em qualquer código.
-- Na esmagadora maioria das vezes o usuário existe em auth.users e não tem
-- linha em perfis — aí toda função de apoio devolve false e nada aparece.
-- ============================================================================
-- select u.id, u.email, u.email_confirmed_at, u.last_sign_in_at,
--        p.nome, p.papel, p.ativo,
--        case when p.id is null then '>>> SEM PERFIL — crie a linha em public.perfis'
--             when not p.ativo  then '>>> PERFIL INATIVO'
--             else 'ok' end as diagnostico
--   from auth.users u
--   left join public.perfis p on p.id = u.id
--  order by u.created_at;

-- Conferência da blindagem: nenhuma linha deve aparecer com rls_ligada = false.
-- select relname as tabela, relrowsecurity as rls_ligada
--   from pg_class
--  where relnamespace = 'public'::regnamespace and relkind = 'r'
--  order by 1;

-- Conferência dos buckets: as duas linhas devem ter public = false.
-- select id, public, file_size_limit from storage.buckets;
