const SENSITIVE_KEYS = /password|passphrase|token|secret|certificate|private.?key|bank.?account/i;
export function sanitizeForAudit(value) {
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,SENSITIVE_KEYS.test(key)?"***":sanitizeForAudit(item)]));
  }
  return value;
}
export function normalizeText(value,max=4000){return String(value||"").trim().slice(0,max);}
