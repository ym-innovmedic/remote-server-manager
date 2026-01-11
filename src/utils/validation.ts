import { AnsibleHost } from '../models/Connection';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an Ansible host
 */
export function validateHost(host: AnsibleHost): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Must have a name
  if (!host.name) {
    errors.push('Host must have a name');
  }

  // Should have ansible_host or resolvable name
  if (!host.ansible_host && !isValidHostname(host.name)) {
    warnings.push('No IP address and hostname may not resolve');
  }

  // Port validation
  const port = host.remote_mgr_port || host.ansible_port;
  if (port !== undefined && (port < 1 || port > 65535)) {
    errors.push(`Invalid port: ${port}`);
  }

  // Credential consistency
  if (host.remote_mgr_credential_id && host.remote_mgr_credential_strategy === 'prompt') {
    warnings.push('Credential ID set but strategy is prompt');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a string is a valid hostname
 */
export function isValidHostname(hostname: string): boolean {
  if (!hostname) {
    return false;
  }

  // Check if it's an IP address
  if (isValidIpAddress(hostname)) {
    return true;
  }

  // Check if it's a valid FQDN
  // Allow alphanumeric, hyphen, and dots
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return hostnameRegex.test(hostname);
}

/**
 * Check if a string is a valid IP address
 */
export function isValidIpAddress(ip: string): boolean {
  if (!ip) {
    return false;
  }

  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    return parts.every((p) => p >= 0 && p <= 255);
  }

  // IPv6 (simplified check)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  if (ipv6Regex.test(ip)) {
    return true;
  }

  return false;
}

/**
 * Check if a port is valid
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Validate a username
 */
export function isValidUsername(username: string): boolean {
  if (!username) {
    return false;
  }
  // Allow alphanumeric, underscore, hyphen, dot
  return /^[a-zA-Z0-9_.-]+$/.test(username);
}
