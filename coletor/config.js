// =====================================================================
// Configuração de conexão com o banco de dados (Supabase).
//
// SUPABASE_URL / SUPABASE_ANON_KEY: o banco DESTE sistema (INVENTRA) —
// onde ficam as tarefas de armazenagem/separação/conferência. Não mude.
//
// DARVIK_SUPABASE_URL / DARVIK_SUPABASE_ANON_KEY (novo): o banco do
// sistema DARVIK (DarvikControl) — usado SÓ para o login, para que o
// mesmo usuário/senha cadastrado no DARVIK funcione aqui também. Copie
// os mesmos dois valores que já estão no arquivo js/config.js do projeto
// DARVIK (a URL já vem preenchida abaixo; falta só colar a chave, a
// mesma "anon public"/"Publishable key" que você já usa lá — não precisa
// ir buscar de novo no painel do Supabase).
// =====================================================================
window.COLETOR_CONFIG = {
  SUPABASE_URL: "https://briqhbtdqewcqhnqqjfn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_0LWBy6Kl6hGVzKvCakxLRA_bJ8gA5Pd",

  DARVIK_SUPABASE_URL: "https://ddundjcmviggfaugbyuv.supabase.co",
  DARVIK_SUPABASE_ANON_KEY: "sb_publishable_INIMiFa7N2_pwspoq4ekAQ_vub3lQIz"
};
