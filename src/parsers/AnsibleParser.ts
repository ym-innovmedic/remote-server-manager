import {
  AnsibleInventory,
  AnsibleHost,
  AnsibleGroup,
  createEmptyHost,
  ConnectionType,
  CredentialStrategy,
} from '../models/Connection';
import { parseGroupHeader } from '../models/Group';

/**
 * Parsed line from inventory file
 */
interface ParsedLine {
  type: 'comment' | 'group' | 'host' | 'variable' | 'empty' | 'child';
  content: string;
  lineNumber: number;
  inlineComment?: string;
  raw: string;
}

/**
 * Parser for Ansible inventory files (INI format)
 */
export class AnsibleParser {
  /**
   * Parse an Ansible inventory file
   */
  parse(content: string): AnsibleInventory {
    const lines = content.split(/\r?\n/);
    const inventory: AnsibleInventory = {
      groups: [],
      ungroupedHosts: [],
      headerComments: [],
    };

    let currentGroup: AnsibleGroup | null = null;
    let currentGroupType: 'hosts' | 'children' | 'vars' = 'hosts';
    let inHeaderComments = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      const parsed = this.parseLine(line, lineNumber);

      switch (parsed.type) {
        case 'comment':
          if (inHeaderComments && !currentGroup) {
            inventory.headerComments.push(parsed.content);
          } else if (currentGroup) {
            currentGroup.comments.push(parsed.content);
          }
          break;

        case 'empty':
          // Empty lines end header comments section
          if (inHeaderComments && inventory.headerComments.length > 0) {
            inHeaderComments = false;
          }
          break;

        case 'group': {
          inHeaderComments = false;
          const groupHeader = parseGroupHeader(parsed.content);
          if (groupHeader) {
            // Find or create the group
            let group = inventory.groups.find((g) => g.name === groupHeader.name);
            if (!group) {
              group = {
                name: groupHeader.name,
                hosts: [],
                children: [],
                vars: {},
                comments: [],
              };
              inventory.groups.push(group);
            }
            currentGroup = group;
            currentGroupType = groupHeader.type;
          }
          break;
        }

        case 'host': {
          inHeaderComments = false;
          const host = this.parseHostLine(parsed.content, lineNumber);
          if (parsed.inlineComment) {
            host.inlineComment = parsed.inlineComment;
          }
          if (currentGroup && currentGroupType === 'hosts') {
            currentGroup.hosts.push(host);
          } else {
            inventory.ungroupedHosts.push(host);
          }
          break;
        }

        case 'child':
          // In :children section, treat as child group reference
          // Otherwise, treat as bare hostname (host without variables)
          if (currentGroup && currentGroupType === 'children') {
            const childName = parsed.content.trim();
            if (childName && !currentGroup.children.includes(childName)) {
              currentGroup.children.push(childName);
            }
          } else if (currentGroupType === 'hosts' || !currentGroup) {
            // Bare hostname without any variables
            inHeaderComments = false;
            const bareHost = this.parseHostLine(parsed.content, lineNumber);
            if (parsed.inlineComment) {
              bareHost.inlineComment = parsed.inlineComment;
            }
            if (currentGroup) {
              currentGroup.hosts.push(bareHost);
            } else {
              inventory.ungroupedHosts.push(bareHost);
            }
          }
          break;

        case 'variable':
          if (currentGroup && currentGroupType === 'vars') {
            const [key, value] = this.parseVariable(parsed.content);
            if (key) {
              currentGroup.vars[key] = value;
            }
          }
          break;
      }
    }

    return inventory;
  }

  /**
   * Serialize an inventory back to string
   */
  serialize(inventory: AnsibleInventory): string {
    const lines: string[] = [];

    // Header comments
    for (const comment of inventory.headerComments) {
      lines.push(comment);
    }

    if (inventory.headerComments.length > 0) {
      lines.push('');
    }

    // Ungrouped hosts
    if (inventory.ungroupedHosts.length > 0) {
      for (const host of inventory.ungroupedHosts) {
        lines.push(this.serializeHost(host));
      }
      lines.push('');
    }

    // Groups
    for (const group of inventory.groups) {
      // Group comments
      for (const comment of group.comments) {
        lines.push(comment);
      }

      // Host section
      if (group.hosts.length > 0) {
        lines.push(`[${group.name}]`);
        for (const host of group.hosts) {
          lines.push(this.serializeHost(host));
        }
        lines.push('');
      }

      // Children section
      if (group.children.length > 0) {
        lines.push(`[${group.name}:children]`);
        for (const child of group.children) {
          lines.push(child);
        }
        lines.push('');
      }

      // Vars section
      const varsKeys = Object.keys(group.vars);
      if (varsKeys.length > 0) {
        lines.push(`[${group.name}:vars]`);
        for (const key of varsKeys) {
          lines.push(`${key}=${group.vars[key]}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Parse a single line
   */
  private parseLine(line: string, lineNumber: number): ParsedLine {
    const trimmed = line.trim();
    const raw = line;

    // Empty line
    if (trimmed === '') {
      return { type: 'empty', content: '', lineNumber, raw };
    }

    // Comment line
    if (trimmed.startsWith('#')) {
      return { type: 'comment', content: line, lineNumber, raw };
    }

    // Group header
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const header = parseGroupHeader(trimmed);
      if (header) {
        return { type: 'group', content: trimmed, lineNumber, raw };
      }
    }

    // Check for inline comment
    let content = trimmed;
    let inlineComment: string | undefined;
    const commentIndex = this.findInlineCommentIndex(trimmed);
    if (commentIndex !== -1) {
      content = trimmed.substring(0, commentIndex).trim();
      inlineComment = trimmed.substring(commentIndex);
    }

    // Variable assignment (for :vars section)
    // Match pattern: variable_name=value (where variable_name starts with letter/underscore)
    // Variables can have spaces in their values, e.g., util_list= [a, b, c]
    const varMatch = content.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=/);
    if (varMatch) {
      // Check if the part before = has no spaces (i.e., it's a simple variable name)
      // This distinguishes "var=value" from "hostname var=value"
      const beforeEquals = content.indexOf('=');
      const beforePart = content.substring(0, beforeEquals);
      if (!beforePart.includes(' ')) {
        return { type: 'variable', content, lineNumber, inlineComment, raw };
      }
    }

    // Check if it's a child group reference (single word, no =)
    if (!content.includes('=') && !content.includes(' ')) {
      return { type: 'child', content, lineNumber, inlineComment, raw };
    }

    // Host entry
    return { type: 'host', content, lineNumber, inlineComment, raw };
  }

  /**
   * Find the index of an inline comment (not inside quotes)
   */
  private findInlineCommentIndex(line: string): number {
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prevChar = i > 0 ? line[i - 1] : '';

      if (char === "'" && prevChar !== '\\' && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && prevChar !== '\\' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
        // Make sure there's a space before the #
        if (i > 0 && line[i - 1] === ' ') {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Parse a host line into an AnsibleHost object
   */
  private parseHostLine(line: string, lineNumber: number): AnsibleHost {
    const parts = this.tokenizeLine(line);

    if (parts.length === 0) {
      return createEmptyHost('');
    }

    const hostName = parts[0];
    const host = createEmptyHost(hostName);
    host.lineNumber = lineNumber;

    // Parse remaining parts as key=value pairs
    for (let i = 1; i < parts.length; i++) {
      const [key, value] = this.parseVariable(parts[i]);
      if (!key) {
        continue;
      }

      // Handle known variables
      switch (key) {
        case 'ansible_host':
          host.ansible_host = value;
          break;
        case 'ansible_connection':
          host.ansible_connection = value;
          break;
        case 'ansible_port':
          host.ansible_port = parseInt(value, 10) || undefined;
          break;
        case 'ansible_user':
          host.ansible_user = value;
          break;
        case 'ansible_winrm_transport':
          host.ansible_winrm_transport = value;
          break;
        case 'ansible_winrm_server_cert_validation':
          host.ansible_winrm_server_cert_validation = value;
          break;
        case 'remote_mgr_connection_type':
          host.remote_mgr_connection_type = value as ConnectionType;
          break;
        case 'remote_mgr_credential_id':
          host.remote_mgr_credential_id = value;
          break;
        case 'remote_mgr_credential_strategy':
          host.remote_mgr_credential_strategy = value as CredentialStrategy;
          break;
        case 'remote_mgr_domain':
          host.remote_mgr_domain = value;
          break;
        case 'remote_mgr_port':
          host.remote_mgr_port = parseInt(value, 10) || undefined;
          break;
        case 'remote_mgr_display_name':
          host.remote_mgr_display_name = this.unquote(value);
          break;
        case 'comment':
          host.comment = this.unquote(value);
          break;
        default:
          // Store in rawVariables
          host.rawVariables[key] = value;
      }
    }

    return host;
  }

  /**
   * Tokenize a line respecting quotes
   */
  private tokenizeLine(line: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prevChar = i > 0 ? line[i - 1] : '';

      if (char === "'" && prevChar !== '\\' && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        current += char;
      } else if (char === '"' && prevChar !== '\\' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
      } else if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Parse a key=value pair
   */
  private parseVariable(str: string): [string, string] {
    const eqIndex = str.indexOf('=');
    if (eqIndex === -1) {
      return ['', str];
    }

    const key = str.substring(0, eqIndex);
    const value = str.substring(eqIndex + 1);

    return [key, value];
  }

  /**
   * Remove surrounding quotes from a string
   */
  private unquote(str: string): string {
    if (
      (str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))
    ) {
      return str.slice(1, -1);
    }
    return str;
  }

  /**
   * Serialize a host to string
   */
  private serializeHost(host: AnsibleHost): string {
    const parts: string[] = [host.name];

    // Standard Ansible variables
    if (host.ansible_host) {
      parts.push(`ansible_host=${host.ansible_host}`);
    }
    if (host.ansible_connection) {
      parts.push(`ansible_connection=${host.ansible_connection}`);
    }
    if (host.ansible_port) {
      parts.push(`ansible_port=${host.ansible_port}`);
    }
    if (host.ansible_user) {
      parts.push(`ansible_user=${host.ansible_user}`);
    }
    if (host.ansible_winrm_transport) {
      parts.push(`ansible_winrm_transport=${host.ansible_winrm_transport}`);
    }
    if (host.ansible_winrm_server_cert_validation) {
      parts.push(
        `ansible_winrm_server_cert_validation=${host.ansible_winrm_server_cert_validation}`
      );
    }

    // Extension-specific variables
    if (host.remote_mgr_connection_type) {
      parts.push(`remote_mgr_connection_type=${host.remote_mgr_connection_type}`);
    }
    if (host.remote_mgr_credential_id) {
      parts.push(`remote_mgr_credential_id=${host.remote_mgr_credential_id}`);
    }
    if (host.remote_mgr_credential_strategy) {
      parts.push(`remote_mgr_credential_strategy=${host.remote_mgr_credential_strategy}`);
    }
    if (host.remote_mgr_domain) {
      parts.push(`remote_mgr_domain=${host.remote_mgr_domain}`);
    }
    if (host.remote_mgr_port) {
      parts.push(`remote_mgr_port=${host.remote_mgr_port}`);
    }
    if (host.remote_mgr_display_name) {
      parts.push(`remote_mgr_display_name="${host.remote_mgr_display_name}"`);
    }
    if (host.comment) {
      parts.push(`comment="${host.comment}"`);
    }

    // Raw variables (preserve all other Ansible variables)
    for (const [key, value] of Object.entries(host.rawVariables)) {
      parts.push(`${key}=${value}`);
    }

    let result = parts.join(' ');

    // Add inline comment if present
    if (host.inlineComment) {
      result += ` ${host.inlineComment}`;
    }

    return result;
  }
}
