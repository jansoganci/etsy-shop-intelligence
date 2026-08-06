import { computeContentHash } from "./_hash";
import type { ListingInput } from "./_validation";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

type ListingRow = {
  listing_id: string;
  url: string;
  status: string;
  source: string;
  first_seen_at: string;
  current_version_id: number | null;
  updated_at: string;
};

type ListingVersionRow = {
  id: number;
  listing_id: string;
  effective_at: string;
  title: string;
  tags_json: string;
  description: string;
  image_alt_texts_json: string;
  price: number;
  currency: string;
  status: string;
  change_note: string | null;
  content_hash: string;
  created_at: string;
};

export type ListingRecord = {
  listingId: string;
  url: string;
  status: "active" | "inactive" | "sold_out" | "draft" | "expired";
  source: "manual" | "manual_only" | "etsy_api";
  firstSeenAt: string;
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  currency: string;
  effectiveAt: string;
  changeNote: string | null;
  updatedAt: string;
};

export type ListingVersionRecord = {
  id: number;
  effectiveAt: string;
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  status: "active" | "inactive" | "sold_out" | "draft" | "expired";
  changeNote: string | null;
  createdAt: string;
};

function mapRecord(listing: ListingRow, version: ListingVersionRow): ListingRecord {
  return {
    listingId: listing.listing_id,
    url: listing.url,
    status: listing.status as ListingRecord["status"],
    source: listing.source as "manual" | "manual_only" | "etsy_api",
    firstSeenAt: listing.first_seen_at,
    title: version.title,
    tags: JSON.parse(version.tags_json) as string[],
    description: version.description,
    imageAltTexts: JSON.parse(version.image_alt_texts_json) as string[],
    price: version.price,
    currency: version.currency,
    effectiveAt: version.effective_at,
    changeNote: version.change_note,
    updatedAt: listing.updated_at,
  };
}

function mapVersionRecord(version: ListingVersionRow): ListingVersionRecord {
  return {
    id: version.id,
    effectiveAt: version.effective_at,
    title: version.title,
    tags: JSON.parse(version.tags_json) as string[],
    description: version.description,
    imageAltTexts: JSON.parse(version.image_alt_texts_json) as string[],
    price: version.price,
    status: version.status as ListingVersionRecord["status"],
    changeNote: version.change_note,
    createdAt: version.created_at,
  };
}

export async function loadListings(db: D1Database): Promise<ListingRecord[]> {
  const result = await db
    .prepare(
      `
        SELECT
          l.listing_id, l.url, l.status, l.source, l.first_seen_at, l.updated_at,
          v.id AS version_id, v.effective_at, v.title, v.tags_json, v.description,
          v.image_alt_texts_json, v.price, v.currency, v.status AS version_status,
          v.change_note, v.content_hash, v.created_at
        FROM listings l
        JOIN listing_versions v ON v.id = l.current_version_id
        ORDER BY l.updated_at DESC
      `,
    )
    .all<ListingRow & ListingVersionRow & { version_id: number }>();

  return (result.results ?? []).map((row) =>
    mapRecord(row, { ...row, id: row.version_id }),
  );
}

export async function loadListing(
  db: D1Database,
  listingId: string,
): Promise<ListingRecord | null> {
  const listing = await db
    .prepare("SELECT * FROM listings WHERE listing_id = ?")
    .bind(listingId)
    .first<ListingRow>();

  if (!listing?.current_version_id) {
    return null;
  }

  const version = await db
    .prepare("SELECT * FROM listing_versions WHERE id = ?")
    .bind(listing.current_version_id)
    .first<ListingVersionRow>();

  if (!version) {
    return null;
  }

  return mapRecord(listing, version);
}

export async function loadListingHistory(
  db: D1Database,
  listingId: string,
): Promise<ListingVersionRecord[]> {
  const result = await db
    .prepare(
      "SELECT * FROM listing_versions WHERE listing_id = ? ORDER BY effective_at DESC, id DESC",
    )
    .bind(listingId)
    .all<ListingVersionRow>();

  return (result.results ?? []).map(mapVersionRecord);
}

export async function saveListing(
  db: D1Database,
  input: ListingInput,
): Promise<{ record: ListingRecord; versionCreated: boolean }> {
  const contentHash = computeContentHash({
    title: input.title,
    tags: input.tags,
    description: input.description,
    imageAltTexts: input.imageAltTexts,
    price: input.price,
    status: input.status,
  });

  const existingListing = await db
    .prepare("SELECT * FROM listings WHERE listing_id = ?")
    .bind(input.listingId)
    .first<ListingRow>();

  if (existingListing?.source === "etsy_api") {
    throw new Error("etsy_listing_read_only");
  }

  if (existingListing?.current_version_id) {
    const currentVersion = await db
      .prepare("SELECT * FROM listing_versions WHERE id = ?")
      .bind(existingListing.current_version_id)
      .first<ListingVersionRow>();

    if (currentVersion && currentVersion.content_hash === contentHash) {
      await db
        .prepare("UPDATE listings SET url = ?, updated_at = CURRENT_TIMESTAMP WHERE listing_id = ?")
        .bind(input.url, input.listingId)
        .run();

      return {
        record: mapRecord({ ...existingListing, url: input.url }, currentVersion),
        versionCreated: false,
      };
    }
  }

  // The `listings` row must exist before a `listing_versions` row can
  // reference it (FOREIGN KEY constraint), so create/touch the parent first
  // and point current_version_id at the new version afterwards.
  await db
    .prepare(
      `
        INSERT INTO listings (listing_id, url, status, first_seen_at, current_version_id)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(listing_id) DO UPDATE SET
          url = excluded.url,
          status = excluded.status,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .bind(
      input.listingId,
      input.url,
      input.status,
      existingListing?.first_seen_at ?? input.effectiveAt,
    )
    .run();

  const versionInsert = await db
    .prepare(
      `
        INSERT INTO listing_versions (
          listing_id, effective_at, title, tags_json, description,
          image_alt_texts_json, price, currency, status, change_note, content_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?)
      `,
    )
    .bind(
      input.listingId,
      input.effectiveAt,
      input.title,
      JSON.stringify(input.tags),
      input.description,
      JSON.stringify(input.imageAltTexts),
      input.price,
      input.status,
      input.changeNote,
      contentHash,
    )
    .run();

  const versionId = versionInsert.meta?.last_row_id;
  if (!versionId) {
    throw new Error("Failed to create listing version.");
  }

  await db
    .prepare(
      `
        UPDATE listings SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE listing_id = ?
      `,
    )
    .bind(versionId, input.listingId)
    .run();

  const savedListing = await db
    .prepare("SELECT * FROM listings WHERE listing_id = ?")
    .bind(input.listingId)
    .first<ListingRow>();
  const savedVersion = await db
    .prepare("SELECT * FROM listing_versions WHERE id = ?")
    .bind(versionId)
    .first<ListingVersionRow>();

  return {
    record: mapRecord(savedListing!, savedVersion!),
    versionCreated: true,
  };
}
