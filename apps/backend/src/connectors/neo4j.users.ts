import { randomUUID } from "node:crypto";
import { getNeo4jDriver } from "./neo4j";

export type DbUser = {
  id: string;
  email: string;
  passwordHash: string;
  roles: string[];
  createdAt: string;
  updatedAt: string;
};

export async function createUser(email: string, passwordHash: string): Promise<DbUser> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const res = await session.run(
      `CREATE (u:User {id:$id,email:$email,passwordHash:$ph,roles:$roles,createdAt:$now,updatedAt:$now}) RETURN u`,
      { id, email: email.toLowerCase(), ph: passwordHash, roles: [], now }
    );
    return res.records[0].get("u").properties as DbUser;
  } finally {
    await session.close();
  }
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (u:User {email:$email}) RETURN u LIMIT 1`,
      { email: email.toLowerCase() }
    );
    return res.records.length ? (res.records[0].get("u").properties as DbUser) : null;
  } finally {
    await session.close();
  }
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (u:User {id:$id}) RETURN u LIMIT 1`,
      { id }
    );
    return res.records.length ? (res.records[0].get("u").properties as DbUser) : null;
  } finally {
    await session.close();
  }
}

export async function createRefreshToken(
  userId: string,
  tokenHash: string,
  expiresAt: string,
  meta: { ip?: string; ua?: string } = {}
) {
  const id = randomUUID();
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    await session.run(
      `MATCH (u:User {id:$uid})
       CREATE (t:RefreshToken {id:$id,tokenHash:$th,expiresAt:$exp,ip:$ip,ua:$ua})
       MERGE (u)-[:HAS_TOKEN]->(t)`,
      { uid: userId, id, th: tokenHash, exp: expiresAt, ip: meta.ip ?? null, ua: meta.ua ?? null }
    );
    return { id };
  } finally {
    await session.close();
  }
}

export async function revokeRefreshTokenByHash(tokenHash: string) {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    await session.run(`MATCH (t:RefreshToken {tokenHash:$th}) DETACH DELETE t`, { th: tokenHash });
  } finally {
    await session.close();
  }
}

export async function isThreadOwner(userId: string, threadId: string): Promise<boolean> {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (u:User {id:$uid})-[:OWNS]->(t:Thread {id:$tid}) RETURN t LIMIT 1`,
      { uid: userId, tid: threadId }
    );
    return res.records.length > 0;
  } finally {
    await session.close();
  }
}
