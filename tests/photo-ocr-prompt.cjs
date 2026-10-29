// Regression checks for PR #82 server OCR guidance. No live model calls or database writes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const server = fs.readFileSync('supabase/functions/ai/index.ts', 'utf8');
const shim = fs.readFileSync('app/shim.js', 'utf8');
const built = fs.readFileSync('index.html', 'utf8');
const start = server.indexOf('const PHOTO_PROMPT = `');
const end = server.indexOf('`;', start + 22);
assert(start >= 0 && end > start, 'server prompt must exist');
const prompt = server.slice(start, end);
for (const word of [
  'Фокус: БРЕНД', 'Этикетка N:', 'Trofimoff', 'Finlandia Vanila',
  'Palitra', 'Pear Date', 'Kraken Magnum', 'S = Seco', 'L = Ligero',
  'S07', 'L07', 'Wild Strawberry', 'Raspberry', 'Peanut',
  'Наш — Бренди', 'Endorphin — Бельгийские вафли',
  'Амбровый банан', 'Maas Dam', 'не угадывай',
  'антитабачные предупреждения', 'СЛЕПОЙ', 'ГАНГРЕНА', 'ИМПОТЕНЦИЯ', 'НЕДОНОШЕННОСТЬ', 'ИНФАРКТ', 'ИНСУЛЬТ', 'МЕРТВОРОЖДЕНИЕ', 'НОВООБРАЗОВАНИЯ', 'СЛЕПОТА', 'РАК ЛЁГКОГО', 'Подробнее о последствиях', 'по контексту оформления', 'НЕ бренд'
]) assert(prompt.includes(word), 'missing server guidance: ' + word);
assert(server.includes('content: [b, { type: "text", text: PHOTO_PROMPT + hints }]'), 'Claude reader must receive PHOTO_PROMPT plus venue hints');
assert(server.includes('venuePhotoHints(db, member.data.venue_id)'), 'signed-in venue must scope learned OCR hints');
assert(server.includes('const hints = hasImg ? await venuePhotoHints'), 'OCR-only must load corrections');
assert(server.includes('Не угадывай бренд или аромат'), 'learned examples must never override unreadable labels');
assert(server.includes('if (ocr_only) { const hints = hasImg ? await venuePhotoHints'), 'OCR-only must load approved hints');
assert(server.includes('readPhotos(claude, messages, hints)'), 'OCR-only must use Claude reader with those hints');
assert(shim.includes('content:[b]}],tools:[],ocr_only:true'), 'Client must send image without discarded guidance');
assert(!shim.includes('photoOcrGuidance'), 'Dead client-side instructions must be removed');
assert(built.includes('content:[b]}],tools:[],ocr_only:true'), 'Built app must use corrected client');
assert(!built.includes('photoOcrGuidance'), 'Built app must not contain stale guidance');
assert(!prompt.includes('S07 и L07 — один'), 'Seco and Ligero must not be conflated');
console.log('PASS: server OCR guidance, confirmed examples, distinct S/L codes, image-only client, embedded build');
