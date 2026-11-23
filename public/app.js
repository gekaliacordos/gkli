import { initializeCore } from './core.js';
import { initializeOperation } from './operation.js';

const title = document.querySelector('#title');
const description = document.querySelector('#description');
const feedback = document.querySelector('#feedback');
const forms = [...document.querySelectorAll('form')];
const home = document.querySelector('#home');
const corePanel = document.querySelector('#core');
const operationPanel = document.querySelector('#operation');
const operationViews = ['cadastros', 'inbox', 'acordos'];
const homeViews = [...operationViews, 'relatorios'];
const settingsButton = document.querySelector('#global-settings');
const reports = document.querySelector('#reports');
const reportStatus = document.querySelector('#report-status');
const reportMetrics = document.querySelector('#report-metrics');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let reportRequest;
const shell = document.querySelector('.layout');
const query = new URLSearchParams(location.search);
const recoveryCode = query.get('code');
const recoveryError = query.has('error') || location.hash.startsWith('#error=');

if (recoveryCode || recoveryError) history.replaceState(null, '', location.pathname);

const views = {
  login: ['Acesse sua conta', 'Entre com seu e-mail e senha.'],
  recover: ['Recuperar acesso', 'Vamos enviar um link para o e-mail cadastrado. Abra-o neste mesmo navegador.'],
  reset: ['Definir nova senha', 'Use pelo menos 12 caracteres.'],
  logout: ['Início', 'Módulos disponíveis para a sua conta.'],
  cadastros: ['Cadastros', 'Carteira fictícia de homologação.'],
  inbox: ['Inbox (Cobranças)', 'Carteira fictícia de homologação.'],
  acordos: ['Acordos', 'Carteira fictícia de homologação.'],
  relatorios: ['Relatórios', 'Resumo das carteiras fictícias disponíveis.'],
  core: ['Configurações globais', 'Usuários, equipes e permissões.'],
};

function show(view, email) {
  const [heading, intro] = views[view];
  title.textContent = heading;
  description.textContent = email || intro;
  const signedIn = view === 'logout' || view === 'core' || homeViews.includes(view);
  forms.forEach((form) => { form.hidden = form.id === 'logout' ? !signedIn : form.id !== view; });
  shell.classList.toggle('workspace', signedIn);
  home.hidden = view !== 'logout';
  corePanel.hidden = view !== 'core';
  settingsButton.hidden = !signedIn || !allowed.has('core');
  if (view === 'core') settingsButton.setAttribute('aria-current', 'true');
  else settingsButton.removeAttribute('aria-current');
  reports.hidden = view !== 'relatorios';
  if (reports.hidden) reportRequest?.abort();
  operationPanel.hidden = !operationViews.includes(view);
  announce('');
}

function announce(message, error = false) {
  feedback.textContent = message;
  feedback.dataset.error = String(error);
}

async function request(action, input, signal) {
  const options = input ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  } : {};
  const response = await fetch(`/api/auth?action=${action}`, { ...options, signal });
  const result = await response.json();
  if (!response.ok && !(action === 'session' && response.status === 401)) {
    if (response.status === 401 && (action.startsWith('core-') || action.startsWith('demo-'))) show('login');
    throw new Error(result.error || 'Não foi possível concluir a operação.');
  }
  return result;
}

const core = initializeCore(request, announce);
const operation = initializeOperation(request, announce, openResource);
let allowed = new Set();

async function openResource(view, unit) {
  if (view !== 'logout' && !allowed.has(view)) return;
  show(view);
  if (view === 'core') await core.open();
  if (view === 'relatorios') await loadReports();
  if (operationViews.includes(view)) await operation.open(view, unit, allowed);
}

document.querySelectorAll('[data-operation-view]').forEach((button) => {
  button.addEventListener('click', () => openResource(button.dataset.operationView));
});

settingsButton.addEventListener('click', () => openResource('core'));

async function loadReports() {
  reportRequest?.abort();
  reportRequest = new AbortController();
  const { signal } = reportRequest;
  reportMetrics.hidden = true;
  reportStatus.textContent = 'Carregando relatório…';
  try {
    const { data } = await request('demo-reports', undefined, signal);
    if (signal.aborted) return;
    if (!data.wallets) {
      reportStatus.textContent = 'Nenhuma carteira de homologação está disponível.';
      return;
    }
    const metrics = [
      ['Cotas em aberto', String(data.open_charges)],
      ['Valor em aberto', money.format(data.open_cents / 100)],
      ['Acordos ativos', String(data.active_agreements)],
      ['Acordos quitados', String(data.settled_agreements)],
    ];
    reportMetrics.replaceChildren(...metrics.map(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'core-card report-metric';
      const term = document.createElement('dt');
      const definition = document.createElement('dd');
      term.textContent = label;
      definition.textContent = value;
      item.append(term, definition);
      return item;
    }));
    reportStatus.textContent = '';
    reportMetrics.hidden = false;
  } catch (error) {
    if (signal.aborted) return;
    reportStatus.textContent = '';
    announce(error.message, true);
  }
}

function renderHome(session) {
  const cards = document.querySelector('#resource-cards');
  const resources = new Map(session.resources.map((resource) => [resource.code, resource]));
  allowed = new Set(resources.keys());
  document.querySelectorAll('[data-operation-view]').forEach((button) => {
    button.hidden = button.dataset.operationView !== 'logout' && !allowed.has(button.dataset.operationView);
  });
  cards.replaceChildren(...homeViews.filter((code) => resources.has(code)).map((code) => {
    const resource = resources.get(code);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'module-card';
    const title = document.createElement('strong');
    title.textContent = resource.title;
    const description = document.createElement('span');
    description.textContent = resource.description;
    button.append(title, description);
    button.addEventListener('click', () => openResource(resource.code));
    return button;
  }));
  document.querySelector('#no-resources').hidden = cards.childElementCount > 0;
  show('logout', session.name);
}

async function showSession() {
  const session = await request('session');
  if (session.authenticated) renderHome(session);
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    show(button.dataset.view);
    document.querySelector(`#${button.dataset.view} input`)?.focus();
  });
});

forms.forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form));
    if (input.email) input.email = input.email.trim();
    if (form.id === 'reset') input.code = recoveryCode;

    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    announce('Processando…');
    try {
      await request(form.id, input);
      form.reset();
      if (form.id === 'login') await showSession();
      if (form.id === 'logout') { core.clear(); operation.clear(); allowed.clear(); show('login'); }
      if (form.id === 'reset') { show('login'); announce('Senha atualizada. Entre com a nova senha.'); }
      if (form.id === 'recover') announce('Se a conta estiver apta, você receberá o link por e-mail.');
    } catch (error) {
      announce(error instanceof SyntaxError || error instanceof TypeError
        ? 'Não foi possível acessar o serviço. Tente novamente.'
        : error.message, true);
    } finally {
      form.removeAttribute('aria-busy');
      buttons.forEach((button) => { button.disabled = false; });
    }
  });
});

if (recoveryCode) show('reset');
else if (recoveryError) {
  show('recover');
  announce('O link de recuperação expirou ou é inválido. Solicite outro link.', true);
} else {
  const login = document.querySelector('#login');
  const submit = login.querySelector('[type=submit]');
  submit.disabled = true;
  showSession().catch((error) => announce(error.message, true)).finally(() => { submit.disabled = false; });
}
