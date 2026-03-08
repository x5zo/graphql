import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth";
import graphqlRoutes from "./routes/graphql";
import statsRoutes from "./routes/stats";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cookieParser());

// Allow multiple frontend origins (Live Server / Vite)
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5501",
  "http://127.0.0.1:5501"
];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow curl/postman (no origin header)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);

      console.error("CORS blocked for:", origin);
      return callback(new Error(`CORS not allowed for origin: ${origin}`));
    },
    credentials: true
  })
);

// Health check
app.get("/health", (_, res) => {
  res.json({ ok: true });
});

// Debug cookie (useful while developing)
app.get("/debug-cookie", (req, res) => {
  const jwt = req.cookies?.jwt;
  res.json({
    hasCookie: Boolean(jwt),
    preview: jwt ? jwt.slice(0, 20) + "..." : null,
    parts: jwt ? jwt.split(".").length : 0
  });
});

// Routes
app.use("/api", authRoutes);            // POST /api/login, POST /api/logout
app.use("/api/graphql", graphqlRoutes); // POST /api/graphql
app.use("/api/stats", statsRoutes);     // GET /api/stats

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`✅ Backend running at http://localhost:${port}`);
});