// Types that match schema/drug-register.schema.json.

export const DISPENSING = ["prescription", "hospitalOnly", "otcPharmacy", "otcGeneralSale"] as const;
export const PRODUCT_TYPES = ["generic", "original", "biosimilar"] as const;

export type Dispensing = (typeof DISPENSING)[number];
export type ProductType = (typeof PRODUCT_TYPES)[number];

export interface Drug {
  id: string;
  detailUrl: string;
  nameLatin: string;
  nameCyrillic: string;
  genericName: string;
  atcCode: string | null;
  extendedAtcCode: string | null;
  ean: string | null;
  pharmaceuticalForm: string;
  strength: string | null;
  packaging: string;
  composition: string | null;
  dosage: string | null;
  dispensing: Dispensing;
  productType: ProductType;
  specialWarning: string | null;
  specialistRecommendation: string | null;
  manufacturers: string;
  manufacturingSites: string | null;
  marketingAuthorizationHolder: string;
  authorization: {
    number: string | null;
    issuedDate: string | null;
    expiryDate: string | null;
    renewalDate: string | null;
  };
  prices: {
    wholesaleExVat: number | null;
    retailWithVat: number | null;
    reference: number | null;
  };
  isOnPositiveList: boolean;
  fundCode: string | null;
  hasBraille: boolean;
  hasVariations: boolean;
  documents: {
    smpcUrl: string | null;
    patientLeafletUrl: string | null;
    labelUrl: string | null;
  };
}

export interface DrugRegisterFile {
  source: string;
  scrapedDate: string;
  currency: "MKD";
  count: number;
  drugs: Drug[];
}

export interface Meta {
  source: string;
  scrapedDate: string;
  currency: "MKD";
  count: number;
  apiVersion: "v1";
  fullDatasetPath: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DrugPage {
  data: Drug[];
  pagination: Pagination;
}
