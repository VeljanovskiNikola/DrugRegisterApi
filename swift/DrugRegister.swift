import Foundation

// Codable models for the drug register API (see openapi.yaml).
// JSON keys match property names, so no CodingKeys are needed.
// Decode with JSONDecoder.drugRegister() (bottom of this file) so dates work.

// MARK: - API responses

/// GET /api/v1/drugs
struct DrugPage: Codable, Sendable {
    let data: [Drug]
    let pagination: Pagination
}

struct Pagination: Codable, Sendable, Hashable {
    let page: Int
    let limit: Int
    let total: Int
    let totalPages: Int
}

/// GET /api/v1/meta
struct RegisterMeta: Codable, Sendable {
    let source: URL
    let scrapedDate: Date
    let currency: String          // always "MKD"
    let count: Int
    let apiVersion: String
    let fullDatasetPath: String   // "/data/drug-register.json", relative to the API host
}

/// Body of every 4xx/5xx response.
struct APIErrorResponse: Codable, Sendable, Error {
    struct Detail: Codable, Sendable {
        let code: String          // invalidParameter, notFound, internalError
        let message: String
        let parameter: String?
    }
    let error: Detail
}

/// GET /data/drug-register.json (all drugs, for an offline copy)
struct DrugRegister: Codable, Sendable {
    let source: URL
    let scrapedDate: Date
    let currency: String          // always "MKD"
    let count: Int
    let drugs: [Drug]
}

// MARK: - Drug

struct Drug: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let detailUrl: URL
    let nameLatin: String
    let nameCyrillic: String
    let genericName: String
    let atcCode: String?
    let extendedAtcCode: String?
    let ean: String?
    let pharmaceuticalForm: String
    let strength: String?
    let packaging: String
    let composition: String?
    let dosage: String?
    let dispensing: Dispensing
    let productType: ProductType
    let specialWarning: String?
    let specialistRecommendation: String?
    let manufacturers: String
    let manufacturingSites: String?
    let marketingAuthorizationHolder: String
    let authorization: Authorization
    let prices: Prices
    let isOnPositiveList: Bool
    let fundCode: String?
    let hasBraille: Bool
    let hasVariations: Bool
    let documents: Documents

    struct Authorization: Codable, Sendable, Hashable {
        let number: String?
        let issuedDate: Date?
        let expiryDate: Date?
        let renewalDate: Date?
    }

    /// All prices in MKD. `nil` means the site shows no price (0).
    struct Prices: Codable, Sendable, Hashable {
        let wholesaleExVat: Decimal?
        let retailWithVat: Decimal?
        let reference: Decimal?
    }

    struct Documents: Codable, Sendable, Hashable {
        let smpcUrl: URL?             // Збирен извештај
        let patientLeafletUrl: URL?   // Упатство за употреба
        let labelUrl: URL?            // Налепница/Пакување
    }
}

/// Начин на издавање
enum Dispensing: String, Codable, Sendable, CaseIterable {
    case prescription     // Rp
    case hospitalOnly     // H
    case otcPharmacy      // BRp
    case otcGeneralSale   // BR*

    var code: String {
        switch self {
        case .prescription: "Rp"
        case .hospitalOnly: "H"
        case .otcPharmacy: "BRp"
        case .otcGeneralSale: "BR*"
        }
    }
}

/// Г/О/БС
enum ProductType: String, Codable, Sendable, CaseIterable {
    case generic      // Г
    case original     // О
    case biosimilar   // БС

    var code: String {
        switch self {
        case .generic: "Г"
        case .original: "О"
        case .biosimilar: "БС"
        }
    }
}

extension JSONDecoder {
    /// Dates in the JSON are date-only ISO 8601 ("2020-06-15").
    /// They decode to midnight UTC, so format them for display with a UTC time zone.
    static func drugRegister() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            let style = Date.ISO8601FormatStyle().year().month().day()
            guard let date = try? style.parse(string) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Expected yyyy-MM-dd, got \(string)"
                )
            }
            return date
        }
        return decoder
    }
}
