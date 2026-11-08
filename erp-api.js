'use strict';

// ======================================================
// PH ENGENHARIA — SERVIDOR PRINCIPAL
// ERP DE GESTÃO DE OBRAS — MINHA OBRA
//
// Integração:
// - Express
// - erp-api.js
// - Supabase
// - Cloudinary
// - Portal do cliente
//
// Autenticação:
// Cookie HttpOnly: ph_erp_admin
// Middleware central: erp-api.js
//
// Node.js >= 18
// ======================================================

const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ======================================================
// CONFIGURAÇÃO DO EXPRESS
// ======================================================

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({
    limit: '5mb'
}));

app.use(express.urlencoded({
    extended: true,
    limit: '5mb'
}));

// Nenhuma resposta da API deve ficar armazenada em cache.

app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// ======================================================
// CARREGAMENTO DO ERP-API
// ======================================================

const erpApiModule = require('./erp-api');

const registerErpApi =
    typeof erpApiModule === 'function'
        ? erpApiModule
        : typeof erpApiModule?.registerErpApi === 'function'
            ? erpApiModule.registerErpApi
            : typeof erpApiModule?.default === 'function'
                ? erpApiModule.default
                : null;

if (typeof registerErpApi !== 'function') {
    throw new TypeError(
        'Não foi possível carregar ./erp-api.js. ' +
        'O módulo precisa exportar a função registerErpApi(app).'
    );
}

console.log(
    '[ERP] Módulo localizado:',
    require.resolve('./erp-api')
);

// ======================================================
// REGISTRO DAS ROTAS PRINCIPAIS
// ======================================================

try {
    registerErpApi(app);

    console.log(
        '[ERP] Rotas administrativas registradas.'
    );

} catch (error) {
    console.error(
        '[ERP] Erro ao registrar as rotas:',
        error.stack || error
    );

    throw error;
}

// ======================================================
// AUTENTICAÇÃO COMPARTILHADA
// ======================================================

// O erp-api.js registra o middleware oficial.
//
// Não criamos outra sessão.
// Não criamos outro cookie.
// Não duplicamos a validação criptográfica.
//
// O mesmo middleware será utilizado nas rotas
// complementares de arquivos, etapas e atualizações.

const requireErpAdmin = app.locals.requireErpAdmin;

if (typeof requireErpAdmin !== 'function') {
    throw new Error(
        'O erp-api.js não disponibilizou ' +
        'app.locals.requireErpAdmin.'
    );
}

// ======================================================
// PROTEÇÃO CONTRA REQUISIÇÕES DE OUTRA ORIGEM
// ======================================================

function verifySameOrigin(req, res, next) {
    const origin = req.get('origin');

    // Requisições sem Origin são permitidas pelo mesmo
    // comportamento adotado no módulo principal.

    if (!origin) {
        return next();
    }

    try {
        const parsedOrigin = new URL(origin);

        if (parsedOrigin.host !== req.get('host')) {
            return res.status(403).json({
                ok: false,
                error: 'Origem não autorizada.'
            });
        }

        return next();

    } catch {
        return res.status(403).json({
            ok: false,
            error: 'Origem inválida.'
        });
    }
}

// Middleware compartilhado para as rotas complementares.

function exigirErpAdmin(req, res, next) {
    return requireErpAdmin(req, res, () => {
        return verifySameOrigin(req, res, next);
    });
}

// ======================================================
// MIGRAÇÃO DA AUTENTICAÇÃO ANTIGA
// ======================================================

// Impede que a aplicação antiga crie uma segunda sessão.
//
// O login atual é realizado pelo erp-api.js:
//
// POST /api/erp/login
// GET  /api/erp/session
// POST /api/erp/logout

app.all(
    [
        '/api/login',
        '/api/auth/status',
        '/api/logout'
    ],
    (_req, res) => {
        return res.status(410).json({
            ok: false,
            message:
                'A autenticação foi atualizada. Utilize ' +
                '/api/erp/login, /api/erp/session e /api/erp/logout.'
        });
    }
);

// ======================================================
// CONFIGURAÇÕES PÚBLICAS
// ======================================================

// Utilizada pelo JavaScript para:
// - Configuração do Supabase.
// - Upload de arquivos e imagens no Cloudinary.
//
// A chave SERVICE_ROLE NUNCA é disponibilizada.

app.get('/api/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const publicKey =
        process.env.SUPABASE_ANON_KEY ||
        process.env.SUPABASE_KEY ||
        '';

    const serviceKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        '';

    // Proteção adicional contra exposição acidental
    // da chave administrativa do Supabase.

    const safePublicKey =
        publicKey && publicKey !== serviceKey
            ? publicKey
            : '';

    return res.json({
        supabaseUrl:
            process.env.SUPABASE_URL || '',

        supabaseKey: safePublicKey,

        cloudinaryName:
            process.env.CLOUDINARY_CLOUD_NAME || '',

        cloudinaryPreset:
            process.env.CLOUDINARY_PRESET || ''
    });
});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get('/health', (_req, res) => {
    return res.status(200).send('OK');
});

// ======================================================
// REDIRECIONAMENTO DE COMPATIBILIDADE
// ======================================================

app.get(
    '/public/minha-obra/minha-obra.html',
    (_req, res) => {
        return res.redirect(
            302,
            '/minha-obra/minha-obra.html'
        );
    }
);

// ======================================================
// UTILITÁRIOS
// ======================================================

function validId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(value || ''));
}

function cleanText(value, maxLength = 500) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().slice(0, maxLength);
}

function isCloudinaryUrl(value) {
    try {
        const parsed = new URL(value);

        return (
            parsed.protocol === 'https:' &&
            parsed.hostname === 'res.cloudinary.com' &&
            !parsed.username &&
            !parsed.password
        );

    } catch {
        return false;
    }
}

function handleError(res, error, publicMessage) {
    console.error(
        '[API]',
        error?.stack || error
    );

    return res.status(500).json({
        ok: false,
        error:
            publicMessage ||
            'Não foi possível concluir a operação.'
    });
}

// ======================================================
// SUPABASE — ACESSO PELO SERVIDOR
// ======================================================

// As tabelas utilizadas pelas rotas complementares
// são controladas por uma lista de permissões.
//
// O acesso administrativo utiliza exclusivamente
// SUPABASE_SERVICE_ROLE_KEY no servidor.
//
// O módulo erp-api.js possui sua própria função db()
// para a tabela erp_obras.

const SUPABASE_TABLES = new Set([
    'arquivos',
    'etapas_obra',
    'atualizacoes_obra'
]);

async function supabaseRequest(
    table,
    method,
    query = '',
    body = null
) {
    if (!SUPABASE_TABLES.has(table)) {
        throw new Error(
            `Tabela não autorizada: ${table}.`
        );
    }

    const supabaseUrl = process.env.SUPABASE_URL;

    const serviceKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        throw new Error(
            'Configure SUPABASE_URL e ' +
            'SUPABASE_SERVICE_ROLE_KEY no Render.'
        );
    }

    const baseUrl = supabaseUrl.replace(/\/+$/, '');

    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json'
    };

    if (body !== null) {
        headers['Content-Type'] = 'application/json';
        headers.Prefer = 'return=representation';
    }

    const response = await fetch(
        `${baseUrl}/rest/v1/${table}${query}`,
        {
            method,
            headers,

            body:
                body === null
                    ? undefined
                    : JSON.stringify(body)
        }
    );

    const responseText = await response.text();

    let data = null;

    if (responseText) {
        try {
            data = JSON.parse(responseText);

        } catch {
            data = responseText;
        }
    }

    if (!response.ok) {
        const message =
            data && typeof data === 'object'
                ? (
                    data.message ||
                    data.details ||
                    data.hint
                )
                : null;

        const error = new Error(
            message ||
            `Erro no Supabase: HTTP ${response.status}.`
        );

        error.status = response.status;

        throw error;
    }

    return data;
}

// ======================================================
// ARQUIVOS — LISTAGEM
// ======================================================

// Utilizada pelo Minha Obra e pelo portal do cliente.
//
// GET /api/arquivos?cliente_id=UUID

app.get('/api/arquivos', async (req, res) => {
    try {
        const clienteId = String(
            req.query.cliente_id || ''
        );

        if (!validId(clienteId)) {
            return res.status(400).json({
                error: 'ID do cliente inválido.'
            });
        }

        const files = await supabaseRequest(
            'arquivos',
            'GET',

            `?cliente_id=eq.${encodeURIComponent(clienteId)}` +
            '&select=id,cliente_id,nome,url,public_id,created_at,categoria,etapa,descricao' +
            '&order=created_at.desc'
        );

        return res.json(
            Array.isArray(files)
                ? files
                : []
        );

    } catch (error) {
        return handleError(
            res,
            error,
            'Não foi possível listar os arquivos. ' +
            'Verifique a tabela arquivos e sua configuração.'
        );
    }
});

// ======================================================
// ARQUIVOS — CADASTRO
// ======================================================

// POST /api/arquivos
//
// Utilizada pelo formulário de envio de documentos
// e fotos da página Minha Obra.

app.post(
    '/api/arquivos',
    exigirErpAdmin,
    async (req, res) => {
        try {
            const body = req.body || {};

            const clienteId = String(
                body.cliente_id || ''
            );

            const nome = cleanText(
                body.nome,
                200
            );

            const url =
                typeof body.url === 'string'
                    ? body.url.trim()
                    : '';

            const publicId = cleanText(
                body.public_id,
                500
            );

            const categoria =
                cleanText(body.categoria, 40) ||
                'Documento';

            const etapa = cleanText(
                body.etapa,
                100
            );

            const descricao = cleanText(
                body.descricao,
                1000
            );

            if (!validId(clienteId)) {
                return res.status(400).json({
                    error: 'ID do cliente inválido.'
                });
            }

            if (!nome || !isCloudinaryUrl(url)) {
                return res.status(400).json({
                    error:
                        'Informe um nome válido e uma URL segura do Cloudinary.'
                });
            }

            if (
                !['Documento', 'Foto da obra'].includes(
                    categoria
                )
            ) {
                return res.status(400).json({
                    error:
                        'Categoria inválida. Use Documento ou Foto da obra.'
                });
            }

            const rows = await supabaseRequest(
                'arquivos',
                'POST',

                '?select=id,cliente_id,nome,url,public_id,created_at,categoria,etapa,descricao',

                {
                    cliente_id: clienteId,
                    nome,
                    url,
                    public_id: publicId || null,
                    categoria,
                    etapa: etapa || null,
                    descricao: descricao || null
                }
            );

            return res.status(201).json(
                Array.isArray(rows)
                    ? rows[0]
                    : rows
            );

        } catch (error) {
            return handleError(
                res,
                error,
                'Não foi possível registrar o arquivo. ' +
                'Confirme a estrutura da tabela arquivos.'
            );
        }
    }
);

// ======================================================
// ARQUIVOS — ATUALIZAÇÃO
// ======================================================

// PATCH /api/arquivos?id=UUID
//
// Permite renomear arquivos e alterar seus metadados.

app.patch(
    '/api/arquivos',
    exigirErpAdmin,
    async (req, res) => {
        try {
            const id = String(
                req.query.id || ''
            );

            const body = req.body || {};

            if (!validId(id)) {
                return res.status(400).json({
                    error: 'ID do arquivo inválido.'
                });
            }

            const updates = {};

            if (body.nome !== undefined) {
                const nome = cleanText(
                    body.nome,
                    200
                );

                if (!nome) {
                    return res.status(400).json({
                        error:
                            'O nome do arquivo não pode ficar vazio.'
                    });
                }

                updates.nome = nome;
            }

            if (body.categoria !== undefined) {
                const categoria = cleanText(
                    body.categoria,
                    40
                );

                if (
                    !['Documento', 'Foto da obra'].includes(
                        categoria
                    )
                ) {
                    return res.status(400).json({
                        error: 'Categoria inválida.'
                    });
                }

                updates.categoria = categoria;
            }

            if (body.etapa !== undefined) {
                updates.etapa =
                    cleanText(body.etapa, 100) || null;
            }

            if (body.descricao !== undefined) {
                updates.descricao =
                    cleanText(body.descricao, 1000) || null;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    error:
                        'Nenhum campo válido foi enviado para atualização.'
                });
            }

            const rows = await supabaseRequest(
                'arquivos',
                'PATCH',

                `?id=eq.${encodeURIComponent(id)}` +
                '&select=id,cliente_id,nome,url,public_id,created_at,categoria,etapa,descricao',

                updates
            );

            if (
                !Array.isArray(rows) ||
                rows.length === 0
            ) {
                return res.status(404).json({
                    error: 'Arquivo não encontrado.'
                });
            }

            return res.json(rows[0]);

        } catch (error) {
            return handleError(
                res,
                error,
                'Não foi possível atualizar os dados do arquivo.'
            );
        }
    }
);

// ======================================================
// CLOUDINARY — EXCLUSÃO DE MÍDIA
// ======================================================

// A assinatura da API é gerada no servidor.
// API_SECRET nunca é enviado ao navegador.

async function deleteCloudinaryFile(file) {
    const cloudName =
        process.env.CLOUDINARY_CLOUD_NAME;

    const apiKey =
        process.env.CLOUDINARY_API_KEY;

    const apiSecret =
        process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error(
            'Credenciais de exclusão do Cloudinary não configuradas.'
        );
    }

    if (!file.public_id) {
        throw new Error(
            'O arquivo não possui public_id para exclusão no Cloudinary.'
        );
    }

    const timestamp = Math.floor(
        Date.now() / 1000
    );

    const signatureBase =
        `public_id=${file.public_id}&timestamp=${timestamp}`;

    const signature = crypto
        .createHash('sha1')
        .update(signatureBase + apiSecret)
        .digest('hex');

    let resourceType = 'image';

    if (typeof file.url === 'string') {
        if (file.url.includes('/raw/upload/')) {
            resourceType = 'raw';

        } else if (
            file.url.includes('/video/upload/')
        ) {
            resourceType = 'video';
        }
    }

    const form = new URLSearchParams({
        public_id: file.public_id,
        timestamp: String(timestamp),
        api_key: apiKey,
        signature
    });

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
        {
            method: 'POST',

            headers: {
                'Content-Type':
                    'application/x-www-form-urlencoded'
            },

            body: form
        }
    );

    let result;

    try {
        result = await response.json();

    } catch {
        throw new Error(
            'Resposta inválida recebida do Cloudinary.'
        );
    }

    if (!response.ok) {
        throw new Error(
            result?.error?.message ||
            'O Cloudinary não conseguiu excluir o arquivo.'
        );
    }

    const cloudinaryStatus = String(
        result?.result || ''
    ).toLowerCase();

    if (
        !['ok', 'not found'].includes(
            cloudinaryStatus
        )
    ) {
        throw new Error(
            'O Cloudinary não confirmou a exclusão do arquivo.'
        );
    }

    return result;
}

// ======================================================
// ARQUIVOS — EXCLUSÃO
// ======================================================

// DELETE /api/arquivos?id=UUID
//
// Primeiro exclui no Cloudinary.
// Depois remove o registro do Supabase.
//
// Se o Cloudinary falhar, o registro do banco
// permanece preservado.

app.delete(
    '/api/arquivos',
    exigirErpAdmin,
    async (req, res) => {
        try {
            const id = String(
                req.query.id || ''
            );

            if (!validId(id)) {
                return res.status(400).json({
                    error: 'ID do arquivo inválido.'
                });
            }

            const rows = await supabaseRequest(
                'arquivos',
                'GET',

                `?id=eq.${encodeURIComponent(id)}` +
                '&select=id,cliente_id,public_id,url'
            );

            const file =
                Array.isArray(rows)
                    ? rows[0]
                    : null;

            if (!file) {
                return res.status(404).json({
                    error: 'Arquivo não encontrado.'
                });
            }

            await deleteCloudinaryFile(file);

            await supabaseRequest(
                'arquivos',
                'DELETE',

                `?id=eq.${encodeURIComponent(id)}`
            );

            return res.json({
                success: true,
                message: 'Arquivo removido da obra.'
            });

        } catch (error) {
            console.error(
                '[API arquivos excluir]',
                error?.stack || error
            );

            return res.status(500).json({
                error:
                    error?.message ||
                    'Não foi possível excluir o arquivo.'
            });
        }
    }
);

// ======================================================
// ETAPAS DA OBRA — LISTAGEM
// ======================================================

// Mantida para compatibilidade com o portal
// e com o módulo compartilhado public/assets/js/api.js.

app.get('/api/etapas', async (req, res) => {
    try {
        const clienteId = String(
            req.query.cliente_id || ''
        );

        if (!validId(clienteId)) {
            return res.status(400).json({
                error: 'ID do cliente inválido.'
            });
        }

        const rows = await supabaseRequest(
            'etapas_obra',
            'GET',

            `?cliente_id=eq.${encodeURIComponent(clienteId)}` +
            '&select=*&order=ordem.asc'
        );

        return res.json(
            Array.isArray(rows)
                ? rows
                : []
        );

    } catch (error) {
        return handleError(
            res,
            error,
            'Não foi possível carregar as etapas. ' +
            'Verifique se a tabela etapas_obra existe.'
        );
    }
});

// ======================================================
// ETAPAS DA OBRA — CADASTRO
// ======================================================

app.post(
    '/api/etapas',
    exigirErpAdmin,
    async (req, res) => {
        try {
            const body = req.body || {};

            const clienteId = String(
                body.cliente_id || ''
            );

            const nome = cleanText(
                body.nome,
                150
            );

            const ordem = Number(body.ordem);

            if (
                !validId(clienteId) ||
                !nome ||
                !Number.isInteger(ordem) ||
                ordem < 0
            ) {
                return res.status(400).json({
                    error:
                        'Informe cliente, nome da etapa e ordem válida.'
                });
            }

            const status =
                cleanText(body.status, 40) ||
                'Pendente';

            if (
                ![
                    'Pendente',
                    'Em andamento',
                    'Concluída'
                ].includes(status)
            ) {
                return res.status(400).json({
                    error: 'Status da etapa inválido.'
                });
            }

            const rows = await supabaseRequest(
                'etapas_obra',
                'POST',
                '?select=*',
                {
                    cliente_id: clienteId,
                    nome,
                    ordem,
                    status
                }
            );

            return res.status(201).json(
                Array.isArray(rows)
                    ? rows[0]
                    : rows
            );

        } catch (error) {
            return handleError(
                res,
                error,
                'Não foi possível cadastrar a etapa da obra.'
            );
        }
    }
);

// ======================================================
// ATUALIZAÇÕES — LISTAGEM
// ======================================================

// Utilizada pelo Minha Obra para mostrar
// as publicações realizadas ao cliente.

app.get('/api/atualizacoes', async (req, res) => {
    try {
        const clienteId = String(
            req.query.cliente_id || ''
        );

        if (!validId(clienteId)) {
            return res.status(400).json({
                error: 'ID do cliente inválido.'
            });
        }

        const rows = await supabaseRequest(
            'atualizacoes_obra',
            'GET',

            `?cliente_id=eq.${encodeURIComponent(clienteId)}` +
            '&select=*&order=created_at.desc'
        );

        return res.json(
            Array.isArray(rows)
                ? rows
                : []
        );

    } catch (error) {
        return handleError(
            res,
            error,
            'Não foi possível carregar o histórico da obra.'
        );
    }
});

// ======================================================
// ATUALIZAÇÕES — CADASTRO
// ======================================================

// POST /api/atualizacoes
//
// Utilizada pelo formulário Publicar no portal.

app.post(
    '/api/atualizacoes',
    exigirErpAdmin,
    async (req, res) => {
        try {
            const body = req.body || {};

            const clienteId = String(
                body.cliente_id || ''
            );

            const titulo = cleanText(
                body.titulo,
                200
            );

            const descricao = cleanText(
                body.descricao,
                2000
            );

            if (
                !validId(clienteId) ||
                !titulo ||
                !descricao
            ) {
                return res.status(400).json({
                    error:
                        'Informe o cliente, o título e a descrição da atualização.'
                });
            }

            const rows = await supabaseRequest(
                'atualizacoes_obra',
                'POST',
                '?select=*',
                {
                    cliente_id: clienteId,
                    titulo,
                    descricao
                }
            );

            return res.status(201).json(
                Array.isArray(rows)
                    ? rows[0]
                    : rows
            );

        } catch (error) {
            return handleError(
                res,
                error,
                'Não foi possível salvar a atualização da obra.'
            );
        }
    }
);

// ======================================================
// ARQUIVOS ESTÁTICOS
// ======================================================

// Estrutura:
// public/
//   index.html
//   login-cliente.html
//   painel-cliente.html
//   assets/
//   minha-obra/
//       minha-obra.html
//       obra-gestao.css
//
// O HTML e o JavaScript são enviados sem cache.
// Isso garante que o navegador carregue a versão atual
// da Minha Obra, inclusive as funções de renderização
// publicadas no objeto window pelo JavaScript novo.

app.use(
    express.static(PUBLIC_DIR, {
        extensions: ['html'],

        setHeaders(res, filePath) {
            res.setHeader(
                'X-Content-Type-Options',
                'nosniff'
            );

            res.setHeader(
                'Referrer-Policy',
                'strict-origin-when-cross-origin'
            );

            const extension = path
                .extname(filePath)
                .toLowerCase();

            if (
                ['.html', '.htm', '.js', '.mjs'].includes(
                    extension
                )
            ) {
                res.setHeader(
                    'Cache-Control',
                    'no-store, no-cache, must-revalidate, proxy-revalidate'
                );

                res.setHeader(
                    'Pragma',
                    'no-cache'
                );

                res.setHeader(
                    'Expires',
                    '0'
                );
            }
        }
    })
);

// ======================================================
// TRATAMENTO DE ROTAS INEXISTENTES
// ======================================================

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            ok: false,
            message: 'Rota da API não encontrada.'
        });
    }

    return res.status(404).send(
        'Página não encontrada.'
    );
});

// ======================================================
// TRATAMENTO GLOBAL DE ERROS
// ======================================================

app.use((error, req, res, next) => {
    console.error(
        '[SERVER]',
        error?.stack || error
    );

    if (res.headersSent) {
        return next(error);
    }

    // JSON inválido enviado pelo navegador.

    if (error?.type === 'entity.parse.failed') {
        return res.status(400).json({
            ok: false,
            message: 'O conteúdo enviado possui JSON inválido.'
        });
    }

    // Requisição maior que o limite configurado.

    if (
        error?.type === 'entity.too.large' ||
        error?.status === 413
    ) {
        return res.status(413).json({
            ok: false,
            message:
                'O conteúdo enviado excedeu o limite permitido.'
        });
    }

    return res.status(500).json({
        ok: false,
        message:
            'Ocorreu um erro interno no servidor.'
    });
});

// ======================================================
// INICIALIZAÇÃO
// ======================================================

app.listen(PORT, () => {
    console.log('==========================================');
    console.log('PH ENGENHARIA — SERVIDOR INICIADO');
    console.log('==========================================');

    console.log(
        `[SERVER] Porta: ${PORT}`
    );

    console.log(
        '[ERP] Autenticação via erp-api.js habilitada.'
    );

    console.log(
        '[ERP] API de obras e clientes habilitada.'
    );

    console.log(
        '[API] Arquivos, etapas e atualizações habilitados.'
    );

    console.log(
        '[SUPABASE] Acesso administrativo pelo servidor.'
    );

    console.log(
        '[CLOUDINARY] Integração de arquivos habilitada.'
    );

    console.log(
        '[STATIC] Minha Obra com cache desabilitado para HTML/JS.'
    );

    console.log('==========================================');
});
