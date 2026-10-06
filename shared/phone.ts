/**
 * Normaliza telefone para comparação de unicidade (só dígitos, com o 9 do BR).
 * Retorna null quando não dá para normalizar.
 */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  // Brasil: 55 + DDD (2) + 8 dígitos -> insere o nono dígito
  if (/^55\d{10}$/.test(digits)) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits.length >= 8 ? digits : null;
}
