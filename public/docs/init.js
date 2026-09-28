// Starts the docs viewer. Kept in its own file so the page's CSP can use script-src 'self'
// with no inline scripts.
Scalar.createApiReference("#app", {
  url: "/openapi.yaml",
  metaData: { title: "Drug Register API · Docs" },
  // Show Swift (URLSession) code snippets first.
  defaultHttpClient: { targetKey: "swift", clientKey: "nsurlsession" },
  documentDownloadType: "yaml",
  // Keep the page self-contained: no Scalar fonts, telemetry, AI agent, dev toolbar,
  // or "Open API Client" link (it would send the spec URL to client.scalar.com).
  withDefaultFonts: false,
  telemetry: false,
  agent: { disabled: true },
  showDeveloperTools: "never",
  hideClientButton: true,
  // Don't keep the token in localStorage between visits.
  persistAuth: false,
});
