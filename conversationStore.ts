import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';

interface ConversationEntry {
  timestamp: string;
  input: string;
  filePaths?: string[];
  response: string;
}

interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  entries: ConversationEntry[];
}

export class ConversationStore {
  private conversations: Map<string, Conversation> = new Map();
  private dataDir: string;

  constructor() {
    // Use XDG_STATE_HOME or fallback to ~/.local/state
    const stateHome = process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state');
    this.dataDir = path.join(stateHome, 'o3-search-mcp', 'conversations');
    this.initializeDataDir();
  }

  private async initializeDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadAllConversations();
    } catch (error) {
      console.error('Failed to initialize data directory:', error);
    }
  }

  private async loadAllConversations(): Promise<void> {
    try {
      const files = await fs.readdir(this.dataDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.dataDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const conversation = JSON.parse(data) as Conversation;
          this.conversations.set(conversation.id, conversation);
        } catch (error) {
          console.error(`Failed to load conversation ${file}:`, error);
        }
      }
      
      console.log(`Loaded ${this.conversations.size} conversations from disk`);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }

  private async saveConversation(conversation: Conversation): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, `${conversation.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save conversation ${conversation.id}:`, error);
    }
  }

  private async deleteConversationFile(id: string): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, `${id}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // File might not exist, which is fine
      if ((error as any).code !== 'ENOENT') {
        console.error(`Failed to delete conversation file ${id}:`, error);
      }
    }
  }

  getConversation(id: string): Conversation | null {
    return this.conversations.get(id) || null;
  }

  async resetConversation(id: string): Promise<void> {
    this.conversations.delete(id);
    await this.deleteConversationFile(id);
  }

  async createOrUpdateConversation(
    id: string,
    input: string,
    response: string,
    filePaths?: string[]
  ): Promise<void> {
    let conversation = this.getConversation(id);
    
    const entry: ConversationEntry = {
      timestamp: new Date().toISOString(),
      input,
      response,
      ...(filePaths && { filePaths })
    };

    if (!conversation) {
      conversation = {
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: [entry]
      };
    } else {
      conversation.entries.push(entry);
      conversation.updatedAt = new Date().toISOString();
    }

    this.conversations.set(id, conversation);
    await this.saveConversation(conversation);
  }

  getConversationContext(conversation: Conversation, maxEntries: number = 10): string {
    const recentEntries = conversation.entries.slice(-maxEntries);
    
    if (recentEntries.length === 0) {
      return "";
    }

    let context = "## Previous Conversation Context\n\n";
    
    for (const entry of recentEntries) {
      context += `### User Query (${new Date(entry.timestamp).toLocaleString()}):\n`;
      context += `${entry.input}\n\n`;
      
      if (entry.filePaths && entry.filePaths.length > 0) {
        context += `**Files analyzed:** ${entry.filePaths.join(", ")}\n\n`;
      }
      
      context += `### AI Response:\n`;
      context += `${entry.response}\n\n`;
      context += "---\n\n";
    }

    return context;
  }
}
