import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, '.env.providers.local');
const prompt = 'Translate to Korean: "This is a provider smoke test." Return translation only.';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).reduce((accumulator, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return accumulator;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return accumulator;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    accumulator[key] = value;
    return accumulator;
  }, {});
}

function splitModels(value, fallback) {
  const models = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return models.length > 0 ? models : fallback;
}

async function parseJsonOrThrow(response, fallback) {
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || fallback;
    throw new Error(`${response.status} ${message}`);
  }

  return data;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('\n').trim();
}

async function testOpenRouter(apiKey, model) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/park-youngtack/chrome_ext_yt_ai',
      'X-Title': 'Provider Smoke Test'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    })
  });

  const data = await parseJsonOrThrow(response, 'OpenRouter request failed');
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function testOpenAI(apiKey, model) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }]
  };

  if (String(model || '').startsWith('gpt-5')) {
    body.reasoning_effort = 'minimal';
  } else {
    body.temperature = 0;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await parseJsonOrThrow(response, 'OpenAI request failed');
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function testGemini(apiKey, model) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0
        }
      })
    }
  );

  const data = await parseJsonOrThrow(response, 'Gemini request failed');
  return extractGeminiText(data);
}

const providerMatrix = [
  {
    id: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    envModels: 'OPENROUTER_MODELS',
    defaultModels: ['google/gemini-3.1-flash-lite-preview'],
    runner: testOpenRouter
  },
  {
    id: 'openai',
    envKey: 'OPENAI_API_KEY',
    envModels: 'OPENAI_MODELS',
    defaultModels: ['gpt-5-nano'],
    runner: testOpenAI
  },
  {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    envModels: 'GEMINI_MODELS',
    defaultModels: ['gemini-3.1-flash-lite-preview'],
    runner: testGemini
  }
];

async function main() {
  const env = parseEnvFile(envPath);
  const configuredProviders = providerMatrix.filter((provider) => String(env[provider.envKey] || '').trim());

  if (configuredProviders.length === 0) {
    console.log(`[skip] No API keys found in ${path.basename(envPath)}`);
    process.exit(0);
  }

  let failed = false;
  for (const provider of configuredProviders) {
    const apiKey = String(env[provider.envKey] || '').trim();
    const models = splitModels(env[provider.envModels], provider.defaultModels);

    for (const model of models) {
      const startedAt = Date.now();
      try {
        const text = await provider.runner(apiKey, model);
        const elapsedMs = Date.now() - startedAt;
        if (!text) {
          throw new Error('empty response');
        }
        console.log(`[pass] ${provider.id} :: ${model} (${elapsedMs}ms) -> ${text.slice(0, 120)}`);
      } catch (error) {
        failed = true;
        console.error(`[fail] ${provider.id} :: ${model} -> ${error.message}`);
      }
    }
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`[fail] provider smoke test runner -> ${error.message}`);
  process.exit(1);
});
