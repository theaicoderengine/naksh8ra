/**
 * Brand configuration. The product name is a placeholder ("Atlas Hiring") —
 * rename via environment variables without code changes.
 */
export function brand() {
  return {
    name: process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Atlas Hiring",
    tagline: process.env.NEXT_PUBLIC_APP_TAGLINE ?? "Evidence-based hiring, at global scale",
    supportEmail: process.env.APP_SUPPORT_EMAIL ?? "support@example.com",
    primaryHex: process.env.NEXT_PUBLIC_BRAND_PRIMARY ?? "#1d4ed8",
    legalEntity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "[Your company legal name]",
  };
}
