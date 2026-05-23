import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envCandidates = [
  process.env.LIQUIDAITY_BACKEND_ENV,
  path.resolve(process.cwd(), 'apps/backend/.env'),
  path.resolve(process.cwd(), '.env'),
].filter((candidate): candidate is string => Boolean(candidate));

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));

if (envPath) {
  dotenv.config({ path: envPath });
}
