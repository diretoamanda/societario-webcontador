// ══════════════════════════════════════════════════════════════
//  netlify/functions/_helpers.js
//  Utilitários compartilhados — importado por todas as funções
//  Prefixo _ faz o Netlify ignorar este arquivo como endpoint
// ══════════════════════════════════════════════════════════════

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

// ── Cliente Supabase com a SERVICE KEY (nunca exposta ao browser) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_key dá acesso total — fica AQUI
);

// ── Headers padrão para toda resposta ──
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type":                 "application/json",
};

// ── Respostas prontas ──
const ok  = (data, status = 200) => ({ statusCode: status, headers: CORS, body: JSON.stringify(data) });
const err = (msg,  status = 400) => ({ statusCode: status, headers: CORS, body: JSON.stringify({ erro: msg }) });
const preflight = () => ({ statusCode: 204, headers: CORS, body: "" });

// ── Mapa de PINs (lidos das variáveis de ambiente) ──
const PINS = {
  Sabrina:  process.env.PIN_SABRINA,
  Amanda:   process.env.PIN_AMANDA,
  Fernanda: process.env.PIN_FERNANDA,
  Gabriela: process.env.PIN_GABRIELA,
  Yasmin:   process.env.PIN_YASMIN,
};

// ── Gera token de sessão assinado com HMAC ──
function gerarToken(usuario) {
  const payload = `${usuario}:${Date.now()}`;
  const hmac = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "trocar-em-producao")
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${hmac}`).toString("base64");
}

// ── Valida token de sessão (retorna o nome do usuário ou null) ──
function validarToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const [usuario, ts, hmac] = decoded.split(":");
    const payload  = `${usuario}:${ts}`;
    const esperado = crypto
      .createHmac("sha256", process.env.SESSION_SECRET || "trocar-em-producao")
      .update(payload)
      .digest("hex");

    if (hmac !== esperado) return null;

    // Token expira após 12 horas (tempo de uma sessão de trabalho)
    const dozeHoras = 12 * 60 * 60 * 1000;
    if (Date.now() - parseInt(ts) > dozeHoras) return null;

    return usuario;
  } catch {
    return null;
  }
}

// ── Extrai token do header Authorization: Bearer <token> ──
function tokenDoHeader(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  return auth.replace("Bearer ", "").trim() || null;
}

// ── Feriados nacionais brasileiros fixos + móveis calculados ──
function feriadosDoAno(ano) {
  // Cálculo da Páscoa (algoritmo de Gauss)
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes   = Math.floor((h + l - 7 * m + 114) / 31);
  const dia   = ((h + l - 7 * m + 114) % 31) + 1;
  const pascoa = new Date(ano, mes - 1, dia);

  const addDias = (base, n) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return new Set([
    // Fixos nacionais
    `${ano}-01-01`, // Confraternização Universal
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Dia do Trabalho
    `${ano}-09-07`, // Independência
    `${ano}-10-12`, // N. Sra. Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamação da República
    `${ano}-11-20`, // Consciência Negra (lei federal desde 2024)
    `${ano}-12-25`, // Natal
    // Móveis
    addDias(pascoa, -47), // Carnaval (segunda)
    addDias(pascoa, -46), // Carnaval (terça)
    addDias(pascoa, -2),  // Sexta-Feira Santa
    pascoa.toISOString().slice(0, 10), // Páscoa
    addDias(pascoa, 60),  // Corpus Christi
  ]);
}

// ── Classifica o acesso (para log e alertas) ──
function classificarAcesso() {
  const agora   = new Date();
  const hora    = agora.getHours();
  const dia     = agora.getDay(); // 0=dom, 6=sab
  const dataStr = agora.toISOString().slice(0, 10);
  const feriados = feriadosDoAno(agora.getFullYear());

  return {
    acessadoEm:      agora.toISOString(),
    foraDoHorario:   hora < 8 || hora >= 18,
    fimDeSemana:     dia === 0 || dia === 6,
    feriado:         feriados.has(dataStr),
    get suspeito()   { return this.foraDoHorario || this.fimDeSemana || this.feriado; },
  };
}

module.exports = {
  supabase,
  ok, err, preflight,
  PINS, gerarToken, validarToken, tokenDoHeader,
  classificarAcesso,
};
