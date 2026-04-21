/**
 * Parse plain KEY=VALUE content into a map.
 * Ignores blank lines and lines starting with `#`, and strips surrounding quotes.
 */
export function parsePlainEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Parse .env content into an ordered list of entries, preserving
 * comments, blank lines, and raw value formatting.
 */
export function parseEnvLines(content: string): { key?: string; value?: string; raw: string }[] {
  return content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return { raw: line };
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      return { raw: line };
    }
    return {
      key: line.slice(0, eqIdx).trim(),
      value: line.slice(eqIdx + 1),
      raw: line,
    };
  });
}
