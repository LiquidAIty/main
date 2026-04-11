#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx);

const jsParser = new Parser();
jsParser.setLanguage(JavaScript);

const repoMap = {
  files: [],
  symbols: [],
  imports: [],
  routes: [],
  mounts: [],
  runtime_paths: [],
  buckets: {},
  dead_risk: [],
  metadata: {
    generated_at: new Date().toISOString(),
    root: ROOT,
  }
};

const graphData = {
  nodes: [],
  edges: [],
};

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'dist' && file !== 'out-tsc') {
        walkDir(filePath, fileList);
      }
    } else {
      fileList.push(filePath);
    }
  });
  return fileList;
}

function getParser(filePath) {
  if (filePath.endsWith('.tsx')) return tsxParser;
  if (filePath.endsWith('.ts')) return tsParser;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return jsParser;
  return null;
}

function extractImports(tree, sourceCode) {
  const imports = [];
  
  function walkNode(node) {
    if (node.type === 'import_statement') {
      try {
        const text = sourceCode.slice(node.startIndex, node.endIndex);
        const match = text.match(/from\s+['"]([^'"]+)['"]/);
        if (match) {
          imports.push({
            source: match[1],
            names: [],
          });
        }
      } catch (e) {
        // Skip problematic nodes
      }
    }
    
    for (let i = 0; i < node.childCount; i++) {
      walkNode(node.child(i));
    }
  }
  
  walkNode(tree.rootNode);
  return imports;
}

function extractExports(tree, sourceCode) {
  const exports = [];
  const lines = sourceCode.split('\n');
  
  lines.forEach((line, idx) => {
    if (line.match(/^export\s+(default\s+)?(function|class|const|let|var|interface|type)\s+(\w+)/)) {
      const match = line.match(/^export\s+(default\s+)?(function|class|const|let|var|interface|type)\s+(\w+)/);
      if (match) {
        exports.push({
          name: match[3],
          type: match[2],
          isDefault: !!match[1],
        });
      }
    } else if (line.includes('export default')) {
      exports.push({
        name: 'default',
        type: 'default_export',
        isDefault: true,
      });
    }
  });
  
  return exports;
}

function extractRouteHandlers(tree, sourceCode) {
  const routes = [];
  const lines = sourceCode.split('\n');
  
  lines.forEach((line, idx) => {
    const match = line.match(/router\.(get|post|put|patch|delete|use)\s*\(\s*['"]([^'"]+)['"]/);    if (match) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        line: idx + 1,
      });
    }
  });
  
  return routes;
}

function extractTopLevelSymbols(tree, sourceCode) {
  const symbols = [];
  const lines = sourceCode.split('\n');
  
  lines.forEach((line, idx) => {
    const funcMatch = line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      symbols.push({
        name: funcMatch[3],
        type: 'function',
        line: idx + 1,
      });
    }
    
    const classMatch = line.match(/^(export\s+)?class\s+(\w+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[2],
        type: 'class',
        line: idx + 1,
      });
    }
    
    const constMatch = line.match(/^(export\s+)?const\s+(\w+)\s*=/);
    if (constMatch) {
      symbols.push({
        name: constMatch[2],
        type: 'const',
        line: idx + 1,
      });
    }
  });
  
  return symbols;
}

function categorizeFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  
  if (rel.includes('client/src/pages')) return 'frontend_page';
  if (rel.includes('client/src/components')) return 'frontend_component';
  if (rel.includes('client/src/hooks')) return 'frontend_hook';
  if (rel.includes('apps/backend/src/routes')) return 'backend_route';
  if (rel.includes('apps/backend/src/v2')) return 'backend_v2';
  if (rel.includes('apps/backend/src/v3')) return 'backend_v3';
  if (rel.includes('apps/backend/src/services')) return 'backend_service';
  if (rel.includes('apps/backend/src/agents')) return 'backend_agent';
  if (rel.includes('apps/backend/src/llm')) return 'backend_llm';
  if (rel.includes('apps/backend/src/db')) return 'backend_db';
  if (rel.includes('apps/backend/src/api')) return 'backend_api';
  if (rel.includes('apps/backend/src/middleware')) return 'backend_middleware';
  if (rel.includes('apps/backend/src/controllers')) return 'backend_controller';
  if (rel.includes('apps/backend/src/connectors')) return 'backend_connector';
  if (rel.includes('apps/backend/src/auth')) return 'backend_auth';
  if (rel.includes('apps/backend/src/security')) return 'backend_security';
  if (rel.includes('apps/backend/src/dispatch')) return 'backend_dispatch';
  if (rel.includes('apps/backend/src/orchestrator')) return 'backend_orchestrator';
  if (rel.includes('apps/backend/src/prompts')) return 'backend_prompts';
  if (rel.includes('apps/backend/src/startup')) return 'backend_startup';
  if (rel.includes('.spec.') || rel.includes('.test.')) return 'test';
  if (rel.includes('scripts/')) return 'script';
  if (rel.endsWith('package.json') || rel.endsWith('tsconfig.json')) return 'config';
  
  return 'other';
}

function analyzeFile(filePath) {
  const parser = getParser(filePath);
  if (!parser) return null;
  
  const sourceCode = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const category = categorizeFile(filePath);
  
  let tree = null;
  let imports = [];
  let exports = [];
  let routes = [];
  let symbols = [];
  
  try {
    tree = parser.parse(sourceCode);
    imports = extractImports(tree, sourceCode);
    exports = extractExports(tree, sourceCode);
    routes = extractRouteHandlers(tree, sourceCode);
    symbols = extractTopLevelSymbols(tree, sourceCode);
  } catch (err) {
    console.error(`   ⚠️  Parse error for ${relPath}: ${err.message}`);
  }
  
  const fileData = {
    path: relPath,
    absolutePath: filePath,
    language: filePath.endsWith('.tsx') ? 'tsx' : filePath.endsWith('.ts') ? 'typescript' : 'javascript',
    category,
    size: sourceCode.length,
    lines: sourceCode.split('\n').length,
    imports: imports.map(i => i.source),
    exports: exports.map(e => e.name),
    routes,
    symbols: symbols.map(s => s.name),
  };
  
  repoMap.files.push(fileData);
  
  graphData.nodes.push({
    id: relPath,
    type: 'file',
    category,
    label: path.basename(filePath),
  });
  
  imports.forEach(imp => {
    repoMap.imports.push({
      from: relPath,
      to: imp.source,
      names: imp.names,
    });
    
    graphData.edges.push({
      source: relPath,
      target: imp.source,
      type: 'imports',
    });
  });
  
  routes.forEach(route => {
    repoMap.routes.push({
      file: relPath,
      method: route.method,
      path: route.path,
      line: route.line,
    });
  });
  
  symbols.forEach(sym => {
    repoMap.symbols.push({
      file: relPath,
      name: sym.name,
      type: sym.type,
      line: sym.line,
    });
  });
  
  return fileData;
}

console.log('🔍 Scanning repository...');

const clientFiles = walkDir(path.join(ROOT, 'client/src'));
const backendFiles = walkDir(path.join(ROOT, 'apps/backend/src'));

const allFiles = [...clientFiles, ...backendFiles].filter(f => {
  return f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.mjs');
});

console.log(`📁 Found ${allFiles.length} source files`);

let analyzed = 0;
allFiles.forEach(file => {
  try {
    analyzeFile(file);
    analyzed++;
    if (analyzed % 50 === 0) {
      console.log(`   Analyzed ${analyzed}/${allFiles.length} files...`);
    }
  } catch (err) {
    console.error(`   ⚠️  Failed to analyze ${path.relative(ROOT, file)}: ${err.message}`);
  }
});

console.log(`✅ Analyzed ${analyzed} files`);

repoMap.buckets = repoMap.files.reduce((acc, f) => {
  if (!acc[f.category]) acc[f.category] = [];
  acc[f.category].push(f.path);
  return acc;
}, {});

console.log('📊 Categorized files:');
Object.entries(repoMap.buckets).forEach(([cat, files]) => {
  console.log(`   ${cat}: ${files.length} files`);
});

fs.writeFileSync(
  path.join(ROOT, 'repo-map.json'),
  JSON.stringify(repoMap, null, 2)
);

fs.writeFileSync(
  path.join(ROOT, 'repo-map.graph.json'),
  JSON.stringify(graphData, null, 2)
);

console.log('✅ Generated repo-map.json');
console.log('✅ Generated repo-map.graph.json');
console.log('📝 Now generating repo-map.md...');
