// Fake data in the exact shape of docs/contract.md. Use it to build and test without the backend.
export const MOCK_SCAN = {
  url: "https://example.com/login",
  hostname: "example.com",
  scannedAt: "2026-10-02T10:00:00Z",
  https: true,
  scanner: {
    forms: 3,
    personalDataFields: 7,
    fieldTypes: { name: 1, email: 2, phone: 1, address: 1, dob: 0, password: 1, financial: 0, governmentId: 0 },
    fields: []
  },
  tracking: {
    cookies: { total: 14, firstParty: 9, thirdParty: 5 },
    thirdPartyScripts: 6,
    trackers: { analytics: 3, advertising: 2, social: 1, unknown: 1 }
  },
  policy: {
    found: true,
    url: "https://example.com/privacy",
    candidates: [{ text: "Privacy Policy", href: "https://example.com/privacy" }]
  }
};

export const MOCK_RESULT = {
  id: "scan_mock001",
  url: "https://example.com/login",
  riskScore: 67,
  riskLevel: "High",
  breakdown: { personalData: 25, trackers: 15, security: 10, policy: 8 },
  recommendations: [
    "Review third-party tracking before signing up.",
    "Check the privacy policy for data deletion information."
  ]
};

export const MOCK_POLICY_ANALYSIS = {
  dataCollected: ["Email", "Phone number", "Device information"],
  purposes: ["Account creation", "Analytics"],
  dataSharing: true,
  thirdParties: "Service providers and advertising partners mentioned",
  retention: "Not clearly specified",
  deletion: "Users can request deletion by email",
  concerns: ["Retention period is not stated"]
};

export const MOCK_REPORT = {
  scan: MOCK_SCAN,
  result: MOCK_RESULT,
  policyAnalysis: null,
  warnings: []
};
