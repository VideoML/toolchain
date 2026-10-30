import { getProviderConfig, type Config } from "../../config.js";
import { CompileError } from "../../errors.js";
import { DryRunProvider } from "./dry-run.js";
import { ElevenLabsTTSProvider } from "./elevenlabs.js";
import { OpenAITTSProvider } from "./openai.js";
import { PollyTTSProvider } from "./aws-polly.js";
import { AzureSpeechTTSProvider } from "./azure.js";
import { GenerationSession } from "./auritus.js";
import type { TTSProvider } from "./types.js";

export function getTtsProvider(name: string, config: Config, session?: GenerationSession): TTSProvider {
  const dryRunProvider = () => {
    const cfg = getProviderConfig(config, "dry-run");
    const wpm = typeof cfg.wpm === "number" ? cfg.wpm : Number(cfg.wpm ?? 165);
    if (Number.isNaN(wpm)) {
      throw new CompileError("providers.dry-run.wpm must be a number");
    }
    return new DryRunProvider(wpm);
  };

  if (name === "dry-run") {
    return dryRunProvider();
  }
  if (name === "auritus") {
    if (!session) throw new CompileError("Auritus requires a generation session");
    return session.getAuritus(getProviderConfig(config, "auritus"));
  }
  if (name === "openai") {
    const cfg = getProviderConfig(config, "openai");
    // Accept key from env, providers.openai.api_key, or legacy root key `openai_api_key`
    const apiKey =
      process.env.OPENAI_API_KEY ||
      String(cfg.api_key ?? "") ||
      (typeof (config as any)?.openai_api_key === "string" ? String((config as any).openai_api_key) : "");
    if (!apiKey || apiKey.startsWith("test-")) {
      throw new CompileError("OpenAI API key credential required");
    }
    return new OpenAITTSProvider({
      apiKey,
      baseUrl: String(cfg.base_url ?? "https://api.openai.com/v1/audio/speech"),
      defaultModel: String(cfg.model ?? "gpt-4o-mini-tts"),
      defaultVoice: String(cfg.voice ?? "alloy"),
    });
  }
  if (name === "elevenlabs") {
    const cfg = getProviderConfig(config, "elevenlabs");
    const voiceSettings = cfg.voice_settings;
    if (voiceSettings && (typeof voiceSettings !== "object" || Array.isArray(voiceSettings))) {
      throw new CompileError("providers.elevenlabs.voice_settings must be a mapping");
    }
    const pdl = cfg.pronunciation_dictionary_locators;
    if (pdl && !Array.isArray(pdl)) {
      throw new CompileError("providers.elevenlabs.pronunciation_dictionary_locators must be a list");
    }
    if (Array.isArray(pdl)) {
      for (const item of pdl) {
        if (typeof item !== "object" || Array.isArray(item)) {
          throw new CompileError("providers.elevenlabs.pronunciation_dictionary_locators entries must be mappings");
        }
      }
    }
    const apiKey = process.env.ELEVENLABS_API_KEY || String(cfg.api_key ?? "");
    const voiceId = String(cfg.voice_id ?? "");
    if (!apiKey || apiKey.startsWith("test-") || !voiceId) {
      throw new CompileError("ElevenLabs API key and voice credentials required");
    }
    return new ElevenLabsTTSProvider({
      apiKey,
      voiceId,
      modelId: String(cfg.model_id ?? "eleven_multilingual_v2"),
      baseUrl: String(cfg.base_url ?? "https://api.elevenlabs.io"),
      voiceSettings: (voiceSettings as Record<string, unknown>) ?? null,
      outputFormat: String(cfg.output_format ?? "") || null,
      pronunciationDictionaryLocators: (pdl as Array<Record<string, unknown>>) ?? null,
    });
  }
  if (name === "aws" || name === "aws-polly") {
    const cfg = getProviderConfig(config, "aws_polly");
    return new PollyTTSProvider({
      region: process.env.AWS_POLLY_REGION || String(cfg.region ?? "us-east-1"),
      voiceId: String(cfg.voice_id ?? "Joanna"),
      engine: String(cfg.engine ?? "standard"),
      languageCode: cfg.language_code ? String(cfg.language_code) : null,
    });
  }
  if (name === "azure" || name === "azure-speech") {
    const cfg = getProviderConfig(config, "azure_speech");
    const apiKey = process.env.AZURE_SPEECH_KEY || String(cfg.api_key ?? "");
    const region = process.env.AZURE_SPEECH_REGION || String(cfg.region ?? "");
    if (!apiKey || apiKey.startsWith("test-") || !region) {
      throw new CompileError("Azure Speech key and region credentials required");
    }
    return new AzureSpeechTTSProvider({
      apiKey,
      region,
      voiceName: String(cfg.voice ?? "en-US-JennyNeural"),
    });
  }
  throw new CompileError(
    `Unknown TTS provider "${name}". Supported: auritus, dry-run, openai, elevenlabs, aws-polly (aws), azure-speech (azure)`,
  );
}
