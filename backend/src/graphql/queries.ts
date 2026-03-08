export const QUERIES = {
  // 1) XP earned by project (we group by project in code using "path")
  xpByProject: `
    query XPTransactions($limit: Int = 5000, $offset: Int = 0) {
      transaction(
        where: { type: { _eq: "xp" } }
        limit: $limit
        offset: $offset
        order_by: { createdAt: asc }
      ) {
        amount
        path
        objectId
        createdAt
      }
    }
  `,

  // 2) Audit ratio (sum up & down)
  auditRatioAgg: `
    query AuditSums {
      up: transaction_aggregate(where: { type: { _eq: "up" } }) {
        aggregate { sum { amount } }
      }
      down: transaction_aggregate(where: { type: { _eq: "down" } }) {
        aggregate { sum { amount } }
      }
    }
  `,

  // 3) Projects PASS / FAIL ratio (we count grade 1 vs 0 for project paths)
  passFailProjects: `
    query ProjectResults($limit: Int = 5000, $offset: Int = 0) {
      result(
        limit: $limit
        offset: $offset
        order_by: { createdAt: asc }
      ) {
        grade
        path
        createdAt
      }
    }
  `
};