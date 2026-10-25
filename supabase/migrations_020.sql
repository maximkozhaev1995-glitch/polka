-- Дозаполнение каталога: Sapphire Crown Hazelnut Crush и Deus Cigar II (по решению Максима 2026-10-25).
-- Только добавление, существующее не трогается.
insert into flavors (id, brand, line, name, descr, strength, sectors, tags, cats, custom, pack_g) values
  ('e9b2449308f6', 'Sapphire Crown', '', 'Hazelnut Crush', 'лесной орех', 5, '{}', '{}', '{}', false, 200),
  ('48eb123059e8', 'Deus', '', 'Cigar II', 'сигарный табак', 5, '{}', '{}', '{}', false, 250)
on conflict (id) do nothing;
