/**
 * Vercel Serverless Function: POST /api/parse-resume-pdf
 * Recebe texto extraído de um PDF (LinkedIn "Salvar como PDF" ou Currículo Base)
 * e converte em JSON estruturado de MasterProfile sem inventar dados.
 */

const { callLLMJson } = require('./_lib/llm');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LLM-Provider, X-LLM-Key, X-LLM-Model');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Use POST.' });

  try {
    const body = req.body || {};
    const pdfText = String(body.text || '').trim();
    const sourceTag = body.sourceTag || 'pdf';

    if (pdfText.length < 40) {
      return res.status(400).json({ error: 'Texto extraído do PDF muito curto ou vazio.' });
    }

    const provider = req.headers['x-llm-provider'] || body.provider || 'gemini';
    const apiKey = req.headers['x-llm-key'] || body.apiKey || '';
    const model = req.headers['x-llm-model'] || body.model || '';

    const systemPrompt = `Você é um extrator rigoroso de dados de currículo para um Banco de Fatos (Master Profile).
REGRA ABSOLUTA: Extraia APENAS informações explicitamente presentes no texto fornecido.
Se um campo não existir no texto, deixe vazio ("") ou lista vazia ([]). NUNCA invente nada.
Responda APENAS JSON válido.`;

    const userPrompt = `TEXTO EXTRAÍDO DO DOCUMENTO (${sourceTag}):
${pdfText.slice(0, 18000)}

Retorne JSON no formato exato:
{
  "basics": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "headline": "",
    "linkedin": "",
    "github": "",
    "portfolio": "",
    "summary": ""
  },
  "education": [
    {
      "id": "pdf-edu-1",
      "institution": "",
      "degree": "",
      "field": "",
      "start_date": "",
      "end_date": "",
      "highlights": []
    }
  ],
  "experiences": [
    {
      "id": "pdf-exp-1",
      "company": "",
      "role": "",
      "location": "",
      "start_date": "",
      "end_date": "",
      "facts": [],
      "verified_skills": []
    }
  ],
  "projects": [
    {
      "id": "pdf-proj-1",
      "name": "",
      "url": "",
      "languages": [],
      "verified_skills": [],
      "readme_summary": "",
      "facts": []
    }
  ],
  "skills_whitelist": [],
  "certifications": [
    { "id": "pdf-cert-1", "name": "", "authority": "", "date": "" }
  ],
  "languages_spoken": [
    { "name": "", "proficiency": "" }
  ]
}`;

    const parsed = await callLLMJson({
      provider,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      temperature: 0
    });

    // Marca origem em cada item
    const tagList = (arr, prefix) =>
      (Array.isArray(arr) ? arr : []).map((item, idx) => ({
        ...item,
        id: item.id || `${prefix}-${idx + 1}`,
        source: sourceTag
      }));

    return res.status(200).json({
      ok: true,
      profile_patch: {
        basics: parsed.basics || {},
        education: tagList(parsed.education, `${sourceTag}-edu`),
        experiences: tagList(parsed.experiences, `${sourceTag}-exp`),
        projects: tagList(parsed.projects, `${sourceTag}-proj`),
        skills_whitelist: Array.isArray(parsed.skills_whitelist) ? parsed.skills_whitelist : [],
        certifications: tagList(parsed.certifications, `${sourceTag}-cert`),
        languages_spoken: Array.isArray(parsed.languages_spoken) ? parsed.languages_spoken : []
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Erro ao extrair dados do PDF.'
    });
  }
};
