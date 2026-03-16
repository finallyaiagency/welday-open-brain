export const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  telegram: "Radar",
  telegram_moneypenny: "Moneypenny",
  telegram_smithers: "Smithers",
  telegram_burns: "Burns",
  dashboard_chat: "Dashboard",
  web: "Manual",
  manual: "Manual",
  api: "API",
  ceo_agent: "CEO Agent",
  email: "Email",
  system: "System",
};

export const SOURCE_GLYPHS: Record<string, string> = {
  google: "GO",
  telegram: "RD",
  telegram_moneypenny: "MP",
  telegram_smithers: "SM",
  telegram_burns: "BR",
  dashboard_chat: "DB",
  web: "MN",
  manual: "MN",
  api: "AP",
  ceo_agent: "EA",
  email: "EM",
  system: "SY",
};

export function formatSourceLabel(source: string | null | undefined) {
  if (!source) return "Unknown";
  return SOURCE_LABELS[source] || source.replace(/[_-]/g, " ");
}

export function formatSourceGlyph(source: string | null | undefined) {
  if (!source) return "??";
  return SOURCE_GLYPHS[source] || source.slice(0, 2).toUpperCase();
}
