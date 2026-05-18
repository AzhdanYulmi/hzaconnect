import { db } from "./db/client.js";
import { auditLog } from "./db/schema.js";
import type { ActorType } from "@hzaconnect/shared";

export async function audit(entry: {
  actorType: ActorType;
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    metadata: entry.metadata ?? null,
  });
}
