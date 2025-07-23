#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface ClaudeClientWrapper {
  client: Client;
  transport: StdioClientTransport;
}

let claudeClient: ClaudeClientWrapper | null = null;

export async function createClaudeClient(): Promise<ClaudeClientWrapper> {
  try {
    // 1) ESM環境でClaude CLI絶対パスを取得
    const path = await import('path');
    const fs = await import('fs');
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const claudeCliPath = require.resolve("@anthropic-ai/claude-code/cli.js");
    
    // Check if CLI exists
    if (!fs.existsSync(claudeCliPath)) {
      throw new Error(`Claude CLI not found at: ${claudeCliPath}`);
    }
    
    process.stderr.write(`[claude-code-tools] Using CLI path: ${claudeCliPath}\n`);
    
    // 2) PATH に node_modules/.bin を追加 (Claude MCP サーバー内部のspawn用)
    // Try both current directory and claude CLI directory for node_modules
    const cwdBinDir = path.resolve(process.cwd(), 'node_modules', '.bin');
    const claudeDir = path.dirname(claudeCliPath);
    const claudeNodeModulesDir = path.resolve(claudeDir, '..', '..');
    const claudeBinDir = path.join(claudeNodeModulesDir, '.bin');
    const delimiter = process.platform === 'win32' ? ';' : ':';
    // Include both possible node_modules/.bin directories in PATH
    const extendedPath = `${cwdBinDir}${delimiter}${claudeBinDir}${delimiter}${process.env.PATH || ''}`;
    
    const transport = new StdioClientTransport({
      command: process.execPath, // 現在のnodeバイナリ
      args: [claudeCliPath, "mcp", "serve"],
      env: {
        ...process.env,
        PATH: extendedPath, // 拡張PATH
        CLAUDE_CLI_PATH: claudeCliPath, // Claude CLI内部再spawn用パス
        MCP_TIMEOUT: "30000", // 30秒タイムアウト
        MCP_CLAUDE_DEBUG: "true", // Enable debug output
        DEBUG: "mcp:*", // General MCP debug
      },
    });

    // Capture stderr for debugging
    const transportAny = transport as any;
    if (transportAny.proc && transportAny.proc.stderr) {
      transportAny.proc.stderr.on('data', (data: Buffer) => {
        process.stderr.write(`[claude-code-tools stderr]: ${data.toString()}`);
      });
    }

    // 2) MCP クライアントハンドルを生成
    const client = new Client({
      name: "o3-search-mcp",
      version: "0.1.0",
    });

    // 3) ハンドシェイク
    try {
      await client.connect(transport);
    } catch (error) {
      process.stderr.write(`[claude-code-tools] Connection error: ${error}\n`);
      // Check if process exited
      if (transportAny.proc && transportAny.proc.exitCode !== null) {
        process.stderr.write(`[claude-code-tools] Process exited with code: ${transportAny.proc.exitCode}\n`);
      }
      throw error;
    }
    
    // 4) 利用可能なツールを確認
    try {
      await client.listTools();
    } catch (error) {
      // Silently ignore tool listing errors
    }
    
    // 4) エラーハンドリング
    transport.onclose = () => {
      claudeClient = null;
    };

    client.onerror = (error) => {
      // Silent error handling
    };

    return { client, transport };
  } catch (error) {
    throw error;
  }
}

export async function ensureClaudeClient(): Promise<ClaudeClientWrapper> {
  if (!claudeClient || (claudeClient.transport as any).closed) {
    try {
      claudeClient = await createClaudeClient();
    } catch (err) {
      throw err;
    }
  }
  return claudeClient;
}

export async function closeClaudeClient(): Promise<void> {
  if (claudeClient) {
    try {
      await claudeClient.client.close();
    } catch (err) {
      // Silent error handling
    }
    claudeClient = null;
  }
}

// 監視・再接続ループ
let supervisionInterval: NodeJS.Timeout | null = null;

export function startClaudeSupervision(): void {
  if (supervisionInterval) return;
  
  supervisionInterval = setInterval(async () => {
    try {
      await ensureClaudeClient();
    } catch (err) {
      // Silent supervision error
    }
  }, 10000); // 10秒間隔
}

export function stopClaudeSupervision(): void {
  if (supervisionInterval) {
    clearInterval(supervisionInterval);
    supervisionInterval = null;
  }
}