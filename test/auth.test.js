import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/auth.js';

test('login, session, origin validation, logout and PKCE recovery', async (t) => {
  const admin = 'e6e5fc32-034f-4908-9bb8-7352cd1f7205';
  const email = 'admin@example.test';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = url.pathname + url.search;
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, method: options.method, body });
    const session = { user: { id: admin, email }, access_token: 'test-session', expires_in: 3600 };
    if (path === '/auth/v1/token?grant_type=password') {
      if (body.password === 'incorrect') return Response.json({}, { status: 400 });
      if (body.email === 'other@example.test') {
        session.user.id = 'another-user';
        session.access_token = 'other-session';
      }
      return Response.json(session);
    }
    if (path === '/rest/v1/rpc/gkli_session_access') {
      return Response.json(options.headers.Authorization === 'Bearer test-session'
        ? { name: email, administrator: true, resources: [] } : null);
    }
    if (path === '/rest/v1/rpc/gkli_core_catalog') {
      if (options.headers.Authorization !== 'Bearer test-session') return Response.json({}, { status: 403 });
      return Response.json({ resources: [], teams: [] });
    }
    if (path === '/rest/v1/rpc/gkli_demo_check') return Response.json(body);
    if (path.startsWith('/auth/v1/recover?')) return Response.json({});
    if (path === '/auth/v1/token?grant_type=pkce') return Response.json(session);
    if (options.headers.Authorization !== 'Bearer test-session') return Response.json({}, { status: 401 });
    return Response.json(session.user);
  });
  const origin = 'https://gkli.example.test';
  Object.assign(process.env, {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'test-key',
    APP_ORIGIN: origin,
  });
  const call = async (action, body, cookie, requestOrigin = origin) => {
    const headers = new Headers();
    let status;
    let output;
    await handler({
      url: `/api/auth?action=${action}`,
      method: body ? 'POST' : 'GET',
      headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' },
      body,
    }, {
      setHeader(name, value) {
        headers.delete(name);
        for (const entry of [value].flat()) headers.append(name, entry);
      },
      writeHead(value, extra) {
        status = value;
        for (const [name, entry] of Object.entries(extra)) headers.set(name, entry);
      },
      end(value) { output = value; },
    });
    return new Response(output, { status, headers });
  };

  assert.equal((await call('session')).status, 401);
  assert.equal((await call('login', { email, password: 'incorrect' })).status, 401);
  assert.equal((await call('login', { email: 'other@example.test', password: 'test' })).status, 401);
  assert.equal((await call('login', { email, password: 'test' }, '', 'https://other.example.test')).status, 403);

  const login = await call('login', { email, password: 'test' });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { authenticated: true });
  const session = login.headers.get('set-cookie');
  assert.match(session, /HttpOnly; SameSite=Lax; Secure/);
  assert.deepEqual(await (await call('session', null, session.split(';')[0])).json(), { authenticated: true, email, name: email, administrator: true, resources: [] });
  assert.equal((await call('core-catalog')).status, 401);
  assert.equal((await call('core-catalog', null, 'gkli_session=other-session')).status, 403);
  assert.deepEqual(await (await call('core-catalog', null, session.split(';')[0])).json(), {
    data: { resources: [], teams: [] },
  });
  assert.match((await call('logout', {}, session.split(';')[0])).headers.get('set-cookie'), /Max-Age=0/);

  assert.equal((await call('demo-check', {}, '', 'https://other.example.test')).status, 403);
  assert.equal((await call('demo-check', {})).status, 401);
  const checked = await call('demo-check', { unit: admin, parts: 3, extra: 'discard' }, session.split(';')[0]);
  assert.equal(checked.status, 200);
  assert.deepEqual(await checked.json(), { data: {
    unit: admin, request_id: null, parts: 3, first_due: null, verified_cents: null, reference: null,
  } });

  const recovery = await call('recover', { email });
  assert.equal(recovery.status, 200);
  const verifier = recovery.headers.get('set-cookie').split(';')[0];
  assert.match(calls.at(-1).body.code_challenge, /^[\w-]{43}$/);
  assert.equal((await call('reset', { code: 'recovery-code', password: 'new-password-2026' })).status, 400);
  const reset = await call('reset', { code: 'recovery-code', password: 'new-password-2026' }, verifier);
  assert.equal(reset.status, 200);
  assert.equal(calls.findLast(({ path }) => path.endsWith("grant_type=pkce")).body.code_verifier, verifier.split('=')[1]);
  assert.equal(calls.at(-2).method, 'PUT');
  assert.equal(reset.headers.getSetCookie().length, 2);
});
