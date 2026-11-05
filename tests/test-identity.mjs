export async function testIdentity(db, id, extra = {}) {
  // Trusted fixture setup only. Exercise production RLS with the member's real epoch.
  await db.query('reset role');
  const {rows:[member]} = await db.query("select to_jsonb(u)->>'membership_epoch' epoch from users u where tg_id=$1", [id]);
  await db.query('set role authenticated');
  return {sub:String(id),tg_id:id,role:'authenticated',membership_epoch:member?.epoch,...extra};
}
