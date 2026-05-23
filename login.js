// ══════════════════════════════════════════════════════════════
//  netlify/functions/login.js — versão simplificada
//  Valida o PIN via variáveis de ambiente (sem SDK do Supabase)
//  POST /.netlify/functions/login
//  Body: { usuario: "Amanda", pin: "2026" }
// ══════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type":                 "application/json",
};

const PINS = () => ({
  Amanda:   process.env.PIN_AMANDA,
  Ricardo:  process.env.PIN_RICARDO,
  Sabrina:  process.env.PIN_SABRINA,
  Fernanda: process.env.PIN_FERNANDA,
  Gabriela: process.env.PIN_GABRIELA,
  Yasmin:   process.env.PIN_YASMIN,
});

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ erro: "Método não permitido" }) };
  }

  let usuario, pin;
  try {
    ({ usuario, pin } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: "Body inválido" }) };
  }

  if (!usuario || !pin) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: "Usuário e PIN obrigatórios" }) };
  }

  const pins = PINS();
  const pinCorreto = pins[usuario];

  // Usuário não encontrado
  if (!pinCorreto) {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ erro: "Usuário não encontrado" }) };
  }

  // PIN incorreto
  if (String(pin) !== String(pinCorreto)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ erro: "PIN incorreto" }) };
  }

  // ── Login válido — registra acesso via REST API (sem SDK) ──
  const agora       = new Date();
  const hora        = agora.getHours();
  const dia         = agora.getDay();
  const foraHorario = hora < 8 || hora >= 18;
  const fimSemana   = dia === 0 || dia === 6;

  // Registra no Supabase via fetch (sem precisar do SDK)
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (SB_URL && SB_KEY) {
    fetch(`${SB_URL}/rest/v1/access_log`, {
      method:  "POST",
      headers: {
        apikey:         SB_KEY,
        Authorization:  `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer:         "return=minimal",
      },
      body: JSON.stringify({
        user_name:        usuario,
        accessed_at:      agora.toISOString(),
        success:          true,
        is_outside_hours: foraHorario,
        is_weekend:       fimSemana,
        is_holiday:       false,
        ip_address:       event.headers["x-forwarded-for"] || "desconhecido",
        user_agent:       event.headers["user-agent"] || "",
      }),
    }).catch(() => {}); // não bloqueia o login se o log falhar
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok:       true,
      usuario,
      token:    `session_${usuario}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
    }),
  };
};
