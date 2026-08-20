/* ==========================================================================
   config.js — ponto único de manutenção
   --------------------------------------------------------------------------
   ESTE ARQUIVO É PÚBLICO. Ele vai inteiro para o navegador de quem abrir o
   site, e qualquer pessoa consegue lê-lo. Isso é esperado e seguro, DESDE QUE
   só contenha a chave `anon`.

   A chave `anon` não dá acesso a nada sozinha: quem decide o que cada usuário
   enxerga é a RLS, no banco. Ver supabase/schema.sql.

   >>> NUNCA coloque aqui a chave `service_role`. Ela ignora toda a RLS e
   >>> daria acesso total ao projeto para qualquer visitante do site.
   ========================================================================== */

window.SUPABASE_CONFIG = {
  // Project URL — Supabase → Settings → API → Project URL
  // SEM o /rest/v1 no fim; a biblioteca acrescenta sozinha.
  URL: "https://mbsvvbiokncwhuglacrn.supabase.co",

  // Chave anon/public — Supabase → Settings → API → Project API keys → anon
  ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ic3Z2Ymlva25jd2h1Z2xhY3JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDIwNzQsImV4cCI6MjEwMjc3ODA3NH0.NwzoAZmwgc2NMMRXJ8Du3PPYU3YnhF7-_95QXSVBQmg",

  // URL da Edge Function que cadastra inspetores. Deixe vazio para desligar o
  // cadastro pela tela (o admin passa a criar usuário pelo painel do Supabase).
  FN_CRIAR_INSPETOR: "https://SEU-PROJETO.supabase.co/functions/v1/admin-criar-inspetor"
};

window.CONFIG = {
  EMPRESA: "Perpec Oilfield Supply",
  SISTEMA: "Portal de Relatórios de Inspeção",

  // Pasta dos schemas de formulário. O arquivo é <codigo>.json.
  PASTA_FORMS: "js/forms/",

  // Pasta do gerador de PDF. É de lá que sai fontes.js (a Proxima Nova Alt
  // embarcada), buscado só na hora de gerar o primeiro documento.
  PASTA_PDF: "js/pdf/",

  // Espera entre a última tecla e a gravação do rascunho no servidor.
  // Menor = perde menos em queda de conexão; maior = menos requisições.
  AUTOSAVE_MS: 1400,

  // Redimensionamento das fotos ANTES do upload.
  // Foto de celular moderno tem 4-6 MB. Vinte delas num relatório = 100 MB no
  // bucket e um PDF que não abre. 1600px preserva leitura de trinca e solda.
  FOTO_LADO_MAX: 1600,
  FOTO_QUALIDADE: 0.82,

  // Validade da URL assinada das imagens (segundos). Curta de propósito:
  // é o que impede o link vazar e virar acesso permanente.
  URL_ASSINADA_SEG: 600,

  // Versão do termo de consentimento. MUDE junto com o texto do termo:
  // é ela que registra sobre qual redação o inspetor concordou.
  TERMO_VERSAO: "v1",

  PREFIXO_CACHE: "perpec.riv."
};
