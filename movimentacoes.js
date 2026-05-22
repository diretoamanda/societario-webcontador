// ══════════════════════════════════════════════════════════════
//  netlify/functions/movimentacoes.js
//  GET    /.netlify/functions/movimentacoes          → lista
//  GET    /.netlify/functions/movimentacoes?id=M001  → uma
//  POST   /.netlify/functions/movimentacoes          → cria
//  PATCH  /.netlify/functions/movimentacoes?id=M001  → atualiza
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
    if (id) {
      const { data, error } = await supabase
        .from("movimentacoes")
        .select("*, mov_steps(*), mov_log(*)")
        .eq("id", id)
        .single();
      if (error) return err("Movimentação não encontrada", 404);
      return ok(data);
    }

    const { data, error } = await supabase
      .from("movimentacoes")
      .select("*, mov_steps(*)")
      .order("created_at", { ascending: false });

    if (error) return err(error.message, 500);
    return ok(data);
  }

  // ════ POST (criar nova movimentação) ════
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return err("Body inválido"); }

    const { clientId, clientName, cnpj, tipo, template, competencia, processId, obs, steps } = body;
    if (!clientName || !tipo || !competencia) return err("clientName, tipo e competencia são obrigatórios");

    const { data: mov, error: movErr } = await supabase
      .from("movimentacoes")
      .insert({
        client_id: clientId, client_name: clientName, cnpj,
        tipo, template: template || "geral",
        competencia, process_id: processId || null,
        obs: obs || "", status: "active",
        created_by: usuario,
      })
      .select()
      .single();

    if (movErr) return err(movErr.message, 500);

    // Inserir etapas do template
    if (steps && steps.length > 0) {
      const stepsData = steps.map((s, i) => ({
        mov_id:      mov.id,
        name:        s.name,
        responsible: s.responsible || s.resp,
        position:    i,
        notes:       "",
      }));
      await supabase.from("mov_steps").insert(stepsData);
    }

    await supabase.from("mov_log").insert({
      mov_id: mov.id, user_name: usuario,
      action: `Movimentação criada — ${tipo} | ${competencia}`,
    });

    return ok(mov, 201);
  }

  // ════ PATCH ════
  if (event.httpMethod === "PATCH") {
    if (!id) return err("ID da movimentação é obrigatório");

    let body;
    try { body = JSON.parse(event.body); }
    catch { return err("Body inválido"); }

    const { campo, valor, stepId, stepData, novasEtapas, removerEtapaId } = body;

    // ── Atualizar campo simples ──
    if (campo && valor !== undefined) {
      const camposPermitidos = ["client_name", "cnpj", "obs", "status", "competencia"];
      if (!camposPermitidos.includes(campo)) return err(`Campo "${campo}" não permitido`);

      await supabase.from("movimentacoes").update({ [campo]: valor }).eq("id", id);

      // Propaga mudança de nome para toda a base
      if (campo === "client_name") {
        const mov = await supabase.from("movimentacoes").select("client_id").eq("id", id).single();
        if (mov.data?.client_id) {
          await supabase.from("client_base").update({ name: valor }).eq("id", mov.data.client_id);
          await supabase.from("processes").update({ client_name: valor }).eq("client_id", mov.data.client_id);
          await supabase.from("movimentacoes").update({ client_name: valor }).eq("client_id", mov.data.client_id);
        }
      }

      await supabase.from("mov_log").insert({
        mov_id: id, user_name: usuario,
        action: `Campo "${campo}" alterado para "${valor}"`,
      });
      return ok({ ok: true });
    }

    // ── Concluir etapa ──
    if (stepId !== undefined && stepData) {
      await supabase.from("mov_steps")
        .update({
          completed_at: stepData.completedAt || new Date().toISOString(),
          completed_by: usuario,
          notes: stepData.notes || "",
        })
        .eq("id", stepId)
        .eq("mov_id", id);

      // Verificar se todas as etapas foram concluídas
      const { data: etapas } = await supabase
        .from("mov_steps").select("*").eq("mov_id", id);

      const todasConcluidas = etapas?.every(s => s.id === stepId || s.completed_at);
      if (todasConcluidas) {
        await supabase.from("movimentacoes")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", id);
      }

      const etapa = etapas?.find(s => s.id === stepId);
      await supabase.from("mov_log").insert({
        mov_id: id, user_name: usuario,
        action: `Etapa "${etapa?.name}" concluída`,
      });

      return ok({ ok: true, todasConcluidas });
    }

    // ── Adicionar etapas extras ──
    if (novasEtapas && novasEtapas.length > 0) {
      const { data: existentes } = await supabase.from("mov_steps").select("position").eq("mov_id", id).order("position", { ascending: false }).limit(1);
      const posInicial = (existentes?.[0]?.position ?? 0) + 1;

      const stepsData = novasEtapas.map((s, i) => ({
        mov_id: id, name: s.name, responsible: s.responsible, position: posInicial + i, notes: "",
      }));
      await supabase.from("mov_steps").insert(stepsData);

      await supabase.from("mov_log").insert({
        mov_id: id, user_name: usuario,
        action: `${novasEtapas.length} etapa(s) adicionada(s) ao template`,
      });
      return ok({ ok: true });
    }

    // ── Remover etapa (só pendentes) ──
    if (removerEtapaId) {
      const { data: etapa } = await supabase.from("mov_steps").select("*").eq("id", removerEtapaId).single();
      if (etapa?.completed_at) return err("Não é possível remover etapa já concluída");

      await supabase.from("mov_steps").delete().eq("id", removerEtapaId);
      await supabase.from("mov_log").insert({
        mov_id: id, user_name: usuario,
        action: `Etapa "${etapa?.name}" removida`,
      });
      return ok({ ok: true });
    }

    return err("Informe campo+valor, stepId+stepData, novasEtapas ou removerEtapaId");
  }

  return err("Método não suportado", 405);
};
