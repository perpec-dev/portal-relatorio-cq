// ============================================================================
// admin-criar-inspetor — Supabase Edge Function (Deno)
// ----------------------------------------------------------------------------
// POR QUE ISTO EXISTE
//
// Criar um usuário no Supabase Auth exige a chave `service_role`, que é chave
// de administrador do projeto inteiro: ela IGNORA toda a RLS. No GitHub Pages
// não existe lugar seguro para guardá-la — todo o JavaScript é público.
//
// Esta função roda no servidor do Supabase, onde a chave fica em variável de
// ambiente e nunca é enviada ao navegador. O admin chama com o PRÓPRIO token
// de sessão; a função confere no banco se ele é mesmo admin antes de agir.
//
// Consequência: com isto no ar, DESLIGUE "Allow new users to sign up" no
// painel (Authentication → Providers → Email). Nenhum cadastro público.
//
// PUBLICAÇÃO (uma vez, exige o Supabase CLI):
//   supabase functions deploy admin-criar-inspetor
//   supabase secrets set ORIGENS_PERMITIDAS="https://SEU-USUARIO.github.io"
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetadas pelo runtime.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const CHAVE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHAVE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// Lista fechada de origens. Sem isso, qualquer site poderia chamar esta função
// a partir do navegador de um admin logado.
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

function cabecalhosCors(origem: string | null) {
  const permitida = origem && ORIGENS.includes(origem) ? origem : ORIGENS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": permitida,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function responder(corpo: unknown, status: number, origem: string | null) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cabecalhosCors(origem), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origem) });
  }
  if (req.method !== "POST") {
    return responder({ erro: "Método não permitido." }, 405, origem);
  }
  if (origem && !ORIGENS.includes(origem)) {
    return responder({ erro: "Origem não autorizada." }, 403, origem);
  }

  // ---- 1. Quem está chamando? -------------------------------------------
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) {
    return responder({ erro: "Sessão necessária." }, 401, origem);
  }

  // Cliente com a chave ANON + token do chamador: sujeito à RLS, como qualquer
  // navegador. É por ele que descobrimos QUEM é o chamador.
  const comoChamador = createClient(URL_SUPABASE, CHAVE_ANON, {
    global: { headers: { Authorization: autorizacao } },
    auth: { persistSession: false },
  });

  const { data: sessao, error: erroSessao } = await comoChamador.auth.getUser();
  if (erroSessao || !sessao?.user) {
    return responder({ erro: "Sessão inválida ou expirada." }, 401, origem);
  }

  // ---- 2. Ele é admin? ---------------------------------------------------
  // A verificação é feita no BANCO, contra public.perfis. Nunca contra o
  // user_metadata do JWT: aquilo o próprio usuário consegue editar via
  // updateUser — confiar nele seria entregar o papel 'admin' de graça.
  const comoServico = createClient(URL_SUPABASE, CHAVE_SERVICE, {
    auth: { persistSession: false },
  });

  const { data: perfilChamador } = await comoServico
    .from("perfis").select("nome, papel, ativo").eq("id", sessao.user.id).single();

  if (!perfilChamador || perfilChamador.papel !== "admin" || !perfilChamador.ativo) {
    return responder({ erro: "Somente o administrador cadastra inspetores." }, 403, origem);
  }

  // ---- 3. Validação da entrada ------------------------------------------
  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo da requisição inválido." }, 400, origem);
  }

  const email = String(corpo.email ?? "").trim().toLowerCase();
  const senha = String(corpo.senha ?? "");
  const nome = String(corpo.nome ?? "").trim();
  const matricula = String(corpo.matricula ?? "").trim() || null;
  const telefone = String(corpo.telefone ?? "").trim() || null;
  const papel = corpo.papel === "admin" ? "admin" : "inspetor";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return responder({ erro: "E-mail inválido." }, 400, origem);
  }
  if (senha.length < 10) {
    return responder({ erro: "A senha inicial precisa de pelo menos 10 caracteres." }, 400, origem);
  }
  if (nome.length < 5) {
    return responder({ erro: "Escreva o nome completo do inspetor." }, 400, origem);
  }

  // ---- 4. Cria o usuário -------------------------------------------------
  // email_confirm: true porque quem cadastra é o admin, presencialmente ou por
  // canal interno — não há e-mail de confirmação a esperar.
  const { data: criado, error: erroCriar } = await comoServico.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (erroCriar || !criado?.user) {
    const jaExiste = /already|registered|exists/i.test(erroCriar?.message ?? "");
    return responder(
      { erro: jaExiste ? "Já existe um usuário com este e-mail." : "Não foi possível criar o acesso." },
      jaExiste ? 409 : 500,
      origem,
    );
  }

  // ---- 5. Cria o perfil --------------------------------------------------
  // NÃO gravamos consentimento aqui: consentimento dado por terceiro não é
  // consentimento (LGPD art. 8º). O inspetor aceita o termo no primeiro
  // acesso, e a tela o segura até que aceite.
  const { error: erroPerfil } = await comoServico.from("perfis").insert({
    id: criado.user.id,
    nome,
    papel,
    matricula,
    telefone,
    ativo: true,
    criado_por: sessao.user.id,
  });

  if (erroPerfil) {
    // Sem o perfil, o usuário existiria no Auth e não seria nada no sistema:
    // logaria e não veria uma linha sequer, sem explicação. Desfaz.
    await comoServico.auth.admin.deleteUser(criado.user.id);
    const duplicado = /duplicate|unique/i.test(erroPerfil.message);
    return responder(
      { erro: duplicado ? "Esta matrícula já está em uso." : "Não foi possível criar o perfil." },
      duplicado ? 409 : 500,
      origem,
    );
  }

  await comoServico.from("auditoria").insert({
    alvo_perfil: criado.user.id,
    evento: "INSPETOR CADASTRADO",
    detalhe: `${nome} (${email}) cadastrado como ${papel}.`,
    autor: perfilChamador.nome,
    autor_id: sessao.user.id,
  });

  return responder({ id: criado.user.id, email, nome, papel }, 201, origem);
});
