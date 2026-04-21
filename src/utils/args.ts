/**
 * Extract positional app names from parsed citty args, skipping the leading
 * positional slots that the command already consumes (e.g. the env name).
 *
 * Returns undefined when no app names were supplied, so callers can treat
 * that as "all apps".
 */
export function parseAppNames(
  args: { _?: string[] },
  skip = 1,
): string[] | undefined {
  const rest = args._?.slice(skip);
  return rest?.length ? rest : undefined;
}
