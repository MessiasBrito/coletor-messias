-- ===========================================================================
-- DIAGNÓSTICO (SÓ LEITURA, não altera nada) — rodar no SQL Editor do projeto
-- DarvikControl. Mostra as armazenagens PENDENTES do painel e compara com o
-- que o coletor (INVENTRA) tem hoje.
--   * "concluida_no_coletor"  = o coletor já guardou, mas o painel não soube
--   * "pendente_no_coletor"   = está pendente nos dois (normal)
--   * "nunca_chegou_ao_coletor" = o painel tem, o coletor nunca recebeu
-- ===========================================================================
select
  t.id,
  po.code as pedido_de_compra,
  po.status as status_do_pedido,
  t.product_id,
  t.variation_id,
  t.qty_pending,
  case
    when t.id in ('storage-1','storage-2','storage-3','storage-4','storage-5','storage-6','storage-9','storage-10','storage-11','storage-12','storage-13','storage-14','storage-15','storage-16','storage-17','storage-18','storage-19','storage-20','storage-21','storage-22','storage-25','storage-26','storage-28') then 'concluida_no_coletor'
    when t.id = 'storage-27' then 'pendente_no_coletor'
    else 'nunca_chegou_ao_coletor'
  end as situacao
from storage_tasks t
left join purchase_orders po on po.id = t.po_id
where t.status = 'PENDENTE'
order by situacao, t.id;
