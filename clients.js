// ══════════════════════════════════════════════════════════════
//  netlify/functions/clients.js
//  GET    /.netlify/functions/clients          → lista todos
//  POST   /.netlify/functions/clients          → cria / importa em lote
//  PATCH  /.netlify/functions/clients?id=C001  → atualiza (nome, CNPJ)
//  DELETE /.netlify/functions/clients?id=C001  → remove (só Sabrina)
//  Header: Authorization: Bearer <token>
// ══════════════════════════════════════════════════════════════

const { supabase, ok, err, preflight, validarToken, tokenDoHeader } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const usuario = validarToken(tokenDoHeader(event));
  if (!usuario) return err("Não autenticado", 401);

  const { id } = event.queryStringParameters || {};

  // ════ GET ════
  if (event.httpMethod === "GET") {
    const { data, error } = await supabase
      .from("client_base")
      .select("*")
      .order("name");

    if (error) return err(error.message, 500);
    return ok(data);
  }

  // ════ POST (criar ou importar em lote) ════
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return err("Body inválido"); }

    // Importação em lote (colar do Excel)
    if (body.lote && Array.isArray(body.lote)) {
      const clientes = body.lote
        .filter(c => c.name && c.name.trim())
        .map(c => ({
          name:       c.name.trim().toUpperCase(),
          cnpj:       c.cnpj?.replace(/\D/g, "") || null,
          created_by: usuario,
        }));

      if (clientes.length === 0) return err("Nenhum cliente válido na importação");

      // Upsert: atualiza se o CNPJ já existir, insere se for novo
      const { data, error } = await supabase
        .from("client_base")
        .upsert(clientes, { onConflict: "cnpj", ignoreDuplicates: false })
        .select();

      if (error) return err(error.message, 500);
      return ok({ importados: data.length, clientes: data }, 201);
    }

    // Inserção individual
    const { name, cnpj, socio, email, tel, tipo } = body;
    if (!name) return err("Nome é obrigatório");

    const { data, error } = await supabase
      .from("client_base")
      .insert({
        name: name.trim().toUpperCase(),
        cnpj: cnpj?.replace(/\D/g, "") || null,
        socio: socio || null,
        email: email || null,
        tel:   tel || null,
        tipo:  tipo || "outros",
        created_by: usuario,
      })
      .select()
      .single();

    if (error) return err(error.message, 500);
    return ok(data, 201);
  }

  // ════ PATCH ════
  if (event.httpMethod === "PATCH") {
    if (!id) return err("ID do cliente é obrigatório");

    let body;
    try { body = JSON.parse(event.body); }
    catch { return err("Body inválido"); }

    const camposPermitidos = ["name", "cnpj", "socio", "email", "tel", "tipo"];
    const updates = {};
    for (const campo of camposPermitidos) {
      if (body[campo] !== undefined) updates[campo] = body[campo];
    }

    if (Object.keys(updates).length === 0) return err("Nenhum campo para atualizar");

    const { error } = await supabase.from("client_base").update(updates).eq("id", id);
    if (error) return err(error.message, 500);

    // Se o nome mudou, propaga para processos e movimentações
    if (updates.name) {
      await Promise.all([
        supabase.from("processes").update({ client_name: updates.name }).eq("client_id", id),
        supabase.from("movimentacoes").update({ client_name: updates.name }).eq("client_id", id),
      ]);
    }

    return ok({ ok: true });
  }

  // ════ DELETE ════
  if (event.httpMethod === "DELETE") {
    if (!id) return err("ID do cliente é obrigatório");
    if (usuario !== "Sabrina") return err("Somente Sabrina pode excluir clientes", 403);

    const { error } = await supabase.from("client_base").delete().eq("id", id);
    if (error) return err(error.message, 500);
    return ok({ ok: true });
  }

  return err("Método não suportado", 405);
};
