import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const jamState = sqliteTable('jam_state', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(0),
});
export const localAccounts = sqliteTable('jam_accounts', {
  id: text('id').primaryKey(),
  accessHash: text('access_hash').unique(),
  login: text('login').unique(),
  passwordHash: text('password_hash'),
  salt: text('salt'),
  email: text('email').unique(),
  emailVerifiedAt: integer('email_verified_at'),
  pendingEmail: text('pending_email'),
  createdAt: integer('created_at').notNull(),
});
export const localSessions = sqliteTable('jam_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull().references(()=>localAccounts.id),
  expiresAt: integer('expires_at').notNull(),
  recoveryUntil: integer('recovery_until'),
});
export const accountTokens = sqliteTable('jam_account_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull().references(()=>localAccounts.id),
  purpose: text('purpose').notNull(),
  email: text('email').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumedBy: text('consumed_by'),
});
export const authClaims = sqliteTable('jam_auth_claims', {
  key: text('key').primaryKey(),
  accountId: text('account_id').notNull().references(()=>localAccounts.id),
});
export const authAttempts = sqliteTable('jam_auth_attempts', {
  key: text('key').primaryKey(),
  window: integer('window').notNull(),
  count: integer('count').notNull(),
});
export const adminInvitations = sqliteTable('jam_admin_invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: text('created_by').notNull().references(()=>localAccounts.id),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedBy: text('used_by').references(()=>localAccounts.id),
  revoked: integer('revoked').notNull().default(0),
});
