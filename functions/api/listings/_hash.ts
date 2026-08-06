export type ListingContentFields = {
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  status: "active" | "inactive";
};

export function computeContentHash(fields: ListingContentFields): string {
  const payload = JSON.stringify({
    title: fields.title,
    tags: fields.tags,
    description: fields.description,
    imageAltTexts: fields.imageAltTexts,
    price: fields.price,
    status: fields.status,
  });

  let hash = 5381;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 33) ^ payload.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
