import { Router } from "express";
import { makeBasicAuthHeader } from "../utils/basicAuth";

const router = Router();

function normalizeToken(raw: string): string {
let t = raw.trim();

try {
const obj = JSON.parse(t);
const possible =
obj?.token ?? obj?.jwt ?? obj?.access_token ?? obj?.data?.token ?? null;
if (typeof possible === "string") t = possible.trim();
} catch {
}

t = t.replace(/^"+|"+$/g, "").trim();
t = t.replace(/^\"+|\"+$/g, "").trim();

return t;
}

router.post("/login", async (req, res) => {
try {
const { identifier, password } = req.body as {
identifier?: string;
password?: string;
};

if (!identifier || !password) {
  return res.status(400).json({ error: "identifier and password are required" });
}

const signinUrl = process.env.REBOOT_SIGNIN_URL!;
const response = await fetch(signinUrl, {
  method: "POST",
  headers: {
    Authorization: makeBasicAuthHeader(identifier, password)
  }
});

const text = await response.text().catch(() => "");

if (!response.ok) {
  return res.status(response.status).json({
    error: "Signin failed",
    status: response.status,
    details: text
  });
}

const token = normalizeToken(text);

// validate JWT
if (token.split(".").length !== 3) {
  return res.status(502).json({
    error: "Signin response did not contain a valid JWT",
    details: text
  });
}

res.cookie("jwt", token, {
  httpOnly: true,
  secure: true,        
  sameSite: "none",  
  maxAge: 1000 * 60 * 60 * 6
});

return res.json({ ok: true });

} catch (e: unknown) {
const message = e instanceof Error ? e.message : String(e);
return res.status(502).json({
error: "Backend could not reach Reboot signin endpoint",
details: message
});
}
});

router.post("/logout", (_req, res) => {
res.clearCookie("jwt", {
httpOnly: true,
secure: true,
sameSite: "none"
});
return res.json({ ok: true });
});

export default router;
