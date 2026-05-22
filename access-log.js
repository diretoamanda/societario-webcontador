// ══════════════════════════════════════════════════════════════
//  netlify/functions/access-log.js
//  GET  /.netlify/functions/access-log   → lista acessos (só Sabrina)
//  POST /.netlify/functions/access-log   → registra acesso manual
//  Header: Authorization: Bearer <token>
// ══════════════════════════════════════════════════════════════

const { supabase, ok, err, preflight, validarToken, tokenDoHeader } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const usuario = validarToken(tokenDoHeader(event));
  if (!usuario) return err("Não autenticado", 401);

  // ════ GET — só Sabrina vê o log ════
  if (event.httpMethod === "GET") {
    if (usuario !== "Sabrina") return err("Acesso restrito", 403);

    const { limite = "100", pagina = "0" } = event.queryStringParameters || {};

    const { data, error, count } = await supabase
      .from("access_log")
      .select("*", { count: "exact" })
      .order("accessed_at", { ascending: false })
      .range(parseInt(pagina) * parseInt(limite), (parseInt(pagina) + 1) * parseInt(limite) - 1);

    if (error) return err(error.message, 500);

    return ok({
      registros:  data,
      total:      count,
      suspeitos:  data.filter(r => r.is_outside_hours || r.is_weekend || r.is_holiday).length,
    });
  }

  return err("Método não suportado", 405);
};
