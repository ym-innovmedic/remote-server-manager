import { ConnectionType, CredentialStrategy } from './Connection';

/**
 * Represents a stored credential
 */
export interface Credential {
  id: string;
  name: string; // Display name: "admin (RDP)"
  username: string;
  password?: string; // Only if strategy is 'save'
  domain?: string; // For RDP/Windows
  strategy: CredentialStrategy;
  category: ConnectionType;
  createdAt?: Date;
  modifiedAt?: Date;
}

/**
 * Generate a unique credential ID
 */
export function generateCredentialId(username: string, category: ConnectionType): string {
  const timestamp = Date.now();
  return `cred_${timestamp}_${username}_${category}`;
}

/**
 * Create a credential display name
 */
export function createCredentialDisplayName(
  username: string,
  category: ConnectionType
): string {
  return `${username} (${category.toUpperCase()})`;
}

/**
 * JSON credential format (for import/export)
 */
export interface JsonCredential {
  id: string;
  name: string;
  username: string;
  password?: string;
  domain?: string;
  category?: string;
  group?: string;
  hasRootAccess?: boolean;
  createdAt?: string;
  modifiedAt?: string;
}

/**
 * Convert JSON credential to internal format
 */
export function convertJsonCredential(
  json: JsonCredential,
  strategy: CredentialStrategy = 'save'
): Credential {
  return {
    id: json.id,
    name: json.name,
    username: json.username,
    password: json.password,
    strategy,
    category: (json.category as ConnectionType) || 'ssh',
    createdAt: json.createdAt ? new Date(json.createdAt) : new Date(),
    modifiedAt: json.modifiedAt ? new Date(json.modifiedAt) : new Date(),
  };
}
