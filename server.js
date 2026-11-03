
'use strict';

// ======================================================
// PH ENGENHARIA — ERP DE GESTÃO DE OBRAS
// Persistência: API do servidor + Supabase.
// Autenticação: erp-api.js + cookie HttpOnly.
// Sessão administrativa: ph_erp_admin.
// ======================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ======================================================
// CARREGAMENTO DO MÓDULO ERP
// ======================================================

// O erp-api.js pode exportar diretamente a função ou
// exportá-la dentro de registerErpApi/default.
//
// A forma recomendada é:
// module.exports = function registerErpApi(app) { ... };

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
        'Não foi possível carregar ./erp-api.js como função. ' +
        'Confira o module.exports do arquivo.'
    );
}

console.log(
    '[ERP] Módulo carregado:',
    require.resolve('./erp-api')
);

// ======================================================
// CONFIGURAÇÕES GERAIS
// ======================================================

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({
    limit: '2mb'
}));

app.use(express.urlencoded({
    extended: true,
    limit: '2mb'
}));

// ======================================================
// REGISTRO DAS ROTAS DO ERP
// ======================================================

// Deve ser registrado depois dos parsers de JSON
// e antes dos arquivos estáticos e do tratamento 404.

try {
    registerErpApi(app);

    console.log('[ERP] Rotas administrativas registradas.');

} catch (error) {
    console.error(
        '[ERP] Falha ao registrar as rotas:',
        error.stack || error
    );

    throw error;
}

// ======================================================
// AUTENTICAÇÃO DAS ROTAS COMPLEMENTARES
// ======================================================

// O erp-api.js é responsável por validar o cookie
// HttpOnly ph_erp_admin.
//
// Para proteger as operações complementares sem duplicar
// a lógica criptográfica do erp-api.js, consultamos a rota
// oficial de sessão e encaminhamos o cookie recebido.
//
// Isso mantém uma única fonte de autenticação.

async function exigirErpAdmin(req, res, next) {
    try {
        const cookie = req.headers.cookie || '';

        const response = await fetch(
            `http://127.0.0.1:${PORT}/api/erp/session`,
            {
                method: 'GET',
                headers: {
                    Cookie: cookie,
                    Accept: 'application/json'
                },
                cache: 'no-store'
            }
        );

        let session = null;

        try {
            session = await response.json();
        } catch {
            session = null;
        }

        if (
            response.ok &&
            session?.authenticated === true
        ) {
            return next();
        }

        return res.status(401).json({
            ok: false,
            authenticated: false,
            message: 'Sessão administrativa necessária.'
        });

    } catch (error) {
        console.error(
            '[AUTH] Falha ao verificar sessão:',
            error.message
        );

        return res.status(503).json({
            ok: false,
            message: 'Não foi possível verificar a sessão administrativa.'
        });
    }
}

// ======================================================
// LOGIN ANTIGO — AVISO DE MIGRAÇÃO
// ======================================================

// A autenticação antiga utilizava express-session e o
// cookie ph.sid. O novo ERP utiliza ph_erp_admin.
//
// Estas rotas antigas não devem criar uma segunda sessão,
// pois ela não seria reconhecida pelo novo painel.

app.all([
    '/api/login',
    '/api/auth/status',
    '/api/logout'
], (_req, res) => {
    return res.status(410).json({
        ok: false,
        message:
            'A autenticação foi atualizada. Utilize ' +
            '/api/erp/login, /api/erp/session e /api/erp/logout.'
    });
});

// ======================================================
// CONFIGURAÇÕES PÚBLICAS
// ======================================================

app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');

    return res.json({
        supabaseUrl: process.env.SUPABASE_URL || '',

        // Esta variável deve conter exclusivamente
        // a chave pública/anon do Supabase.
        //
        // Nunca coloque SUPABASE_SERVICE_ROLE_KEY aqui.
        supabaseKey:
            process.env.SUPABASE_ANON_KEY ||
            process.env.SUPABASE_KEY ||
            '',

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
// REDIRECIONAMENTO ANTIGO
// ======================================================

app.get('/public/minha-obra/minha-obra.html', (_req, res) => {
    return res.redirect(
        302,
        '/minha-obra/minha-obra.html'
    );
});

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
        error: publicMessage
    });
}

// ======================================================
// SUPABASE — ACESSO PELO SERVIDOR
// ======================================================

// A chave de serviço permanece exclusivamente no servidor.
// Nenhuma rota pública retorna essa credencial.

async function supabaseRequest(
    table,
    method,
    query = '',
    body = null
) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        throw new Error(
            'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.'
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

        throw new Error(
            message ||
            `Erro no Supabase: HTTP ${response.status}.`
        );
    }

    return data;
}

// ======================================================
// ARQUIVOS — LISTAGEM
// ======================================================

// Mantida para consulta pelo portal do cliente.

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

        res.set('Cache-Control', 'no-store');

        return res.json(files || []);

    } catch (error) {
        return handleError(
            res,
            error,
            'Não foi possível listar os arquivos. Verifique a configuração do banco e as colunas da tabela arquivos.'
        );
    }
});

// ======================================================
// ARQUIVOS — CADASTRO
// ======================================================

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
                'Não foi possível registrar o arquivo. Confirme se a migração SQL foi executada.'
            );
        }
    }
);

// ======================================================
// ARQUIVOS — RENOMEAR E EDITAR METADADOS
// ======================================================

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
// CLOUDINARY — EXCLUIR MÍDIA
// ======================================================

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

    if (
        !['ok', 'not found'].includes(
            result?.result
        )
    ) {
        throw new Error(
            'O Cloudinary não confirmou a exclusão do arquivo.'
        );
    }

    return result;
}

// ======================================================
// ARQUIVOS — EXCLUIR
// ======================================================

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

            // Se o Cloudinary falhar, o registro
            // será preservado no banco.

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
            return handleError(
                res,
                error,
                error?.message ||
                'Não foi possível excluir o arquivo.'
            );
        }
    }
);

// ======================================================
// ETAPAS DA OBRA — LISTAGEM
// ======================================================

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

        res.set('Cache-Control', 'no-store');

        return res.json(rows || []);

    } catch (error) {
        return handleError(
            res,
            error,
            'Não foi possível carregar as etapas. Verifique se a tabela etapas_obra existe.'
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
// HISTÓRICO E ATUALIZAÇÕES — LISTAGEM
// ======================================================

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

        res.set('Cache-Control', 'no-store');

        return res.json(rows || []);

    } catch (error) {
        return handleError(
            res,
            error,
            'Não foi possível carregar o histórico da obra.'
        );
    }
});

// ======================================================
// HISTÓRICO E ATUALIZAÇÕES — CADASTRO
// ======================================================

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

// A página pode ser carregada sem sessão para que o
// JavaScript exiba a tela de autenticação externa.
//
// Os dados administrativos continuam protegidos pelas
// rotas /api/erp registradas pelo erp-api.js.

app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],

    setHeaders(res) {
        res.setHeader(
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Referrer-Policy',
            'strict-origin-when-cross-origin'
        );
    }
}));

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

    return res.status(500).json({
        ok: false,
        message: 'Ocorreu um erro interno no servidor.'
    });
});

// ======================================================
// INICIALIZAÇÃO
// ======================================================

app.listen(PORT, () => {
    console.log(
        `PH Engenharia rodando na porta ${PORT}`
    );

    console.log(
        'Autenticação administrativa via erp-api.js habilitada.'
    );

    console.log(
        'Supabase e Cloudinary configurados por variáveis de ambiente.'
    );
});
