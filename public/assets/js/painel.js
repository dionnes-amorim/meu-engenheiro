
(() => {
  const app = document.getElementById('app');
  const e = ME.escape;

  const stages = [
    {
      name: 'Planejamento',
      detail: 'Organização inicial, projeto e preparação da obra.'
    },
    {
      name: 'Fundação e estrutura',
      detail: 'Execução da base e dos elementos estruturais.'
    },
    {
      name: 'Alvenaria e instalações',
      detail: 'Paredes, elétrica, hidráulica e instalações.'
    },
    {
      name: 'Acabamento',
      detail: 'Revestimentos, pintura, louças e ajustes finais.'
    },
    {
      name: 'Entrega',
      detail: 'Conferência final e preparação para entrega.'
    }
  ];

  const pct = value =>
    Math.max(0, Math.min(100, Number(value) || 0));

  const statusClass = status =>
    /conclu/i.test(status || '')
      ? 'done'
      : /paus|parad/i.test(status || '')
        ? 'paused'
        : /atras/i.test(status || '')
          ? 'delayed'
          : '';

  function fileCategory(file) {
    if (
      file.categoria === 'Foto da obra' ||
      file.categoria === 'Documento'
    ) {
      return file.categoria;
    }

    const url = String(file.url || '');
    const name = String(file.nome || '');

    const isImage =
      /^image\//i.test(file.tipo || '') ||
      /\/image\/upload\//i.test(url) ||
      /\.(png|jpe?g|gif|webp|bmp|heic)(?:$|\?)/i.test(url) ||
      /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(name);

    return isImage ? 'Foto da obra' : 'Documento';
  }

  function emptyState(title, description) {
    return `
      <div class="empty-state compact-empty">
        <div class="empty-icon">▤</div>
        <strong>${e(title)}</strong>
        <span>${e(description)}</span>
      </div>
    `;
  }

  function documentsMarkup(files) {
    if (!files.length) {
      return emptyState(
        'Nenhum documento disponível',
        'Os documentos compartilhados pelo engenheiro aparecerão aqui.'
      );
    }

    return `
      <div class="file-list">
        ${files.map(file => {
          const url = ME.safeUrl(file.url);

          return `
            <article class="file-item">
              <div class="file-icon">▤</div>

              <div class="file-meta">
                <div class="file-name">
                  ${e(file.nome || 'Documento da obra')}
                </div>

                <div class="file-date">
                  Adicionado em ${e(ME.date(file.created_at))}
                </div>

                ${file.etapa ? `
                  <div class="file-date">
                    Etapa: ${e(file.etapa)}
                  </div>
                ` : ''}

                ${file.descricao ? `
                  <div class="file-description">
                    ${e(file.descricao)}
                  </div>
                ` : ''}
              </div>

              ${url !== '#'
                ? `
                  <a class="file-open"
                     href="${e(url)}"
                     target="_blank"
                     rel="noopener noreferrer">
                    Abrir ↗
                  </a>
                `
                : `
                  <span class="file-open muted">
                    Indisponível
                  </span>
                `
              }
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function photosMarkup(files) {
    if (!files.length) {
      return emptyState(
        'Nenhuma foto compartilhada',
        'As fotos de acompanhamento da obra aparecerão nesta galeria.'
      );
    }

    return `
      <div class="photo-gallery">
        ${files.map(file => {
          const url = ME.safeUrl(file.url);

          return `
            <article class="photo-card">
              ${url !== '#'
                ? `
                  <a class="photo-card-image"
                     href="${e(url)}"
                     target="_blank"
                     rel="noopener noreferrer">
                    <img
                      src="${e(url)}"
                      alt="${e(file.nome || 'Foto da obra')}"
                      loading="lazy">
                  </a>
                `
                : `
                  <div class="photo-card-image photo-placeholder">
                    Imagem indisponível
                  </div>
                `
              }

              <div class="photo-card-info">
                <strong>
                  ${e(file.nome || 'Foto da obra')}
                </strong>

                <span>${e(ME.date(file.created_at))}</span>

                ${file.etapa ? `
                  <span>Etapa: ${e(file.etapa)}</span>
                ` : ''}

                ${file.descricao ? `
                  <p>${e(file.descricao)}</p>
                ` : ''}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function updatesMarkup(updates) {
    if (!updates.length) {
      return emptyState(
        'Ainda não há atualizações',
        'Quando o engenheiro publicar novidades, elas aparecerão aqui.'
      );
    }

    return `
      <div class="client-updates">
        ${updates.map(item => `
          <article class="client-update">
            <div class="client-update-marker">↗</div>

            <div class="client-update-content">
              <div class="client-update-head">
                <h3>
                  ${e(item.titulo || 'Atualização da obra')}
                </h3>

                <time>
                  ${e(ME.dateTime(item.created_at))}
                </time>
              </div>

              <p>${e(item.descricao || '')}</p>
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  function stageMarkup(client) {
    const currentName = client.etapa_atual || 'Planejamento';

    let currentIndex = stages.findIndex(stage =>
      stage.name.toLocaleLowerCase('pt-BR') ===
      currentName.toLocaleLowerCase('pt-BR')
    );

    const visibleStages = [...stages];

    if (currentIndex < 0) {
      visibleStages.push({
        name: currentName,
        detail: 'Etapa informada pelo responsável da obra.'
      });

      currentIndex = visibleStages.length - 1;
    }

    const isComplete = /conclu/i.test(client.status || '');

    return `
      <div class="timeline">
        ${visibleStages.map((stage, index) => {
          const done = isComplete || index < currentIndex;
          const current = !isComplete && index === currentIndex;

          return `
            <article class="timeline-step
              ${done ? 'timeline-step-done' : ''}
              ${current ? 'timeline-step-current' : ''}">

              <div class="timeline-dot">
                ${done ? '✓' : index + 1}
              </div>

              <div class="timeline-copy">
                <div class="timeline-title-row">
                  <strong>${e(stage.name)}</strong>

                  ${current
                    ? '<span class="status current-stage">Etapa atual</span>'
                    : done
                      ? '<span class="status done">Concluída</span>'
                      : '<span class="status pending">Próxima</span>'
                  }
                </div>

                <span>${e(stage.detail)}</span>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  async function init() {
    const id = localStorage.getItem('cliente_id');

    if (!id) {
      location.href = '/login-cliente.html';
      return;
    }

    try {
      const clientResult = await ME.request(
        'clientes',
        'GET',
        null,
        `?id=eq.${encodeURIComponent(id)}` +
        '&select=id,nome,email,endereco_obra,progresso,status,etapa_atual,created_at'
      );

      const client = Array.isArray(clientResult)
        ? clientResult[0]
        : clientResult;

      if (!client) {
        localStorage.removeItem('cliente_id');
        location.href = '/login-cliente.html';
        return;
      }

      const [filesResult, updatesResult] = await Promise.allSettled([
        ME.request(
          'arquivos',
          'GET',
          null,
          `?cliente_id=eq.${encodeURIComponent(id)}&order=created_at.desc`
        ),
        ME.request(
          'atualizacoes_obra',
          'GET',
          null,
          `?cliente_id=eq.${encodeURIComponent(id)}&order=created_at.desc`
        )
      ]);

      const allFiles =
        filesResult.status === 'fulfilled' &&
        Array.isArray(filesResult.value)
          ? filesResult.value
          : [];

      const updates =
        updatesResult.status === 'fulfilled' &&
        Array.isArray(updatesResult.value)
          ? updatesResult.value
          : [];

      render(
        client,
        allFiles,
        updates,
        filesResult.status === 'rejected',
        updatesResult.status === 'rejected'
      );
    } catch (error) {
      app.innerHTML = `
        <main class="page">
          <div class="content-card empty-state">
            <div class="empty-icon">!</div>
            <strong>Não foi possível carregar sua obra</strong>
            <span>${e(error.message || 'Tente entrar novamente.')}</span>

            <p style="margin-top:18px">
              <button id="retry" class="btn btn-primary">
                Tentar novamente
              </button>

              <button id="logout-error" class="btn btn-outline">
                Sair
              </button>
            </p>
          </div>
        </main>
      `;

      document.getElementById('retry')
        .addEventListener('click', init);

      document.getElementById('logout-error')
        .addEventListener('click', logout);
    }
  }

  function logout() {
    localStorage.removeItem('cliente_id');
    location.href = '/login-cliente.html';
  }

  function render(
    client,
    allFiles,
    updates,
    filesError,
    updatesError
  ) {
    const progress = pct(client.progresso);
    const status = client.status || 'Em andamento';

    const photos = allFiles.filter(
      file => fileCategory(file) === 'Foto da obra'
    );

    const documents = allFiles.filter(
      file => fileCategory(file) === 'Documento'
    );

    const firstName = (client.nome || 'cliente')
      .trim()
      .split(/\s+/)[0];

    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a class="brand-lockup"
               href="/"
               aria-label="Meu Engenheiro">

              <img class="brand-logo"
                   src="/assets/img/logo-engenheiro.png"
                   alt="PH Engenharia">

              <div>
                <div class="brand brand-title">Meu Engenheiro</div>
                <div class="brand-subtitle">Área do cliente</div>
              </div>
            </a>

            <button id="logout" class="btn btn-light">
              Sair ↗
            </button>
          </div>
        </header>

        <main class="page client-page">
          <section class="client-hero">
            <div class="client-hero-content">
              <div class="eyebrow">Seu espaço de acompanhamento</div>

              <h1>Olá, ${e(firstName)}.</h1>

              <p>
                Acompanhe as etapas, veja as fotos e encontre os documentos
                e atualizações compartilhados pelo seu engenheiro.
              </p>

              <div class="client-hero-meta">
                <span class="status ${statusClass(status)}">
                  ${e(status)}
                </span>

                <span class="client-current-stage">
                  Etapa atual:
                  <strong>${e(client.etapa_atual || 'Planejamento')}</strong>
                </span>
              </div>

              <div class="client-progress">
                <div class="client-progress-label">
                  <span>Progresso informado da obra</span>
                  <strong>${progress}%</strong>
                </div>

                <div class="progress-track">
                  <div class="progress-fill" style="width:${progress}%"></div>
                </div>
              </div>
            </div>
          </section>

          <div class="client-section-heading">
            <div>
              <div class="eyebrow">Visão geral</div>
              <h2>Minha obra</h2>
            </div>
          </div>

          <section class="metrics client-metrics">
            <article class="metric">
              <div class="metric-top">
                <span>Progresso informado</span>
                <span class="metric-icon">↗</span>
              </div>
              <div class="metric-value">${progress}%</div>
              <div class="metric-note">Atualizado pelo responsável da obra</div>
            </article>

            <article class="metric">
              <div class="metric-top">
                <span>Fotos da obra</span>
                <span class="metric-icon">▧</span>
              </div>
              <div class="metric-value">${photos.length}</div>
              <div class="metric-note">Imagens compartilhadas</div>
            </article>

            <article class="metric">
              <div class="metric-top">
                <span>Documentos</span>
                <span class="metric-icon">▤</span>
              </div>
              <div class="metric-value">${documents.length}</div>
              <div class="metric-note">Arquivos disponíveis</div>
            </article>
          </section>

          <section class="content-card client-stage-card">
            <div class="section-pad">
              <div class="section-heading-row">
                <div>
                  <h2 class="section-title">Etapas da obra</h2>
                  <p class="section-desc">
                    A etapa atual é definida pelo engenheiro,
                    independentemente da porcentagem informada.
                  </p>
                </div>

                <span class="status ${statusClass(status)}">
                  ${e(status)}
                </span>
              </div>

              ${stageMarkup(client)}
            </div>
          </section>

          <section class="content-card client-gallery-section">
            <div class="section-pad">
              <div class="section-heading-row">
                <div>
                  <h2 class="section-title">Fotos da obra</h2>
                  <p class="section-desc">
                    Registro visual do andamento do projeto.
                  </p>
                </div>

                <span class="section-count">
                  ${photos.length} foto(s)
                </span>
              </div>

              ${filesError
                ? '<p class="notice error">Não foi possível carregar os arquivos neste momento.</p>'
                : photosMarkup(photos)
              }
            </div>
          </section>

          <section class="content-card client-documents-section">
            <div class="section-pad">
              <div class="section-heading-row">
                <div>
                  <h2 class="section-title">Documentos</h2>
                  <p class="section-desc">
                    Projetos, relatórios e outros arquivos compartilhados.
                  </p>
                </div>

                <span class="section-count">
                  ${documents.length} arquivo(s)
                </span>
              </div>

              ${filesError
                ? '<p class="notice error">Não foi possível carregar os arquivos neste momento.</p>'
                : documentsMarkup(documents)
              }
            </div>
          </section>

          <section class="content-card client-updates-section">
            <div class="section-pad">
              <div class="section-heading-row">
                <div>
                  <h2 class="section-title">Diário e atualizações</h2>
                  <p class="section-desc">
                    Acompanhe os registros publicados pelo engenheiro.
                  </p>
                </div>
              </div>

              ${updatesError
                ? '<p class="notice error">O histórico não pôde ser carregado. Tente novamente mais tarde.</p>'
                : updatesMarkup(updates)
              }
            </div>
          </section>

          <footer class="footer-logos">
            <div class="footer-caption">
              PH ENGENHARIA · ACOMPANHAMENTO DA SUA OBRA
            </div>

            <div class="two-logos">
              <img src="/assets/img/logo-engenheiro.png"
                   alt="PH Engenharia">

              <img src="/assets/img/logo-desenvolvimento.png"
                   alt="Desenvolvimento">
            </div>
          </footer>
        </main>
      </div>
    `;

    document.getElementById('logout')
      .addEventListener('click', logout);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
