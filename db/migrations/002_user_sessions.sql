-- Migration: Add User and Session tables for durable auth
-- Run as postgres superuser or liquidaity-user

BEGIN;

-- Create User table (using Prisma naming convention)
CREATE TABLE IF NOT EXISTS "User" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create Session table
CREATE TABLE IF NOT EXISTS "Session" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- Grant permissions to liquidaity-user
GRANT SELECT, INSERT, UPDATE, DELETE ON "User" TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE, DELETE ON "Session" TO "liquidaity-user";

-- Verify migration
SELECT 
  COUNT(*) as total_users
FROM "User";

SELECT 
  COUNT(*) as total_sessions
FROM "Session";

COMMIT;
