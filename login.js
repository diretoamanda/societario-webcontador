// ══════════════════════════════════════════════════════════════
//  netlify/functions/login.js
//  POST /.netlify/functions/login
//  Body: { usuario: "Sabrina", pin: "1234" }
//  Retorna: { token, usuario, expiresAt }
// ══════════════════════════════════════════════════════════════

const {
  supabase, ok, err, preflight,
  PINS, gerarToken, classificarAcesso,
} = require("./_helpers");

exports.handler = async (event) => {
  // Responde ao preflight do CORS
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST")    return err("Método não permitido", 405);

  // ── Parse do body ──
  let usuario, pin;
  try {
    ({ usuario, pin } = JSON.parse(event.body));
  } catch {
    return err("Body inválido");
  }

  if (!usuario || !pin) return err("Usuário e PIN são obrigatórios");

  // ── Validação do PIN (acontece no servidor — nunca no browser) ──
  const pinCorreto = PINS[usuario];
  if (!pinCorreto) return err("Usuário não encontrado", 404);
  if (pinCorreto !== String(pin)) {
    // Registra tentativa falha no Supabase para auditoria
    await supabase.from("access_log").insert({
      user_name:    usuario,
      accessed_at:  new Date().toISOString(),
      success:      false,
      ip_address:   event.headers["x-forwarded-for"] || "desconhecido",
      user_agent:   event.headers["user-agent"] || "",
    }).catch(() => {}); // ignora erro de log para não bloquear a resposta

    return err("PIN incorreto", 401);
  }

  // ── Classifica o acesso (hora, dia, feriado) ──
  const acesso = classificarAcesso();

  // ── Registra acesso bem-sucedido no Supabase ──
  await supabase.from("access_log").insert({
    user_name:        usuario,
    accessed_at:      acesso.acessadoEm,
    success:          true,
    is_outside_hours: acesso.foraDoHorario,
    is_weekend:       acesso.fimDeSemana,
    is_holiday:       acesso.feriado,
    ip_address:       event.headers["x-forwarded-for"] || "desconhecido",
    user_agent:       event.headers["user-agent"] || "",
  }).catch(() => {});

  // ── Dispara alerta se acesso suspeito ──
  if (acesso.suspeito && process.env.POWER_AUTOMATE_WEBHOOK_URL) {
    const motivos = [
      acesso.foraDoHorario && "fora do horário comercial",
      acesso.fimDeSemana   && "fim de semana",
      acesso.feriado       && "feriado",
    ].filter(Boolean).join(", ");

    // Chama webhook do Power Automate em background (não bloqueia o login)
    fetch(process.env.POWER_AUTOMATE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assunto:  `⚠️ Acesso suspeito — Painel Societário`,
        mensagem: `O usuário ${usuario} acessou o painel em ${new Date(acesso.acessadoEm).toLocaleString("pt-BR")} (${motivos}).`,
        usuario,
        acessadoEm: acesso.acessadoEm,
        motivos,
      }),
    }).catch(() => {});
  }

  // ── Gera token e retorna ──
  const token = gerarToken(usuario);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  return ok({ token, usuario, expiresAt, acessoSuspeito: acesso.suspeito });
};
