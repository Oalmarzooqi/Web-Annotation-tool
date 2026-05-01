import "dotenv/config";

import cors from "cors";
import express from "express";
import { prisma } from "./prisma";

const app = express();

app.use(
  cors({
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({ orderBy: { updatedAt: "desc" } });
  res.json(projects);
});

app.post("/api/projects", async (req, res) => {
  const body = req.body as { name?: unknown; description?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description : "";

  if (!name) return res.status(400).json({ error: "name is required" });

  const project = await prisma.project.create({
    data: { name, description },
  });
  res.status(201).json(project);
});

app.get("/api/projects/:id", async (req, res) => {
  const id = req.params.id;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return res.status(404).json({ error: "not found" });
  res.json(project);
});

app.put("/api/projects/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body as { name?: unknown; description?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description : "";

  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const project = await prisma.project.update({
      where: { id },
      data: { name, description },
    });
    res.json(project);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await prisma.project.delete({ where: { id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});

