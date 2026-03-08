export function makeBasicAuthHeader(identifier: string, password: string) {
  const token = Buffer.from(`${identifier}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}