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

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

// ----------------------------
// MAIN /api/stats
// ----------------------------
router.get("/", async (req, res) => {
  try {
    const token = req.cookies?.jwt;
    if (!token) return res.status(401).json({ error: "Missing JWT cookie" });

    // use env event id (fallback 763)
    const eventId = Number(process.env.REBOOT_EVENT_ID || 763);

    // =========================
    // A) PROFILE (name + ratio + XP)
    // =========================
    const PROFILE_QUERY = `
      query Profile($eventId: Int!) {
        user {
          login
          auditRatio
          firstName
          lastName
          xps(
            where: {
              _or: [
                { originEventId: { _eq: $eventId } }
                {
                  path: {
                    _like: "/bahrain/bh-module/piscine-%"
                    _nlike: "/bahrain/bh-module/piscine-%/%"
                  }
                }
              ]
            }
          ) {
            amount
            path
          }
        }
      }
    `;

    const profileData = await callGraphQL(token, PROFILE_QUERY, { eventId });
    const user = profileData?.user?.[0];

    if (!user) {
      return res.status(404).json({ error: "User not found in GraphQL response" });
    }

    // total XP (sum of xps)
    const totalXP = (user.xps ?? []).reduce(
      (sum: number, x: any) => sum + Number(x?.amount || 0),
      0
    );

    // =========================
    // B) XP BY PROJECT (from xps.path)
    // =========================
    // We will group by the last part of the path (project slug)
    // Example path: /bahrain/bh-module/lem-in  => "lem-in"
    const xpMap = new Map<string, number>();

    for (const x of user.xps ?? []) {
      const path: string = x?.path || "";
      const amount = Number(x?.amount || 0);

      if (!path) continue;

      // try to extract the "last segment"
      const parts = path.split("/").filter(Boolean);
      const slug = parts[parts.length - 1] || "unknown";

      // ignore weird ones if needed
      if (!slug) continue;

      xpMap.set(slug, (xpMap.get(slug) ?? 0) + amount);
    }

    const xpByProject = Array.from(xpMap.entries())
      .map(([project, xp]) => ({ project, xp }))
      .sort((a, b) => b.xp - a.xp);

    // =========================
    // C) PASS/FAIL ratio (projects)
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

    const pfData = await callGraphQL(token, PASSFAIL_QUERY);
    const results: any[] = pfData?.result ?? [];

    // Some projects may appear multiple times; keep unique project name
    const seen = new Set<string>();
    let pass = 0;
    let fail = 0;

    for (const r of results) {
      const name = r?.object?.name;
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      const grade = Number(r?.grade || 0);
      if (grade > 0) pass++;
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
    // D) Audit ratio + done/received amounts
    // =========================
    const AUDIT_AMOUNTS_QUERY = `
      query AuditAmounts {
        up: transaction_aggregate(where: { type: { _eq: "up" } }) {
          aggregate { sum { amount } }
        }
        down: transaction_aggregate(where: { type: { _eq: "down" } }) {
          aggregate { sum { amount } }
        }
      }
    `;
    const auditData = await callGraphQL(token, AUDIT_AMOUNTS_QUERY);
    const done     = auditData?.up?.aggregate?.sum?.amount   ?? 0;
    const received = auditData?.down?.aggregate?.sum?.amount ?? 0;

    const audit = {
      ratio:    user.auditRatio ?? null,
      done:     Number(done),
      received: Number(received),
    };

    // Return final JSON
    return res.json({
      me: {
        login: user.login ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
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