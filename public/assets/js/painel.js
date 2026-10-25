(() => {
  const app = document.getElementById('app'); const e = ME.escape;
  const pct = value => Math.max(0, Math.min(100, Number(value) || 0));
  const statusClass = status => /conclu/i.test(status || '') ? 'done' : /paus|parad/i.test(status || '') ? 'paused' : '';
  function filesMarkup(files) {
    if (!files.length) return `<div class="empty-state"><div class="empty-icon">▤</div><strong>Os documentos aparecerão aqui</strong><span>Quando seu engenheiro compartilhar arquivos, eles ficarão disponíveis nesta área.</span></div>`;
    return files.map(file => { let url = ME.safeUrl(file.url); let pdf = /\.pdf(?:$|\?)/i.test(file.url || '') || /pdf/i.test(file.tipo || ''); return `<div class="file-item"><div class="file-icon">${pdf ? '▤' : '▧'}</div><div class="file-meta"><div class="file-name">${e(file.nome || 'Arquivo da obra')}</div><div class="file-date">Adicionado em ${e(ME.date(file.created_at))}</div></div>${url !== '#' ? `<a class="file-open" href="${e(url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : '<span class="file-open muted">Indisponível</span>'}</div>`; }).join('');
  }
  async function init() {
    const id = localStorage.getItem('cliente_id');
    if (!id) { location.href = '/login-cliente.html'; return; }
    try {
      const [client] = await ME.request('clientes', 'GET', null, `?id=eq.${encodeURIComponent(id)}&select=id,nome,email,endereco_obra,progresso,status,created_at`);
      if (!client) { localStorage.removeItem('cliente_id'); location.href = '/login-cliente.html'; return; }
      const docs = await ME.request('arquivos', 'GET', null, `?cliente_id=eq.${encodeURIComponent(id)}&order=created_at.desc`);
      render(client, Array.isArray(docs) ? docs : []);
    } catch (error) {
      app.innerHTML = `<main class="page"><div class="content-card empty-state"><div class="empty-icon">!</div><strong>Não foi possível carregar sua obra</strong><span>${e(error.message || 'Tente entrar novamente.')}</span><p style="margin-top:18px"><button id="retry" class="btn btn-primary">Tentar novamente</button> <button id="logout-error" class="btn btn-outline">Sair</button></p></div></main>`;
      document.getElementById('retry').addEventListener('click', init); document.getElementById('logout-error').addEventListener('click', logout);
    }
  }
  function logout() { localStorage.removeItem('cliente_id'); location.href = '/login-cliente.html'; }
  function render(client, files) {
    const progress = pct(client.progresso); const status = client.status || 'Em andamento';
    const steps = [
      { name: 'Planejamento', detail: 'Organização inicial e preparação do projeto.', threshold: 1 },
      { name: 'Fundação e estrutura', detail: 'Etapa estrutural da obra.', threshold: 25 },
      { name: 'Alvenaria e instalações', detail: 'Execução das paredes e instalações.', threshold: 50 },
      { name: 'Acabamento', detail: 'Etapa de finalização e ajustes.', threshold: 75 },
      { name: 'Entrega', detail: 'Conclusão do projeto.', threshold: 100 }
    ];
    app.innerHTML = `<div class="app-shell"><header class="topbar"><div class="topbar-inner"><a class="brand-lockup" href="/" aria-label="Meu Engenheiro"><div class="brand-mark">M</div><div><div class="brand brand-title">Meu Engenheiro</div><div class="brand-subtitle">Área do cliente</div></div></a><button id="logout" class="btn btn-light">Sair ↗</button></div></header><main class="page"><section class="client-hero"><div class="client-hero-content"><div class="eyebrow">Seu espaço de acompanhamento</div><h1>Olá, ${e((client.nome || 'cliente').trim().split(/\s+/)[0])}.</h1><p>Acompanhe por aqui as informações e os arquivos compartilhados sobre sua obra. Em caso de dúvidas, fale diretamente com o profissional responsável.</p><div class="client-progress"><div class="client-progress-label"><span>Progresso informado da obra</span><strong>${progress}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div></div></section><div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:24px 0 14px;flex-wrap:wrap"><div><div class="eyebrow">Visão geral</div><h2 style="font:800 20px Manrope,sans-serif;letter-spacing:-.04em;margin:7px 0 0">Minha obra</h2></div><span class="status ${statusClass(status)}">${e(status)}</span></div><div class="metrics"><article class="metric"><div class="metric-top"><span>Andamento</span><span class="metric-icon">↗</span></div><div class="metric-value">${progress}%</div><div class="metric-note">Progresso informado pelo responsável</div></article><article class="metric"><div class="metric-top"><span>Arquivos disponíveis</span><span class="metric-icon">▤</span></div><div class="metric-value">${files.length}</div><div class="metric-note">Fotos e documentos compartilhados</div></article><article class="metric"><div class="metric-top"><span>Endereço</span><span class="metric-icon">⌖</span></div><div class="metric-value" style="font-size:16px;line-height:1.4;letter-spacing:-.02em">${e(client.endereco_obra || 'A confirmar')}</div><div class="metric-note">Local cadastrado para o projeto</div></article></div><div class="detail-grid"><section class="content-card"><div class="section-pad"><h2 class="section-title">Fotos e documentos</h2><p class="section-desc">Acesse os materiais que foram compartilhados com você.</p><div class="file-list">${filesMarkup(files)}</div></div></section><section class="content-card"><div class="section-pad"><h2 class="section-title">Etapas da obra</h2><p class="section-desc">Referência visual de andamento. A porcentagem acima é a informação cadastrada no sistema.</p><div class="timeline">${steps.map((step,index) => { const done = progress >= step.threshold; const current = !done && (index === 0 || progress >= steps[index-1].threshold); return `<div class="timeline-step"><div class="timeline-dot">${done ? '✓' : index + 1}</div><div><strong>${e(step.name)} ${current ? '<span class="status" style="margin-left:5px;padding:3px 6px">Etapa atual</span>' : ''}</strong><span>${e(step.detail)}</span></div></div>`; }).join('')}</div><p class="helper">As etapas são ilustrativas nesta versão. A atualização detalhada por etapa poderá ser ativada em uma próxima fase.</p></div></section></div><footer class="footer-logos"><div class="footer-caption">MEU ENGENHEIRO · ACOMPANHAMENTO DA SUA OBRA</div><div class="two-logos"><img src="/assets/img/logo-engenheiro.svg" alt="Espaço para logo do engenheiro"><img src="/assets/img/logo-desenvolvimento.svg" alt="Espaço para logo de desenvolvimento"></div></footer></main></div>`;
    document.getElementById('logout').addEventListener('click', logout);
  }
  window.addEventListener('DOMContentLoaded', init);
})();
