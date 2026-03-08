const DEFAULT_SLUG_MAX_LENGTH = 64;

export function slugify(value: string, maxLength = DEFAULT_SLUG_MAX_LENGTH) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, maxLength);
}

export function buildSlugId(slugSource: string | null | undefined, id: string, maxLength = DEFAULT_SLUG_MAX_LENGTH) {
  const slug = slugify(slugSource || '', maxLength);
  return slug ? `${slug}-${id}` : id;
}
