// ══════════════════════════════════════════════════════════════
//  netlify/functions/trocar-pin.js
//  POST /.netlify/functions/trocar-pin
//  Header: Authorization: Bearer <token>
//  Body: { pinAtual: "1234", pinNovo: "5678" }
//
//  ⚠️  PINs ficam em variáveis de ambiente no Netlify.
//      Esta função atualiza a variável via Netlify API.
//      Requer NETLIFY_ACCESS_TOKEN e NETLIFY_SITE_ID no .env.
// ══════════════════════════════════════════════════════════════

const { ok, err, preflight, PINS, validarToken, tokenDoHeader } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST")    return err("Método não permitido", 405);

  // ── Autenticação ──
  const usuario = validarToken(tokenDoHeader(event));
  if (!usuario) return err("Não autenticado", 401);

  let pinAtual, pinNovo;
  try {
    ({ pinAtual, pinNovo } = JSON.parse(event.body));
  } catch {
    return err("Body inválido");
  }

  if (!pinAtual || !pinNovo)     return err("pinAtual e pinNovo são obrigatórios");
  if (!/^\d{4}$/.test(pinNovo)) return err("O novo PIN deve ter exatamente 4 dígitos");
  if (PINS[usuario] !== String(pinAtual)) return err("PIN atual incorreto", 401);

  // ── Atualiza a variável de ambiente no Netlify via API ──
  const nomeDaVariavel = `PIN_${usuario.toUpperCase()}`;

  const res = await fetch(
    `https://api.netlify.com/api/v1/sites/${process.env.NETLIFY_SITE_ID}/env/${nomeDaVariavel}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${process.env.NETLIFY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [{ value: pinNovo, context: "all" }] }),
    }
  );

  if (!res.ok) {
    return err("Não foi possível atualizar o PIN. Tente novamente.", 500);
  }

  return ok({ mensagem: `PIN de ${usuario} atualizado com sucesso. Válido no próximo deploy.` });
};
