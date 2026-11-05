// © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
// Вход: Telegram Mini App (подпись initData) или обычный веб через Telegram Login Widget (подпись виджета,
// другая схема secret_key — см. checkWidgetAuth). Находим сотрудника, выдаём JWT для базы.
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

// Сравнение без утечки по времени: не выходим на первом несовпавшем символе
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function checkInitData(initData: string, botToken: string) {
  const p = new URLSearchParams(initData);
  const hash = (p.get("hash") || "").toLowerCase();
  if (!hash) return null;
  p.delete("hash");
  // По документации Telegram строки сортируются по ключу
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, dcs));
  if (!sameHex(calc, hash)) return null;
  const authDate = Number(p.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > 86400 || age < -300) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

// Telegram Login Widget (для обычного браузера, без Mini App): плоский объект
// {id, first_name, last_name?, username?, photo_url?, auth_date, hash}.
// Схема подписи другая: secret_key = SHA256(botToken) напрямую, без "WebAppData".
async function checkWidgetAuth(auth: Record<string, unknown>, botToken: string) {
  if (!auth || typeof auth !== "object") return null;
  const hash = String(auth.hash || "").toLowerCase();
  if (!hash) return null;
  const dcs = Object.keys(auth).filter((k) => k !== "hash" && auth[k] !== undefined && auth[k] !== null)
    .sort().map((k) => `${k}=${auth[k]}`).join("\n");
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const calc = hex(await hmac(new Uint8Array(secret), dcs));
  if (!sameHex(calc, hash)) return null;
  const authDate = Number(auth.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > 86400 || age < -300) return null;
  const id = Number(auth.id);
  if (!Number.isFinite(id)) return null;
  return { id, first_name: auth.first_name, last_name: auth.last_name, username: auth.username };
}

async function signJwt(payload: Record<string, unknown>, secret: string) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const b = b64u(JSON.stringify(payload));
  const sig = await hmac(enc.encode(secret), `${h}.${b}`);
  return `${h}.${b}.${b64u(sig)}`;
}

async function refreshClaims(token: unknown, secret: string) {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (header.alg !== "HS256") return null;
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decode(parts[2]), enc.encode(parts[0] + "." + parts[1]))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const now = Math.floor(Date.now()/1000);
    if (claims.role !== "authenticated" || claims.aud !== "authenticated" ||
        !Number.isFinite(claims.iat) || claims.iat > now+300 || !Number.isFinite(claims.exp) ||
        !/^[0-9]{1,15}$/.test(String(claims.sub)) || String(claims.tg_id) !== claims.sub ||
        !/^[0-9a-f-]{36}$/.test(claims.sid) || !/^[0-9a-f-]{36}$/.test(claims.membership_epoch)) return null;
    // Expired access tokens can prove possession only within the server-side absolute session deadline.
    return claims;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { initData, widgetAuth, invite, session_token } = await req.json();
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const jwtSecret = Deno.env.get("APP_JWT_SECRET");
    if (!botToken || !jwtSecret) return json({ error: "server_not_configured" }, 500);
    const tg = initData ? await checkInitData(String(initData), botToken)
      : widgetAuth ? await checkWidgetAuth(widgetAuth, botToken) : null;
    if (!tg || !tg.id) return json({ error: "bad_signature" }, 401);
    const proof = initData ? new URLSearchParams(String(initData)) : null;
    const authDate = Number(proof ? proof.get("auth_date") : widgetAuth.auth_date);
    const signature = String(proof ? proof.get("hash") : widgetAuth.hash).toLowerCase();
    const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256",
      enc.encode((proof ? "mini:" : "widget:") + tg.id + ":" + signature))));
    const previous = session_token ? await refreshClaims(session_token, jwtSecret) : null;
    if (session_token && (!previous || previous.sub !== String(tg.id))) return json({ error: "session_expired" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: bound, error } = await db.rpc("bind_telegram_session", {
      p_tg_id: tg.id, p_proof_hash: digest, p_auth_date: authDate,
      p_session_id: previous?.sid || null,
      p_invite: invite ? String(invite).trim() : null,
      p_name: [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || String(tg.id),
      p_allow_invites: Deno.env.get("ALLOW_INVITE_SIGNUP") === "true",
    });
    if (error) return json({ error: "server_error" }, 500);
    if (!bound) return json({ error: "session_expired" }, 401);
    if (bound.error) return json({ error: bound.error }, 403);
    if (previous && previous.membership_epoch !== bound.membership_epoch) return json({ error: "session_expired" }, 401);
    const now = Math.floor(Date.now() / 1000);
    if (bound.expires_at <= now) return json({ error: "session_expired" }, 401);
    const token = await signJwt({
      aud: "authenticated", role: "authenticated", sub: String(tg.id), tg_id: tg.id,
      sid: bound.session_id, membership_epoch: bound.membership_epoch,
      iat: now, exp: Math.min(now + 12 * 3600, bound.expires_at),
    }, jwtSecret);
    return json({ token, user: bound.user });
  } catch {
    return json({ error: "server_error" }, 500);
  }
});
