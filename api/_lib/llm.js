/**
 * Sona Resume Studio — Adaptador Multi-Provedor BYOK (Gemini, OpenAI, Groq, OpenRouter)
 * Usa fetch nativo do Node.js 18+ (zero dependências externas).
 */

const PROVIDER_DEFAULTS = {
  gemini: {
    name: 'Google Gemini (Free Tier)',
    defaultModel: 'gemini-3.8-flash',
    fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-3-27b-it']
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1/chat/completions'
  },
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions'
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'google/gemini-2.0-flash-001',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions'
  }
};

/**
 * Extrai e faz parse seguro de JSON de respostas de LLMs (mesmo com cercas ```json).
 */
function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Resposta vazia do modelo de IA.');
  }
  const trimmed = text.trim();

  // Tentativa 1: parse direto
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // Tentativa 2: bloco ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {}
  }

  // Tentativa 3: primeiro '{' até último '}'
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  throw new Error('Não foi possível interpretar o JSON retornado pelo modelo de IA.');
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt, temperature = 0.2 }) {
  const targetModel = model || PROVIDER_DEFAULTS.gemini.defaultModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = data?.error?.message || `Erro HTTP ${response.status} na API do Gemini.`;
    throw new Error(errMsg);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJsonFromText(text);
}

async function callOpenAICompatible({ provider, apiKey, model, systemPrompt, userPrompt, temperature = 0.2 }) {
  const cfg = PROVIDER_DEFAULTS[provider];
  if (!cfg || !cfg.baseUrl) {
    throw new Error(`Provedor desconhecido: ${provider}`);
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://sona.vercel.app';
    headers['X-Title'] = 'Sona Resume Studio';
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const body = {
    model: model || cfg.defaultModel,
    temperature,
    response_format: { type: 'json_object' },
    messages
  };

  const response = await fetch(cfg.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = data?.error?.message || `Erro HTTP ${response.status} no provedor ${cfg.name}.`;
    throw new Error(errMsg);
  }

  const text = data?.choices?.[0]?.message?.content || '';
  return extractJsonFromText(text);
}

/**
 * Executa uma chamada estruturada (JSON) ao provedor BYOK escolhido.
 */
async function callLLMJson({ provider = 'gemini', apiKey, model, systemPrompt, userPrompt, temperature = 0.2 }) {
  const normalizedProvider = String(provider || 'gemini').toLowerCase().trim();
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('Chave de API (BYOK) não informada. Configure sua chave no Passo 1 do Onboarding.');
  }

  if (normalizedProvider === 'gemini') {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      return await callGemini({ apiKey: apiKey.trim(), model, systemPrompt, userPrompt, temperature });
    } catch (err) {
      const isHighDemand = /high demand|overloaded|503|temporarily unavailable|resource exhausted/i.test(err.message);
      const isDeprecated = /not found|404|not supported|no longer available|deprecated/i.test(err.message);

      // Retry rápido no mesmo modelo se for pico temporário de demanda (503)
      if (isHighDemand) {
        await sleep(1200);
        try {
          return await callGemini({ apiKey: apiKey.trim(), model, systemPrompt, userPrompt, temperature });
        } catch (_) {}
      }

      // Se o modelo padrão falhar por indisponibilidade/depreciação ou pico persistente, tenta fallbacks gratuitos
      if (!model && (isDeprecated || isHighDemand)) {
        const suggestedMatch = err.message.match(/use\s+models\/(gemini-[a-z0-9.-]+)/i);
        const candidates = [
          ...(suggestedMatch ? [suggestedMatch[1]] : []),
          ...PROVIDER_DEFAULTS.gemini.fallbackModels
        ];
        for (const fallback of Array.from(new Set(candidates))) {
          try {
            return await callGemini({ apiKey: apiKey.trim(), model: fallback, systemPrompt, userPrompt, temperature });
          } catch (_) {}
        }
      }
      throw err;
    }
  }

  if (normalizedProvider === 'openai' || normalizedProvider === 'groq' || normalizedProvider === 'openrouter') {
    return callOpenAICompatible({
      provider: normalizedProvider,
      apiKey: apiKey.trim(),
      model,
      systemPrompt,
      userPrompt,
      temperature
    });
  }

  throw new Error(`Provedor de IA não suportado: "${provider}". Use gemini, openai, groq ou openrouter.`);
}

async function listGeminiFreeModels(apiKey) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('Informe sua chave do Google AI Studio para listar os modelos disponíveis.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Erro HTTP ${res.status} ao listar modelos Gemini.`);
  }

  const freeModels = (data.models || [])
    .filter((m) => {
      const methods = m.supportedGenerationMethods || [];
      if (!methods.includes('generateContent')) return false;
      const id = String(m.name || '').replace(/^models\//, '').toLowerCase();
      // Mantém apenas famílias com Free Tier (Flash 3.x, Flash-Lite 3.x e Gemma) e exclui mídia/pro pagos/legados 1.x/2.x
      const isFreeFamily = /(^gemini-.*flash|^gemma-)/.test(id);
      const isExcluded = /(image|tts|audio|video|veo|imagen|embedding|aqa|robotics|computer-use|1\.0|1\.5|2\.0|2\.5)/.test(id);
      return isFreeFamily && !isExcluded;
    })
    .map((m) => {
      const id = String(m.name || '').replace(/^models\//, '');
      return {
        id,
        label: m.displayName ? `${m.displayName} (${id})` : id
      };
    });

  // Garante gemini-3.8-flash no topo se presente
  freeModels.sort((a, b) => {
    if (a.id === 'gemini-3.8-flash') return -1;
    if (b.id === 'gemini-3.8-flash') return 1;
    return b.id.localeCompare(a.id);
  });

  return freeModels;
}

async function testConnection({ provider = 'gemini', apiKey, model }) {
  const result = await callLLMJson({
    provider,
    apiKey,
    model,
    systemPrompt: 'Responda apenas JSON válido: {"ok": true, "message": "Conexão validada"}',
    userPrompt: 'Teste de conectividade Sona BYOK.',
    temperature: 0
  });
  return { ok: true, provider, model: model || PROVIDER_DEFAULTS[provider]?.defaultModel, result };
}

module.exports = {
  PROVIDER_DEFAULTS,
  extractJsonFromText,
  callLLMJson,
  listGeminiFreeModels,
  testConnection
};
