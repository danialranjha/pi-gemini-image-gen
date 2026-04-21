import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StringEnum } from '@mariozechner/pi-ai';
import { getAgentDir, withFileMutationQueue } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

const PROVIDER = 'google-gemini';
const DEFAULT_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const DEFAULT_SAVE_MODE = 'project';
const DEFAULT_ASPECT_RATIO = '16:9';
const SAVE_MODES = ['none', 'project', 'global', 'custom'];
const ASPECT_RATIOS = ['1:1', '3:2', '4:3', '16:9', '9:16'];

const PING_PARAMS = Type.Object({
  message: Type.Optional(Type.String({ description: 'Optional ping payload.' })),
});

const GENERATE_PARAMS = Type.Object({
  prompt: Type.String({ description: 'Image generation prompt.' }),
  model: Type.Optional(Type.String({ description: 'Gemini image model id.' })),
  aspectRatio: Type.Optional(StringEnum(ASPECT_RATIOS)),
  save: Type.Optional(StringEnum(SAVE_MODES)),
  saveDir: Type.Optional(Type.String({ description: 'Directory to save image when save=custom.' })),
});

function readConfigFile(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function loadConfig(cwd) {
  const globalConfig = readConfigFile(join(getAgentDir(), 'extensions', 'gemini-image-gen.json'));
  const projectConfig = readConfigFile(join(cwd, '.pi', 'extensions', 'gemini-image-gen.json'));
  return { ...globalConfig, ...projectConfig };
}

function resolveSaveConfig(params, cwd) {
  const config = loadConfig(cwd);
  const mode = params.save || process.env.PI_GEMINI_IMAGE_SAVE_MODE || config.save || DEFAULT_SAVE_MODE;

  if (!SAVE_MODES.includes(mode)) {
    return { mode: DEFAULT_SAVE_MODE, outputDir: join(cwd, '.pi', 'generated-images') };
  }
  if (mode === 'project') return { mode, outputDir: join(cwd, '.pi', 'generated-images') };
  if (mode === 'global') return { mode, outputDir: join(getAgentDir(), 'generated-images') };
  if (mode === 'custom') {
    const outputDir = params.saveDir || process.env.PI_GEMINI_IMAGE_SAVE_DIR || config.saveDir;
    if (!outputDir) throw new Error('save=custom requires saveDir or PI_GEMINI_IMAGE_SAVE_DIR');
    return { mode, outputDir: resolve(outputDir) };
  }
  return { mode };
}

function resolveModel(params, cwd) {
  const config = loadConfig(cwd);
  return params.model || config.model || DEFAULT_MODEL;
}

function imageExtension(mimeType) {
  const lower = mimeType.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'png';
}

async function saveImage(base64Data, mimeType, outputDir) {
  const filename = `gemini-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${imageExtension(mimeType)}`;
  const outputPath = join(outputDir, filename);
  await withFileMutationQueue(outputPath, async () => {
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, Buffer.from(base64Data, 'base64'));
  });
  return outputPath;
}

function extractImage(parts) {
  const notes = [];
  for (const part of parts) {
    if (part.text) notes.push(part.text);
    if (part.inlineData?.data) {
      return {
        image: {
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
        },
        notes,
      };
    }
  }
  throw new Error('Gemini response did not include inline image data');
}

async function requestGeminiImage(apiKey, params, cwd, signal) {
  const aspectRatio = params.aspectRatio || DEFAULT_ASPECT_RATIO;
  const model = resolveModel(params, cwd);
  const prompt = `${params.prompt}\n\nTarget aspect ratio: ${aspectRatio}. Return exactly one image.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini image request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const candidate = payload.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const extracted = extractImage(parts);

  return {
    ...extracted,
    model,
    aspectRatio,
    finishReason: candidate?.finishReason,
    usageMetadata: payload.usageMetadata,
  };
}

export default function geminiImageGen(pi) {
  pi.registerTool({
    name: 'ping_image_extension',
    label: 'Ping image extension',
    description: 'Sanity check that the Gemini image extension loaded correctly.',
    promptSnippet: 'Use this to verify the Gemini image extension is loaded before trying image generation.',
    parameters: PING_PARAMS,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: 'text', text: `pong:${params.message || 'ok'}` }],
        details: { provider: PROVIDER, extension: 'pi-gemini-image-gen', ok: true },
      };
    },
  });

  pi.registerTool({
    name: 'generate_gemini_image',
    label: 'Generate Gemini image',
    description: 'Generate an image with Gemini and optionally save it locally.',
    promptSnippet: 'Use this for Gemini image generation while staying on pi_local.',
    promptGuidelines: [
      'Use generate_gemini_image for image generation tasks instead of pretending to create an image in text.',
      'When using generate_gemini_image, pass the exact prompt you want logged for later review.',
    ],
    parameters: GENERATE_PARAMS,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY for Gemini image generation.');
      }

      onUpdate?.({
        content: [{ type: 'text', text: 'Requesting Gemini image...' }],
        details: { provider: PROVIDER, prompt: params.prompt },
      });

      const result = await requestGeminiImage(apiKey, params, ctx.cwd, signal);
      const saveConfig = resolveSaveConfig(params, ctx.cwd);
      let savedPath;
      if (saveConfig.mode !== 'none' && saveConfig.outputDir) {
        savedPath = await saveImage(result.image.data, result.image.mimeType, saveConfig.outputDir);
      }

      const summary = [
        `Generated image via ${PROVIDER}/${result.model}.`,
        `Aspect ratio: ${result.aspectRatio}.`,
        savedPath ? `Saved to: ${savedPath}` : 'Not saved to disk.',
      ].join(' ');

      return {
        content: [
          { type: 'text', text: summary },
          { type: 'image', data: result.image.data, mimeType: result.image.mimeType },
        ],
        details: {
          provider: PROVIDER,
          model: result.model,
          prompt: params.prompt,
          aspectRatio: result.aspectRatio,
          savedPath,
          saveMode: saveConfig.mode,
          finishReason: result.finishReason,
          notes: result.notes,
          usageMetadata: result.usageMetadata,
        },
      };
    },
  });
}
