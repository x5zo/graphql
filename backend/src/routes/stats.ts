import { Router } from "express";

const router = Router();

// GraphQL helper (uses Node 18+ fetch; works on Node 22)
async function callGraphQL(token: string, query: string, variables: any = {}) {
  const url = process.env.REBOOT_GRAPHQL_URL!;
  if (!url) throw new Error("Missing REBOOT_GRAPHQL_URL in .env");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok || json?.errors) {
    throw new Error(JSON.stringify(json));
  }

  return json.data;
}

// ----------------------------
// MAIN /api/stats
// ----------------------------
router.get("/", async (req, res) => {
  try {
    const token = req.cookies?.jwt;
    if (!token) return res.status(401).json({ error: "Missing JWT cookie" });

    // =========================
    // A) PROFILE (name + audit ratio)
    // =========================
    const PROFILE_QUERY = `
      query Profile {
        user {
          login
          auditRatio
          firstName
          lastName
        }
      }
    `;

    // =========================
    // B) XP from transaction table (per project instructions)
    //    Filter to /bahrain/bh-module/ paths only — depth-3 paths are top-level projects
    // =========================
    const XP_QUERY = `
      query XP {
        transaction(
          where: {
            type: { _eq: "xp" }
            path: { _like: "/bahrain/bh-module/%" }
          }
          order_by: { createdAt: asc }
        ) {
          amount
          path
          objectId
        }
      }
    `;

    // =========================
    // C) PASS/FAIL ratio (result table, project objects)
    // =========================
    const PASSFAIL_QUERY = `
      query PassFail {
        result(where: { object: { type: { _eq: "project" } } }) {
          grade
          object {
            name
            type
          }
        }
      }
    `;

    // =========================
    // D) Audit done/received amounts
    // =========================
    const AUDIT_QUERY = `
      query AuditAmounts {
        up: transaction_aggregate(where: { type: { _eq: "up" } }) {
          aggregate { sum { amount } }
        }
        down: transaction_aggregate(where: { type: { _eq: "down" } }) {
          aggregate { sum { amount } }
        }
      }
    `;

    // Run all queries in parallel
    const [profileData, xpData, pfData, auditData] = await Promise.all([
      callGraphQL(token, PROFILE_QUERY),
      callGraphQL(token, XP_QUERY),
      callGraphQL(token, PASSFAIL_QUERY),
      callGraphQL(token, AUDIT_QUERY),
    ]);

    const user = profileData?.user?.[0];
    if (!user) {
      return res.status(404).json({ error: "User not found in GraphQL response" });
    }

    // =========================
    // Process XP transactions
    // Sum ALL depth-3 transactions: /bahrain/bh-module/<project>
    // No deduplication — zone01 grants XP once per project
    // =========================
    // Total XP: depth-3 projects + depth-4 checkpoint items under /bahrain/bh-module/
    // Chart XP: depth-3 only (top-level projects for the bar chart)
    let totalXPRaw = 0;
    const xpMap = new Map<string, number>(); // for chart (depth-3 only)

    for (const tx of xpData?.transaction ?? []) {
      const path: string = tx?.path || "";
      const amount = Number(tx?.amount || 0);
      if (!path || !amount) continue;

      const parts = path.split("/").filter(Boolean);

      // depth-3: top-level project — count in total AND chart
      if (parts.length === 3) {
        totalXPRaw += amount;
        const slug = parts[2];
        xpMap.set(slug, (xpMap.get(slug) ?? 0) + amount);
      }
      // depth-4: checkpoint exercises under bh-module — count in total only
      else if (parts.length === 4) {
        totalXPRaw += amount;
      }
      // depth-5+: piscine-js sub-exercises — skip (already counted via piscine-js root at depth-3)
    }

    const xpByProject = Array.from(xpMap.entries())
      .map(([project, xp]) => ({ project, xp }))
      .sort((a, b) => b.xp - a.xp);

    const totalXP = totalXPRaw;

    // =========================
    // Process pass/fail
    // grade >= 1 = pass (100%), below = fail
    // Deduplicate by project name (keep last result)
    // =========================
    const results: any[] = pfData?.result ?? [];
    const seen = new Set<string>();
    let pass = 0;
    let fail = 0;

    for (const r of results) {
      const name = r?.object?.name;
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      const grade = Number(r?.grade || 0);
      if (grade >= 1) pass++;
      else fail++;
    }

    const total = pass + fail;
    const passFail = {
      pass,
      fail,
      total,
      passRate: total ? pass / total : null,
      failRate: total ? fail / total : null,
    };

    // =========================
    // Process audit amounts
    // =========================
    const done     = auditData?.up?.aggregate?.sum?.amount   ?? 0;
    const received = auditData?.down?.aggregate?.sum?.amount ?? 0;

    const audit = {
      ratio:    user.auditRatio ?? null,
      done:     Number(done),
      received: Number(received),
    };

    return res.json({
      me: {
        login:     user.login     ?? null,
        firstName: user.firstName ?? null,
        lastName:  user.lastName  ?? null,
      },
      totalXP,
      audit,
      xpByProject,
      passFail,
    });
  } catch (e: any) {
    return res.status(500).json({
      error: "Failed to compute stats",
      details: String(e?.message ?? e),
    });
  }
});

export default router;
