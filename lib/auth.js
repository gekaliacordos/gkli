import { createHash, randomBytes } from 'node:crypto';

const sessionDuration = 3600;

function configuration() {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_ORIGIN, VERCEL_URL } = process.env;
  const origin = APP_ORIGIN || (VERCEL_URL && `https://${VERCEL_URL}`);
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !origin) return null;

  return {
    authUrl: new URL('/auth/v1/', SUPABASE_URL),
    rpcUrl: new URL('/rest/v1/rpc/', SUPABASE_URL),
    origin: new URL(origin).origin,
    key: SUPABASE_PUBLISHABLE_KEY,
  };
}

async function supabaseRequest(config, base, path, { method = 'GET', body, token } = {}) {
  const headers = { apikey: config.key };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

function authRequest(config, path, options) {
  return supabaseRequest(config, config.authUrl, path, options);
}

function rpc(config, name, token, body = {}) {
  return supabaseRequest(config, config.rpcUrl, name, { method: 'POST', token, body });
}

async function accessFor(config, token) {
  const result = await rpc(config, 'gkli_session_access', token);
  if (result.status === 401 || result.status === 403) return null;
  if (result.status !== 200) throw new Error('Não foi possível verificar a autorização.');
  return result.data;
}

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function coreRequest(config, req, res, action, params) {
  const token = readCookie(req, 'session');
  if (!token) return reply(res, 401, { error: 'Entre novamente para continuar.' });

  let name;
  let body;
  switch (action) {
    case 'core-catalog':
      name = 'gkli_core_catalog';
      break;
    case 'core-users':
      if (params.after && !uuidPattern.test(params.after)) return reply(res, 400, { error: 'Página inválida.' });
      name = 'gkli_core_list_users';
      body = { search: (params.search ?? '').slice(0, 120), after_id: params.after || null };
      break;
    case 'core-team':
      if (typeof params.name !== 'string' || !params.name.trim() || params.name.length > 120) {
        return reply(res, 400, { error: 'Informe um nome de equipe de até 120 caracteres.' });
      }
      name = 'gkli_core_create_team';
      body = { team_name: params.name };
      break;
    case 'core-save':
      if (!uuidPattern.test(params.id ?? '') || typeof params.name !== 'string'
        || !params.name.trim() || params.name.length > 120 || typeof params.active !== 'boolean'
        || !params.permissions || typeof params.permissions !== 'object' || Array.isArray(params.permissions)
        || !Array.isArray(params.teams) || !params.teams.every((id) => uuidPattern.test(id))) {
        return reply(res, 400, { error: 'Revise os dados de acesso do usuário.' });
      }
      name = 'gkli_core_save_user';
      body = { target: params.id, full_name: params.name, enabled: params.active,
        grants: params.permissions, team_ids: params.teams };
      break;
    default:
      return reply(res, 404, { error: 'Operação indisponível.' });
  }

  const result = await rpc(config, name, token, body);
  if (result.status === 401) return reply(res, 401, { error: 'Entre novamente para continuar.' });
  if (result.status === 403) return reply(res, 403, { error: 'Você não tem permissão para esta operação.' });
  if (result.status === 409) return reply(res, 409, { error: 'O registro conflita com os dados atuais. Confira antes de salvar.' });
  if (result.status === 400) return reply(res, 400, { error: 'Revise os dados informados.' });
  if (result.status >= 400) return providerError(res, result.status);
  return reply(res, 200, { data: result.data });
}

const demoReads = new Map([
  ['demo-reports', ['gkli_demo_reports', []]],
  ['demo-catalog', ['gkli_demo_catalog', ['resource', 'after_id']]],
  ['demo-details', ['gkli_demo_details', ['unit', 'resource']]],
  ['demo-quote', ['gkli_demo_quote', ['unit', 'parts']]],
]);
const demoWrites = new Map([
  ['demo-check', ['gkli_demo_check', ['unit', 'request_id', 'parts', 'first_due', 'verified_cents', 'reference']]],
  ['demo-activate', ['gkli_demo_activate', ['agreement']]],
  ['demo-payment', ['gkli_demo_payment', ['agreement', 'part', 'paid', 'reference']]],
]);

async function demoRequest(config, req, res, operation, input) {
  const token = readCookie(req, 'session');
  if (!token) return reply(res, 401, { error: 'Entre novamente para continuar.' });
  const [name, keys] = operation;
  const body = Object.fromEntries(keys.map((key) => [key, input[key] ?? null]));
  const { status, data } = await rpc(config, name, token, body);
  if (status === 401) return reply(res, 401, { error: 'Entre novamente para continuar.' });
  if (status === 403) return reply(res, 403, { error: 'Você não tem acesso a esta operação.' });
  if (status === 409) return reply(res, 409, { error: 'Já existe uma operação para este registro. Atualize a tela e confira o status.' });
  if (status === 400) {
    return reply(res, 400, { error: data?.code === '22023' ? data.message : 'Confira os dados informados.' });
  }
  if (status >= 400) return providerError(res, status);
  return reply(res, 200, { data });
}

function cookie(config, name, value, age) {
  const secure = config.origin.startsWith('https:') ? '; Secure' : '';
  return `gkli_${name}=${encodeURIComponent(value)}; Path=/api/auth; Max-Age=${age}; HttpOnly; SameSite=Lax${secure}`;
}

function readCookie(req, name) {
  const prefix = `gkli_${name}=`;
  const entry = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return '';
  }
}

function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readInput(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return null;
  try {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (req.body !== undefined) return req.body;
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) return null;
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  return typeof password === 'string' && password.length > 0 && password.length <= 1024;
}

function providerError(res, status) {
  if (status === 429) return reply(res, 429, { error: 'Muitas tentativas. Aguarde e tente novamente.' });
  return reply(res, 503, { error: 'O serviço de acesso está indisponível. Tente novamente em instantes.' });
}

async function login(config, res, input) {
  if (!validEmail(input.email) || !validPassword(input.password)) {
    return reply(res, 400, { error: 'Preencha o e-mail e a senha.' });
  }
  const { status, data } = await authRequest(config, 'token?grant_type=password', {
    method: 'POST',
    body: { email: input.email, password: input.password },
  });
  if (status === 429 || status >= 500) return providerError(res, status);
  if (status !== 200 || !data?.user?.id || !data.access_token) {
    return reply(res, 401, { error: 'E-mail ou senha inválidos, ou conta sem acesso ao NewCore.' });
  }
  const access = await accessFor(config, data.access_token);
  if (!access) return reply(res, 401, { error: 'E-mail ou senha inválidos, ou conta sem acesso ao NewCore.' });
  const duration = Math.min(Number(data.expires_in) || sessionDuration, sessionDuration);
  res.setHeader('Set-Cookie', cookie(config, 'session', data.access_token, duration));
  return reply(res, 200, { authenticated: true });
}

async function recover(config, res, input) {
  if (!validEmail(input.email)) return reply(res, 400, { error: 'Informe um e-mail válido.' });
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirect = new URL('/', config.origin);
  const url = `recover?redirect_to=${encodeURIComponent(redirect.href)}`;
  const { status } = await authRequest(config, url, {
    method: 'POST',
    body: { email: input.email, code_challenge: challenge, code_challenge_method: 's256' },
  });
  if (status >= 500) return providerError(res, status);
  res.setHeader('Set-Cookie', cookie(config, 'recovery', verifier, 3600));
  return reply(res, 200, { accepted: true });
}

async function reset(config, req, res, input) {
  const verifier = readCookie(req, 'recovery');
  if (!verifier || typeof input.code !== 'string' || input.code.length > 512) {
    return reply(res, 400, { error: 'Link inválido. Solicite outro e abra no navegador usado para pedir a recuperação.' });
  }
  if (!validPassword(input.password) || input.password.length < 12) {
    return reply(res, 400, { error: 'A nova senha precisa ter pelo menos 12 caracteres.' });
  }
  const exchange = await authRequest(config, 'token?grant_type=pkce', {
    method: 'POST',
    body: { auth_code: input.code, code_verifier: verifier },
  });
  if (exchange.status === 429 || exchange.status >= 500) return providerError(res, exchange.status);
  res.setHeader('Set-Cookie', cookie(config, 'recovery', '', 0));
  if (exchange.status !== 200 || !exchange.data?.user?.id || !exchange.data.access_token) {
    return reply(res, 400, { error: 'Link expirado ou inválido. Solicite outro link de recuperação.' });
  }
  const token = exchange.data.access_token;
  if (!await accessFor(config, token)) {
    await authRequest(config, 'logout?scope=local', { method: 'POST', token }).catch(() => {});
    return reply(res, 400, { error: 'Link expirado ou inválido. Solicite outro link de recuperação.' });
  }
  const updated = await authRequest(config, 'user', { method: 'PUT', token, body: { password: input.password } });
  await authRequest(config, 'logout?scope=global', { method: 'POST', token }).catch(() => {});
  if (updated.status !== 200) {
    return reply(res, 400, { error: 'A senha não foi alterada. Solicite outro link para tentar novamente.' });
  }
  res.setHeader('Set-Cookie', [cookie(config, 'recovery', '', 0), cookie(config, 'session', '', 0)]);
  return reply(res, 200, { updated: true });
}

export default async function handler(req, res) {
  const config = configuration();
  const query = new URL(req.url, 'http://localhost').searchParams;
  const action = query.get('action');
  if (!config) return providerError(res, 503);
  try {
    if (req.method === 'GET' && demoReads.has(action)) {
      return await demoRequest(config, req, res, demoReads.get(action), Object.fromEntries(query));
    }
    if (req.method === 'GET' && ['core-catalog', 'core-users'].includes(action)) {
      return await coreRequest(config, req, res, action, Object.fromEntries(query));
    }
    if (req.method === 'GET' && action === 'session') {
      const token = readCookie(req, 'session');
      if (!token) return reply(res, 401, { authenticated: false });
      const { status, data } = await authRequest(config, 'user', { token });
      if (status === 429 || status >= 500) return providerError(res, status);
      const access = status === 200 && data?.id && await accessFor(config, token);
      if (!access) {
        res.setHeader('Set-Cookie', cookie(config, 'session', '', 0));
        return reply(res, 401, { authenticated: false });
      }
      return reply(res, 200, { authenticated: true, email: data.email, ...access });
    }

    if (req.method !== 'POST') return reply(res, 405, { error: 'Método indisponível.' });
    if (req.headers.origin !== config.origin) return reply(res, 403, { error: 'Origem não autorizada.' });
    if (action === 'logout') {
      const token = readCookie(req, 'session');
      res.setHeader('Set-Cookie', cookie(config, 'session', '', 0));
      if (token) await authRequest(config, 'logout?scope=local', { method: 'POST', token }).catch(() => {});
      return reply(res, 200, { authenticated: false });
    }
    const input = await readInput(req);
    if (!input || typeof input !== 'object') return reply(res, 400, { error: 'Dados inválidos.' });
    if (demoWrites.has(action)) return await demoRequest(config, req, res, demoWrites.get(action), input);
    if (['core-team', 'core-save'].includes(action)) return await coreRequest(config, req, res, action, input);
    if (action === 'login') return await login(config, res, input);
    if (action === 'recover') return await recover(config, res, input);
    if (action === 'reset') return await reset(config, req, res, input);
    return reply(res, 404, { error: 'Operação indisponível.' });
  } catch {
    return providerError(res, 503);
  }
}
