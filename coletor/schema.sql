-- =====================================================================
-- Estoque Messias — Coletor (Armazenagem / Separação / Conferência)
-- Script de criação do banco de dados + dados iniciais (migrados do
-- sistema principal). Rode este script inteiro no SQL Editor do Supabase
-- (Project > SQL Editor > New query > colar tudo > Run).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- COLABORADORES (usuários do coletor — login com usuário e senha)
-- ---------------------------------------------------------------------
create table if not exists colaboradores (
  id text primary key,
  username text unique not null,
  password_hash text not null,
  name text not null,
  role text not null default 'OPERADOR_ESTOQUE',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table colaboradores enable row level security;
-- Nenhuma policy criada de propósito: ninguém lê/grava esta tabela
-- diretamente pela chave anônima. O login só é possível pela função
-- verify_login() abaixo, que roda com privilégios elevados (security definer).

-- ---------------------------------------------------------------------
-- CATÁLOGO
-- ---------------------------------------------------------------------
create table if not exists categorias (
  id text primary key,
  name text not null
);

create table if not exists produtos (
  id text primary key,
  sku text unique not null,
  name text not null,
  category_id text references categorias(id),
  brand text,
  price numeric,
  variations jsonb not null default '[]'::jsonb, -- [{id,name}]
  created_at timestamptz not null default now()
);

create table if not exists localizacoes (
  id text primary key,
  corridor text,
  shelf text,
  level text,
  capacity numeric not null default 0,
  code text unique not null,
  qr_payload text not null
);

-- ---------------------------------------------------------------------
-- ESTOQUE
-- ---------------------------------------------------------------------
create table if not exists estoque (
  id text primary key,
  product_id text not null references produtos(id),
  variation_id text,
  location_id text not null references localizacoes(id),
  quantity numeric not null default 0
);

create table if not exists movimentacoes_estoque (
  id text primary key,
  type text not null,               -- entrada | saida | ajuste
  product_id text not null,
  variation_id text,
  quantity numeric not null,
  location_id text,
  user_id text,
  user_name text,
  "timestamp" timestamptz not null default now(),
  ref_type text,
  ref_id text,
  note text
);

-- ---------------------------------------------------------------------
-- ARMAZENAGEM (fila gerada pelo recebimento no sistema principal)
-- ---------------------------------------------------------------------
create table if not exists tarefas_armazenagem (
  id text primary key,
  po_id text,
  po_item_id text,
  product_id text not null references produtos(id),
  variation_id text,
  qty_pending numeric not null default 0,
  suggested_location_id text references localizacoes(id),
  status text not null default 'PENDENTE'   -- PENDENTE | CONCLUIDO
);

-- ---------------------------------------------------------------------
-- VENDAS / SEPARAÇÃO / CONFERÊNCIA
-- ---------------------------------------------------------------------
create table if not exists pedidos_venda (
  id text primary key,
  code text unique not null,
  channel text not null default 'LOJA',
  customer_id text,
  status text not null default 'AGUARDANDO_SEPARACAO',
  priority text not null default 'NORMAL',
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists itens_pedido_venda (
  id text primary key,
  pedido_id text not null references pedidos_venda(id) on delete cascade,
  product_id text not null references produtos(id),
  variation_id text,
  qty numeric not null default 0,
  location_id text references localizacoes(id),
  separated boolean not null default false,
  conferred boolean not null default false
);

create table if not exists auditoria (
  id text primary key,
  "timestamp" timestamptz not null default now(),
  user_id text,
  user_name text,
  action text,
  entity_type text,
  entity_id text,
  details text
);

-- =====================================================================
-- RLS: liberado para a chave anônima (o controle de acesso real é o
-- login por usuário/senha na tela inicial do coletor — mesmo nível de
-- proteção que o sistema principal já usa hoje).
-- =====================================================================
alter table categorias enable row level security;
alter table produtos enable row level security;
alter table localizacoes enable row level security;
alter table estoque enable row level security;
alter table movimentacoes_estoque enable row level security;
alter table tarefas_armazenagem enable row level security;
alter table pedidos_venda enable row level security;
alter table itens_pedido_venda enable row level security;
alter table auditoria enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  categorias, produtos, localizacoes, estoque, movimentacoes_estoque,
  tarefas_armazenagem, pedidos_venda, itens_pedido_venda, auditoria
to anon, authenticated;

create policy "anon full access" on categorias for all to anon using (true) with check (true);
create policy "anon full access" on produtos for all to anon using (true) with check (true);
create policy "anon full access" on localizacoes for all to anon using (true) with check (true);
create policy "anon full access" on estoque for all to anon using (true) with check (true);
create policy "anon full access" on movimentacoes_estoque for all to anon using (true) with check (true);
create policy "anon full access" on tarefas_armazenagem for all to anon using (true) with check (true);
create policy "anon full access" on pedidos_venda for all to anon using (true) with check (true);
create policy "anon full access" on itens_pedido_venda for all to anon using (true) with check (true);
create policy "anon full access" on auditoria for all to anon using (true) with check (true);

-- =====================================================================
-- LOGIN: função que verifica usuário + senha sem expor a tabela
-- colaboradores (nem o hash da senha) para a chave anônima.
-- =====================================================================
create or replace function verify_login(p_username text, p_password text)
returns table(id text, name text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select c.id, c.name, c.role
    from colaboradores c
    where lower(c.username) = lower(p_username)
      and c.active = true
      and c.password_hash = crypt(p_password, c.password_hash);
end;
$$;

grant execute on function verify_login(text, text) to anon;

-- =====================================================================
-- DADOS INICIAIS (migrados do sistema principal em 07/09/2026)
-- =====================================================================

-- Colaboradores — senha inicial provisória: "1234" para todos.
-- IMPORTANTE: troque essas senhas depois (rode um UPDATE nesta tabela
-- com um novo crypt('nova-senha', gen_salt('bf'))). Isso não faz parte
-- do coletor ainda — não há tela de "trocar senha" nesta primeira versão.
insert into colaboradores (id, username, password_hash, name, role, active) values
  ('u1', 'administrador', crypt('1234', gen_salt('bf')), 'Administrador', 'ADMIN', true),
  ('user-1', 'inventra.oficial', crypt('1234', gen_salt('bf')), 'INVENTRA.OFICIAL', 'ADMIN', true)
on conflict (id) do nothing;

insert into categorias (id, name) values
  ('cat-1', 'vestidos')
on conflict (id) do nothing;

insert into produtos (id, sku, name, category_id, brand, price, variations) values
  ('prod-1', 'SKU-0001', 'Vestido Midi', 'cat-1', 'Brito Modas', 45,
   '[{"id":"var-r6izeni","name":"Preto"},{"id":"var-m60g10n","name":"Branco"},{"id":"var-7q357hv","name":"Bege"}]'::jsonb)
on conflict (id) do nothing;

insert into localizacoes (id, corridor, shelf, level, capacity, code, qr_payload) values
  ('loc-1', 'A', '3', '1', 30, 'A-3-1', 'LOC:loc-1')
on conflict (id) do nothing;

insert into estoque (id, product_id, variation_id, location_id, quantity) values
  ('stock-1', 'prod-1', 'var-r6izeni', 'loc-1', 20)
on conflict (id) do nothing;

insert into tarefas_armazenagem (id, po_id, po_item_id, product_id, variation_id, qty_pending, suggested_location_id, status) values
  ('storage-1', 'po-1', 'poi-1', 'prod-1', 'var-r6izeni', 0, 'loc-1', 'CONCLUIDO'),
  ('storage-2', 'po-2', 'poi-2', 'prod-1', 'var-r6izeni', 20, 'loc-1', 'PENDENTE'),
  ('storage-3', 'po-2', 'poi-3', 'prod-1', 'var-7q357hv', 50, 'loc-1', 'PENDENTE')
on conflict (id) do nothing;

insert into pedidos_venda (id, code, channel, customer_id, status, priority, created_at, created_by) values
  ('so-1', 'PED-0001', 'LOJA', null, 'AGUARDANDO_SEPARACAO', 'ALTA', to_timestamp(1788231114.779), 'u1'),
  ('so-2', 'PED-0002', 'LOJA', null, 'EM_CONFERENCIA', 'ALTA', to_timestamp(1788403889.151), 'user-1')
on conflict (id) do nothing;

insert into itens_pedido_venda (id, pedido_id, product_id, variation_id, qty, location_id, separated, conferred) values
  ('soi-1', 'so-1', 'prod-1', 'var-r6izeni', 2, null, false, false),
  ('soi-2', 'so-2', 'prod-1', null, 0, null, true, false)
on conflict (id) do nothing;

-- Fim do script.
