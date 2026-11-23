const { createClient } = require('@supabase/supabase-js');

function getAdminClient(req) {
  if (req && req._adminClient) return req._adminClient;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Confirm-Delete');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido. Use DELETE.' });
  }

  const adminClient = getAdminClient(req);
  if (!adminClient) {
    return res.status(503).json({
      error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no servidor para excluir contas.'
    });
  }

  const authHeader = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  const token = match[1].trim();
  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  const headerConfirm = String(req.headers?.['x-confirm-delete'] || req.headers?.['X-Confirm-Delete'] || '').trim();
  const bodyConfirm = String(req.body?.confirmation || '').trim();
  if (headerConfirm !== 'EXCLUIR' && bodyConfirm !== 'EXCLUIR') {
    return res.status(400).json({ error: 'Confirmação inválida. Digite EXCLUIR para remover a conta.' });
  }

  const uid = userData.user.id;
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(uid);
  if (deleteErr) {
    return res.status(500).json({ error: `Falha ao excluir conta: ${deleteErr.message}` });
  }

  return res.status(200).json({ ok: true, deletedUserId: uid });
};
