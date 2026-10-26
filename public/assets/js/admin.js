
(() => {
  const app = document.getElementById('app');

  let allClients = [];
  let activeClient = null;
  let filterText = '';
  let filterStatus = 'Todos';

  const e = ME.escape;

  const progress = value =>
    Math.max(0, Math.min(100, Number(value) || 0));

  const statusClass = status =>
    /conclu/i.test(status || '')
      ? 'done'
      : /paus|parad/i.test(status || '')
        ? 'paused'
        : '';

  const stages = [
    'Planejamento',
    'Fundação e estrutura',
    'Alvenaria e instalações',
    'Acabamento',
    'Entrega'
  ];

  const statuses = [
    'Em andamento',
    'Pausada',
    'Paralisada',
    'Concluída'
  ];

  function shell(content) {
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a class="brand-lockup" href="/" aria-label="Meu Engenheiro">
              <img class="brand-logo" src="/assets/img/logo-engenheiro.png" alt="PH Engenharia">
              <div>
                <div class="brand brand-title">Meu Engenheiro</div>
                <div class="brand-subtitle">Gestão inteligente de obras</div>
              </div>
            </a>
            <div class="topbar-actions">
              <a class="btn btn-light hide-mobile"
                 href="/login-cliente.html"
                 target="_blank"
                 rel="noopener">↗ Prévia da área do cliente</a>
              <div class="avatar" title="Área de gestão">ME</div>
            </div>
          </div>
        </header>
        ${content}
      </div>`;
  }

  function renderDashboard(list = allClients) {
    const completed = allClients.filter(c =>
      /conclu/i.test(c.status || '') || progress(c.progresso) >= 100
    ).length;

    const active = allClients.length - completed;

    const average = allClients.length
      ? Math.round(
          allClients.reduce((sum, c) => sum + progress(c.progresso), 0) /
          allClients.length
        )
      : 0;

    shell(`
      <main class="page">
        <div class="welcome-row">
          <div>
            <div class="eyebrow">Painel de gestão</div>
            <h1>Suas obras, sob controle.</h1>
            <p>Gerencie clientes, arquivos e andamento dos projetos.</p>
          </div>
          <button class="btn btn-primary" id="new-client">
            ＋ Cadastrar cliente
          </button>
        </div>

        <section class="metrics" aria-label="Resumo das obras">
          <article class="metric">
            <div class="metric-top">
              <span>Total de clientes</span>
              <span class="metric-icon">♙</span>
            </div>
            <div class="metric-value">${allClients.length}</div>
            <div class="metric-note">Cadastros no sistema</div>
          </article>

          <article class="metric">
            <div class="metric-top">
              <span>Obras em andamento</span>
              <span class="metric-icon">⌂</span>
            </div>
            <div class="metric-value">${active}</div>
            <div class="metric-note">Projetos não concluídos</div>
          </article>

          <article class="metric">
            <div class="metric-top">
              <span>Progresso médio</span>
              <span class="metric-icon">↗</span>
            </div>
            <div class="metric-value">${average}%</div>
            <div class="metric-note">Calculado com os dados cadastrados</div>
          </article>
        </section>

        <section class="content-card">
          <div class="card-heading">
            <div>
              <h2>Clientes e obras</h2>
              <p>Selecione uma obra para editar as informações.</p>
            </div>
            <div class="dashboard-filters">
              <div class="search-wrap">
                <span class="search-icon">⌕</span>
                <input
                  id="search"
                  type="search"
                  placeholder="Buscar cliente, e-mail ou endereço..."
                  value="${e(filterText)}"
                  aria-label="Buscar clientes">
              </div>
              <select id="status-filter" class="filter-select" aria-label="Filtrar por status">
                ${['Todos', ...statuses].map(item => `<option value="${e(item)}" ${filterStatus === item ? 'selected' : ''}>${e(item === 'Todos' ? 'Todos os status' : item)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="client-list" class="client-list">
            ${renderCards(list)}
          </div>
        </section>

        <footer class="footer-logos">
          <div class="footer-caption">
            MEU ENGENHEIRO · PLATAFORMA DE GESTÃO DE OBRAS
          </div>
          <div class="two-logos">
            <img src="/assets/img/logo-engenheiro.png"
                 alt="Logo do engenheiro">
            <img src="/assets/img/logo-desenvolvimento.png"
                 alt="Logo de desenvolvimento">
          </div>
        </footer>
      </main>
    `);

    document.getElementById('new-client')
      .addEventListener('click', showNewClient);

    document.getElementById('search')
      .addEventListener('input', event => {
        filterText = event.target.value;
        document.getElementById('client-list').innerHTML =
          renderCards(filterClients());

        wireOpenButtons();
      });

    document.getElementById('status-filter').addEventListener('change', event => {
      filterStatus = event.target.value;
      document.getElementById('client-list').innerHTML = renderCards(filterClients());
      wireOpenButtons();
    });

    wireOpenButtons();
  }

  function renderCards(list) {
    if (!list.length) {
      return `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">⌂</div>
          <strong>
            ${allClients.length
              ? 'Nenhum resultado encontrado'
              : 'Seu primeiro projeto começa aqui'}
          </strong>
          <span>
            ${allClients.length
              ? 'Tente buscar por outro nome ou endereço.'
              : 'Cadastre um cliente para começar.'}
          </span>
        </div>`;
    }

    return list.map(c => {
      const pct = progress(c.progresso);
      const status = c.status || 'Em andamento';

      return `
        <article class="client-card">
          <div class="client-card-top">
            <div class="client-avatar">${e(ME.initials(c.nome))}</div>
            <div class="client-main">
              <div class="client-name">${e(c.nome || 'Cliente sem nome')}</div>
              <div class="client-email">${e(c.email || 'E-mail não informado')}</div>
            </div>
            <span class="status ${statusClass(status)}">${e(status)}</span>
          </div>

          <div class="client-address">
            ⌖ &nbsp;${e(c.endereco_obra || 'Endereço não cadastrado')}
          </div>

          <div class="progress-row">
            <span class="muted">Progresso da obra</span>
            <strong>${pct}%</strong>
          </div>

          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>

          <div class="client-card-footer">
            <span class="muted" style="font-size:10px">
              Cadastro ${e(ME.date(c.created_at))}
            </span>
            <button class="small-action" data-open="${e(c.id)}">
              Gerenciar obra →
            </button>
          </div>
        </article>`;
    }).join('');
  }

  function wireOpenButtons() {
    document.querySelectorAll('[data-open]').forEach(button => {
      button.addEventListener('click', () => openClient(button.dataset.open));
    });
  }

  function filterClients() {
    const q = filterText.toLocaleLowerCase('pt-BR');

    return allClients.filter(c => {
      const matchesText = [c.nome, c.email, c.endereco_obra, c.status, c.etapa_atual]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(q));
      const matchesStatus = filterStatus === 'Todos' || (c.status || 'Em andamento') === filterStatus;
      return matchesText && matchesStatus;
    });
  }

  function showNewClient() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';

    overlay.innerHTML = `
      <form class="modal" id="client-form">
        <div class="modal-header">
          <div>
            <div class="eyebrow">Novo cadastro</div>
            <h2>Adicionar cliente</h2>
            <p>Cadastre os dados básicos da obra.</p>
          </div>
          <button type="button" class="icon-btn" id="close-modal">✕</button>
        </div>

        <div id="form-error" class="notice error hidden"></div>

        <div class="field">
          <label for="nome">Nome do cliente *</label>
          <input id="nome" name="nome" required maxlength="150">
        </div>

        <div class="field">
          <label for="email">E-mail de acesso *</label>
          <input id="email" name="email" type="email" required maxlength="200">
        </div>

        <div class="field">
          <label for="senha">Senha inicial *</label>
          <input id="senha" name="senha" type="password"
                 required minlength="4" maxlength="100"
                 autocomplete="new-password">
        </div>

        <div class="field">
          <label for="endereco">Endereço da obra</label>
          <input id="endereco" name="endereco" maxlength="300">
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-outline" id="cancel-modal">
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary" id="save-client">
            Salvar cliente →
          </button>
        </div>
      </form>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    overlay.querySelector('#close-modal').addEventListener('click', close);
    overlay.querySelector('#cancel-modal').addEventListener('click', close);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });

    overlay.querySelector('#client-form').addEventListener('submit', async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const fd = new FormData(form);
      const save = overlay.querySelector('#save-client');
      const error = overlay.querySelector('#form-error');

      save.disabled = true;
      save.textContent = 'Salvando...';
      error.classList.add('hidden');

      try {
        await ME.request('clientes', 'POST', {
          nome: String(fd.get('nome')).trim(),
          email: String(fd.get('email')).trim().toLowerCase(),
          senha_acesso: String(fd.get('senha')),
          endereco_obra: String(fd.get('endereco') || '').trim(),
          progresso: 0,
          status: 'Em andamento',
          etapa_atual: 'Planejamento'
        });

        close();
        ME.toast('Cliente cadastrado com sucesso.');
        await loadClients();
      } catch (err) {
        error.textContent = err.message || 'Não foi possível salvar o cadastro.';
        error.classList.remove('hidden');
        save.disabled = false;
        save.textContent = 'Salvar cliente →';
      }
    });
  }

  async function openClient(id) {
    try {
      const result = await ME.request(
        'clientes',
        'GET',
        null,
        `?id=eq.${encodeURIComponent(id)}&select=*`
      );

      const client = Array.isArray(result) ? result[0] : result;

      if (!client) throw new Error('Cliente não encontrado.');

      activeClient = client;

      const [filesResult, updatesResult] = await Promise.allSettled([
        ME.request('arquivos', 'GET', null, `?cliente_id=eq.${encodeURIComponent(id)}&order=created_at.desc`),
        ME.request('atualizacoes_obra', 'GET', null, `?cliente_id=eq.${encodeURIComponent(id)}&order=created_at.desc`)
      ]);

      const files = filesResult.status === 'fulfilled' && Array.isArray(filesResult.value)
        ? filesResult.value : [];
      const updates = updatesResult.status === 'fulfilled' && Array.isArray(updatesResult.value)
        ? updatesResult.value : [];

      renderDetail(client, files, updates);
    } catch (err) {
      ME.toast(err.message || 'Não foi possível abrir a obra.', 'error');
    }
  }

  function renderDetail(client, files, updates = []) {
    const pct = progress(client.progresso);
    const status = client.status || 'Em andamento';
    const etapa = client.etapa_atual || 'Planejamento';

    shell(`
      <header class="detail-header">
        <div class="detail-header-inner">
          <button class="btn btn-outline" id="back">← Voltar</button>
          <div>
            <div class="detail-title">${e(client.nome || 'Cliente')}</div>
            <div class="detail-subtitle">
              ${e(client.endereco_obra || 'Endereço não cadastrado')}
            </div>
          </div>
          <div style="margin-left:auto">
            <span class="status ${statusClass(status)}">${e(status)}</span>
          </div>
        </div>
      </header>

      <main class="page">
        <div class="welcome-row">
          <div>
            <div class="eyebrow">Gestão da obra</div>
            <h1 style="margin-bottom:7px">${e(client.nome || 'Obra')}</h1>
            <p>Edite os dados, o andamento e os arquivos do projeto.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="upload-trigger" class="btn btn-primary">
              ＋ Anexar arquivo
            </button>
            <input type="file" id="upload-file" hidden
                   accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv">

            <button id="delete-client" class="btn btn-outline">
              Excluir cliente
            </button>
          </div>
        </div>

        <section class="content-card" style="margin-bottom:20px">
          <div class="section-pad">
            <h2 class="section-title">Editar informações da obra</h2>
            <p class="section-desc">
              As informações salvas serão exibidas na área do cliente.
            </p>

            <form id="project-form">
              <div class="field">
                <label for="edit-nome">Nome do cliente</label>
                <input id="edit-nome" name="nome" required maxlength="150"
                       value="${e(client.nome || '')}">
              </div>

              <div class="field">
                <label for="edit-email">E-mail</label>
                <input id="edit-email" name="email" type="email"
                       required maxlength="200" value="${e(client.email || '')}">
              </div>

              <div class="field">
                <label for="edit-endereco">Endereço da obra</label>
                <input id="edit-endereco" name="endereco_obra"
                       maxlength="300" value="${e(client.endereco_obra || '')}">
              </div>

              <div class="field">
                <label for="edit-progresso">Progresso da obra (%)</label>
                <input id="edit-progresso" name="progresso" type="number"
                       min="0" max="100" step="1" required
                       value="${pct}">
              </div>

              <div class="field">
                <label for="edit-status">Status</label>
                <select id="edit-status" name="status">
                  ${statuses.map(item => `
                    <option value="${e(item)}"
                      ${status === item ? 'selected' : ''}>
                      ${e(item)}
                    </option>
                  `).join('')}
                  ${!statuses.includes(status) ? `
                    <option value="${e(status)}" selected>${e(status)}</option>
                  ` : ''}
                </select>
              </div>

              <div class="field">
                <label for="edit-etapa">Etapa atual</label>
                <select id="edit-etapa" name="etapa_atual">
                  ${stages.map(item => `
                    <option value="${e(item)}"
                      ${etapa === item ? 'selected' : ''}>
                      ${e(item)}
                    </option>
                  `).join('')}
                  ${!stages.includes(etapa) ? `
                    <option value="${e(etapa)}" selected>${e(etapa)}</option>
                  ` : ''}
                </select>
              </div>

              <div id="project-error" class="notice error hidden"></div>

              <button type="submit" class="btn btn-primary" id="save-project">
                Salvar alterações
              </button>
            </form>
          </div>
        </section>

        <section class="metrics">
          <article class="metric">
            <div class="metric-top">
              <span>Progresso informado</span>
              <span class="metric-icon">↗</span>
            </div>
            <div class="metric-value">${pct}%</div>
            <div class="progress-track" style="margin-top:12px">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
          </article>

          <article class="metric">
            <div class="metric-top">
              <span>Arquivos compartilhados</span>
              <span class="metric-icon">▤</span>
            </div>
            <div class="metric-value">${files.length}</div>
            <div class="metric-note">Fotos e documentos da obra</div>
          </article>

          <article class="metric">
            <div class="metric-top">
              <span>Etapa atual</span>
              <span class="metric-icon">⌂</span>
            </div>
            <div class="metric-value" style="font-size:18px;line-height:1.4">
              ${e(etapa)}
            </div>
            <div class="metric-note">${e(status)}</div>
          </article>
        </section>

        <div class="detail-grid" style="margin-top:20px">
          <section class="content-card">
            <div class="section-pad">
              <h2 class="section-title">Arquivos da obra</h2>
              <p class="section-desc">
                Você pode renomear ou excluir arquivos compartilhados.
              </p>
              <div id="file-list" class="file-list">
                ${renderFiles(files)}
              </div>
            </div>
          </section>

          <aside class="content-card">
            <div class="section-pad">
              <h2 class="section-title">Acesso do cliente</h2>
              <p class="section-desc">
                Compartilhe o endereço do portal com o cliente.
              </p>

              <div class="credential-box">
                <div class="credential-label">E-mail de acesso</div>
                <div class="credential-value">${e(client.email || 'Não informado')}</div>

                <div class="credential-label">Endereço do portal</div>
                <div class="credential-value">
                  ${e(location.origin + '/login-cliente.html')}
                </div>
              </div>

              <button class="btn btn-light"
                      style="width:100%;margin-top:12px"
                      id="copy-link">
                ▣ Copiar link do portal
              </button>
            </div>
          </aside>
        </div>

        <section class="content-card diary-card">
          <div class="section-pad">
            <div class="section-heading-row">
              <div>
                <h2 class="section-title">Diário e atualizações da obra</h2>
                <p class="section-desc">Registre novidades, decisões e informações que serão compartilhadas com o cliente.</p>
              </div>
            </div>
            <form id="update-form" class="update-form">
              <div class="field">
                <label for="update-title">Título da atualização</label>
                <input id="update-title" name="titulo" maxlength="200" required placeholder="Ex.: Fundação concluída">
              </div>
              <div class="field">
                <label for="update-description">Descrição</label>
                <textarea id="update-description" name="descricao" rows="3" maxlength="2000" required placeholder="Descreva o andamento, observações ou próximos passos."></textarea>
              </div>
              <button type="submit" class="btn btn-primary" id="publish-update">Publicar atualização</button>
              <div id="update-error" class="notice error hidden" role="alert"></div>
            </form>
            <div id="update-list" class="update-list">${renderUpdates(updates)}</div>
          </div>
        </section>

        <footer class="footer-logos">
          <div class="footer-caption">MEU ENGENHEIRO · ÁREA DE GESTÃO</div>
          <div class="two-logos">
            <img src="/assets/img/logo-engenheiro.png" alt="Logo do engenheiro">
            <img src="/assets/img/logo-desenvolvimento.png" alt="Logo de desenvolvimento">
          </div>
        </footer>
      </main>
    `);

    document.getElementById('back').addEventListener('click', () => {
      renderDashboard(filterClients());
    });

    document.getElementById('upload-trigger').addEventListener('click', () => {
      document.getElementById('upload-file').click();
    });

    document.getElementById('upload-file').addEventListener('change', uploadFile);

    document.getElementById('copy-link').addEventListener('click', async () => {
      const link = `${location.origin}/login-cliente.html`;

      try {
        await navigator.clipboard.writeText(link);
        ME.toast('Link do portal copiado.');
      } catch {
        ME.toast('Copie o endereço exibido no quadro de acesso.');
      }
    });

    document.getElementById('project-form').addEventListener('submit', saveProject);

    const stageSelect = document.getElementById('edit-etapa');
    stageSelect.addEventListener('change', () => {
      const stageProgress = {
        'Planejamento': 0,
        'Fundação e estrutura': 20,
        'Alvenaria e instalações': 45,
        'Acabamento': 70,
        'Entrega': 90
      };
      const progressInput = document.getElementById('edit-progresso');
      if (Object.prototype.hasOwnProperty.call(stageProgress, stageSelect.value)) {
        progressInput.value = stageProgress[stageSelect.value];
      }
      if (/conclu/i.test(document.getElementById('edit-status').value) && stageSelect.value !== 'Entrega') {
        document.getElementById('edit-status').value = 'Em andamento';
      }
    });

    document.getElementById('edit-status').addEventListener('change', event => {
      if (/conclu/i.test(event.target.value)) {
        document.getElementById('edit-etapa').value = 'Entrega';
        document.getElementById('edit-progresso').value = 100;
      }
    });

    document.getElementById('update-form').addEventListener('submit', saveUpdate);
    document.getElementById('delete-client').addEventListener('click', deleteClient);

    document.querySelectorAll('[data-rename-file]').forEach(button => {
      button.addEventListener('click', () => renameFile(button.dataset.renameFile));
    });

    document.querySelectorAll('[data-delete-file]').forEach(button => {
      button.addEventListener('click', () => deleteFile(button.dataset.deleteFile));
    });
  }

  async function saveProject(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = document.getElementById('save-project');
    const error = document.getElementById('project-error');

    const pctValue = Number(form.elements.progresso.value);

    if (
      !Number.isFinite(pctValue) ||
      pctValue < 0 ||
      pctValue > 100
    ) {
      ME.toast('O progresso precisa estar entre 0% e 100%.', 'error');
      return;
    }

    const changes = {
      nome: form.elements.nome.value.trim(),
      email: form.elements.email.value.trim().toLowerCase(),
      endereco_obra: form.elements.endereco_obra.value.trim(),
      progresso: pctValue,
      status: form.elements.status.value,
      etapa_atual: form.elements.etapa_atual.value
    };

    if (!changes.nome || !changes.email) {
      ME.toast('Preencha o nome e o e-mail do cliente.', 'error');
      return;
    }

    button.disabled = true;
    button.textContent = 'Salvando...';
    error.classList.add('hidden');

    try {
      await ME.request(
        'clientes',
        'PATCH',
        changes,
        `?id=eq.${encodeURIComponent(activeClient.id)}`
      );

      ME.toast('Alterações salvas com sucesso.');
      await loadClients();
      await openClient(activeClient.id);
    } catch (err) {
      error.textContent = err.message || 'Não foi possível salvar as alterações.';
      error.classList.remove('hidden');
      ME.toast(error.textContent, 'error');
    } finally {
      const currentButton = document.getElementById('save-project');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = 'Salvar alterações';
      }
    }
  }

 
  function renderUpdates(updates) {
    if (!updates.length) {
      return `<div class="empty-state compact-empty"><div class="empty-icon">↗</div><strong>Nenhuma atualização publicada</strong><span>As novidades da obra aparecerão aqui.</span></div>`;
    }
    return updates.map(item => `
      <article class="update-item">
        <div class="update-timeline-dot">↗</div>
        <div class="update-item-body">
          <div class="update-item-top"><strong>${e(item.titulo || 'Atualização da obra')}</strong><time>${e(ME.dateTime(item.created_at))}</time></div>
          <p>${e(item.descricao || '')}</p>
        </div>
      </article>`).join('');
  }

  async function saveUpdate(event) {
    event.preventDefault();
    if (!activeClient) return;
    const form = event.currentTarget;
    const button = document.getElementById('publish-update');
    const error = document.getElementById('update-error');
    const titulo = form.elements.titulo.value.trim();
    const descricao = form.elements.descricao.value.trim();
    if (!titulo || !descricao) return;
    button.disabled = true;
    button.textContent = 'Publicando...';
    error.classList.add('hidden');
    try {
      await ME.request('atualizacoes_obra', 'POST', {
        cliente_id: activeClient.id,
        titulo,
        descricao
      });
      ME.toast('Atualização publicada para o cliente.');
      await openClient(activeClient.id);
    } catch (err) {
      error.textContent = err.message || 'Não foi possível publicar a atualização.';
      error.classList.remove('hidden');
      ME.toast(error.textContent, 'error');
    } finally {
      const current = document.getElementById('publish-update');
      if (current) {
        current.disabled = false;
        current.textContent = 'Publicar atualização';
      }
    }
  }

  async function deleteClient() {
    const client = activeClient;
    if (!client) return;

    const confirmed = confirm(
      `Deseja realmente excluir o cadastro de ${client.nome}?\n\nEssa ação não poderá ser desfeita.`
    );

    if (!confirmed) return;

    try {
      await ME.request(
        'clientes',
        'DELETE',
        null,
        `?id=eq.${encodeURIComponent(client.id)}`
      );

      activeClient = null;
      ME.toast('Cliente excluído.');
      await loadClients();
    } catch (err) {
      ME.toast(err.message || 'Não foi possível excluir o cliente.', 'error');
    }
  }

  async function renameFile(fileId) {
    const file = currentFiles().find(item => String(item.id) === String(fileId));
    if (!file || !activeClient) return;

    const name = prompt('Digite o novo nome do arquivo:', file.nome || '');

    if (name === null) return;

    if (!name.trim()) {
      ME.toast('Informe um nome para o arquivo.', 'error');
      return;
    }

    try {
      await ME.request(
        'arquivos',
        'PATCH',
        { nome: name.trim() },
        `?id=eq.${encodeURIComponent(file.id)}`
      );

      ME.toast('Arquivo renomeado com sucesso.');
      await openClient(activeClient.id);
    } catch (err) {
      ME.toast(err.message || 'Não foi possível renomear o arquivo.', 'error');
    }
  }

  async function deleteFile(fileId) {
    const file = currentFiles().find(item => String(item.id) === String(fileId));
    if (!file || !activeClient) return;

    if (!confirm(`Deseja excluir o arquivo "${file.nome}"?`)) return;

    try {
      await ME.request(
        'arquivos',
        'DELETE',
        null,
        `?id=eq.${encodeURIComponent(file.id)}`
      );

      ME.toast('Arquivo excluído com sucesso.');
      await openClient(activeClient.id);
    } catch (err) {
      ME.toast(err.message || 'Não foi possível excluir o arquivo.', 'error');
    }
  }

  let displayedFiles = [];

  function currentFiles() {
    return displayedFiles;
  }

  function renderFiles(files) {
    displayedFiles = files;

    if (!files.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon">▤</div>
          <strong>Nenhum arquivo compartilhado</strong>
          <span>Anexe fotos ou documentos para organizar esta obra.</span>
        </div>`;
    }

    const getCategory = file => {
      if (file.categoria === 'Foto da obra' || file.categoria === 'Documento') {
        return file.categoria;
      }

      const imageUrl = String(file.url || '');
      const imageName = String(file.nome || '');

      return /^image\//i.test(file.tipo || '') ||
        /\/image\/upload\//i.test(imageUrl) ||
        /\.(png|jpe?g|gif|webp|bmp|heic)(?:$|\?)/i.test(imageUrl) ||
        /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(imageName)
        ? 'Foto da obra'
        : 'Documento';
    };

    const renderGroup = (title, items, emptyMessage, photoMode = false) => `
      <section class="file-group" style="margin-top:18px">
        <h3 style="font-size:15px;margin:0 0 10px">
          ${e(title)} <span class="muted">(${items.length})</span>
        </h3>
        ${items.length ? items.map(file => {
          const url = ME.safeUrl(file.url);
          const category = getCategory(file);
          const isPdf =
            /\.pdf(?:$|\?)/i.test(file.url || '') ||
            /pdf/i.test(file.tipo || '') ||
            /\.pdf$/i.test(file.nome || '');

          return `
            <div class="file-item">
              ${photoMode && url !== '#' ? `<img class="file-thumb" src="${e(url)}" alt="${e(file.nome || 'Foto da obra')}" loading="lazy">` : `<div class="file-icon">${isPdf ? '▤' : '▧'}</div>`}
              <div class="file-meta">
                <div class="file-name">${e(file.nome || 'Arquivo da obra')}</div>
                <div class="file-date">
                  ${e(category)} · ${e(ME.date(file.created_at))}
                </div>
                ${file.etapa ? `<div class="file-date">Etapa: ${e(file.etapa)}</div>` : ''}
                ${file.descricao ? `<div class="file-date">${e(file.descricao)}</div>` : ''}
              </div>
              ${url !== '#'
                ? `<a class="file-open" href="${e(url)}"
                      target="_blank" rel="noopener noreferrer">${photoMode ? 'Ver foto ↗' : 'Abrir ↗'}</a>`
                : '<span class="file-open muted">Link indisponível</span>'}
              <button class="btn btn-outline"
                      type="button"
                      data-rename-file="${e(file.id)}">
                Renomear
              </button>
              <button class="btn btn-outline"
                      type="button"
                      data-delete-file="${e(file.id)}">
                Excluir
              </button>
            </div>`;
        }).join('') : `
          <div class="muted" style="font-size:13px;padding:8px 0">
            ${e(emptyMessage)}
          </div>
        `}
      </section>`;

    const photos = files.filter(file => getCategory(file) === 'Foto da obra');
    const documents = files.filter(file => getCategory(file) !== 'Foto da obra');

    return `
      ${renderGroup('Fotos da obra', photos, 'Nenhuma foto foi adicionada.', true)}
      ${renderGroup('Documentos', documents, 'Nenhum documento foi adicionado.')}
    `;
  }

 
  function collectUploadMetadata(file) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      const defaultCategory = file.type.startsWith('image/') ? 'Foto da obra' : 'Documento';
      overlay.innerHTML = `
        <form class="modal upload-modal" id="upload-metadata-form">
          <div class="modal-header">
            <div>
              <div class="eyebrow">Novo arquivo</div>
              <h2>Organizar antes de enviar</h2>
              <p>Defina o nome e onde este arquivo aparecerá para o cliente.</p>
            </div>
            <button type="button" class="icon-btn" id="cancel-upload" aria-label="Cancelar">✕</button>
          </div>
          <div class="selected-file-note"><span class="file-icon">${defaultCategory === 'Foto da obra' ? '▧' : '▤'}</span><div><strong>${e(file.name)}</strong><span>${(file.size / (1024 * 1024)).toFixed(2)} MB</span></div></div>
          <div class="field">
            <label for="upload-name">Nome que será exibido *</label>
            <input id="upload-name" name="nome" required maxlength="200" value="${e(file.name)}" placeholder="Ex.: Planta baixa - revisão 02.pdf">
          </div>
          <div class="field">
            <label for="upload-category">Categoria *</label>
            <select id="upload-category" name="categoria" required>
              <option value="Documento" ${defaultCategory === 'Documento' ? 'selected' : ''}>Documento</option>
              <option value="Foto da obra" ${defaultCategory === 'Foto da obra' ? 'selected' : ''}>Foto da obra</option>
            </select>
          </div>
          <div class="field">
            <label for="upload-stage">Etapa relacionada</label>
            <select id="upload-stage" name="etapa">
              <option value="">Sem etapa específica</option>
              ${stages.map(stage => `<option value="${e(stage)}" ${stage === (activeClient?.etapa_atual || 'Planejamento') ? 'selected' : ''}>${e(stage)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="upload-description">Descrição (opcional)</label>
            <textarea id="upload-description" name="descricao" rows="2" maxlength="1000" placeholder="Uma observação para identificar o arquivo"></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="cancel-upload-secondary">Cancelar</button>
            <button type="submit" class="btn btn-primary">Enviar arquivo →</button>
          </div>
        </form>`;
      document.body.appendChild(overlay);
      const close = value => {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector('#cancel-upload').addEventListener('click', () => close(null));
      overlay.querySelector('#cancel-upload-secondary').addEventListener('click', () => close(null));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) close(null);
      });
      overlay.querySelector('#upload-metadata-form').addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        const nome = form.elements.nome.value.trim();
        if (!nome) {
          form.elements.nome.focus();
          return;
        }
        close({
          nome,
          categoria: form.elements.categoria.value,
          etapa: form.elements.etapa.value,
          descricao: form.elements.descricao.value.trim()
        });
      });
      overlay.querySelector('#upload-name').focus();
      overlay.querySelector('#upload-name').select();
    });
  }

  async function uploadFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file || !activeClient) return;

    if (file.size > 15 * 1024 * 1024) {
      ME.toast('O arquivo excede o limite de 15 MB.', 'error');
      return;
    }

    const metadata = await collectUploadMetadata(file);
    if (!metadata) return;

    try {
      const config = await ME.getConfig();
      if (!config.cloudinaryName || !config.cloudinaryPreset) {
        ME.toast('Configure CLOUDINARY_CLOUD_NAME e CLOUDINARY_PRESET no Render.', 'error');
        return;
      }

      ME.toast('Enviando arquivo...');
      const data = new FormData();
      data.append('file', file);
      data.append('upload_preset', config.cloudinaryPreset);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryName)}/auto/upload`,
        { method: 'POST', body: data }
      );
      const uploaded = await response.json();

      if (!response.ok || !uploaded.secure_url) {
        throw new Error(uploaded.error?.message || 'O serviço de arquivos recusou o envio.');
      }

      await ME.request('arquivos', 'POST', {
        cliente_id: activeClient.id,
        nome: metadata.nome,
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        categoria: metadata.categoria,
        etapa: metadata.etapa,
        descricao: metadata.descricao
      });

      ME.toast(metadata.categoria === 'Foto da obra' ? 'Foto enviada e organizada na galeria.' : 'Documento enviado com sucesso.');
      await openClient(activeClient.id);
    } catch (err) {
      ME.toast(err.message || 'Falha ao enviar arquivo.', 'error');
    }
  }

  async function loadClients() {
    app.innerHTML = `
      <div class="loading">
        <div>
          <div class="spinner"></div>
          Carregando clientes e obras...
        </div>
      </div>`;

    try {
      const data = await ME.request(
        'clientes',
        'GET',
        null,
        '?select=*&order=created_at.desc'
      );

      allClients = Array.isArray(data) ? data : [];
      renderDashboard(filterClients());
    } catch (err) {
      shell(`
        <main class="page">
          <div class="content-card empty-state">
            <div class="empty-icon">!</div>
            <strong>Não foi possível carregar os dados</strong>
            <span>${e(err.message || 'Confira a conexão com o banco de dados.')}</span>
            <p style="margin-top:18px">
              <button id="retry" class="btn btn-primary">Tentar novamente</button>
            </p>
          </div>
        </main>
      `);

      document.getElementById('retry').addEventListener('click', loadClients);
    }
  }

  window.addEventListener('DOMContentLoaded', loadClients);
})();
