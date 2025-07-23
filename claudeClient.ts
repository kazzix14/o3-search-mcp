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
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const claudeCliPath = require.resolve("@anthropic-ai/claude-code/cli.js");
    
    
    // 2) PATH に node_modules/.bin を追加 (Claude MCP サーバー内部のspawn用)
    // Use dirname of claudeCliPath to find the correct node_modules
    const claudeDir = path.dirname(claudeCliPath);
    const nodeModulesDir = path.resolve(claudeDir, '..', '..');
    const binDir = path.join(nodeModulesDir, '.bin');
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const extendedPath = `${binDir}${delimiter}${process.env.PATH || ''}`;
    
    const transport = new StdioClientTransport({
      command: process.execPath, // 現在のnodeバイナリ
      args: [claudeCliPath, "mcp", "serve"],
      env: {
        ...process.env,
        PATH: extendedPath, // 拡張PATH
        CLAUDE_CLI_PATH: claudeCliPath, // Claude CLI内部再spawn用パス
        MCP_TIMEOUT: "30000", // 30秒タイムアウト
      },
    });

    // 2) MCP クライアントハンドルを生成
    const client = new Client({
      name: "o3-search-mcp",
      version: "0.1.0",
    });

    // 3) ハンドシェイク
    await client.connect(transport);
    
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