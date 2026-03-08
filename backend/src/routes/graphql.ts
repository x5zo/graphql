import { Router } from "express";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const token = req.cookies?.jwt;
    if (!token) return res.status(401).json({ error: "Not logged in" });

    const { query, variables } = req.body as {
      query?: string;
      variables?: Record<string, unknown>;
    };

    if (!query) return res.status(400).json({ error: "query is required" });

    const gqlUrl = process.env.REBOOT_GRAPHQL_URL!;
    const response = await fetch(gqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ query, variables: variables ?? {} })
    });

    const data = await response.json().catch(async () => ({
      raw: await response.text()
    }));

    return res.status(response.status).json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: "GraphQL proxy failed", details: message });
  }
});

export default router;