// ══════════════════════════════════════════════════════════════
//  netlify/functions/processes.js
//  GET    /.netlify/functions/processes           → lista todos
//  GET    /.netlify/functions/processes?id=P001   → um processo
//  POST   /.netlify/functions/processes           → cria
//  PATCH  /.netlify/functions/processes?id=P001   → atualiza
//  DELETE /.netlify/functions/processes?id=P001   → exclui
//  Header: Authorization: Bearer <token>
// ══════════════════════════════════════════════════════════════

const { supabase, ok, err, preflight, validarToken, tokenDoHeader } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  // ── Toda rota exige autenticação ──
  const usuario = validarToken(tokenDoHeader(event));
  if (!usuario) return err("Não autenticado", 401);

  const { id } = event.queryStringParameters || {};

  // ════ GET ════
  if (event.httpMethod === "GET") {
    if (id) {
      // Buscar um processo específico com suas etapas
      const { data, error } = await supabase
        .from("processes")
        .select(`*, steps(*), process_log(*)`)
        .eq("id", id)
        .single();

      if (error) return err("Processo não encontrado", 404);
      return ok(data);
    }

    // Listar todos os processos ativos
    const { data, error } = await supabase
      .from("processes")
      .select(`*, steps(*)`)
      .order("created_at", { ascending: false });

    if (error) return err(error.message, 500);
    return ok(data);
  }

  // ════ POST (criar) ════
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return err("Body inválido"); }

    const { type, typeLabel, clientId, clientName, cnpj, responsible, obs, socio, steps } = body;
    if (!type || !clientName || !responsible) {
      return err("type, clientName e responsible são obrigatórios");
    }

    // Inserir processo
    const { data: proc, error: procErr } = await supabase
      .from("processes")
      .insert({
        type, type_label: typeLabel, client_id: clientId,
        client_name: clientName, cnpj, responsible,
        obs: obs || "", socio: socio || "",
        status: "active",
        start_date: new Date().toISOString().slice(0, 10),
        created_by: usuario,
      })
      .select()
      .single();

    if (procErr) return err(procErr.message, 500);

    // Inserir etapas iniciais se fornecidas
    if (steps && steps.length > 0) {
      const stepsData = steps.map((s, i) => ({
        process_id:   proc.id,
        name:         s.name,
        responsible:  s.responsible,
        deadline_days: s.deadlineDays || 3,
        position:     i,
        activated_at: i === 0 ? new Date().toISOString() : null,
      }));

      await supabase.from("steps").insert(stepsData);
    }

    // Log de criação
    await supabase.from("process_log").insert({
      process_id: proc.id,
      user_name:  usuario,
      action:     `Processo criado — ${typeLabel} para ${clientName}`,
    });

    return ok(proc, 201);
  }

  // ════ PATCH (atualizar) ════
  if (event.httpMethod === "PATCH") {
    if (!id) return err("ID do processo é obrigatório");

    let body;
    try { body = JSON.parse(event.body); }
    catch { return err("Body inválido"); }

    const { campo, valor, stepId, stepData } = body;

    // Atualizar campo do processo (edição inline)
    if (campo && valor !== undefined) {
      const camposPermitidos = ["client_name", "cnpj", "responsible", "obs", "status", "socio"];
      if (!camposPermitidos.includes(campo)) return err(`Campo "${campo}" não pode ser editado`);

      const { error } = await supabase
        .from("processes")
        .update({ [campo]: valor })
        .eq("id", id);

      if (error) return err(error.message, 500);

      // Se o nome do cliente mudou, atualiza em todas as referências
      if (campo === "client_name") {
        const proc = await supabase.from("processes").select("client_id").eq("id", id).single();
        if (proc.data?.client_id) {
          await supabase.from("client_base").update({ name: valor }).eq("id", proc.data.client_id);
          await supabase.from("movimentacoes").update({ client_name: valor }).eq("client_id", proc.data.client_id);
        }
      }

      await supabase.from("process_log").insert({
        process_id: id, user_name: usuario,
        action: `Campo "${campo}" alterado para "${valor}"`,
      });

      return ok({ ok: true });
    }

    // Concluir uma etapa
    if (stepId !== undefined && stepData) {
      const { error } = await supabase
        .from("steps")
        .update({
          completed_at: stepData.completedAt || new Date().toISOString(),
          completed_by: usuario,
          notes:        stepData.notes || "",
        })
        .eq("id", stepId)
        .eq("process_id", id);

      if (error) return err(error.message, 500);

      // Ativar a próxima etapa
      const { data: etapas } = await supabase
        .from("steps")
        .select("*")
        .eq("process_id", id)
        .order("position");

      const concluida = etapas?.find(s => s.id === stepId);
      const proxima   = etapas?.find(s => s.position === (concluida?.position ?? 0) + 1 && !s.completed_at);

      if (proxima) {
        await supabase.from("steps").update({ activated_at: new Date().toISOString() }).eq("id", proxima.id);
      } else if (etapas?.every(s => s.id === stepId || s.completed_at)) {
        // Todas as etapas concluídas → processo concluído
        await supabase.from("processes").update({ status: "completed" }).eq("id", id);
      }

      await supabase.from("process_log").insert({
        process_id: id, user_name: usuario,
        action: `Etapa "${concluida?.name}" concluída`,
      });

      return ok({ ok: true });
    }

    return err("Informe campo+valor ou stepId+stepData");
  }

  // ════ DELETE ════
  if (event.httpMethod === "DELETE") {
    if (!id) return err("ID do processo é obrigatório");

    // Apenas Sabrina pode excluir
    if (usuario !== "Sabrina") return err("Somente Sabrina pode excluir processos", 403);

    await supabase.from("steps").delete().eq("process_id", id);
    await supabase.from("process_log").delete().eq("process_id", id);
    const { error } = await supabase.from("processes").delete().eq("id", id);
    if (error) return err(error.message, 500);

    return ok({ ok: true });
  }

  return err("Método não suportado", 405);
};
