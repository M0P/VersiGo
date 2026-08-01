-- AP-19: Worker-Heartbeat-Tabelle fuer Health-/Readiness-Monitoring
-- Der Worker schreibt per Upsert auf workerId; die API liest den
-- aktuellsten Eintrag fuer GET /ready (worker up/down/unknown).

CREATE TABLE "worker_heartbeats" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "instanceLabel" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_heartbeats_workerId_key" ON "worker_heartbeats"("workerId");
CREATE INDEX "worker_heartbeats_lastSeenAt_idx" ON "worker_heartbeats"("lastSeenAt");
