import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import YAML from "yaml";
import { ParseError } from "./errors.js";

export type Config = Record<string, unknown>;

export function loadConfig(projectDir?: string, dslPath?: string): Config {
  const override = process.env.VIDEOML_PATH || process.env.BABULUS_PATH;
  if (override) {
    const resolved = resolve(override);
    const candidate =
      existsSync(resolved) && !resolved.endsWith(".yml") && !resolved.endsWith(".yaml")
        ? join(resolved, "config.yml")
        : resolved;
    if (existsSync(candidate)) {
      try {
        return parseConfig(candidate);
      } catch (err) {
        // If project context is provided, fall back to other lookup locations instead of failing hard.
        if (!projectDir && !dslPath) {
          throw err;
        }
      }
    } else if (!projectDir && !dslPath) {
      throw new ParseError(`VIDEOML_PATH/BABULUS_PATH is set but config not found: ${candidate}`);
    }
  }

  const path = findConfigPathWithoutOverride(projectDir, dslPath);
  if (!path) {
    return {};
  }
  return parseConfig(path);
}

export function findConfigPath(projectDir?: string, dslPath?: string): string | null {
  const override = process.env.VIDEOML_PATH || process.env.BABULUS_PATH;
  if (override) {
    const resolved = resolve(override);
    const candidate =
      existsSync(resolved) && !resolved.endsWith(".yml") && !resolved.endsWith(".yaml")
        ? join(resolved, "config.yml")
        : resolved;
    if (existsSync(candidate)) {
      return candidate;
    }
    // If a projectDir/dslPath is provided, fall back to that rather than hard-failing.
    // This keeps strict behavior for config-only lookups but avoids breaking CLI runs
    // when a global path is stale.
    if (!projectDir && !dslPath) {
      throw new ParseError(`VIDEOML_PATH/BABULUS_PATH is set but config not found: ${candidate}`);
    }
  }

  return findConfigPathWithoutOverride(projectDir, dslPath);
}

function findConfigPathWithoutOverride(projectDir?: string, dslPath?: string): string | null {
  if (dslPath) {
    const root = findProjectRoot(dslPath);
    const videomlLocal = join(root, ".videoml", "config.yml");
    if (existsSync(videomlLocal)) {
      return videomlLocal;
    }
    const babulusLocal = join(root, ".babulus", "config.yml");
    if (existsSync(babulusLocal)) {
      return babulusLocal;
    }
  }

  if (projectDir) {
    const videomlLocal = join(resolve(projectDir), ".videoml", "config.yml");
    if (existsSync(videomlLocal)) {
      return videomlLocal;
    }
    const babulusLocal = join(resolve(projectDir), ".babulus", "config.yml");
    if (existsSync(babulusLocal)) {
      return babulusLocal;
    }
  }

  const cwdVideoml = join(process.cwd(), ".videoml", "config.yml");
  if (existsSync(cwdVideoml)) {
    return cwdVideoml;
  }
  const cwdBabulus = join(process.cwd(), ".babulus", "config.yml");
  if (existsSync(cwdBabulus)) {
    return cwdBabulus;
  }

  const homeVideoml = join(homedir(), ".videoml", "config.yml");
  if (existsSync(homeVideoml)) {
    return homeVideoml;
  }
  const homeBabulus = join(homedir(), ".babulus", "config.yml");
  if (existsSync(homeBabulus)) {
    return homeBabulus;
  }

  return null;
}

function parseConfig(path: string): Config {
  try {
    const text = readFileSync(path, "utf-8");
    const obj = YAML.parse(text);
    if (!obj) {
      return {};
    }
    if (typeof obj !== "object" || Array.isArray(obj)) {
      throw new ParseError(`Config must be a mapping: ${path}`);
    }
    return obj as Config;
  } catch (err) {
    if (err instanceof ParseError) {
      throw err;
    }
    throw new ParseError(`Invalid config: ${path}`);
  }
}

export function findProjectRoot(dslPath: string): string {
  let current = resolve(dirname(dslPath));
  while (true) {
    if (existsSync(join(current, ".videoml")) || existsSync(join(current, ".babulus")) || existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(dirname(dslPath));
    }
    current = parent;
  }
}

export function getProviderConfig(config: Config, provider: string): Record<string, unknown> {
  const providers = config.providers;
  if (providers == null) {
    return {};
  }
  if (typeof providers !== "object" || Array.isArray(providers)) {
    throw new ParseError("config.providers must be a mapping");
  }
  const cfg = (providers as Record<string, unknown>)[provider] ?? {};
  if (typeof cfg !== "object" || Array.isArray(cfg)) {
    throw new ParseError(`config.providers.${provider} must be a mapping`);
  }
  return cfg as Record<string, unknown>;
}

function getNestedString(config: Config, path: string[]): string | null {
  let current: unknown = config;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (current == null) {
    return null;
  }
  if (typeof current !== "string") {
    throw new ParseError(`config.${path.join(".")} must be a string`);
  }
  return current;
}

export function getDefaultProvider(config: Config): string | null {
  const explicit = getNestedString(config, ["tts", "default_provider"]);
  if (explicit) {
    return explicit;
  }


  return null;
}

export function getDefaultSfxProvider(config: Config): string | null {
  return getNestedString(config, ["audio", "default_sfx_provider"]);
}

export function getDefaultMusicProvider(config: Config): string | null {
  return getNestedString(config, ["audio", "default_music_provider"]);
}
