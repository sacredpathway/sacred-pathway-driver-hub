// Shared print stylesheet for paystubs / settlement statements (theme-aware).

// =============================================================================
//  CSS — theme-aware so the picker on /settings/paystub actually changes the
//  printed paystub. Theme colors flow in via CSS variables on .paystub-page.
// =============================================================================

export function buildPrintCss({
  primary,
  accent,
  accentSoft,
}: {
  primary: string;
  accent: string;
  accentSoft: string;
}): string {
  return `
.paystub-page {
  --sp-primary: ${primary};
  --sp-accent: ${accent};
  --sp-accent-soft: ${accentSoft};
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #111;
  background: #fff;
  max-width: 8in;
  margin: 0 auto;
  padding: 0.5in;
  font-size: 11pt;
  line-height: 1.4;
}
.paystub-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 3px solid var(--sp-primary);
  padding-bottom: 12px;
  margin-bottom: 16px;
}
.paystub-brand { display: flex; gap: 12px; align-items: center; }
.brand-mark {
  background: var(--sp-accent);
  color: var(--sp-primary);
  font-weight: 700;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14pt;
  letter-spacing: 1px;
}
.brand-logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #eee;
}
.brand-company { font-size: 14pt; font-weight: 700; color: var(--sp-primary); }
.brand-meta    { font-size: 9pt; color: #555; }
.brand-address { font-size: 9pt; color: #555; margin-top: 2px; }
.paystub-id { text-align: right; }
.paystub-id-title {
  font-weight: 700;
  letter-spacing: 1px;
  font-size: 12pt;
  color: var(--sp-primary);
}
.paystub-id-meta { font-size: 9pt; color: #333; margin-top: 4px; }
.paystub-id-meta div { margin-top: 2px; }

.paystub-parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 20px;
}
.party-title {
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 8pt;
  color: #777;
}
.party-name { font-weight: 700; font-size: 12pt; margin-top: 2px; }
.party div { margin-top: 2px; font-size: 10pt; }

.block { margin-bottom: 18px; }
.block h3 {
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 9pt;
  color: var(--sp-primary);
  margin: 0 0 6px 0;
  font-weight: 700;
  border-bottom: 1px solid var(--sp-primary);
  padding-bottom: 2px;
}
table.lines { width: 100%; border-collapse: collapse; }
table.lines th, table.lines td {
  border-bottom: 1px solid #eee;
  padding: 6px 8px;
  font-size: 10pt;
  text-align: left;
  vertical-align: top;
}
table.lines th {
  font-size: 8pt;
  color: #777;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
table.lines td.r, table.lines th.r { text-align: right; }
table.lines tr.subtotal td {
  border-top: 1px solid var(--sp-primary);
  border-bottom: 0;
  font-weight: 700;
  padding-top: 8px;
}
.muted { color: #888; }

.netpay {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  background: var(--sp-accent-soft);
  border: 1px solid var(--sp-accent);
  border-radius: 6px;
  padding: 12px;
  margin-top: 14px;
}
.netpay > div .label {
  font-size: 8pt;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.netpay > div .value { font-size: 12pt; font-weight: 700; margin-top: 2px; }
.netpay > div.big .value { font-size: 18pt; color: var(--sp-primary); }
.netpay > div.big .label { color: var(--sp-primary); font-weight: 700; }

.footer-meta {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--sp-accent-soft);
  border: 1px solid var(--sp-accent);
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 10pt;
}

.paystub-legal {
  margin-top: 16px;
  padding: 10px 12px;
  background: #fafafa;
  border-left: 3px solid var(--sp-primary);
  border-radius: 0 4px 4px 0;
  font-size: 9pt;
  color: #444;
  line-height: 1.5;
  white-space: pre-wrap;
}

.paystub-footer {
  margin-top: 18px;
  border-top: 1px solid #ddd;
  padding-top: 8px;
  font-size: 8pt;
  color: #999;
  text-align: center;
  position: relative;
}
.watermark {
  position: absolute;
  top: -200px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 80pt;
  color: rgba(217, 80, 80, 0.08);
  font-weight: 900;
  letter-spacing: 4px;
  pointer-events: none;
  z-index: 0;
}

.print-toolbar {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  z-index: 10;
}
.print-button {
  background: var(--sp-primary);
  color: #fff;
  border: 0;
  padding: 10px 18px;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.print-link {
  background: #fff;
  color: #333;
  padding: 10px 14px;
  border-radius: 6px;
  text-decoration: none;
  border: 1px solid #ddd;
  font-size: 10pt;
}

@media print {
  .no-print { display: none !important; }
  .paystub-page { padding: 0.4in; max-width: none; }
  @page { size: letter; margin: 0.5in; }
}
`;
}
