export function initializeCore(request, announce) {
  const get = (id) => document.getElementById(id);
  const search = get('user-search');
  const list = get('user-list');
  const profile = get('profile-editor');
  const save = get('save-profile');
  const next = get('next-users');
  const teamName = get('team-name');
  let catalog = { resources: [], teams: [] };
  let selected;
  let pageRequest;
  let searchTimer;
  let after = null;

  function button(text, className, callback) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    element.addEventListener('click', callback);
    return element;
  }

  function clear() {
    pageRequest?.abort();
    clearTimeout(searchTimer);
    selected = undefined;
    list.replaceChildren();
    profile.hidden = true;
    get('profile-empty').hidden = false;
    next.hidden = true;
  }

  function renderCatalog() {
    get('team-list').replaceChildren(...catalog.teams.map((team) => {
      const item = document.createElement('li');
      item.textContent = team.name;
      return item;
    }));
  }

  function showUser(user) {
    selected = user;
    profile.hidden = false;
    get('profile-empty').hidden = true;
    get('profile-email').textContent = user.email || 'Conta sem e-mail';
    get('profile-name').value = user.display_name ?? '';
    get('profile-active').checked = user.active;
    get('profile-name').disabled = user.administrator;
    get('profile-active').disabled = user.administrator;
    get('protected-profile').hidden = !user.administrator;
    save.hidden = user.administrator;

    get('profile-resources').replaceChildren(...catalog.resources.map((resource) => {
      const label = document.createElement('label');
      label.textContent = resource.title;
      const select = document.createElement('select');
      select.name = resource.code;
      for (const [value, text] of [['', 'Sem acesso'], ['read', 'Leitura'], ['write', 'Leitura e edição']]) {
        select.add(new Option(text, value));
      }
      select.value = user.permissions[resource.code] ?? '';
      select.disabled = user.administrator;
      label.append(select);
      return label;
    }));
    get('profile-teams').replaceChildren(...catalog.teams.map((team) => {
      const label = document.createElement('label');
      label.className = 'checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = team.id;
      checkbox.checked = user.team_ids.includes(team.id);
      checkbox.disabled = user.administrator;
      label.append(checkbox, team.name);
      return label;
    }));
  }

  async function loadUsers(cursor = null) {
    pageRequest?.abort();
    pageRequest = new AbortController();
    const { signal } = pageRequest;
    const params = new URLSearchParams({ search: search.value.trim() });
    if (cursor) params.set('after', cursor);
    const { data } = await request('core-users&' + params, undefined, signal);
    if (signal.aborted) return;
    const users = data.slice(0, 25);
    after = data.length > 25 ? users.at(-1).id : null;
    const rows = users.map((user) => button(
      user.display_name ? `${user.display_name} · ${user.email || 'sem e-mail'}` : (user.email || 'Conta sem e-mail'),
      'secondary user-row',
      () => showUser(user)
    ));
    if (!rows.length) {
      const message = document.createElement('p');
      message.textContent = 'Nenhum usuário encontrado.';
      rows.push(message);
    }
    if (cursor) list.append(...rows);
    else list.replaceChildren(...rows);
    next.hidden = !after;
  }

  async function recoverError(operation) {
    try {
      await operation();
    } catch (error) {
      if (error.name !== 'AbortError') announce(error.message, true);
    }
  }

  search.addEventListener('input', () => {
    clear();
    searchTimer = setTimeout(() => recoverError(() => loadUsers()), 220);
  });
  next.addEventListener('click', async () => {
    next.disabled = true;
    await recoverError(() => loadUsers(after));
    next.disabled = false;
  });
  save.addEventListener('click', async () => {
    if (!selected || selected.administrator) return;
    const updated = {
      id: selected.id,
      name: get('profile-name').value.trim(),
      active: get('profile-active').checked,
      permissions: Object.fromEntries([...profile.querySelectorAll('select')]
        .filter((select) => select.value).map((select) => [select.name, select.value])),
      teams: [...get('profile-teams').querySelectorAll('input:checked')].map((input) => input.value),
    };
    save.disabled = true;
    await recoverError(async () => {
      await request('core-save', updated);
      if (selected?.id === updated.id) selected = {
        ...selected, display_name: updated.name, active: updated.active,
        permissions: updated.permissions, team_ids: updated.teams,
      };
      await loadUsers();
      announce('Acesso atualizado.');
    });
    save.disabled = false;
  });
  get('add-team').addEventListener('click', async () => {
    const add = get('add-team');
    add.disabled = true;
    await recoverError(async () => {
      const name = teamName.value.trim();
      const { data: id } = await request('core-team', { name });
      catalog.teams.push({ id, name });
      catalog.teams.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      renderCatalog();
      if (selected) {
        const label = document.createElement('label');
        label.className = 'checkbox';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = id;
        input.disabled = selected.administrator;
        label.append(input, name);
        get('profile-teams').append(label);
      }
      teamName.value = '';
      announce('Equipe criada.');
    });
    add.disabled = false;
  });

  return {
    clear,
    async open() {
      clear();
      search.value = '';
      await recoverError(async () => {
        const { data } = await request('core-catalog');
        catalog = data;
        renderCatalog();
        await loadUsers();
      });
    },
  };
}
