const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents) => currency.format(cents / 100);
const date = (iso) => iso.split('-').reverse().join('/');
const agreementLabels = { conferido: 'Conferido pela administradora', ativo: 'Ativo', quitado: 'Quitado' };

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function button(text, callback, className = 'secondary') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', callback);
  return node;
}

function input(label, name, configuration) {
  const control = Object.assign(document.createElement('input'), {
    name, required: true, ...configuration,
  });
  const field = element('label', label);
  field.append(control);
  return field;
}

function centsFromForm(value) {
  if (!/^\d{1,10}(?:,\d{2})?$/.test(value)) throw new Error('Informe o valor em reais sem separador de milhar, como 1234,56.');
  const [reais, cents = '00'] = value.split(',');
  return Number(reais) * 100 + Number(cents);
}

export function initializeOperation(request, announce, navigate) {
  const units = document.querySelector('#operation-units');
  const detail = document.querySelector('#operation-detail');
  const more = document.querySelector('#operation-next');
  const heading = document.querySelector('#operation-unit-title');
  let state;

  async function run(work, control) {
    if (control) control.disabled = true;
    try {
      await work();
    } catch (error) {
      if (error.name !== 'AbortError') announce(error.message, true);
    } finally {
      if (control) control.disabled = false;
    }
  }

  async function read(action, params, current) {
    const result = await request(action + '&' + new URLSearchParams(params), undefined, current.abort.signal);
    if (current.abort.signal.aborted) throw new DOMException('Navegação substituída.', 'AbortError');
    return result.data;
  }

  function addPanel(title, ...children) {
    const panel = element('section', null, 'operation-section');
    if (title) panel.append(element('h3', title));
    panel.append(...children);
    detail.append(panel);
    return panel;
  }

  function operationForm(label, fields, callback) {
    const form = element('form', null, 'operation-form');
    const submit = element('button', label);
    submit.type = 'submit';
    form.append(...fields, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      void run(() => callback(values), submit);
    });
    return form;
  }

  function renderQuote(current, unit) {
    const container = element('div');
    const quoteForm = operationForm('Simular', [
      input('Quantidade de parcelas', 'parts', { type: 'number', min: 1, max: 12, value: '1' }),
    ], async (fields) => {
      const parts = Number(fields.parts);
      const quote = await read('demo-quote', { unit: unit.id, parts }, current);
      const requestId = crypto.randomUUID();
      const amounts = element('p',
        `Cotas: ${money(quote.base)} · Honorários: ${money(quote.fee)} · Total: ${money(quote.total)}`);
      const breakdown = element('p', parts === 1
        ? `Uma parcela de ${money(quote.last)}.`
        : `${parts - 1} × ${money(quote.regular)} e última parcela de ${money(quote.last)}.`);
      const confirmation = operationForm('Registrar conferência', [
        input('Primeiro vencimento', 'first_due', { type: 'date' }),
        input('Valor total conferido (R$)', 'verified', { type: 'text', inputMode: 'decimal', maxLength: 13 }),
        input('Referência da planilha fictícia', 'reference', { type: 'text', maxLength: 150 }),
      ], async (form) => {
        await request('demo-check', {
          unit: unit.id, request_id: requestId, parts, first_due: form.first_due,
          verified_cents: centsFromForm(form.verified.trim()), reference: form.reference,
        });
        await refresh(current, unit);
        if (state === current) announce('Conferência registrada. O acordo pode ser formalizado.');
      });
      container.replaceChildren(amounts, breakdown, confirmation);
    });
    addPanel('Simulação de acordo', quoteForm, container);
  }

  function renderAgreement(current, unit, agreement, canEdit) {
    const panel = addPanel(agreementLabels[agreement.state],
      element('p', `Total ${money(agreement.amount_cents)} · Conferência ${agreement.evidence}`));
    if (canEdit && agreement.state === 'conferido') {
      panel.append(button('Formalizar acordo fictício', (event) => run(async () => {
        await request('demo-activate', { agreement: agreement.id });
        await refresh(current, unit);
        if (state === current) announce('Acordo formalizado na homologação.');
      }, event.currentTarget)));
    }

    const parts = element('ul', null, 'operation-list');
    for (const part of agreement.installments) {
      const row = element('li', `Parcela ${part.number} · ${money(part.amount_cents)} · ${date(part.due_on)}`);
      if (part.paid_on) row.append(element('p', `Pagamento confirmado em ${date(part.paid_on)}.`));
      else if (canEdit) {
        const payment = element('details');
        payment.append(element('summary', 'Registrar confirmação de pagamento'), operationForm('Confirmar parcela', [
          input('Data informada pela administradora', 'paid', { type: 'date' }),
          input('Referência do comprovante fictício', 'reference', { type: 'text', maxLength: 150 }),
        ], async (form) => {
          await request('demo-payment', { agreement: agreement.id, part: part.number, ...form });
          await refresh(current, unit);
          if (state === current) announce('Confirmação de pagamento registrada.');
        }));
        row.append(payment);
      }
      parts.append(row);
    }
    if (parts.childElementCount) panel.append(parts);
  }

  async function showUnit(current, unit) {
    const serial = ++current.selection;
    heading.textContent = `Unidade ${unit.codigo} · Bloco ${unit.bloco}`;
    detail.replaceChildren(element('p', 'Carregando atendimento…'));
    const data = await read('demo-details', { unit: unit.id, resource: current.view }, current);
    if (serial !== current.selection) return;
    detail.replaceChildren(element('p', `${unit.condominio} · ${unit.administradora}`));
    if (current.view === 'cadastros') {
      addPanel('Responsáveis e contatos', ...data.contacts.map((contact) =>
        element('p', [contact.nome, contact.papel, contact.tipo, contact.valor].filter(Boolean).join(' · '))));
      if (!data.contacts.length) detail.append(element('p', 'Nenhum responsável vinculado.'));
      return;
    }
    const charges = element('ul', null, 'operation-list');
    for (const charge of data.charges) {
      charges.append(element('li', `${charge.receipt} · ${date(charge.due_on)} · ${money(charge.amount_cents)} · ${charge.agreement_id ? 'Em acordo' : 'Em aberto'}`));
    }
    if (charges.childElementCount) addPanel('Cotas registradas', charges);
    if (current.view === 'inbox') {
      if (current.allowed.has('acordos')) detail.append(button('Abrir acordos da unidade', () => navigate('acordos', unit)));
      return;
    }
    if (data.canEdit && !data.hasCheckedAgreement && data.charges.some((charge) => !charge.agreement_id)) {
      renderQuote(current, unit);
    }
    for (const agreement of data.agreements) renderAgreement(current, unit, agreement, data.canEdit);
  }

  async function refresh(current, unit) {
    if (state !== current) return;
    await Promise.all([showUnit(current, unit), loadUnits(current)]);
  }

  async function loadUnits(current, cursor) {
    const page = await read('demo-catalog', { resource: current.view, ...(cursor && { after_id: cursor }) }, current);
    const items = page.slice(0, 25);
    if (!cursor) units.replaceChildren();
    if (!items.length && !cursor) {
      units.append(element('p', current.view === 'acordos' ? 'Nenhum acordo registrado. Abra uma unidade pelo Inbox para simular.' : 'Nenhuma unidade disponível nesta carteira.'));
    }
    items.forEach((unit) => {
      const label = `${unit.codigo} / ${unit.bloco} · ${unit.condominio}`;
      const summary = current.view === 'cadastros' ? label : `${label} · ${money(unit.cotas_em_aberto)} em cotas abertas`;
      units.append(button(summary, () => run(() => showUnit(current, unit)), 'secondary user-row'));
    });
    current.cursor = page.length > 25 ? items.at(-1).id : undefined;
    more.hidden = !current.cursor;
  }

  function clear() {
    state?.abort.abort();
    state = undefined;
    units.replaceChildren();
    detail.replaceChildren();
    more.hidden = true;
  }

  more.addEventListener('click', () => {
    if (state?.cursor) void run(() => loadUnits(state, state.cursor), more);
  });

  return {
    clear,
    async open(view, selected, allowed) {
      clear();
      const current = { view, allowed, abort: new AbortController(), selection: 0 };
      state = current;
      heading.textContent = 'Atendimento';
      detail.append(element('p', 'Selecione uma unidade.'));
      await run(async () => {
        await Promise.all([loadUnits(current), selected && showUnit(current, selected)]);
      });
    },
  };
}
