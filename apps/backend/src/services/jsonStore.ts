import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

const DATA_DIR = path.join(__dirname, '..', '..', '.data');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

// Generic function to read JSON file with initialization
async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  await ensureDataDir();
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    // File doesn't exist or is invalid, initialize it
    await writeJsonFile(filePath, defaultValue);
    return defaultValue;
  }
}

// Generic function to write JSON file atomically
async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir();
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tempFile, filePath);
}

// User-scoped data storage
interface UserData {
  agents: Agent[];
  configs: AgentConfig[];
  messages: ChatMessage[];
  layout: Layout;
  artifacts: Artifact[];
}

const getUserDataFile = (userId: string) => path.join(DATA_DIR, `user_${userId}.json`);

async function getUserData(userId: string): Promise<UserData> {
  return readJsonFile(getUserDataFile(userId), {
    agents: [],
    configs: [],
    messages: [],
    layout: { nodes: [], edges: [] },
    artifacts: []
  });
}

async function saveUserData(userId: string, data: UserData): Promise<void> {
  await writeJsonFile(getUserDataFile(userId), data);
}

// Agents
interface Agent {
  id: string;
  name: string;
  type: string;
  status: string;
  persona: string;
  created: string;
}

export async function getAgents(userId: string): Promise<Agent[]> {
  const userData = await getUserData(userId);
  return userData.agents;
}

export async function saveAgents(userId: string, agents: Agent[]): Promise<void> {
  const userData = await getUserData(userId);
  userData.agents = agents;
  await saveUserData(userId, userData);
}

export async function addAgent(userId: string, agent: Agent): Promise<void> {
  const userData = await getUserData(userId);
  userData.agents.push(agent);
  await saveUserData(userId, userData);
}

// Configs
interface AgentConfig {
  agentId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export async function getConfigs(userId: string): Promise<AgentConfig[]> {
  const userData = await getUserData(userId);
  return userData.configs;
}

export async function saveConfigs(userId: string, configs: AgentConfig[]): Promise<void> {
  const userData = await getUserData(userId);
  userData.configs = configs;
  await saveUserData(userId, userData);
}

export async function getConfig(userId: string, agentId: string): Promise<AgentConfig | null> {
  const userData = await getUserData(userId);
  return userData.configs.find(c => c.agentId === agentId) || null;
}

export async function saveConfig(userId: string, config: AgentConfig): Promise<void> {
  const userData = await getUserData(userId);
  const index = userData.configs.findIndex(c => c.agentId === config.agentId);
  if (index >= 0) {
    userData.configs[index] = config;
  } else {
    userData.configs.push(config);
  }
  await saveUserData(userId, userData);
}

// Messages
interface ChatMessage {
  id: string;
  agentId: string;
  role: string;
  text: string;
  ts: string;
}

export async function getMessages(userId: string): Promise<ChatMessage[]> {
  const userData = await getUserData(userId);
  return userData.messages;
}

export async function saveMessages(userId: string, messages: ChatMessage[]): Promise<void> {
  const userData = await getUserData(userId);
  userData.messages = messages;
  await saveUserData(userId, userData);
}

export async function addMessage(userId: string, message: ChatMessage): Promise<void> {
  const userData = await getUserData(userId);
  userData.messages.push(message);
  await saveUserData(userId, userData);
}

export async function getMessagesByAgent(userId: string, agentId: string, limit: number = 50): Promise<ChatMessage[]> {
  const userData = await getUserData(userId);
  return userData.messages
    .filter(m => m.agentId === agentId)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit);
}

// Layout
interface Layout {
  nodes: Array<{ id: string; x: number; y: number }>;
  edges: Array<{ from: string; to: string }>;
}

export async function getLayout(userId: string): Promise<Layout> {
  const userData = await getUserData(userId);
  return userData.layout;
}

export async function saveLayout(userId: string, layout: Layout): Promise<void> {
  const userData = await getUserData(userId);
  userData.layout = layout;
  await saveUserData(userId, userData);
}

// Artifacts
interface Artifact {
  id: string;
  agentId: string;
  name: string;
  size: number;
  createdAt: string;
  filePath: string;
}

export async function getArtifacts(userId: string): Promise<Artifact[]> {
  const userData = await getUserData(userId);
  return userData.artifacts;
}

export async function saveArtifacts(userId: string, artifacts: Artifact[]): Promise<void> {
  const userData = await getUserData(userId);
  userData.artifacts = artifacts;
  await saveUserData(userId, userData);
}

export async function addArtifact(userId: string, artifact: Artifact): Promise<void> {
  const userData = await getUserData(userId);
  userData.artifacts.push(artifact);
  await saveUserData(userId, userData);
}

export async function getArtifactsByAgent(userId: string, agentId: string): Promise<Artifact[]> {
  const userData = await getUserData(userId);
  return userData.artifacts.filter(a => a.agentId === agentId);
}
