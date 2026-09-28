import { createHmac, timingSafeEqual } from "node:crypto";

export class AuthenticationError extends Error {
  constructor(message = "Telegram authorization could not be verified.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyTelegramInitData(initData, botToken, { now = Date.now(), maxAgeSeconds = 3600 } = {}) {
  if (typeof initData !== "string" || !botToken) throw new AuthenticationError();

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    throw new AuthenticationError();
  }

  const hashes = params.getAll("hash");
  const users = params.getAll("user");
  const names = new Set();
  for (const [name] of params) {
    if (names.has(name)) throw new AuthenticationError();
    names.add(name);
  }
  if (hashes.length !== 1 || users.length !== 1 || !/^[a-f0-9]{64}$/i.test(hashes[0])) throw new AuthenticationError();

  const pairs = [];
  for (const [key, entry] of params) {
    if (key !== "hash") pairs.push([key, entry]);
  }
  pairs.sort(([left], [right]) => left.localeCompare(right));
  const dataCheckString = pairs.map(([key, entry]) => `${key}=${entry}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!secureEqual(calculatedHash, hashes[0])) throw new AuthenticationError();

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0 || authDate * 1000 > now + 30_000 || now - authDate * 1000 > maxAgeSeconds * 1000) {
    throw new AuthenticationError();
  }

  try {
    const user = JSON.parse(users[0]);
    if (!user || !/^\d+$/.test(String(user.id))) throw new Error("invalid user");
    return Object.freeze({ id: String(user.id), firstName: String(user.first_name || "") });
  } catch {
    throw new AuthenticationError();
  }
}
