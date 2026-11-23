/**
 * Vercel Serverless Function: POST /api/generate-resume
 * Suporta:
 *  - action: "test_key" -> valida a chave BYOK do usuário
 *  - action: "generate" (padrão) -> executa o Pipeline Anti-Alucinação ATS em 3 Camadas
 */

const { testConnection, listGeminiFreeModels } = require('./_lib/llm');
const { generateTruthfulATSResume } = require('./_lib/resume_engine');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LLM-Provider, X-LLM-Key, X-LLM-Model');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Use POST.' });

  try {
    const body = req.body || {};
    const provider = req.headers['x-llm-provider'] || body.provider || 'gemini';
    const apiKey = req.headers['x-llm-key'] || body.apiKey || '';
    const model = req.headers['x-llm-model'] || body.model || '';

    if (body.action === 'list_models') {
      const models = await listGeminiFreeModels(apiKey);
      return res.status(200).json({ ok: true, models });
    }

    if (body.action === 'test_key') {
      const check = await testConnection({ provider, apiKey, model });
      return res.status(200).json(check);
    }

    const { profile, job, jdText = '', isolated = false } = body;
    if (!profile) {
      return res.status(400).json({
        error: 'Banco de Fatos (Master Profile) vazio. Complete o Onboarding antes de gerar.'
      });
    }
    if (!job?.requisitos && !jdText.trim() && !job?.cargo) {
      return res.status(400).json({
        error: 'Informe a vaga ou cole a descrição da vaga (JD) para gerar o currículo ATS.'
      });
    }

    const result = await generateTruthfulATSResume({
      profile,
      job: job || {},
      jdText,
      isolated: Boolean(isolated),
      llmConfig: { provider, apiKey, model }
    });

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Erro ao gerar currículo ATS.'
    });
  }
};
