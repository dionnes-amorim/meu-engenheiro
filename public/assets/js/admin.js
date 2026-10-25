(() => {
  const app = document.getElementById('app');
  let allClients = [];
  let activeClient = null;
  let filterText = '';
  const e = ME.escape;
  const statusClass = (status) => /conclu/i.test(status || '') ? 'done' : /paus|parad/i.test(status || '') ? 'paused' : '';
  const progress = (value) => Math.max(0, Math.min(100, Number(value) || 0));

  function shell(content) {
    app.innerHTML = `<div class="app-shell"><header class="topbar"><div class="topbar-inner"><a class="brand-lockup" href="/" aria-label="Meu Engenheiro, início"><div class="brand-mark">M</div><div><div class="brand brand-title">Meu Engenheiro</div><div class="brand-subtitle">Gestão inteligente de obras</div></div></a><div class="topbar-actions"><a class="btn btn-light hide-mobile" href="/login-cliente.html" target="_blank" rel="noopener">↗ Prévia da área do cliente</a><div class="avatar" title="Área de gestão">ME</div></div></div></header>${content}</div>`;
  }
  function renderDashboard(list = allClients) {
    const completed = allClients.filter(c => /conclu/i.test(c.status || '') || progress(c.progresso) >= 100).length;
    const active = allClients.length - completed;
    const average = allClients.length ? Math.round(allClients.reduce((sum, c) => sum + progress(c.progresso), 0) / allClients.length) : 0;
    shell(`<main class="page"><div class="welcome-row"><div><div class="eyebrow">Painel de gestão</div><h1>Suas obras, sob controle.</h1><p>Uma visão clara dos clientes e do andamento dos projetos.</p></div><button class="btn btn-primary" id="new-client">＋ Cadastrar cliente</button></div>
      <section class="metrics" aria-label="Resumo das obras"><article class="metric"><div class="metric-top"><span>Total de clientes</span><span class="metric-icon">♙</span></div><div class="metric-value">${allClients.length}</div><div class="metric-note">Cadastros no sistema</div></article><article class="metric"><div class="metric-top"><span>Obras em andamento</span><span class="metric-icon">⌂</span></div><div class="metric-value">${active}</div><div class="metric-note">Projetos não concluídos</div></article><article class="metric"><div class="metric-top"><span>Progresso médio</span><span class="metric-icon">↗</span></div><div class="metric-value">${average}%</div><div class="metric-note">Calculado com os dados cadastrados</div></article></section>
      <section class="content-card"><div class="card-heading"><div><h2>Clientes e obras</h2><p>Abra um cadastro para consultar documentos e compartilhar informações.</p></div><div class="search-wrap"><span class="search-icon">⌕</span><input id="search" type="search" placeholder="Buscar cliente, e-mail ou endereço..." value="${e(filterText)}" aria-label="Buscar clientes"></div></div><div id="client-list" class="client-list">${renderCards(list)}</div></section>
      <footer class="footer-logos"><div class="footer-caption">MEU ENGENHEIRO · PLATAFORMA DE GESTÃO DE OBRAS</div><div class="two-logos"><img src="/assets/img/logo-engenheiro.png" alt="Espaço para logo do engenheiro"><img src="/assets/img/logo-desenvolvimento.png" alt="Espaço para logo de desenvolvimento"></div></footer></main>`);
    document.getElementById('new-client').addEventListener('click', showNewClient);
    document.getElementById('search').addEventListener('input', (event) => {
      filterText = event.target.value;
      const q = filterText.toLocaleLowerCase('pt-BR');
      const filtered = allClients.filter(c => [c.nome, c.email, c.endereco_obra, c.status].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(q)));
      document.getElementById('client-list').innerHTML = renderCards(filtered);
      wireOpenButtons();
    });
    wireOpenButtons();
  }
  function renderCards(list) {
    if (!list.length) return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⌂</div><strong>${allClients.length ? 'Nenhum resultado encontrado' : 'Seu primeiro projeto começa aqui'}</strong><span>${allClients.length ? 'Tente buscar por outro nome ou endereço.' : 'Cadastre um cliente para começar a organizar suas obras.'}</span></div>`;
    return list.map(c => {
      const pct = progress(c.progresso); const status = c.status || 'Em andamento';
      return `<article class="client-card"><div class="client-card-top"><div class="client-avatar">${e(ME.initials(c.nome))}</div><div class="client-main"><div class="client-name">${e(c.nome || 'Cliente sem nome')}</div><div class="client-email">${e(c.email || 'E-mail não informado')}</div></div><span class="status ${statusClass(status)}">${e(status)}</span></div><div class="client-address">⌖ &nbsp;${e(c.endereco_obra || 'Endereço da obra não cadastrado')}</div><div class="progress-row"><span class="muted">Progresso da obra</span><strong>${pct}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="client-card-footer"><span class="muted" style="font-size:10px">Cadastro ${e(ME.date(c.created_at))}</span><button class="small-action" data-open="${e(c.id)}">Ver obra &nbsp;→</button></div></article>`;
    }).join('');
  }
  function wireOpenButtons() { document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openClient(button.dataset.open))); }
  function showNewClient() {
    const overlay = document.createElement('div'); overlay.className = 'modal-backdrop'; overlay.innerHTML = `<form class="modal" id="client-form"><div class="modal-header"><div><div class="eyebrow">Novo cadastro</div><h2>Adicionar cliente</h2><p>Cadastre os dados básicos para organizar a obra.</p></div><button type="button" class="icon-btn" id="close-modal" aria-label="Fechar">✕</button></div><div id="form-error" class="notice error hidden"></div><div class="field"><label for="nome">Nome do cliente *</label><input id="nome" name="nome" required maxlength="150" placeholder="Nome completo"></div><div class="field"><label for="email">E-mail de acesso *</label><input id="email" name="email" type="email" required maxlength="200" placeholder="cliente@email.com"></div><div class="field"><label for="senha">Senha inicial *</label><input id="senha" name="senha" type="password" required minlength="4" maxlength="100" autocomplete="new-password" placeholder="Crie uma senha inicial"></div><div class="field"><label for="endereco">Endereço da obra</label><input id="endereco" name="endereco" maxlength="300" placeholder="Rua, bairro, lote e cidade"></div><div class="form-actions"><button type="button" class="btn btn-outline" id="cancel-modal">Cancelar</button><button type="submit" class="btn btn-primary" id="save-client">Salvar cliente →</button></div></form>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#close-modal').addEventListener('click', close); overlay.querySelector('#cancel-modal').addEventListener('click', close);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    overlay.querySelector('#client-form').addEventListener('submit', async ev => {
      ev.preventDefault(); const form = ev.currentTarget; const fd = new FormData(form); const save = overlay.querySelector('#save-client'); const error = overlay.querySelector('#form-error'); save.disabled = true; save.textContent = 'Salvando...'; error.classList.add('hidden');
      try {
        await ME.request('clientes', 'POST', { nome: String(fd.get('nome')).trim(), email: String(fd.get('email')).trim().toLowerCase(), senha_acesso: String(fd.get('senha')), endereco_obra: String(fd.get('endereco') || '').trim(), progresso: 5, status: 'Em andamento' });
        close(); ME.toast('Cliente cadastrado com sucesso.'); await loadClients();
      } catch (err) { error.textContent = err.message || 'Não foi possível salvar o cadastro.'; error.classList.remove('hidden'); save.disabled = false; save.textContent = 'Salvar cliente →'; }
    });
  }
  async function openClient(id) {
    try {
      const [client] = await ME.request('clientes', 'GET', null, `?id=eq.${encodeURIComponent(id)}&select=*`);
      if (!client) throw new Error('Cliente não encontrado.');
      activeClient = client;
      const files = await ME.request('arquivos', 'GET', null, `?cliente_id=eq.${encodeURIComponent(id)}&order=created_at.desc`);
      renderDetail(client, Array.isArray(files) ? files : []);
    } catch (err) { ME.toast(err.message || 'Não foi possível abrir a obra.', 'error'); }
  }
  function renderDetail(client, files) {
    const id = e(client.id); const pct = progress(client.progresso); const status = client.status || 'Em andamento';
    shell(`<header class="detail-header"><div class="detail-header-inner"><button class="btn btn-outline" id="back">← Voltar</button><div><div class="detail-title">${e(client.nome || 'Cliente')}</div><div class="detail-subtitle">${e(client.endereco_obra || 'Endereço não cadastrado')}</div></div><div style="margin-left:auto"><span class="status ${statusClass(status)}">${e(status)}</span></div></div></header><main class="page"><div class="welcome-row"><div><div class="eyebrow">Detalhes do projeto</div><h1 style="margin-bottom:7px">${e(client.nome || 'Obra')}</h1><p>Acompanhe os arquivos e as informações de acesso do cliente.</p></div><button id="upload-trigger" class="btn btn-primary">＋ Anexar arquivo</button><input type="file" id="upload-file" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"></div><div class="metrics"><article class="metric"><div class="metric-top"><span>Progresso informado</span><span class="metric-icon">↗</span></div><div class="metric-value">${pct}%</div><div class="progress-track" style="margin-top:12px"><div class="progress-fill" style="width:${pct}%"></div></div></article><article class="metric"><div class="metric-top"><span>Arquivos compartilhados</span><span class="metric-icon">▤</span></div><div class="metric-value">${files.length}</div><div class="metric-note">Fotos, documentos e registros</div></article><article class="metric"><div class="metric-top"><span>Cliente desde</span><span class="metric-icon">◷</span></div><div class="metric-value" style="font-size:24px">${e(ME.date(client.created_at))}</div><div class="metric-note">Data do cadastro</div></article></div><div class="detail-grid"><section class="content-card"><div class="section-pad"><h2 class="section-title">Arquivos da obra</h2><p class="section-desc">Materiais disponíveis para compartilhar com o cliente.</p><div id="file-list" class="file-list">${renderFiles(files)}</div></div></section><aside class="content-card"><div class="section-pad"><h2 class="section-title">Acesso do cliente</h2><p class="section-desc">Compartilhe o endereço abaixo para o cliente entrar na área da obra.</p><div class="credential-box"><div class="credential-label">E-mail de acesso</div><div class="credential-value">${e(client.email || 'Não informado')}</div><div class="credential-label">Endereço do portal</div><div class="credential-value">${e(location.origin + '/login-cliente.html')}</div></div><button class="btn btn-light" style="width:100%;margin-top:12px" id="copy-link">▣ Copiar link do portal</button><p class="helper">Por segurança, a senha cadastrada não é exibida nesta tela. Se o cliente esquecer, gere um novo acesso pelo processo de autenticação adotado no sistema.</p></div></aside></div><footer class="footer-logos"><div class="footer-caption">MEU ENGENHEIRO · ÁREA DE GESTÃO</div><div class="two-logos"><img src="/assets/img/logo-engenheiro.png" alt="Espaço para logo do engenheiro"><img src="/assets/img/logo-desenvolvimento.png" alt="Espaço para logo de desenvolvimento"></div></footer></main>`);
    document.getElementById('back').addEventListener('click', () => renderDashboard(filterClients()));
    document.getElementById('upload-trigger').addEventListener('click', () => document.getElementById('upload-file').click());
    document.getElementById('upload-file').addEventListener('change', uploadFile);
    document.getElementById('copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/login-cliente.html`); ME.toast('Link do portal copiado.'); } catch { ME.toast('Copie o endereço exibido no quadro de acesso.'); } });
  }
  function filterClients() { const q = filterText.toLocaleLowerCase('pt-BR'); return allClients.filter(c => [c.nome,c.email,c.endereco_obra,c.status].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(q))); }
  function renderFiles(files) {
    if (!files.length) return `<div class="empty-state"><div class="empty-icon">▤</div><strong>Nenhum arquivo compartilhado</strong><span>Anexe fotos ou documentos para organizar os registros desta obra.</span></div>`;
    return files.map(file => { const url = ME.safeUrl(file.url); const pdf = /\.pdf(?:$|\?)/i.test(file.url || '') || /pdf/i.test(file.tipo || ''); return `<div class="file-item"><div class="file-icon">${pdf ? '▤' : '▧'}</div><div class="file-meta"><div class="file-name">${e(file.nome || 'Arquivo da obra')}</div><div class="file-date">Adicionado em ${e(ME.date(file.created_at))}</div></div>${url !== '#' ? `<a class="file-open" href="${e(url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : '<span class="file-open muted">Link indisponível</span>'}</div>`; }).join('');
  }
  async function uploadFile(event) {
    const file = event.target.files && event.target.files[0]; event.target.value = ''; if (!file || !activeClient) return;
    if (file.size > 15 * 1024 * 1024) { ME.toast('O arquivo excede o limite de 15 MB desta interface.', 'error'); return; }
    const config = await ME.getConfig();
    if (!config.cloudinaryName || !config.cloudinaryPreset) { ME.toast('Configure CLOUDINARY_CLOUD_NAME e CLOUDINARY_PRESET no Render.', 'error'); return; }
    ME.toast('Enviando arquivo...');
    try {
      const data = new FormData(); data.append('file', file); data.append('upload_preset', config.cloudinaryPreset);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryName)}/auto/upload`, { method: 'POST', body: data });
      const uploaded = await response.json();
      if (!response.ok || !uploaded.secure_url) throw new Error(uploaded.error?.message || 'O serviço de mídia não aceitou o arquivo.');
      await ME.request('arquivos', 'POST', { cliente_id: activeClient.id, nome: file.name, url: uploaded.secure_url, public_id: uploaded.public_id });
      ME.toast('Arquivo anexado com sucesso.'); await openClient(activeClient.id);
    } catch (err) { ME.toast(err.message || 'Falha ao enviar arquivo.', 'error'); }
  }
  async function loadClients() {
    app.innerHTML = '<div class="loading"><div><div class="spinner"></div>Carregando clientes e obras...</div></div>';
    try { const data = await ME.request('clientes', 'GET', null, '?select=*&order=created_at.desc'); allClients = Array.isArray(data) ? data : []; renderDashboard(filterClients()); }
    catch (err) { shell(`<main class="page"><div class="content-card empty-state"><div class="empty-icon">!</div><strong>Não foi possível carregar os dados</strong><span>${e(err.message || 'Confira as variáveis e as políticas do Supabase configuradas no Render.')}</span><p style="margin-top:18px"><button id="retry" class="btn btn-primary">Tentar novamente</button></p></div></main>`); document.getElementById('retry').addEventListener('click', loadClients); }
  }
  window.addEventListener('DOMContentLoaded', loadClients);
})();
