import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Drug, DrugRegisterFile, Meta } from "./types.js";

export interface Dataset {
  meta: Meta;
  /** Sorted by nameLatin, then strength, then id. */
  drugs: Drug[];
  byId: Map<string, Drug>;
  /** Normalized search text per drug, same order as `drugs`. */
  searchKeys: SearchKey[];
}

export interface SearchKey {
  names: string[]; // nameLatin, nameCyrillic
  generic: string;
}

export const DATA_FILE = join(process.cwd(), "public", "data", "drug-register.json");

/** Lowercase, strip accents, collapse spaces. Used on both the query and the data. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDataset(file: DrugRegisterFile): Dataset {
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const drugs = [...file.drugs].sort(
    (a, b) =>
      collator.compare(a.nameLatin, b.nameLatin) ||
      collator.compare(a.strength ?? "", b.strength ?? "") ||
      a.id.localeCompare(b.id),
  );
  return {
    meta: {
      source: file.source,
      scrapedDate: file.scrapedDate,
      currency: file.currency,
      count: file.count,
      apiVersion: "v1",
      fullDatasetPath: "/data/drug-register.json",
    },
    drugs,
    byId: new Map(drugs.map((d) => [d.id, d])),
    searchKeys: drugs.map((d) => ({
      names: [normalize(d.nameLatin), normalize(d.nameCyrillic)],
      generic: normalize(d.genericName),
    })),
  };
}

let cached: Dataset | undefined;

/** Loads the data once per function instance. */
export function getDataset(): Dataset {
  if (!cached) {
    const file = JSON.parse(readFileSync(DATA_FILE, "utf8")) as DrugRegisterFile;
    cached = buildDataset(file);
  }
  return cached;
}
