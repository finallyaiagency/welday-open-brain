const HASHTAG_PATTERN = /(^|\s)#([a-z0-9][a-z0-9_-]*)/gi;

export function normalizeHashtag(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^[#@]+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return normalized || null;
}

export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];

  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_PATTERN.exec(text)) !== null) {
    const normalized = normalizeHashtag(match[2]);
    if (normalized) tags.push(normalized);
  }

  return mergeHashtags(tags);
}

export function contextToHashtag(context: string | null | undefined): string | null {
  if (!context) return null;
  return normalizeHashtag(context);
}

export function mergeHashtags(...groups: Array<Array<string | null | undefined> | null | undefined>): string[] {
  const seen = new Set<string>();

  for (const group of groups) {
    if (!group) continue;
    for (const tag of group) {
      const normalized = normalizeHashtag(tag);
      if (normalized) seen.add(normalized);
    }
  }

  return Array.from(seen.values());
}

export function formatHashtag(tag: string | null | undefined): string {
  const normalized = normalizeHashtag(tag);
  return normalized ? `#${normalized}` : "#";
}
