// ══════════════════════════════════════════════════════════════
//  netlify/functions/data-proxy.js
//  Proxy seguro para o DataLayer do Painel Societário
//
//  Substitui as chamadas diretas ao Supabase no index.html.
//  A SUPABASE_KEY nunca chega ao navegador.
//
//  Ações suportadas (via POST com body JSON):
//    { action: "get",         key }
//    { action: "set",         key, value }
//    { action: "getForms"                }
//    { action: "updateForm",  formId, status, processedBy }
// ══════════════════════════════════════════════════════════════

const { ok, err, preflight } = require("./_helpers");

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = () => ({
  apikey:          SB_KEY(),
  Authorization:   `Bearer ${SB_KEY()}`,
  "Content-Type":  "application/json",
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST")    return err("Método não permitido", 405);

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return err("Body inválido"); }

  const { action, key, value, formId, status, processedBy } = body;

  // ── GET: lê um valor da tabela wc_kv ──
  if (action === "get") {
    if (!key) return err("key é obrigatório");
    const r = await fetch(
      `${SB_URL()}/rest/v1/wc_kv?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: sbHeaders() }
    );
    if (!r.ok) return err("Erro ao ler dado", 500);
    const rows = await r.json();
    return ok(rows.length > 0 ? rows[0].value : null);
  }

  // ── SET: grava/atualiza um valor na tabela wc_kv ──
  if (action === "set") {
    if (!key) return err("key é obrigatório");
    await fetch(`${SB_URL()}/rest/v1/wc_kv`, {
      method:  "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body:    JSON.stringify({ key, value }),
    });
    return ok({ ok: true });
  }

  // ── GET FORMS: lista formulários pendentes ──
  if (action === "getForms") {
    const r = await fetch(
      `${SB_URL()}/rest/v1/form_submissions?status=eq.pending&order=created_at.desc`,
      { headers: sbHeaders() }
    );
    if (!r.ok) return err("Erro ao buscar formulários", 500);
    const data = await r.json();
    return ok(data);
  }

  // ── UPDATE FORM: marca formulário como processado ──
  if (action === "updateForm") {
    if (!formId) return err("formId é obrigatório");
    await fetch(`${SB_URL()}/rest/v1/form_submissions?id=eq.${formId}`, {
      method:  "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body:    JSON.stringify({
        status:       status || "processed",
        processed_at: new Date().toISOString(),
        processed_by: processedBy || "sistema",
      }),
    });
    return ok({ ok: true });
  }

  return err(`Ação desconhecida: ${action}`);
};
