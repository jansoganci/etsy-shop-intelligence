function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "prompt"
  );
}

export function buildDownloadFilename(prompt: string, when: Date): string {
  const promptSlug = slugify(prompt.slice(0, 60));
  const timestamp = when.toISOString().replace(/[:.]/g, "-");

  return `etsy-image-studio-${promptSlug}-${timestamp}.jpg`;
}
