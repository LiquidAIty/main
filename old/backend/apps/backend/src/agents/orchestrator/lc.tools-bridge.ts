import { getTool } from '../registry';
import { loadPolicy } from './policy';

export function buildLocalTools(): Array<{ name: string; description: string; invoke: (input: any) => Promise<string> }> {
  const policy = loadPolicy();
  const locals = (policy.tools || []).filter(t => t.kind === 'local');
  const tools = locals.map(t => {
    const name = t.name;
    const description = t.description || '';
    const handler = getTool(name) as any;
    const invoke = async (input: any) => {
      if (!handler || typeof handler.run !== 'function') {
        throw new Error(`local tool not available: ${name}`);
      }
      const res = await handler.run(input ?? {});
      const text = (res?.content ?? res?.text ?? res?.result ?? res);
      return typeof text === 'string' ? text : JSON.stringify(text);
    };
    return { name, description, invoke };
  });
  return tools;
}
