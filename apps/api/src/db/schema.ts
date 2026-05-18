import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  bigserial,
  jsonb,
  customType,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

const citext = customType<{ data: string; notNull: false; default: false }>({
  dataType() {
    return "citext";
  },
});

export const agentRole = pgEnum("agent_role", ["agent", "supervisor", "admin"]);
export const agentStatus = pgEnum("agent_status", ["active", "disabled"]);
export const conversationStatus = pgEnum("conversation_status", [
  "open",
  "assigned",
  "closed",
]);
export const senderType = pgEnum("sender_type", ["agent", "session", "system"]);
export const actorType = pgEnum("actor_type", ["agent", "session", "system"]);
export const scanStatus = pgEnum("scan_status", [
  "pending",
  "clean",
  "rejected",
]);
export const identifierKind = pgEnum("identifier_kind", [
  "player_id",
  "email",
  "phone",
  "username",
  "custom",
]);
export const identifierSource = pgEnum("identifier_source", [
  "self",
  "agent",
  "sso",
]);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: agentRole("role").notNull().default("agent"),
    status: agentStatus("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("agents_email_unique").on(t.email),
  }),
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    refreshTokenHash: bytea("refresh_token_hash").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    agentIdx: index("agent_sessions_agent_idx").on(t.agentId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalUserId: text("external_user_id"),
    externalIdentityProvider: text("external_identity_provider"),
    displayName: text("display_name"),
    casinoContext: jsonb("casino_context").$type<Record<string, unknown>>(),
    userAgent: text("user_agent"),
    ipHash: bytea("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    extIdx: index("sessions_external_user_idx").on(t.externalUserId),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    status: conversationStatus("status").notNull().default("open"),
    assignedAgentId: uuid("assigned_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    unreadForAgent: integer("unread_for_agent").notNull().default(0),
    unreadForSession: integer("unread_for_session").notNull().default(0),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  },
  (t) => ({
    queueIdx: index("conversations_queue_idx").on(t.status, t.lastMessageAt),
    agentIdx: index("conversations_agent_idx").on(
      t.assignedAgentId,
      t.status,
    ),
    sessionIdx: index("conversations_session_idx").on(t.sessionId),
  }),
);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "restrict",
  }),
  uploadedByType: actorType("uploaded_by_type").notNull(),
  uploadedById: uuid("uploaded_by_id"),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  checksumSha256: bytea("checksum_sha256"),
  scanStatus: scanStatus("scan_status").notNull().default("clean"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "restrict" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    senderType: senderType("sender_type").notNull(),
    senderId: uuid("sender_id"),
    senderDisplayName: text("sender_display_name"),
    clientMessageId: uuid("client_message_id").notNull(),
    body: text("body").notNull().default(""),
    attachmentId: uuid("attachment_id").references(() => attachments.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => ({
    idemIdx: uniqueIndex("messages_idempotency").on(
      t.conversationId,
      t.clientMessageId,
    ),
    seqIdx: uniqueIndex("messages_seq").on(t.conversationId, t.seq),
    convCreatedIdx: index("messages_conversation_created_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  }),
);

// Anonymous identification: append-only structured identifiers for sessions.
// A "current" identifier of a kind is one with `superseded_at IS NULL`.
export const sessionIdentifiers = pgTable(
  "session_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: identifierKind("kind").notNull(),
    customLabel: text("custom_label"), // used when kind='custom'
    value: citext("value").notNull(),
    source: identifierSource("source").notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    bySession: index("session_identifiers_session_idx").on(t.sessionId),
    byValue: index("session_identifiers_value_idx").on(t.kind, t.value),
  }),
);

// Single-tenant deployment-wide configuration. Currently focused on the
// identification flow but designed to grow.
export const deploymentSettings = pgTable("deployment_settings", {
  id: integer("id").primaryKey().default(1), // singleton row, id=1
  // Which identifier kinds are exposed in the widget pre-chat form.
  // Stored as a JSON array of {kind, custom_label?, required, regex?, label?}.
  identifierFields: jsonb("identifier_fields")
    .$type<
      Array<{
        kind: "player_id" | "email" | "phone" | "username" | "custom";
        custom_label?: string;
        required?: boolean;
        regex?: string;
        label_en?: string;
        label_tr?: string;
      }>
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // If true, the player can't send a first message until required fields filled.
  requireBeforeChat: text("require_before_chat").notNull().default("false"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Per-deployment library of tag definitions. Admin-curated.
export const tagDefinitions = pgTable(
  "tag_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(), // stable key, lowercase
    labelEn: text("label_en").notNull(),
    labelTr: text("label_tr"),
    color: text("color").notNull().default("#374151"), // hex
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tag_definitions_slug_unique").on(t.slug),
  }),
);

// Tag applications on a conversation. Append-only with `removed_at` for
// "untag" so the audit trail is preserved.
export const conversationTags = pgTable(
  "conversation_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tagDefinitions.id, { onDelete: "restrict" }),
    appliedByAgentId: uuid("applied_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => ({
    activeIdx: uniqueIndex("conversation_tags_active_unique")
      .on(t.conversationId, t.tagId)
      .where(sql`${t.removedAt} IS NULL`),
    byConv: index("conversation_tags_conv_idx").on(t.conversationId),
    byTag: index("conversation_tags_tag_idx").on(t.tagId),
  }),
);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorType: actorType("actor_type").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id"),
  metadata: jsonb("metadata"),
});

// --- Type aliases ---
export type AgentRow = typeof agents.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type SessionIdentifierRow = typeof sessionIdentifiers.$inferSelect;
export type DeploymentSettingsRow = typeof deploymentSettings.$inferSelect;
export type TagDefinitionRow = typeof tagDefinitions.$inferSelect;
export type ConversationTagRow = typeof conversationTags.$inferSelect;
