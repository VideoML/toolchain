export type TTSRequest = {
  text: string;
  voice?: string | null;
  model?: string | null;
  format?: string;
  sampleRateHz: number;
  extra?: Record<string, unknown>;
};

export type TTSSegment = {
  path: string;
  durationSec: number;
  cached?: boolean;
};

export interface TTSProvider {
  name: string;
  defaultModel?: string;
  defaultVoice?: string;
  synthesize(req: TTSRequest, outPath: string): Promise<TTSSegment>;
}
