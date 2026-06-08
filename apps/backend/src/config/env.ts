import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envPath = fs.existsSync(path.resolve(process.cwd(), 'apps/backend/.env')) 
  ? path.resolve(process.cwd(), 'apps/backend/.env')
  : path.resolve(process.cwd(), '.env');

if (!fs.existsSync(envPath)) {
  throw new Error(`backend_env_missing: required env file not found at ${envPath}`);
}

dotenv.config({ path: envPath });
