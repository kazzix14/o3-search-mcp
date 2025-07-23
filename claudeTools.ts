#!/usr/bin/env node
import { z } from "zod";
import { ensureClaudeClient } from "./claudeClient.js";

export interface ClaudeToolResult {
  [x: string]: unknown;
  content: Array<{
    [x: string]: unknown;
    type: "text";
    text: string;
    _meta?: { [x: string]: unknown };
  }>;
  isError?: boolean;
  _meta?: { [x: string]: unknown };
}

// Helper function to normalize MCP tool call results
function normalizeMcpResult(mcpResult: any): ClaudeToolResult {
  try {
    if (!mcpResult || !mcpResult.content) {
      return {
        content: [{ type: "text", text: "No content received from Claude tool" }],
        isError: true
      };
    }

    const content = Array.isArray(mcpResult.content) ? mcpResult.content : [mcpResult.content];
    const normalizedContent = content.map((item: any) => {
      if (item.type === "text" && item.text) {
        return { type: "text", text: item.text };
      } else if (item.type === "image" && item.data) {
        return { type: "text", text: `[Image data: ${item.mimeType || 'unknown'}]` };
      } else if (item.type === "resource" && item.resource) {
        return { type: "text", text: item.resource.text || item.resource.uri || "[Resource]" };
      } else {
        return { type: "text", text: JSON.stringify(item) };
      }
    });

    return {
      content: normalizedContent,
      isError: false
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error normalizing MCP result: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

// View tool - ファイル読み取り
export async function viewFile(path: string): Promise<ClaudeToolResult> {
  try {
    const { client } = await ensureClaudeClient();
    const result = await client.callTool({
      name: "Read",
      arguments: { file_path: path },
    });
    return normalizeMcpResult(result);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error reading file: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

// Edit tool - ファイル編集
export async function editFile(file_path: string, old_string: string, new_string: string): Promise<ClaudeToolResult> {
  try {
    const { client } = await ensureClaudeClient();
    const result = await client.callTool({
      name: "Edit",
      arguments: { file_path, old_string, new_string },
    });
    return normalizeMcpResult(result);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error editing file: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

// LS tool - ディレクトリ一覧
export async function listDirectory(path: string = "."): Promise<ClaudeToolResult> {
  try {
    const { client } = await ensureClaudeClient();
    const result = await client.callTool({
      name: "LS",
      arguments: { path },
    });
    return normalizeMcpResult(result);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error listing directory: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

// Write tool - ファイル新規作成
export async function writeFile(path: string, content: string): Promise<ClaudeToolResult> {
  try {
    const { client } = await ensureClaudeClient();
    const result = await client.callTool({
      name: "Write",
      arguments: { file_path: path, content },
    });
    return normalizeMcpResult(result);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error writing file: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

// Bash tool - コマンド実行
export async function runBash(command: string): Promise<ClaudeToolResult> {
  try {
    const { client } = await ensureClaudeClient();
    const result = await client.callTool({
      name: "Bash",
      arguments: { command },
    });
    return normalizeMcpResult(result);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error running command: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

// Grep tool - ファイル検索
export async function grepFiles(pattern: string, path?: string): Promise<ClaudeToolResult> {
  try {
    const { client } = await ensureClaudeClient();
    const args: any = { pattern };
    if (path) args.path = path;
    
    const result = await client.callTool({
      name: "Grep",
      arguments: args,
    });
    return normalizeMcpResult(result);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error searching files: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}