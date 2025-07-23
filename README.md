# o3-search-mcp

An MCP (Model Context Protocol) server that provides advanced AI capabilities using OpenAI's o3 model. Features include web search, persistent conversation memory, file analysis, and **git diff analysis** for debugging code changes.

<a href="https://glama.ai/mcp/servers/@yoshiko-pg/o3-search-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@yoshiko-pg/o3-search-mcp/badge" alt="o3-search MCP server" />
</a>

## Installation

### Using npx (Recommended)

Claude Code:

```
$ claude mcp add o3 -s user \
	-e OPENAI_API_KEY=your-api-key \
	-e SEARCH_CONTEXT_SIZE=medium \
	-e REASONING_EFFORT=medium \
	-- npx o3-search-mcp
```

json:

```json
{
  "mcpServers": {
    "o3-search": {
      "command": "npx",
      "args": ["o3-search-mcp"],
      "env": {
        "OPENAI_API_KEY": "your-api-key",
        // Optional: low, medium, high (default: medium)
        "SEARCH_CONTEXT_SIZE": "medium",
        "REASONING_EFFORT": "medium"
      }
    }
  }
}
```

### Local Development Setup

If you want to download and run the code locally:

   ```bash
   # setup
   git clone git@github.com:yoshiko-pg/o3-search-mcp.git
   cd o3-search-mcp
   pnpm install
   pnpm build
   ```

Claude Code:

```
$ claude mcp add o3 -s user \
	-e OPENAI_API_KEY=your-api-key \
	-e SEARCH_CONTEXT_SIZE=medium \
	-e REASONING_EFFORT=medium \
	-- node /path/to/o3-search-mcp/build/index.js
```

json:

```json
{
  "mcpServers": {
    "o3-search": {
      "command": "node",
      "args": ["/path/to/o3-search-mcp/build/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-api-key",
        // Optional: low, medium, high (default: medium)
        "SEARCH_CONTEXT_SIZE": "medium",
        "REASONING_EFFORT": "medium"
      }
    }
  }
}
```

## Features

### 🔍 Web Search with o3 Reasoning
Get up-to-date information with OpenAI's most advanced reasoning model.

### 💬 Persistent Conversations
Conversations are automatically saved to `~/.local/state/o3-search-mcp/conversations/` and persist across sessions.

### 📁 File Content Analysis
Analyze any text-based files by providing absolute file paths.

### 🔄 **NEW: Git Diff Analysis**
Debug code changes by comparing commits, branches, or working directory changes. Perfect for "it was working before..." scenarios.

## Usage Examples

### Basic Query
```javascript
{
  "input": "What are the latest TypeScript 5.0 features?"
}
```

### File Analysis
```javascript
{
  "input": "Review this code for potential bugs",
  "file_paths": ["/Users/name/project/src/main.ts"]
}
```

### Git Diff Analysis - Debug After Changes
```javascript
// "It was working before I refactored..."
{
  "input": "I refactored the code and now there's an infinite loop",
  "from": "HEAD~1"
}

// Compare specific commits
{
  "input": "What changed between these versions?",
  "from": "v1.0.0",
  "to": "v1.1.0"
}

// Compare branches
{
  "input": "Review the changes in this feature branch",
  "from": "main",
  "to": "feature/new-auth"
}

// Include your working changes
{
  "input": "Debug my current changes",
  "from": "HEAD",
  "unstaged": true  // Default when 'to' is not specified
}
```

### Combined Analysis - The Full Power
```javascript
{
  "input": "After refactoring, the API returns infinite responses. Check the stream handler too.",
  "from": "HEAD~1",
  "file_paths": ["/path/to/src/api/stream.rs"],
  "conversation_id": "debug-session-1"
}
```

### Continuing Debug Sessions
```javascript
{
  "input": "I fixed the infinite loop but now Markdown isn't rendering",
  "from": "HEAD~2", 
  "conversation_id": "debug-session-1"  // Continues previous analysis
}
```

## Git Diff Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | string | **Required for diff analysis.** Git reference (commit, branch, tag) to compare from |
| `to` | string | Git reference to compare to. If omitted, compares against working directory |
| `unstaged` | boolean | Include uncommitted changes. Default: `true` when `to` is not specified |

## Common Debugging Scenarios

### "It was working yesterday..."
```javascript
{
  "input": "Tests were passing yesterday, now they fail",
  "from": "HEAD~1"
}
```

### "Production is broken"
```javascript
{
  "input": "Production has errors but staging works fine",
  "from": "staging",
  "to": "production"
}
```

### "My refactoring broke something"
```javascript
{
  "input": "After moving client-side logic, the app crashes",
  "from": "before-refactor-tag",
  "file_paths": ["/src/components/App.tsx", "/src/api/client.ts"]
}
```

### Code Review with AI
```javascript
{
  "input": "Review this PR for potential issues and improvements",
  "from": "main",
  "to": "feature/user-authentication"
}
```

## Error Handling

The tool provides clear error messages for common issues:

- **Not a git repository**: Ensure you're in a git repository
- **Invalid references**: Check that branch/commit names exist
- **Diff too large**: Consider narrowing the scope or analyzing specific files
- **Git command not found**: Install git and ensure it's in your PATH

## Tips for Best Results

1. **Be specific in your questions**: Instead of "something is broken", try "infinite API calls after refactoring"

2. **Combine with file analysis**: Use `file_paths` to provide current file content alongside the diff

3. **Use conversation IDs**: For complex debugging sessions, maintain context across multiple queries

4. **Start with recent changes**: Use `HEAD~1` or `HEAD~2` to focus on recent modifications

5. **Review before deploying**: Compare your feature branch against main before merging