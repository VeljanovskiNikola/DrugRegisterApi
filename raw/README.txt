Drug register raw export - lekovi.zdravstvo.gov.mk/drugsregister - scraped 27.09.2026

drugs_raw.jsonl: one JSON object per line, 4,119 lines, UTF-8.
  id           drug ID on the site. Detail page: https://lekovi.zdravstvo.gov.mk/drugsregister/detailview/{id}
  page         page number in the overview table at 200 rows per page
  table        the 17 overview-table columns, text exactly as on the site
               (Варијации = "Да" when the site shows a variations icon)
  detail       all fields from the detail page, label -> text (Macedonian labels as on the site)
  detailLinks  PDF links, relative to https://lekovi.zdravstvo.gov.mk
               downloadreport = patient leaflet (PIL), downloadguide = SmPC, downloadsticker = sticker

Checks: 4,119 rows = site total. No duplicates. Table and detail fields match for every drug.
