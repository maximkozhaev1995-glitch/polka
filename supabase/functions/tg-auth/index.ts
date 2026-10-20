// Вход через Telegram Mini App: проверяем подпись initData, находим сотрудника, выдаём JWT для базы.
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors });

async function hmac(key: BufferSource, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64u = (u: Uint8Array | string) => {
  const b = typeof u === "string" ? enc.encode(u) : u;
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function checkInitData(initData: string, botToken: string) {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, dcs));
  if (calc !== hash) return null;
  const age = Math.floor(Date.now() / 1000) - Number(p.get("auth_date") || 0);
  if (age > 86400) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

async function signJwt(payload: Record<string, unknown>, secret: string) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const b = b64u(JSON.stringify(payload));
  const sig = await hmac(enc.encode(secret), `${h}.${b}`);
  return `${h}.${b}.${b64u(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { initData, invite } = await req.json();
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const jwtSecret = Deno.env.get("APP_JWT_SECRET");
    if (!botToken || !jwtSecret) return json({ error: "server_not_configured" }, 500);
    const tg = await checkInitData(String(initData || ""), botToken);
    if (!tg || !tg.id) return json({ error: "bad_signature" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let { data: user } = await db.from("users").select("*").eq("tg_id", tg.id).maybeSingle();

    if (!user) {
      if (!invite) return json({ error: "need_invite" }, 403);
      const { data: inv } = await db.from("invites").select("*").eq("code", String(invite).trim()).is("used_by", null).maybeSingle();
      if (!inv) return json({ error: "bad_invite" }, 403);
      const name = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || String(tg.id);
      const ins = await db.from("users").insert({ tg_id: tg.id, venue_id: inv.venue_id, name, role: inv.role }).select().single();
      if (ins.error) return json({ error: "cannot_create_user" }, 500);
      user = ins.data;
      await db.from("invites").update({ used_by: tg.id }).eq("code", inv.code);
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({
      aud: "authenticated", role: "authenticated", sub: String(tg.id), tg_id: tg.id,
      iat: now, exp: now + 12 * 3600,
    }, jwtSecret);
    return json({ token, user });
  } catch (e) {
    return json({ error: "server_error", detail: String(e) }, 500);
  }
});
